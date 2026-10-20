// Rolagens: simular e comparar alternativas, confirmar (gravar as execuções ligadas a
// uma rolagem), desfazer, e sugerir séries candidatas pelos critérios do usuário.
//
// Regras que valem para tudo aqui:
// - nada envia ordem; confirmar só registra o que o usuário diz que fez na corretora;
// - crédito não é lucro: o simulador mostra o fluxo de caixa separado do resultado;
// - preço que falta não vira zero: a alternativa sai com o motivo;
// - o sistema não elege a melhor alternativa nem ordena por crédito.

import type { FastifyInstance } from 'fastify';
import {
  avaliarCandidato, curvaDePayoff, ErroDePosicao, ErroDeValor, montarCarteira, pernasAbertas, precoParaAbrir, precoParaEncerrar,
  resumoDaAvaliacao, simularRolagem, situacaoDoMercado, TEXTO_DOS_AVISOS,
  type AnaliseDePayoff, type Carteira, type CriteriosDeRolagem, type PedidoDeRolagem, type PernaAAbrir, type PernaAEncerrar,
} from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, type Cliente } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario, paraCotacao, type CotacaoDeSaida } from '../cotacoes.ts';
import { CODIGO, conferirEstrategia, inserirExecucao, paraDominio, serieDoCodigo, UUID } from './posicoes.ts';

const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const CENTAVOS = { type: 'integer', minimum: 0, maximum: 100_000_000 } as const;
const QUANTIDADE = { type: 'integer', minimum: 1, maximum: 100_000_000 } as const;

const ENCERRAR = {
  type: 'array', maxItems: 8,
  items: {
    type: 'object', additionalProperties: false, required: ['codigo', 'quantidade'],
    properties: { codigo: CODIGO, quantidade: QUANTIDADE, preco: CENTAVOS, custos: CENTAVOS },
  },
} as const;
const ABRIR = {
  type: 'array', maxItems: 8,
  items: {
    type: 'object', additionalProperties: false, required: ['codigo', 'lado', 'quantidade'],
    properties: {
      codigo: CODIGO, tipo: { type: 'string', enum: ['call', 'put', 'ativo'] }, strike: { type: 'integer', minimum: 1, maximum: 100_000_000 },
      vencimento: DIA, lado: { type: 'string', enum: ['compra', 'venda'] }, quantidade: QUANTIDADE, preco: CENTAVOS, custos: CENTAVOS,
    },
  },
} as const;

type Encerrar = { codigo: string; quantidade: number; preco?: number; custos?: number };
type Abrir = { codigo: string; tipo?: 'call' | 'put' | 'ativo'; strike?: number; vencimento?: string; lado: 'compra' | 'venda'; quantidade: number; preco?: number; custos?: number };

type PrecoUsado = {
  codigo: string; acao: 'encerrar' | 'abrir'; lado: 'compra' | 'venda'; quantidade: number; preco: number;
  origem: string; estimativa: boolean; qualidade: string | null; instanteDaFonte: string | null;
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// Erro do domínio → código estável para a tela (alguns trazem o código do ativo no fim).
function erroDaRolagem(e: unknown): { erro: string; codigo?: string } {
  if (e instanceof ErroDePosicao || e instanceof ErroDeValor) {
    const m = /^(nada_aberto|quantidade_a_encerrar_invalida)_em_(.+)$/.exec(e.message);
    return m ? { erro: m[1] as string, codigo: m[2] as string } : { erro: e.message };
  }
  throw e;
}

function resumoDoPayoff(a: AnaliseDePayoff | null) {
  return a ? { pontosDeEquilibrio: a.pontosDeEquilibrio, lucroMaximo: a.lucroMaximo, perdaMaxima: a.perdaMaxima } : null;
}

function ajusteDa(c: Carteira): number {
  let realizado = 0;
  let custos = 0;
  for (const i of c.values()) { realizado += i.realizadoBruto; custos += i.custosPagos; }
  return Math.round(realizado) - custos;
}

// Curvas de antes e depois na MESMA faixa de preço, para o gráfico comparar.
function curvas(antes: Carteira, depois: Carteira, payoffAntes: AnaliseDePayoff | null, payoffDepois: AnaliseDePayoff | null, referencia: number | null) {
  const pa = pernasAbertas(antes);
  const pd = pernasAbertas(depois);
  const strikes = [...pa, ...pd].filter((p) => p.strike !== undefined).map((p) => p.strike as number);
  const equilibrios = [...(payoffAntes?.pontosDeEquilibrio ?? []), ...(payoffDepois?.pontosDeEquilibrio ?? [])].map((x) => x * 100);
  const ref = referencia ?? (strikes.length ? strikes.reduce((a, b) => a + b, 0) / strikes.length : null);
  if (!ref || ref <= 0) return null;
  const pontos = [ref * 0.7, ref * 1.3, ...strikes, ...equilibrios];
  let de = Math.max(0, Math.min(...pontos));
  let ate = Math.max(...pontos);
  const margem = (ate - de) * 0.05;
  de = Math.max(0, Math.round(de - margem));
  ate = Math.round(ate + margem);
  if (ate <= de) return null;
  return {
    referencia: ref,
    antes: payoffAntes ? curvaDePayoff(pa, de, ate, 80, ajusteDa(antes)) : null,
    depois: payoffDepois ? curvaDePayoff(pd, de, ate, 80, ajusteDa(depois)) : null,
  };
}

async function carregarEstrategia(c: Cliente, id: string) {
  const est = (await c.query('select id, nome, ativo_objeto, situacao from estrategias where id = $1', [id])).rows[0];
  if (!est) throw new ErroHttp(404, 'nao_encontrado');
  const execs = (await c.query(
    `select codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade, preco, custos, instante
     from execucoes where estrategia_id = $1`, [id],
  )).rows.map(paraDominio);
  let carteira: Carteira;
  try {
    carteira = montarCarteira(execs);
  } catch (e) {
    throw new ErroHttp(409, 'estrategia_inconsistente', { motivo: e instanceof Error ? e.message : 'erro' });
  }
  return { est: est as { id: string; nome: string; ativo_objeto: string; situacao: string }, carteira };
}

export async function rotasDeRolagens(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  // Monta o pedido do domínio completando dados da série e preços que faltam com o
  // preço executável do momento (ou o último negócio, marcado como estimativa).
  async function montarPedido(c: Cliente, carteira: Carteira, encerrar: Encerrar[], abrir: Abrir[], cotacoes: Map<string, CotacaoDeSaida>, hoje: string, instante: string, exigirPreco: boolean) {
    const precos: PrecoUsado[] = [];
    const pe: PernaAEncerrar[] = [];
    for (const e of encerrar) {
      const codigo = e.codigo.toUpperCase();
      const atual = carteira.get(codigo);
      if (!atual || atual.quantidade === 0) return { erro: 'nada_aberto', codigo } as const;
      const lado = atual.quantidade > 0 ? 'venda' as const : 'compra' as const;
      const q = cotacoes.get(codigo) ?? null;
      let preco = e.preco;
      let origem = 'informado';
      let estimativa = false;
      if (preco === undefined) {
        if (exigirPreco) return { erro: 'preco_obrigatorio', codigo } as const;
        const p = q ? precoParaEncerrar(paraCotacao(q), atual.quantidade > 0 ? 'comprada' : 'vendida', 'executavel_ou_ultimo') : null;
        if (!p || !p.ok) return { erro: 'sem_preco', codigo } as const;
        preco = Math.round(p.valor);
        origem = p.origem;
        estimativa = p.estimativa;
      }
      pe.push({ codigo, quantidade: e.quantidade, preco, estimativa, ...(e.custos !== undefined ? { custos: e.custos } : {}) });
      precos.push({ codigo, acao: 'encerrar', lado, quantidade: e.quantidade, preco, origem, estimativa, qualidade: q?.qualidade ?? null, instanteDaFonte: q?.instanteDaFonte ?? null });
    }
    const pa: PernaAAbrir[] = [];
    for (const a of abrir) {
      const codigo = a.codigo.toUpperCase();
      let tipo = a.tipo;
      let strike = a.strike;
      let vencimento = a.vencimento;
      const ja = carteira.get(codigo);
      if (ja) { tipo ??= ja.tipo; strike ??= ja.strike; vencimento ??= ja.vencimento; }
      if (!tipo || (tipo !== 'ativo' && (strike === undefined || vencimento === undefined))) {
        const serie = await serieDoCodigo(c, codigo, hoje);
        if (!serie) return { erro: 'serie_desconhecida', codigo } as const;
        tipo = serie.tipo;
        strike = serie.strike ?? undefined;
        vencimento = serie.vencimento ?? undefined;
      }
      if (tipo === 'ativo') { strike = undefined; vencimento = undefined; }
      const q = cotacoes.get(codigo) ?? null;
      let preco = a.preco;
      let origem = 'informado';
      let estimativa = false;
      if (preco === undefined) {
        if (exigirPreco) return { erro: 'preco_obrigatorio', codigo } as const;
        const p = q ? precoParaAbrir(paraCotacao(q), a.lado, 'executavel_ou_ultimo') : null;
        if (!p || !p.ok) return { erro: 'sem_preco', codigo } as const;
        preco = Math.round(p.valor);
        origem = p.origem;
        estimativa = p.estimativa;
      }
      pa.push({
        codigo, tipo, lado: a.lado, quantidade: a.quantidade, preco, estimativa, multiplicador: ja?.multiplicador ?? 1,
        ...(strike !== undefined ? { strike } : {}), ...(vencimento !== undefined ? { vencimento } : {}), ...(a.custos !== undefined ? { custos: a.custos } : {}),
      });
      precos.push({ codigo, acao: 'abrir', lado: a.lado, quantidade: a.quantidade, preco, origem, estimativa, qualidade: q?.qualidade ?? null, instanteDaFonte: q?.instanteDaFonte ?? null });
    }
    const pedido: PedidoDeRolagem = { encerrar: pe, abrir: pa, instante };
    return { pedido, precos } as const;
  }

  function saidaDaSimulacao(carteira: Carteira, pedido: PedidoDeRolagem, referencia: number | null) {
    const r = simularRolagem(carteira, pedido);
    return {
      fluxo: r.fluxo,
      realizadoNoEncerramento: r.realizadoNoEncerramento,
      realizadoAcumulado: r.realizadoAcumulado,
      payoff: { antes: resumoDoPayoff(r.payoff.antes), depois: resumoDoPayoff(r.payoff.depois) },
      ultimoVencimento: r.ultimoVencimento,
      avisos: r.avisos.map((codigo) => ({ codigo, texto: TEXTO_DOS_AVISOS[codigo] })),
      curvas: curvas(carteira, r.carteiraDepois, r.payoff.antes, r.payoff.depois, referencia),
      execucoes: r.execucoes.map((e) => ({
        codigo: e.codigo, tipo: e.tipo, strike: e.strike ?? null, vencimento: e.vencimento ?? null, lado: e.lado, quantidade: e.quantidade, preco: e.preco, custos: e.custos ?? 0,
      })),
    };
  }

  // ---------- Simular e comparar ----------

  app.post('/api/rolagens/simular', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['estrategiaId', 'alternativas'],
        properties: {
          estrategiaId: UUID,
          alternativas: {
            type: 'array', minItems: 1, maxItems: 4,
            items: {
              type: 'object', additionalProperties: false, required: ['nome', 'encerrar', 'abrir'],
              properties: { nome: { type: 'string', minLength: 1, maxLength: 60 }, encerrar: ENCERRAR, abrir: ABRIR },
            },
          },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const b = req.body as { estrategiaId: string; alternativas: { nome: string; encerrar: Encerrar[]; abrir: Abrir[] }[] };
    const agora = relogio();
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(agora, cfg).dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const { est, carteira } = await carregarEstrategia(c, b.estrategiaId);
      const codigos = new Set<string>([est.ativo_objeto]);
      for (const a of b.alternativas) for (const x of [...a.encerrar, ...a.abrir]) codigos.add(x.codigo.toUpperCase());
      const lista = await cotacoesDoUsuario(c, [...codigos], agora, cfg);
      const cotacoes = new Map(lista.map((q) => [q.codigo, q]));
      const ativo = cotacoes.get(est.ativo_objeto) ?? null;
      const alternativas = [];
      for (const a of b.alternativas) {
        const m = await montarPedido(c, carteira, a.encerrar, a.abrir, cotacoes, hoje, agora.toISOString(), false);
        if ('erro' in m) { alternativas.push({ nome: a.nome, ok: false as const, erro: m.erro, codigo: m.codigo }); continue; }
        try {
          alternativas.push({ nome: a.nome, ok: true as const, precos: m.precos, ...saidaDaSimulacao(carteira, m.pedido, ativo?.ultimo ?? null) });
        } catch (e) {
          alternativas.push({ nome: a.nome, ok: false as const, ...erroDaRolagem(e) });
        }
      }
      return {
        agora: agora.toISOString(),
        estrategia: { id: est.id, nome: est.nome, ativoObjeto: est.ativo_objeto },
        ativo,
        alternativas,
        premissas: [
          'Preço que você não informou: o executável do momento (quem compra paga o melhor vendedor; quem vende recebe o melhor comprador). Sem oferta, o último negócio, marcado como estimativa.',
          'Fora do pregão, os preços são do fechamento oficial da B3 do último pregão: servem para comparar, não garantem execução.',
          'Equilíbrio, lucro e perda máximos são da estratégia inteira no vencimento: pernas abertas ao preço médio, mais o que já foi realizado, menos os custos pagos.',
          'As alternativas aparecem na ordem em que você montou. O sistema não escolhe a melhor: crédito maior não quer dizer rolagem melhor.',
        ],
      };
    });
  });

  // ---------- Confirmar (registrar o que foi feito na corretora) ----------

  app.post('/api/rolagens', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['estrategiaId', 'instante', 'encerrar', 'abrir'],
        properties: {
          estrategiaId: UUID, instante: { type: 'string', minLength: 10, maxLength: 40 }, observacao: { type: 'string', maxLength: 300 },
          encerrar: ENCERRAR, abrir: ABRIR,
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { estrategiaId: string; instante: string; observacao?: string; encerrar: Encerrar[]; abrir: Abrir[] };
    const agora = relogio();
    const t = Date.parse(b.instante);
    if (Number.isNaN(t) || t < Date.parse('2000-01-01T00:00:00Z')) throw new ErroHttp(400, 'instante_invalido');
    if (t > agora.getTime() + 5 * 60_000) throw new ErroHttp(400, 'instante_no_futuro');
    const instante = new Date(t).toISOString();
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(agora, cfg).dia;
    const resultado = await emTransacao(pool, s.usuarioId, async (c) => {
      await c.query('select 1 from estrategias where id = $1 for update', [b.estrategiaId]);
      const { est, carteira } = await carregarEstrategia(c, b.estrategiaId);
      if (est.situacao !== 'aberta') throw new ErroHttp(409, 'estrategia_encerrada');
      const m = await montarPedido(c, carteira, b.encerrar, b.abrir, new Map(), hoje, instante, true);
      if ('erro' in m) throw new ErroHttp(400, m.erro, { codigo: m.codigo });
      let sim: ReturnType<typeof saidaDaSimulacao>;
      try {
        sim = saidaDaSimulacao(carteira, m.pedido, null);
      } catch (e) {
        const x = erroDaRolagem(e);
        throw new ErroHttp(400, x.erro, x.codigo ? { codigo: x.codigo } : undefined);
      }
      const resumo = {
        fluxo: sim.fluxo, realizadoNoEncerramento: sim.realizadoNoEncerramento, avisos: sim.avisos.map((a) => a.codigo),
        payoff: sim.payoff, ultimoVencimento: sim.ultimoVencimento,
        pernas: m.precos.map((p) => ({ acao: p.acao, codigo: p.codigo, lado: p.lado, quantidade: p.quantidade, preco: p.preco })),
      };
      const obs = b.observacao?.trim() || null;
      const id = (await c.query(
        'insert into rolagens (user_id, estrategia_id, instante, observacao, resumo) values ($1, $2, $3, $4, $5) returning id',
        [s.usuarioId, est.id, instante, obs, JSON.stringify(resumo)],
      )).rows[0].id as string;
      for (const e of sim.execucoes) {
        await inserirExecucao(c, s.usuarioId, est.id, {
          codigo: e.codigo, tipo: e.tipo, lado: e.lado, quantidade: e.quantidade, preco: e.preco, custos: e.custos, instante,
          multiplicador: carteira.get(e.codigo)?.multiplicador ?? 1, observacao: 'Rolagem',
          ...(e.strike !== null ? { strike: e.strike } : {}), ...(e.vencimento !== null ? { vencimento: e.vencimento } : {}),
        }, 'manual', id);
      }
      await conferirEstrategia(c, est.id);
      await auditar(c, s, 'rolagem.confirmada', { tipo: 'rolagem', id, depois: { estrategia: est.id, ...resumo } }, ipDe(req));
      return { id, resumo };
    });
    return reply.status(201).send(resultado);
  });

  app.delete('/api/rolagens/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = (await c.query(
        `select r.estrategia_id, r.resumo, e.situacao from rolagens r join estrategias e on e.id = r.estrategia_id where r.id = $1 for update of e`, [id],
      )).rows[0];
      if (!r) throw new ErroHttp(404, 'nao_encontrado');
      if (r.situacao !== 'aberta') throw new ErroHttp(409, 'estrategia_encerrada');
      await c.query('delete from rolagens where id = $1', [id]);
      await conferirEstrategia(c, r.estrategia_id);
      await auditar(c, s, 'rolagem.desfeita', { tipo: 'rolagem', id, antes: { estrategia: r.estrategia_id, ...r.resumo } }, ipDe(req));
      return { ok: true };
    });
  });

  // ---------- Sugestões ----------

  app.get('/api/rolagens/sugestoes', {
    config: { politica: 'autenticado' },
    schema: {
      querystring: {
        type: 'object', additionalProperties: false, required: ['estrategiaId', 'codigo'],
        properties: {
          estrategiaId: UUID, codigo: CODIGO,
          diasMin: { type: 'integer', minimum: 0, maximum: 1000 }, diasMax: { type: 'integer', minimum: 0, maximum: 1000 },
          deltaMin: { type: 'number', minimum: 0, maximum: 1 }, deltaMax: { type: 'number', minimum: 0, maximum: 1 },
          creditoMinimo: { type: 'integer', minimum: -100_000_000, maximum: 100_000_000 }, debitoMaximo: { type: 'integer', minimum: 0, maximum: 100_000_000 },
          negociosMin: { type: 'integer', minimum: 0, maximum: 1_000_000 }, spreadMaximoPct: { type: 'number', minimum: 0, maximum: 200 },
          strike: { type: 'string', enum: ['manter', 'acima', 'abaixo', 'qualquer'] }, perdaMaximaNaoAumenta: { type: 'boolean' },
          mesmoVencimento: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const q = req.query as CriteriosDeRolagem & { estrategiaId: string; codigo: string; mesmoVencimento?: boolean };
    const codigo = q.codigo.toUpperCase();
    const criterios: CriteriosDeRolagem = {};
    for (const k of ['diasMin', 'diasMax', 'deltaMin', 'deltaMax', 'creditoMinimo', 'debitoMaximo', 'negociosMin', 'spreadMaximoPct', 'strike', 'perdaMaximaNaoAumenta'] as const) {
      if (q[k] !== undefined) (criterios as Record<string, unknown>)[k] = q[k];
    }
    const agora = relogio();
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(agora, cfg).dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const { est, carteira } = await carregarEstrategia(c, q.estrategiaId);
      const perna = carteira.get(codigo);
      if (!perna || perna.quantidade === 0) throw new ErroHttp(404, 'perna_nao_aberta');
      if (perna.tipo === 'ativo' || perna.strike === undefined || !perna.vencimento) throw new ErroHttp(400, 'so_opcao_rola');
      const dia = (await c.query(
        "select to_char(max(dia), 'YYYY-MM-DD') as dia from fechamentos where codigo = $1 and tipo_mercado = 10", [est.ativo_objeto],
      )).rows[0]?.dia as string | null;
      if (!dia) throw new ErroHttp(404, 'sem_fechamento');
      // Próximos três vencimentos depois do atual (e o atual, se pedido), mesmo tipo, strikes até ±30% do ativo.
      const vencimentos = (await c.query(
        `select distinct to_char(vencimento, 'YYYY-MM-DD') as vencimento from series_opcoes
         where ativo_objeto = $1 and tipo = $2 and visto_ultimo >= $3 and vencimento >= $3
           and (vencimento > $4::date or ($5 and vencimento = $4::date))
         order by 1 limit 4`, [est.ativo_objeto, perna.tipo, dia, perna.vencimento, q.mesmoVencimento === true],
      )).rows.map((l) => l.vencimento);
      const linhas = vencimentos.length ? (await c.query(
        `select s.codigo, s.strike, to_char(s.vencimento, 'YYYY-MM-DD') as vencimento, f.negocios, k.delta
         from series_opcoes s
         join fechamentos f on f.codigo = s.codigo and f.dia = $2
         left join calculos_opcoes k on k.codigo = s.codigo and k.dia = $2 and k.motivo is null
         join fechamentos a on a.codigo = $1 and a.dia = $2
         where s.ativo_objeto = $1 and s.tipo = $3 and s.vencimento = any($4::date[]) and s.codigo <> $5
           and s.strike between a.ultimo * 0.7 and a.ultimo * 1.3
         order by s.vencimento, s.strike limit 80`, [est.ativo_objeto, dia, perna.tipo, vencimentos, codigo],
      )).rows : [];
      const lista = await cotacoesDoUsuario(c, [codigo, est.ativo_objeto, ...linhas.map((l) => l.codigo as string)], agora, cfg);
      const cotacoes = new Map(lista.map((x) => [x.codigo, x]));
      const ativo = cotacoes.get(est.ativo_objeto) ?? null;
      const quantidade = Math.abs(perna.quantidade);
      const lado = perna.quantidade > 0 ? 'compra' as const : 'venda' as const;
      const qPerna = cotacoes.get(codigo) ?? null;
      const saida = qPerna ? precoParaEncerrar(paraCotacao(qPerna), perna.quantidade > 0 ? 'comprada' : 'vendida', 'executavel_ou_ultimo') : null;

      const candidatos = [];
      for (const l of linhas) {
        const cq = cotacoes.get(l.codigo) ?? null;
        const entrada = cq ? precoParaAbrir(paraCotacao(cq), lado, 'executavel_ou_ultimo') : null;
        let liquido: number | null = null;
        let perdaPiorou: boolean | null = null;
        let depois = null;
        let avisos: string[] = [];
        if (saida?.ok && entrada?.ok) {
          try {
            const r = simularRolagem(carteira, {
              instante: agora.toISOString(),
              encerrar: [{ codigo, quantidade, preco: Math.round(saida.valor), estimativa: saida.estimativa }],
              abrir: [{ codigo: l.codigo, tipo: perna.tipo, strike: Number(l.strike), vencimento: l.vencimento, lado, quantidade, preco: Math.round(entrada.valor), multiplicador: perna.multiplicador, estimativa: entrada.estimativa }],
            });
            liquido = r.fluxo.liquido;
            avisos = r.avisos;
            depois = resumoDoPayoff(r.payoff.depois);
            if (r.payoff.antes && r.payoff.depois) {
              const a = r.payoff.antes.perdaMaxima;
              const d = r.payoff.depois.perdaMaxima;
              perdaPiorou = d.tipo === 'ilimitado' ? a.tipo !== 'ilimitado' : a.tipo === 'limitado' && d.valor < a.valor;
            }
          } catch {
            // candidato inválido para esta carteira: fica sem números
          }
        }
        const dias = Math.round((Date.parse(`${l.vencimento}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);
        const avaliacao = avaliarCandidato({
          codigo: l.codigo, strike: Number(l.strike), strikeAtual: perna.strike, dias, delta: l.delta === null ? null : Number(l.delta),
          negocios: l.negocios === null ? null : Number(l.negocios), bid: cq?.bid ?? null, ask: cq?.ask ?? null, liquido, perdaMaximaPiorou: perdaPiorou,
        }, criterios);
        candidatos.push({
          codigo: l.codigo, strike: Number(l.strike), vencimento: l.vencimento, dias,
          delta: l.delta === null ? null : Number(l.delta), negocios: Number(l.negocios), bid: cq?.bid ?? null, ask: cq?.ask ?? null, qualidade: cq?.qualidade ?? null,
          precoDeEntrada: entrada?.ok ? { valor: Math.round(entrada.valor), origem: entrada.origem, estimativa: entrada.estimativa } : null,
          liquido, payoffDepois: depois, avisos, criterios: avaliacao, resumo: resumoDaAvaliacao(avaliacao),
        });
      }
      return {
        agora: agora.toISOString(), dia,
        estrategia: { id: est.id, nome: est.nome, ativoObjeto: est.ativo_objeto },
        ativo,
        perna: {
          codigo, tipo: perna.tipo, strike: perna.strike, vencimento: perna.vencimento, quantidade: perna.quantidade, lado,
          precoDeSaida: saida?.ok ? { valor: Math.round(saida.valor), origem: saida.origem, estimativa: saida.estimativa } : null,
          qualidade: qPerna?.qualidade ?? null, instanteDaFonte: iso(qPerna?.instanteDaFonte ?? null),
        },
        criterios,
        candidatos,
        premissas: [
          `Séries do fechamento oficial da B3 de ${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}, mesmo tipo da perna, próximos vencimentos, strikes até 30% do preço do ativo.`,
          'Cada candidato simula sair da perna inteira pelo preço executável e entrar na série nova, na mesma quantidade e no mesmo lado, sem custos.',
          'Delta é calculado pelo sistema (Black-Scholes com a Selic) a partir do fechamento; sem cálculo, o critério fica "sem dado".',
          'A lista segue a ordem de vencimento e strike. Nenhum candidato é recomendado e nada vira ordem.',
        ],
      };
    });
  });
}
