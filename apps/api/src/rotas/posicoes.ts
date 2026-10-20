// Posições do usuário: estratégias com as execuções que ele informou (ou importou do
// MetaTrader 5). A posição nunca é editada direto; ela sai das execuções.
//
// Na leitura, cada estratégia volta com:
// - a carteira (preço médio por instrumento, resultado realizado e custos);
// - o resultado não realizado ESTIMADO, marcado pelo preço executável (bid para quem
//   está comprado, ask para quem está vendido) ou, sem ele, pelo último negócio;
// - o payoff no vencimento (pontos de equilíbrio, lucro e perda máximos) e a curva;
// - os dias até o vencimento de cada perna.
// Tudo é do dono (RLS). Nada aqui envia ordem.

import type { FastifyInstance } from 'fastify';
import {
  analisarPayoff, curvaDePayoff, diasDePregaoEntre, ErroDePosicao, ErroDeValor, exposicoes, montarCarteira, pareceAtivoObjeto,
  pernasAbertas, resumoDeResultado, sessaoDoDia, situacaoDoMercado, type Carteira, type Cotacao, type Execucao, type Perna,
} from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, type Cliente } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario, paraCotacao, type CotacaoDeSaida } from '../cotacoes.ts';

export const UUID = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } as const;
export const CODIGO = { type: 'string', pattern: '^[A-Za-z0-9]{4,12}$' } as const;
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const MAXIMO_DE_ESTRATEGIAS_ABERTAS = 100;
const MAXIMO_DE_EXECUCOES = 200;

export const EXECUCAO = {
  type: 'object', additionalProperties: false,
  required: ['codigo', 'tipo', 'lado', 'quantidade', 'preco', 'instante'],
  properties: {
    codigo: CODIGO,
    tipo: { type: 'string', enum: ['call', 'put', 'ativo'] },
    strike: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    vencimento: DIA,
    multiplicador: { type: 'integer', minimum: 1, maximum: 10_000 },
    lado: { type: 'string', enum: ['compra', 'venda'] },
    quantidade: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    preco: { type: 'integer', minimum: 0, maximum: 100_000_000 },
    custos: { type: 'integer', minimum: 0, maximum: 100_000_000 },
    instante: { type: 'string', minLength: 10, maxLength: 40 },
    observacao: { type: 'string', maxLength: 300 },
  },
} as const;

export type CorpoDaExecucao = {
  codigo: string; tipo: 'call' | 'put' | 'ativo'; strike?: number; vencimento?: string; multiplicador?: number;
  lado: 'compra' | 'venda'; quantidade: number; preco: number; custos?: number; instante: string; observacao?: string;
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// Confere a execução vinda da tela. Opção precisa de strike e vencimento; ativo não pode ter.
export function lerExecucao(b: CorpoDaExecucao, agora: Date): CorpoDaExecucao {
  const codigo = b.codigo.toUpperCase();
  if (b.tipo === 'ativo') {
    if (b.strike !== undefined || b.vencimento !== undefined) throw new ErroHttp(400, 'ativo_sem_strike_nem_vencimento');
  } else if (b.strike === undefined || b.vencimento === undefined || Number.isNaN(Date.parse(`${b.vencimento}T12:00:00Z`))) {
    throw new ErroHttp(400, 'opcao_sem_strike_ou_vencimento');
  }
  const t = Date.parse(b.instante);
  if (Number.isNaN(t)) throw new ErroHttp(400, 'instante_invalido');
  if (t > agora.getTime() + 5 * 60_000) throw new ErroHttp(400, 'instante_no_futuro');
  if (t < Date.parse('2000-01-01T00:00:00Z')) throw new ErroHttp(400, 'instante_invalido');
  const { observacao, ...resto } = b;
  const obs = observacao?.trim();
  return { ...resto, codigo, instante: new Date(t).toISOString(), ...(obs ? { observacao: obs } : {}) };
}

export async function inserirExecucao(c: Cliente, userId: string, estrategiaId: string, e: CorpoDaExecucao, origem: 'manual' | 'importada_mt5', rolagemId: string | null = null): Promise<string> {
  const r = await c.query(
    `insert into execucoes (user_id, estrategia_id, codigo, tipo, strike, vencimento, multiplicador, lado, quantidade, preco, custos, instante, origem, observacao, rolagem_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [userId, estrategiaId, e.codigo, e.tipo, e.strike ?? null, e.vencimento ?? null, e.multiplicador ?? 1, e.lado, e.quantidade, e.preco,
      e.custos ?? 0, e.instante, origem, e.observacao ?? null, rolagemId],
  );
  return r.rows[0].id as string;
}

export function paraDominio(l: Record<string, any>): Execucao {
  return {
    codigo: l.codigo, tipo: l.tipo, lado: l.lado, quantidade: Number(l.quantidade), preco: Number(l.preco), custos: Number(l.custos),
    multiplicador: Number(l.multiplicador), instante: new Date(l.instante).toISOString(),
    ...(l.strike !== null ? { strike: Number(l.strike) } : {}),
    ...(l.vencimento !== null ? { vencimento: l.vencimento as string } : {}),
  };
}

// Depois de gravar, a estratégia inteira tem de continuar consistente: o mesmo código
// sempre com o mesmo tipo, strike, vencimento e multiplicador, e a carteira montável.
export async function conferirEstrategia(c: Cliente, estrategiaId: string): Promise<void> {
  const r = await c.query(
    `select codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade, preco, custos, instante
     from execucoes where estrategia_id = $1`, [estrategiaId],
  );
  if (r.rows.length > MAXIMO_DE_EXECUCOES) throw new ErroHttp(409, 'limite_de_execucoes');
  const vistos = new Map<string, string>();
  for (const l of r.rows) {
    const assinatura = `${l.tipo}|${l.strike}|${l.vencimento}|${l.multiplicador}`;
    const antes = vistos.get(l.codigo);
    if (antes !== undefined && antes !== assinatura) throw new ErroHttp(400, 'codigo_com_dados_diferentes', { codigo: l.codigo });
    vistos.set(l.codigo, assinatura);
  }
  try {
    montarCarteira(r.rows.map(paraDominio));
  } catch (e) {
    if (e instanceof ErroDeValor) throw new ErroHttp(400, e.message);
    throw e;
  }
}

// Série pelo código: opção no cadastro da B3 (o vencimento mais próximo que ainda não
// passou; senão o último conhecido) ou ação/unit/ETF pelo formato do código.
export async function serieDoCodigo(c: Cliente, codigo: string, hoje: string) {
  const r = await c.query(
    `select codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, ativo_objeto
     from series_opcoes where codigo = $1
     order by (vencimento >= $2::date) desc, case when vencimento >= $2::date then vencimento end asc, vencimento desc
     limit 1`, [codigo, hoje],
  );
  const l = r.rows[0];
  if (l) return { codigo, tipo: l.tipo as 'call' | 'put', strike: Number(l.strike), vencimento: l.vencimento as string, ativoObjeto: (l.ativo_objeto as string | null) ?? null };
  if (pareceAtivoObjeto(codigo)) return { codigo, tipo: 'ativo' as const, strike: null, vencimento: null, ativoObjeto: codigo };
  return null;
}

type LinhaEstrategia = { id: string; nome: string; ativo_objeto: string; observacao: string | null; situacao: string; criada_em: Date; encerrada_em: Date | null };

function premissas(): string[] {
  return [
    'Resultado não realizado é estimativa: comprado é marcado pelo melhor comprador (bid), vendido pelo melhor vendedor (ask); sem oferta, pelo último negócio.',
    'Fora do pregão, o preço é o fechamento oficial da B3 do último pregão (histórico), não tempo real.',
    'Payoff no vencimento: só vale para pernas do mesmo vencimento e não considera exercício antecipado.',
    'Custos: o resultado líquido desconta todos os custos já pagos; custos de encerramento futuros não entram.',
  ];
}

export async function rotasDePosicoes(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  app.get('/api/posicoes', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = relogio();
    const cfg = await calendario.obter();
    const mercado = situacaoDoMercado(agora, cfg);
    const hoje = mercado.dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const estrategias = (await c.query('select * from estrategias order by situacao, criada_em desc')).rows as LinhaEstrategia[];
      const execs = (await c.query(
        `select id, estrategia_id, codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade,
                preco, custos, instante, origem, observacao, rolagem_id
         from execucoes order by instante, criada_em`,
      )).rows;
      const rolagens = (await c.query('select id, estrategia_id, instante, observacao, resumo from rolagens order by instante desc')).rows;
      const porEstrategia = new Map<string, Record<string, any>[]>();
      for (const e of execs) porEstrategia.set(e.estrategia_id, [...(porEstrategia.get(e.estrategia_id) ?? []), e]);

      // Cotações de tudo que está aberto e dos ativos-objeto.
      const carteiras = new Map<string, Carteira | { erro: string }>();
      const codigos = new Set<string>();
      for (const e of estrategias) {
        try {
          const cart = montarCarteira((porEstrategia.get(e.id) ?? []).map(paraDominio));
          carteiras.set(e.id, cart);
          for (const i of cart.values()) if (i.quantidade !== 0) codigos.add(i.codigo);
        } catch (erro) {
          carteiras.set(e.id, { erro: erro instanceof Error ? erro.message : 'erro' });
        }
        if (e.situacao === 'aberta') codigos.add(e.ativo_objeto);
      }
      const lista = await cotacoesDoUsuario(c, [...codigos], agora, cfg);
      const cotacoes = new Map<string, CotacaoDeSaida>(lista.map((q) => [q.codigo, q]));
      const paraMarcar = new Map<string, Cotacao>(lista.map((q) => [q.codigo, paraCotacao(q)]));

      const liquidoPorCodigo: Record<string, number> = {};
      const ativoDe = new Map<string, string>();
      const todasAbertas: Execucao[] = [];

      const saida = estrategias.map((e) => {
        const linhas = porEstrategia.get(e.id) ?? [];
        const base = {
          id: e.id, nome: e.nome, ativoObjeto: e.ativo_objeto, observacao: e.observacao, situacao: e.situacao,
          criadaEm: iso(e.criada_em), encerradaEm: iso(e.encerrada_em),
          execucoes: linhas.map((l) => ({
            id: l.id, codigo: l.codigo, tipo: l.tipo, strike: l.strike === null ? null : Number(l.strike), vencimento: l.vencimento,
            multiplicador: Number(l.multiplicador), lado: l.lado, quantidade: Number(l.quantidade), preco: Number(l.preco),
            custos: Number(l.custos), instante: iso(l.instante), origem: l.origem, observacao: l.observacao, rolagemId: l.rolagem_id,
          })),
          rolagens: rolagens.filter((r) => r.estrategia_id === e.id).map((r) => ({ id: r.id, instante: iso(r.instante), observacao: r.observacao, resumo: r.resumo })),
        };
        const cart = carteiras.get(e.id);
        if (!cart || !(cart instanceof Map)) return { ...base, erro: (cart as { erro: string } | undefined)?.erro ?? 'erro', instrumentos: [], resultado: null, ativo: null, payoff: null };
        if (e.situacao === 'aberta') {
          for (const l of linhas) { todasAbertas.push(paraDominio(l)); ativoDe.set(l.codigo, e.ativo_objeto); }
        }
        const instrumentos = [...cart.values()].map((i) => {
          if (e.situacao === 'aberta' && i.quantidade !== 0) liquidoPorCodigo[i.codigo] = (liquidoPorCodigo[i.codigo] ?? 0) + i.quantidade;
          return {
            codigo: i.codigo, tipo: i.tipo, strike: i.strike ?? null, vencimento: i.vencimento ?? null, multiplicador: i.multiplicador,
            quantidade: i.quantidade, precoMedio: i.precoMedio, realizadoBruto: Math.round(i.realizadoBruto), custosPagos: i.custosPagos,
            cotacao: i.quantidade !== 0 ? (cotacoes.get(i.codigo) ?? null) : null,
            diasCorridos: i.vencimento ? Math.round((Date.parse(`${i.vencimento}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000) : null,
            diasDePregao: i.vencimento ? diasDePregaoEntre(hoje, i.vencimento, cfg) : null,
            vencido: i.vencimento ? i.vencimento < hoje || (i.vencimento === hoje && mercado.motivo === 'depois') : false,
          };
        });
        const resultado = resumoDeResultado(cart, paraMarcar, 'executavel_ou_ultimo');
        const qAtivo = cotacoes.get(e.ativo_objeto) ?? null;
        const pernas = pernasAbertas(cart);
        return { ...base, instrumentos, resultado, ativo: qAtivo, payoff: payoffDe(pernas, resultado.realizadoLiquido, qAtivo) };
      });

      let exposicao: ReturnType<typeof exposicoes> = [];
      try {
        exposicao = exposicoes(montarCarteira(todasAbertas), (codigo) => ativoDe.get(codigo) ?? codigo);
      } catch {
        // O mesmo código com multiplicadores diferentes em estratégias diferentes: sem agregado.
      }
      return { agora: agora.toISOString(), hoje, estrategias: saida, exposicoes: exposicao, liquidoPorCodigo, premissas: premissas() };
    });
  });

  // Dados de uma série para preencher o formulário (tipo, strike, vencimento, ativo-objeto).
  app.get('/api/posicoes/serie/:codigo', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['codigo'], properties: { codigo: CODIGO } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const codigo = (req.params as { codigo: string }).codigo.toUpperCase();
    const agora = relogio();
    const cfg = await calendario.obter();
    return emTransacao(pool, s.usuarioId, async (c) => {
      const serie = await serieDoCodigo(c, codigo, situacaoDoMercado(agora, cfg).dia);
      if (!serie) throw new ErroHttp(404, 'serie_desconhecida');
      const [cotacao] = await cotacoesDoUsuario(c, [codigo], agora, cfg);
      return { ...serie, cotacao: cotacao ?? null };
    });
  });

  app.post('/api/posicoes', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['nome', 'ativoObjeto'],
        properties: {
          nome: { type: 'string', minLength: 1, maxLength: 80 },
          ativoObjeto: CODIGO,
          observacao: { type: 'string', maxLength: 1000 },
          execucoes: { type: 'array', maxItems: 20, items: EXECUCAO },
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { nome: string; ativoObjeto: string; observacao?: string; execucoes?: CorpoDaExecucao[] };
    const agora = relogio();
    const nome = b.nome.trim();
    if (!nome) throw new ErroHttp(400, 'nome_obrigatorio');
    const execucoes = (b.execucoes ?? []).map((e) => lerExecucao(e, agora));
    const id = await emTransacao(pool, s.usuarioId, async (c) => {
      const n = Number((await c.query("select count(*) as n from estrategias where situacao = 'aberta'")).rows[0]?.n ?? 0);
      if (n >= MAXIMO_DE_ESTRATEGIAS_ABERTAS) throw new ErroHttp(409, 'limite_de_estrategias');
      const nova = (await c.query(
        'insert into estrategias (user_id, nome, ativo_objeto, observacao) values ($1, $2, $3, $4) returning id',
        [s.usuarioId, nome, b.ativoObjeto.toUpperCase(), b.observacao?.trim() || null],
      )).rows[0].id as string;
      for (const e of execucoes) await inserirExecucao(c, s.usuarioId, nova, e, 'manual');
      await conferirEstrategia(c, nova);
      await auditar(c, s, 'posicao.criada', { tipo: 'estrategia', id: nova, depois: { nome, ativoObjeto: b.ativoObjeto.toUpperCase(), execucoes: execucoes.length } }, ipDe(req));
      return nova;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/api/posicoes/:id', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } },
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          nome: { type: 'string', minLength: 1, maxLength: 80 },
          observacao: { type: ['string', 'null'], maxLength: 1000 },
          situacao: { type: 'string', enum: ['aberta', 'encerrada'] },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = req.body as { nome?: string; observacao?: string | null; situacao?: 'aberta' | 'encerrada' };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const atual = (await c.query('select * from estrategias where id = $1 for update', [id])).rows[0];
      if (!atual) throw new ErroHttp(404, 'nao_encontrado');
      const nome = b.nome?.trim() ?? atual.nome;
      if (!nome) throw new ErroHttp(400, 'nome_obrigatorio');
      const situacao = b.situacao ?? atual.situacao;
      if (situacao === 'encerrada' && atual.situacao !== 'encerrada') {
        // Encerrar só quando nada ficou aberto: o que sobrou precisa de uma execução de saída
        // (ou de "virou pó", para opção vencida).
        const execs = (await c.query(
          `select codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade, preco, custos, instante
           from execucoes where estrategia_id = $1`, [id],
        )).rows.map(paraDominio);
        const abertos = [...montarCarteira(execs).values()].filter((i) => i.quantidade !== 0).map((i) => i.codigo);
        if (abertos.length) throw new ErroHttp(409, 'ainda_ha_pernas_abertas', { codigos: abertos });
      }
      if (situacao === 'aberta' && atual.situacao !== 'aberta') {
        const n = Number((await c.query("select count(*) as n from estrategias where situacao = 'aberta'")).rows[0]?.n ?? 0);
        if (n >= MAXIMO_DE_ESTRATEGIAS_ABERTAS) throw new ErroHttp(409, 'limite_de_estrategias');
      }
      const observacao = b.observacao === undefined ? atual.observacao : (b.observacao?.trim() || null);
      await c.query(
        `update estrategias set nome = $2, observacao = $3, situacao = $4,
           encerrada_em = case when $4 = 'encerrada' then coalesce(encerrada_em, now()) else null end
         where id = $1`, [id, nome, observacao, situacao],
      );
      await auditar(c, s, 'posicao.alterada', { tipo: 'estrategia', id, antes: { nome: atual.nome, situacao: atual.situacao }, depois: { nome, situacao } }, ipDe(req));
      return { ok: true };
    });
  });

  app.delete('/api/posicoes/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = (await c.query('delete from estrategias where id = $1 returning nome, ativo_objeto', [id])).rows[0];
      if (!r) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'posicao.excluida', { tipo: 'estrategia', id, antes: { nome: r.nome, ativoObjeto: r.ativo_objeto } }, ipDe(req));
      return { ok: true };
    });
  });

  app.post('/api/posicoes/:id/execucoes', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } }, body: EXECUCAO },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const e = lerExecucao(req.body as CorpoDaExecucao, relogio());
    const execId = await emTransacao(pool, s.usuarioId, async (c) => {
      const est = (await c.query('select situacao from estrategias where id = $1 for update', [id])).rows[0];
      if (!est) throw new ErroHttp(404, 'nao_encontrado');
      if (est.situacao !== 'aberta') throw new ErroHttp(409, 'estrategia_encerrada');
      const novo = await inserirExecucao(c, s.usuarioId, id, e, 'manual');
      await conferirEstrategia(c, id);
      await auditar(c, s, 'posicao.execucao_registrada', { tipo: 'execucao', id: novo, depois: { estrategia: id, codigo: e.codigo, lado: e.lado, quantidade: e.quantidade, preco: e.preco } }, ipDe(req));
      return novo;
    });
    return reply.status(201).send({ id: execId });
  });

  app.delete('/api/posicoes/:id/execucoes/:execId', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id', 'execId'], properties: { id: UUID, execId: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id, execId } = req.params as { id: string; execId: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const est = (await c.query('select situacao from estrategias where id = $1 for update', [id])).rows[0];
      if (!est) throw new ErroHttp(404, 'nao_encontrado');
      if (est.situacao !== 'aberta') throw new ErroHttp(409, 'estrategia_encerrada');
      const daRolagem = (await c.query('select rolagem_id from execucoes where id = $1 and estrategia_id = $2', [execId, id])).rows[0];
      if (daRolagem?.rolagem_id) throw new ErroHttp(409, 'faz_parte_de_rolagem', { rolagemId: daRolagem.rolagem_id });
      const r = (await c.query('delete from execucoes where id = $1 and estrategia_id = $2 returning codigo, lado, quantidade, preco', [execId, id])).rows[0];
      if (!r) throw new ErroHttp(404, 'nao_encontrado');
      await conferirEstrategia(c, id);
      await auditar(c, s, 'posicao.execucao_excluida', { tipo: 'execucao', id: execId, antes: { estrategia: id, codigo: r.codigo, lado: r.lado, quantidade: Number(r.quantidade), preco: Number(r.preco) } }, ipDe(req));
      return { ok: true };
    });
  });

  // Opção que venceu fora do dinheiro ("virou pó"): registra a saída a preço zero, sem custo,
  // no fechamento do dia do vencimento. Só para opção já vencida e ainda aberta.
  app.post('/api/posicoes/:id/vencer', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } },
      body: { type: 'object', additionalProperties: false, required: ['codigo'], properties: { codigo: CODIGO } },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const codigo = (req.body as { codigo: string }).codigo.toUpperCase();
    const agora = relogio();
    const cfg = await calendario.obter();
    const mercado = situacaoDoMercado(agora, cfg);
    const execId = await emTransacao(pool, s.usuarioId, async (c) => {
      const est = (await c.query('select situacao from estrategias where id = $1 for update', [id])).rows[0];
      if (!est) throw new ErroHttp(404, 'nao_encontrado');
      if (est.situacao !== 'aberta') throw new ErroHttp(409, 'estrategia_encerrada');
      const execs = (await c.query(
        `select codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade, preco, custos, instante
         from execucoes where estrategia_id = $1`, [id],
      )).rows.map(paraDominio);
      const i = montarCarteira(execs).get(codigo);
      if (!i || i.quantidade === 0) throw new ErroHttp(404, 'perna_nao_aberta');
      if (i.tipo === 'ativo' || !i.vencimento) throw new ErroHttp(400, 'so_opcao_vence');
      const vencida = i.vencimento < mercado.dia || (i.vencimento === mercado.dia && mercado.motivo === 'depois');
      if (!vencida) throw new ErroHttp(409, 'ainda_nao_venceu');
      const fim = sessaoDoDia(i.vencimento, cfg)?.fechamento ?? '17:00';
      const e: CorpoDaExecucao = {
        codigo, tipo: i.tipo, strike: i.strike as number, vencimento: i.vencimento, multiplicador: i.multiplicador,
        lado: i.quantidade > 0 ? 'venda' : 'compra', quantidade: Math.abs(i.quantidade), preco: 0, custos: 0,
        instante: new Date(`${i.vencimento}T${fim}:00-03:00`).toISOString(), observacao: 'Venceu sem exercício (virou pó).',
      };
      const novo = await inserirExecucao(c, s.usuarioId, id, e, 'manual');
      await conferirEstrategia(c, id);
      await auditar(c, s, 'posicao.vencimento_registrado', { tipo: 'execucao', id: novo, depois: { estrategia: id, codigo, quantidade: e.quantidade } }, ipDe(req));
      return novo;
    });
    return reply.status(201).send({ id: execId });
  });

  // Importa posições que o MetaTrader 5 informou (preço médio da corretora) como execuções.
  // Vai para uma estratégia existente ou para uma nova.
  app.post('/api/posicoes/importar', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['codigos'],
        properties: {
          codigos: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: CODIGO },
          estrategiaId: UUID,
          nova: {
            type: 'object', additionalProperties: false, required: ['nome'],
            properties: { nome: { type: 'string', minLength: 1, maxLength: 80 }, ativoObjeto: CODIGO },
          },
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { codigos: string[]; estrategiaId?: string; nova?: { nome: string; ativoObjeto?: string } };
    if ((b.estrategiaId === undefined) === (b.nova === undefined)) throw new ErroHttp(400, 'escolha_estrategia_ou_nova');
    const agora = relogio();
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(agora, cfg).dia;
    const resultado = await emTransacao(pool, s.usuarioId, async (c) => {
      const execucoes: CorpoDaExecucao[] = [];
      let ativoSugerido: string | null = null;
      for (const codigo of b.codigos.map((x) => x.toUpperCase())) {
        const p = (await c.query('select lado, quantidade, preco_medio, recebido_em from posicoes_ponte where codigo = $1', [codigo])).rows[0];
        if (!p) throw new ErroHttp(404, 'posicao_nao_encontrada', { codigo });
        const serie = await serieDoCodigo(c, codigo, hoje);
        if (!serie) throw new ErroHttp(400, 'serie_desconhecida', { codigo });
        ativoSugerido ??= serie.ativoObjeto;
        execucoes.push({
          codigo, tipo: serie.tipo, ...(serie.strike !== null ? { strike: serie.strike } : {}), ...(serie.vencimento !== null ? { vencimento: serie.vencimento } : {}),
          lado: p.lado, quantidade: Number(p.quantidade), preco: Math.round(Number(p.preco_medio)), custos: 0,
          instante: new Date(p.recebido_em).toISOString(), observacao: 'Importada do MetaTrader 5 (preço médio da corretora).',
        });
      }
      let estrategiaId = b.estrategiaId;
      if (estrategiaId) {
        const est = (await c.query('select situacao from estrategias where id = $1 for update', [estrategiaId])).rows[0];
        if (!est) throw new ErroHttp(404, 'nao_encontrado');
        if (est.situacao !== 'aberta') throw new ErroHttp(409, 'estrategia_encerrada');
      } else {
        const ativo = (b.nova?.ativoObjeto ?? ativoSugerido ?? '').toUpperCase();
        if (!ativo) throw new ErroHttp(400, 'ativo_objeto_obrigatorio');
        const nome = (b.nova?.nome ?? '').trim();
        if (!nome) throw new ErroHttp(400, 'nome_obrigatorio');
        const n = Number((await c.query("select count(*) as n from estrategias where situacao = 'aberta'")).rows[0]?.n ?? 0);
        if (n >= MAXIMO_DE_ESTRATEGIAS_ABERTAS) throw new ErroHttp(409, 'limite_de_estrategias');
        estrategiaId = (await c.query('insert into estrategias (user_id, nome, ativo_objeto) values ($1, $2, $3) returning id', [s.usuarioId, nome, ativo])).rows[0].id as string;
      }
      for (const e of execucoes) await inserirExecucao(c, s.usuarioId, estrategiaId as string, e, 'importada_mt5');
      await conferirEstrategia(c, estrategiaId as string);
      await auditar(c, s, 'posicao.importada_mt5', { tipo: 'estrategia', id: estrategiaId, depois: { codigos: execucoes.map((e) => e.codigo) } }, ipDe(req));
      return { id: estrategiaId, importadas: execucoes.length };
    });
    return reply.status(201).send(resultado);
  });
}

// Payoff da parte aberta, já somando o que foi realizado (resultado acumulado da estratégia).
export function payoffDe(pernas: Perna[], realizadoLiquido: number, ativo: CotacaoDeSaida | null) {
  if (pernas.length === 0) return { motivo: 'sem_pernas_abertas' as const };
  let analise: ReturnType<typeof analisarPayoff>;
  try {
    analise = analisarPayoff(pernas, realizadoLiquido);
  } catch (e) {
    if (e instanceof ErroDePosicao && e.message === 'vencimentos_diferentes') return { motivo: 'vencimentos_diferentes' as const };
    throw e;
  }
  // Faixa do gráfico: ±30% em torno do preço do ativo (ou dos strikes / preço de entrada),
  // alargada para caber strikes e pontos de equilíbrio.
  const strikes = pernas.filter((p) => p.strike !== undefined).map((p) => p.strike as number);
  const entradaAtivo = pernas.filter((p) => p.tipo === 'ativo').map((p) => p.preco);
  const referencia = ativo?.ultimo ?? ativo?.bid ?? (strikes.length ? strikes.reduce((a, b) => a + b, 0) / strikes.length : entradaAtivo[0] ?? null);
  if (!referencia || referencia <= 0) return { analise, curva: null, referencia: null, vencimento: vencimentoDas(pernas) };
  const pontos = [referencia * 0.7, referencia * 1.3, ...strikes, ...analise.pontosDeEquilibrio.map((x) => x * 100)];
  let de = Math.max(0, Math.min(...pontos));
  let ate = Math.max(...pontos);
  const margem = (ate - de) * 0.05;
  de = Math.max(0, Math.round(de - margem));
  ate = Math.round(ate + margem);
  return { analise, curva: curvaDePayoff(pernas, de, ate, 80, realizadoLiquido), referencia, vencimento: vencimentoDas(pernas) };
}

function vencimentoDas(pernas: Perna[]): string | null {
  return pernas.find((p) => p.vencimento)?.vencimento ?? null;
}
