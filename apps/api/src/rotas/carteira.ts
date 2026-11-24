// Minha carteira: notas de corretagem importadas, posição inicial lançada à mão e a
// carteira consolidada (todas as estratégias abertas somadas por código, com o preço
// médio do jeito da Receita e o preço de agora).
//
// Notas: o PDF (ou a planilha XLS da CM Capital) chega em base64, é lido aqui e NÃO é guardado.
// Fluxo em dois passos: /api/notas/ler devolve a prévia (com o que falta completar);
// /api/notas/importar grava o que a pessoa confirmou. A mesma nota não entra duas vezes.

import type { FastifyInstance } from 'fastify';
import {
  consolidarCarteira, lerNotaDaPlanilha, lerNotaDeCorretagem, lotesAbertos, resultadoEmAberto, situacaoDoMercado, strikeParaOLote, vencimentoEstimado,
  type ConfiguracaoDoCalendario, type NotaLida,
} from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, type Cliente } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario } from '../cotacoes.ts';
import { textoDoPdf } from '../pdf-texto.ts';
import { celulasDoXls, ehXls } from '../xls-celulas.ts';
import { seriesDaB3 } from '../series-da-nota.ts';
import type { Buscar } from '../coleta/coleta.ts';

// A nota em planilha (.xls) da CM Capital não traz o nome da corretora: usa o mesmo nome
// que vem no PDF dela, para a mesma nota não entrar duas vezes (PDF e XLS).
const CORRETORA_DO_XLS = 'CM CAPITAL MARKETS CCTVM LTDA.';
import { conferirEstrategia, inserirExecucao, paraDominio, serieDoCodigo, UUID } from './posicoes.ts';

const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const COD = { type: 'string', pattern: '^[A-Z0-9]{4,12}$' } as const;
const CENT = { type: 'integer', minimum: 0, maximum: 1e13 } as const;

export type NegocioDaPrevia = {
  lado: 'compra' | 'venda'; mercado: string; codigo: string | null; tipo: 'call' | 'put' | 'ativo' | null;
  strike: number | null; vencimento: string | null; ativoObjeto: string | null; vencimentoEstimado: boolean;
  quantidade: number; preco: number; valor: number; custos: number; observacao: string;
  falta: string[]; // o que a pessoa precisa completar antes de importar
  alertas: string[];
};

// Ativo-objeto pelas 4 letras do código: o código à vista mais negociado com essa raiz
// (BBAS → BBAS3, BOVA → BOVA11, PETR → PETR4).
async function ativoPelaRaiz(c: Cliente, raiz: string): Promise<string | null> {
  const r = await c.query(
    `select codigo from fechamentos where tipo_mercado = 10 and codigo ~ ('^' || $1 || '[0-9]{1,2}$')
     and dia > (select max(dia) from fechamentos) - 10 group by codigo order by sum(volume) desc nulls last limit 1`, [raiz],
  );
  return (r.rows[0]?.codigo as string | undefined) ?? null;
}

async function prepararNegocios(c: Cliente, nota: NotaLida, cfg: ConfiguracaoDoCalendario, buscar?: Buscar): Promise<NegocioDaPrevia[]> {
  const r: NegocioDaPrevia[] = [];
  const raizes = new Map<string, string | null>();
  // Opções da nota fora do cadastro: procura de uma vez nos arquivos da B3.
  const opcoes = [...new Set(nota.negocios.filter((n) => n.codigo && (n.mercado === 'opcao_compra' || n.mercado === 'opcao_venda')).map((n) => n.codigo as string))];
  const cadastradas = new Set(opcoes.length ? (await c.query('select distinct codigo from series_opcoes where codigo = any($1)', [opcoes])).rows.map((x) => x.codigo as string) : []);
  const daB3 = await seriesDaB3(buscar, nota.dataPregao, opcoes.filter((o) => !cadastradas.has(o)));
  for (const n of nota.negocios) {
    const falta: string[] = [];
    const alertas: string[] = [];
    let tipo: NegocioDaPrevia['tipo'] = null;
    let strike: number | null = n.strike;
    let vencimento: string | null = null;
    let ativoObjeto: string | null = null;
    let estimado = false;
    const preco = Math.round(n.preco);
    if (Math.abs(n.preco - preco) > 0.001) alertas.push('preco_com_fracao_de_centavo');
    if (!n.codigo) falta.push('codigo');
    else if (n.mercado === 'vista' || n.mercado === 'fracionario' || n.mercado === 'exercicio_compra' || n.mercado === 'exercicio_venda') {
      tipo = 'ativo';
      ativoObjeto = n.codigo;
      if (n.mercado.startsWith('exercicio')) alertas.push('exercicio');
    } else if (n.mercado === 'opcao_compra' || n.mercado === 'opcao_venda') {
      tipo = n.mercado === 'opcao_compra' ? 'call' : 'put';
      let s = await serieDoCodigo(c, n.codigo, nota.dataPregao);
      // Fora do cadastro (série antiga): o arquivo da B3 do dia da nota traz strike e vencimento.
      if (!s || s.tipo === 'ativo') s = daB3.get(n.codigo) ?? s;
      if (s && s.tipo !== 'ativo') {
        strike = strike ?? s.strike;
        if (n.strike !== null && s.strike !== n.strike) { alertas.push('strike_da_nota_difere_do_cadastro'); }
        vencimento = s.vencimento;
        ativoObjeto = s.ativoObjeto;
      }
      if (!vencimento) { vencimento = vencimentoEstimado(n.codigo, nota.dataPregao, n.prazo, cfg); estimado = vencimento !== null; }
      if (!ativoObjeto) {
        const raiz = n.codigo.slice(0, 4);
        if (!raizes.has(raiz)) raizes.set(raiz, await ativoPelaRaiz(c, raiz));
        ativoObjeto = raizes.get(raiz) ?? null;
      }
      if (strike === null) falta.push('strike');
      if (!vencimento) falta.push('vencimento');
      if (!ativoObjeto) falta.push('ativo_objeto');
    } else falta.push('mercado');
    r.push({
      lado: n.lado, mercado: n.mercado, codigo: n.codigo, tipo, strike, vencimento, ativoObjeto, vencimentoEstimado: estimado,
      quantidade: n.quantidade, preco, valor: n.valor, custos: n.custos, observacao: n.observacao, falta, alertas,
    });
  }
  // Rolagem com histórico faltando: a nota compra uma opção e vende outra do mesmo
  // ativo — a compra provavelmente encerra uma venda feita antes, que não está no sistema.
  for (const n of r) {
    if (n.lado === 'compra' && (n.tipo === 'call' || n.tipo === 'put') && r.some((o) => o !== n && o.lado === 'venda' && o.tipo === n.tipo && o.ativoObjeto === n.ativoObjeto)) {
      const vendida = await c.query(
        `select coalesce(sum(case when lado = 'venda' then quantidade else -quantidade end), 0)::int as q
         from execucoes x join estrategias e on e.id = x.estrategia_id where e.situacao = 'aberta' and x.codigo = $1`, [n.codigo],
      );
      if (Number(vendida.rows[0]?.q ?? 0) < n.quantidade) n.alertas.push('parece_encerrar_venda_anterior');
    }
  }
  return r;
}

async function estrategiaDaCarteira(c: Cliente, userId: string, ativoObjeto: string): Promise<string> {
  const nome = `Carteira ${ativoObjeto}`;
  const ja = await c.query("select id from estrategias where situacao = 'aberta' and nome = $1 and ativo_objeto = $2 order by criada_em limit 1", [nome, ativoObjeto]);
  if (ja.rows[0]) return ja.rows[0].id as string;
  const nova = await c.query(
    "insert into estrategias (user_id, nome, ativo_objeto, observacao) values ($1, $2, $3, 'Criada pela importação de notas e pela posição inicial.') returning id",
    [userId, nome, ativoObjeto],
  );
  return nova.rows[0].id as string;
}

export async function rotasDaCarteira(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  // ---------- Notas de corretagem ----------

  app.post('/api/notas/ler', {
    config: { politica: 'autenticado' },
    bodyLimit: 12 * 1024 * 1024,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['arquivos'],
        properties: {
          arquivos: {
            type: 'array', minItems: 1, maxItems: 40,
            items: { type: 'object', additionalProperties: false, required: ['nome', 'conteudo'], properties: { nome: { type: 'string', maxLength: 200 }, conteudo: { type: 'string', maxLength: 7_000_000 } } },
          },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const b = req.body as { arquivos: { nome: string; conteudo: string }[] };
    const cfg = await calendario.obter();
    return emTransacao(pool, s.usuarioId, async (c) => {
      const notas = [];
      for (const a of b.arquivos) {
        let lida: NotaLida | { erro: string };
        try {
          const bytes = Buffer.from(a.conteudo, 'base64');
          lida = ehXls(bytes) ? lerNotaDaPlanilha(celulasDoXls(bytes), CORRETORA_DO_XLS) : lerNotaDeCorretagem(textoDoPdf(bytes));
        } catch (e) {
          lida = { erro: e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'pdf_ilegivel' };
        }
        if ('erro' in lida) { notas.push({ arquivo: a.nome, erro: lida.erro }); continue; }
        const ja = await c.query('select id from notas_corretagem where corretora = $1 and numero = $2 and data_pregao = $3', [lida.corretora, lida.numero, lida.dataPregao]);
        notas.push({
          arquivo: a.nome, corretora: lida.corretora, numero: lida.numero, dataPregao: lida.dataPregao, custos: lida.custos,
          custoTotal: lida.custoTotal, irrf: lida.irrf, liquido: lida.liquido, conferida: lida.conferida, avisos: lida.avisos,
          jaImportada: Boolean(ja.rows[0]), negocios: await prepararNegocios(c, lida, cfg, dep.buscar),
        });
      }
      return { notas };
    });
  });

  const NEGOCIO = {
    type: 'object', additionalProperties: true,
    required: ['lado', 'codigo', 'tipo', 'quantidade', 'preco', 'custos', 'ativoObjeto'],
    properties: {
      lado: { enum: ['compra', 'venda'] }, codigo: COD, tipo: { enum: ['call', 'put', 'ativo'] }, ativoObjeto: COD,
      strike: { type: ['integer', 'null'], minimum: 1 }, vencimento: { anyOf: [DIA, { type: 'null' }] },
      quantidade: { type: 'integer', minimum: 1, maximum: 100_000_000 }, preco: CENT, custos: CENT,
      observacao: { type: 'string', maxLength: 40 },
    },
  } as const;

  app.post('/api/notas/importar', {
    config: { politica: 'autenticado' },
    bodyLimit: 2 * 1024 * 1024,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['notas'],
        properties: {
          notas: {
            type: 'array', minItems: 1, maxItems: 60,
            items: {
              type: 'object', additionalProperties: true, required: ['corretora', 'numero', 'dataPregao', 'custoTotal', 'conferida', 'negocios'],
              properties: {
                corretora: { type: 'string', minLength: 1, maxLength: 120 }, numero: { type: 'string', pattern: '^[0-9]{1,12}$' }, dataPregao: DIA,
                custos: { type: 'object' }, custoTotal: CENT, irrf: CENT, liquido: { type: ['integer', 'null'] }, conferida: { type: 'boolean' },
                negocios: { type: 'array', minItems: 1, maxItems: 300, items: NEGOCIO },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    type N = { lado: 'compra' | 'venda'; codigo: string; tipo: 'call' | 'put' | 'ativo'; ativoObjeto: string; strike?: number | null; vencimento?: string | null; quantidade: number; preco: number; custos: number; observacao?: string };
    const b = req.body as { notas: { corretora: string; numero: string; dataPregao: string; custos?: object; custoTotal: number; irrf?: number; liquido?: number | null; conferida: boolean; negocios: N[] }[] };
    const resultado = await emTransacao(pool, s.usuarioId, async (c) => {
      const saida: { numero: string; situacao: 'importada' | 'ja_importada'; execucoes: number }[] = [];
      const estrategias = new Set<string>();
      // Strike ajustado por provento: a mesma série (código + vencimento) aparece com strikes
      // diferentes em notas de datas diferentes. Vale o mais recente (o da nota mais nova),
      // nas execuções novas e nas que já estavam na carteira.
      const strikeAtual = new Map<string, { strike: number; data: string }>();
      for (const nota of b.notas) for (const n of nota.negocios) {
        if (n.tipo === 'ativo' || !n.strike || !n.vencimento) continue;
        const chave = `${n.codigo}|${n.vencimento}`;
        const ja = strikeAtual.get(chave);
        if (!ja || nota.dataPregao >= ja.data) strikeAtual.set(chave, { strike: n.strike, data: nota.dataPregao });
      }
      for (const [chave, v] of strikeAtual) {
        const [codigo, vencimento] = chave.split('|') as [string, string];
        const depois = (await c.query(
          `select strike from execucoes where codigo = $1 and vencimento = $2 and instante >= $3::date + 1 order by instante desc limit 1`,
          [codigo, vencimento, v.data],
        )).rows[0];
        if (depois) v.strike = Number(depois.strike);
        await c.query('update execucoes set strike = $3 where codigo = $1 and vencimento = $2 and strike <> $3', [codigo, vencimento, v.strike]);
      }
      for (const nota of b.notas) {
        for (const n of nota.negocios) {
          if (n.tipo !== 'ativo' && (!n.strike || !n.vencimento)) throw new ErroHttp(400, 'opcao_sem_strike_ou_vencimento', { nota: nota.numero, codigo: n.codigo });
        }
        const ins = await c.query(
          `insert into notas_corretagem (user_id, corretora, numero, data_pregao, custos, custo_total, irrf, liquido, conferida)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (user_id, corretora, numero, data_pregao) do nothing returning id`,
          [s.usuarioId, nota.corretora, nota.numero, nota.dataPregao, JSON.stringify(nota.custos ?? {}), nota.custoTotal, nota.irrf ?? 0, nota.liquido ?? null, nota.conferida],
        );
        const notaId = ins.rows[0]?.id as string | undefined;
        if (!notaId) { saida.push({ numero: nota.numero, situacao: 'ja_importada', execucoes: 0 }); continue; }
        let k = 0;
        for (const n of nota.negocios) {
          const est = await estrategiaDaCarteira(c, s.usuarioId, n.ativoObjeto);
          estrategias.add(est);
          // Hora do pregão em ordem de leitura: mantém a sequência dos negócios da nota.
          const instante = new Date(Date.parse(`${nota.dataPregao}T10:00:00-03:00`) + k * 1000).toISOString();
          k += 1;
          const id = await inserirExecucao(c, s.usuarioId, est, {
            codigo: n.codigo, tipo: n.tipo, lado: n.lado, quantidade: n.quantidade, preco: n.preco, custos: n.custos, instante,
            ...(n.tipo !== 'ativo' ? { strike: strikeAtual.get(`${n.codigo}|${n.vencimento}`)?.strike ?? n.strike as number, vencimento: n.vencimento as string } : {}),
            observacao: `Nota ${nota.numero}${n.observacao ? ` (${n.observacao})` : ''}`,
          }, 'nota_corretagem');
          await c.query('update execucoes set nota_id = $1 where id = $2', [notaId, id]);
        }
        saida.push({ numero: nota.numero, situacao: 'importada', execucoes: nota.negocios.length });
      }
      // Consistência de cada carteira; no erro, diz qual código e em qual nota ele está.
      for (const e of estrategias) {
        try {
          await conferirEstrategia(c, e);
        } catch (x) {
          if (!(x instanceof ErroHttp)) throw x;
          const codigo = typeof x.extra?.codigo === 'string' ? x.extra.codigo : null;
          const notas = codigo ? b.notas.filter((n) => n.negocios.some((g) => g.codigo === codigo)).map((n) => n.numero) : [];
          const versoes = codigo ? (await c.query(
            `select distinct strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento from execucoes where estrategia_id = $1 and codigo = $2`, [e, codigo],
          )).rows.map((v) => ({ strike: v.strike === null ? null : Number(v.strike), vencimento: v.vencimento as string | null })) : [];
          throw new ErroHttp(x.status, x.codigo, { ...x.extra, notas, versoes });
        }
      }
      await auditar(c, s, 'notas.importadas', { tipo: 'notas_corretagem', depois: { notas: saida } }, ipDe(req));
      return saida;
    });
    return reply.status(201).send({ notas: resultado });
  });

  app.get('/api/notas', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        `select n.id, n.corretora, n.numero, to_char(n.data_pregao, 'YYYY-MM-DD') as data_pregao, n.custo_total, n.irrf, n.liquido, n.conferida, n.importada_em,
                (select count(*)::int from execucoes x where x.nota_id = n.id) as negocios
         from notas_corretagem n order by n.data_pregao desc, n.numero desc`,
      );
      return {
        notas: r.rows.map((l) => ({
          id: l.id, corretora: l.corretora, numero: l.numero, dataPregao: l.data_pregao, custoTotal: Number(l.custo_total), irrf: Number(l.irrf),
          liquido: l.liquido === null ? null : Number(l.liquido), conferida: l.conferida, negocios: l.negocios, importadaEm: new Date(l.importada_em).toISOString(),
        })),
      };
    });
  });

  app.delete('/api/notas/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const ests = (await c.query('select distinct estrategia_id from execucoes where nota_id = $1', [id])).rows.map((l) => l.estrategia_id as string);
      const r = await c.query('delete from notas_corretagem where id = $1 returning numero', [id]);
      if (!r.rows[0]) throw new ErroHttp(404, 'nota_nao_encontrada');
      for (const e of ests) await conferirEstrategia(c, e);
      await auditar(c, s, 'notas.apagada', { tipo: 'notas_corretagem', id, antes: { numero: r.rows[0].numero } }, ipDe(req));
      return { ok: true };
    });
  });

  // ---------- Posição inicial (o que já existia antes das notas) ----------

  app.post('/api/carteira/posicao-inicial', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['codigo', 'lado', 'quantidade', 'preco', 'data'],
        properties: {
          codigo: { type: 'string', pattern: '^[A-Za-z0-9]{4,12}$' }, lado: { enum: ['compra', 'venda'] },
          quantidade: { type: 'integer', minimum: 1, maximum: 100_000_000 }, preco: { type: 'integer', minimum: 0, maximum: 1e11 },
          custos: CENT, data: DIA, strike: { type: 'integer', minimum: 1 }, vencimento: DIA, tipo: { enum: ['call', 'put', 'ativo'] },
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { codigo: string; lado: 'compra' | 'venda'; quantidade: number; preco: number; custos?: number; data: string; strike?: number; vencimento?: string; tipo?: 'call' | 'put' | 'ativo' };
    const codigo = b.codigo.toUpperCase();
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(relogio(), cfg).dia;
    if (b.data > hoje) throw new ErroHttp(400, 'data_no_futuro');
    const id = await emTransacao(pool, s.usuarioId, async (c) => {
      const serie = await serieDoCodigo(c, codigo, b.data);
      let tipo = b.tipo ?? serie?.tipo ?? null;
      let strike = b.strike ?? serie?.strike ?? null;
      let vencimento = b.vencimento ?? serie?.vencimento ?? null;
      let ativoObjeto = serie?.ativoObjeto ?? null;
      if (!tipo) {
        const m = /^[A-Z]{4}([A-X])\d/.exec(codigo);
        if (!m) throw new ErroHttp(400, 'codigo_desconhecido');
        tipo = (m[1] as string) <= 'L' ? 'call' : 'put';
      }
      if (tipo !== 'ativo') {
        vencimento = vencimento ?? vencimentoEstimado(codigo, b.data, null, cfg);
        ativoObjeto = ativoObjeto ?? await ativoPelaRaiz(c, codigo.slice(0, 4));
        if (!strike || !vencimento) throw new ErroHttp(400, 'opcao_sem_strike_ou_vencimento');
        if (!ativoObjeto) throw new ErroHttp(400, 'ativo_objeto_desconhecido');
      } else ativoObjeto = codigo;
      const est = await estrategiaDaCarteira(c, s.usuarioId, ativoObjeto as string);
      const nova = await inserirExecucao(c, s.usuarioId, est, {
        codigo, tipo, lado: b.lado, quantidade: b.quantidade, preco: b.preco, custos: b.custos ?? 0,
        instante: new Date(`${b.data}T09:00:00-03:00`).toISOString(), observacao: 'Posição inicial',
        ...(tipo !== 'ativo' ? { strike: strike as number, vencimento: vencimento as string } : {}),
      }, 'posicao_inicial');
      await conferirEstrategia(c, est);
      await auditar(c, s, 'carteira.posicao_inicial', { tipo: 'execucao', id: nova, depois: { codigo, lado: b.lado, quantidade: b.quantidade } }, ipDe(req));
      return nova;
    });
    return reply.status(201).send({ id });
  });

  // ---------- Zerar a carteira (só do próprio usuário) ----------

  app.post('/api/carteira/zerar', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['confirmacao'], properties: { confirmacao: { type: 'string', maxLength: 20 } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    if ((req.body as { confirmacao: string }).confirmacao !== 'ZERAR') throw new ErroHttp(400, 'confirmacao_invalida');
    return emTransacao(pool, s.usuarioId, async (c) => {
      const apagado = (await c.query('select app.zerar_carteira() as r')).rows[0]?.r as Record<string, number>;
      await auditar(c, s, 'carteira.zerada', { tipo: 'usuario', id: s.usuarioId, antes: apagado }, ipDe(req));
      return { apagado };
    });
  });

  // ---------- Carteira consolidada ----------

  app.get('/api/carteira', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = relogio();
    const cfg = await calendario.obter();
    const mercado = situacaoDoMercado(agora, cfg);
    const hoje = mercado.dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const linhas = (await c.query(
        `select x.codigo, x.tipo, x.strike, to_char(x.vencimento, 'YYYY-MM-DD') as vencimento, x.multiplicador, x.lado, x.quantidade, x.preco, x.custos,
                x.instante, e.ativo_objeto
         from execucoes x join estrategias e on e.id = x.estrategia_id where e.situacao = 'aberta' order by x.instante, x.criada_em`,
      )).rows;
      const ativoDe = new Map<string, string>(linhas.map((l) => [l.codigo as string, l.ativo_objeto as string]));
      const execs = linhas.map(paraDominio);
      let posicoes;
      try {
        posicoes = consolidarCarteira(execs);
      } catch (e) {
        throw new ErroHttp(409, e instanceof Error ? e.message : 'carteira_inconsistente');
      }
      const abertas = posicoes.filter((p) => p.quantidade !== 0);
      const ativos = [...new Set(abertas.map((p) => ativoDe.get(p.codigo) as string))];

      // Lotes das ações compradas e, para cada lote, a call sugerida para cobri-lo: série
      // mensal do primeiro vencimento com pelo menos 5 dias, menor strike ≥ custo do lote.
      const lotes = lotesAbertos(execs);
      const seriesDoAtivo = new Map<string, { codigo: string; strike: number; vencimento: string }[]>();
      for (const p of abertas) {
        if (p.tipo !== 'ativo' || p.quantidade <= 0) continue;
        const r = await c.query(
          `select codigo, strike::int as strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento from series_opcoes
           where ativo_objeto = $1 and tipo = 'call' and vencimento >= $2::date + 5 and codigo !~ 'W[0-9]$'
             and visto_ultimo >= (select max(visto_ultimo) from series_opcoes) - 5
           order by vencimento, strike`, [p.codigo, hoje],
        );
        const primeiro = r.rows[0]?.vencimento as string | undefined;
        seriesDoAtivo.set(p.codigo, r.rows.filter((x) => x.vencimento === primeiro) as { codigo: string; strike: number; vencimento: string }[]);
      }
      const sugeridas = new Map<string, { codigo: string; strike: number; vencimento: string }>();
      for (const [codigo, ls] of lotes) for (const l of ls) {
        const s = strikeParaOLote(l.precoComCustos, seriesDoAtivo.get(codigo) ?? []);
        if (s) sugeridas.set(`${codigo}:${l.instante}`, s);
      }
      const codigosSugeridos = [...new Set([...sugeridas.values()].map((s) => s.codigo))];
      const cot = new Map((await cotacoesDoUsuario(c, [...new Set([...abertas.map((p) => p.codigo), ...ativos, ...codigosSugeridos])], agora, cfg)).map((q) => [q.codigo, q]));
      const diasAte = (v: string) => Math.round((Date.parse(`${v}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);
      const lotesDe = (codigo: string, preco: number | null) => (lotes.get(codigo) ?? []).map((l) => {
        const s = sugeridas.get(`${codigo}:${l.instante}`) ?? null;
        const qs = s ? cot.get(s.codigo) ?? null : null;
        const premio = qs ? (qs.bid ?? qs.ultimo ?? null) : null;
        const custo = Math.round(l.quantidade * l.precoComCustos);
        const resultado = preco !== null ? Math.round(l.quantidade * (preco - l.precoComCustos)) : null;
        const seExercido = s ? Math.round(l.quantidade * (s.strike - l.precoComCustos + (premio ?? 0))) : null;
        return {
          instante: l.instante, data: new Date(l.instante).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
          quantidadeOriginal: l.quantidadeOriginal, quantidade: l.quantidade, preco: l.preco, precoComCustos: l.precoComCustos, custo,
          resultado, resultadoFracao: resultado !== null && custo > 0 ? resultado / custo : null,
          sugestao: s ? {
            codigo: s.codigo, strike: s.strike, vencimento: s.vencimento, dias: diasAte(s.vencimento),
            premio, origemDoPremio: qs ? (qs.bid ? 'bid' : qs.ultimo ? 'ultimo' : null) : null, qualidade: qs?.qualidade ?? null,
            receita: premio !== null ? Math.round(premio * l.quantidade) : null,
            premioFracao: premio !== null ? premio / l.precoComCustos : null,
            seExercido, seExercidoFracao: seExercido !== null && custo > 0 ? seExercido / custo : null,
          } : null,
        };
      });
      const realizado = posicoes.reduce((t, p) => t + p.realizadoLiquido, 0);
      const realizadoBruto = posicoes.reduce((t, p) => t + p.realizadoBruto, 0);
      const custosPagos = posicoes.reduce((t, p) => t + p.custosPagos, 0);

      const grupos = ativos.sort().map((ativo) => {
        const qAtivo = cot.get(ativo) ?? null;
        const itens = abertas.filter((p) => ativoDe.get(p.codigo) === ativo).map((p) => {
          const q = cot.get(p.codigo) ?? null;
          const vencida = Boolean(p.vencimento && p.vencimento < hoje);
          // Preço de agora: ação pelo último negócio; opção pelo preço de quem encerraria
          // (comprada sai no bid, vendida no ask), sem oferta pelo último.
          let preco: number | null = null;
          let origem: 'ultimo' | 'bid' | 'ask' | null = null;
          if (q && !vencida) {
            if (p.tipo === 'ativo') { preco = q.ultimo; origem = 'ultimo'; }
            else if (p.quantidade > 0 && q.bid) { preco = q.bid; origem = 'bid'; }
            else if (p.quantidade < 0 && q.ask) { preco = q.ask; origem = 'ask'; }
            else { preco = q.ultimo; origem = 'ultimo'; }
          }
          const r = preco !== null ? resultadoEmAberto(p, preco) : null;
          return {
            codigo: p.codigo, tipo: p.tipo, strike: p.strike ?? null, vencimento: p.vencimento ?? null, vencida,
            quantidade: p.quantidade, precoMedio: p.precoMedio, precoMedioComCustos: p.precoMedioComCustos, custoDaPosicao: p.custoDaPosicao,
            preco, origemDoPreco: origem, qualidade: q?.qualidade ?? null, provedor: q?.provedor ?? null,
            valorDeMercado: preco !== null ? Math.round(p.quantidade * preco * p.multiplicador) : null,
            resultado: r?.valor ?? null, resultadoFracao: r?.fracao ?? null, realizadoLiquido: p.realizadoLiquido,
            diasAteVencimento: p.vencimento && !vencida ? diasAte(p.vencimento) : null,
            lotes: p.tipo === 'ativo' && p.quantidade > 0 ? lotesDe(p.codigo, preco) : [],
          };
        }).sort((a, b) => (a.tipo === 'ativo' ? -1 : b.tipo === 'ativo' ? 1 : (a.vencimento ?? '').localeCompare(b.vencimento ?? '') || (a.strike ?? 0) - (b.strike ?? 0)));
        const acoes = itens.filter((i) => i.tipo === 'ativo').reduce((t, i) => t + i.quantidade, 0);
        const callsVendidas = itens.filter((i) => i.tipo === 'call' && !i.vencida && i.quantidade < 0).reduce((t, i) => t - i.quantidade, 0);
        const callsCompradas = itens.filter((i) => i.tipo === 'call' && !i.vencida && i.quantidade > 0).reduce((t, i) => t + i.quantidade, 0);
        const soma = (f: (i: (typeof itens)[number]) => number | null) => itens.filter((i) => !i.vencida).reduce<number | null>((t, i) => (t === null || f(i) === null ? null : t + (f(i) as number)), 0);
        return {
          ativoObjeto: ativo,
          cotacao: qAtivo ? { ultimo: qAtivo.ultimo, bid: qAtivo.bid, ask: qAtivo.ask, fechamentoAnterior: qAtivo.fechamentoAnterior, qualidade: qAtivo.qualidade, provedor: qAtivo.provedor, instanteDaFonte: qAtivo.instanteDaFonte } : null,
          itens,
          cobertura: { acoes, callsVendidas, callsCompradas, descobertas: Math.max(0, callsVendidas - Math.max(0, acoes) - callsCompradas) },
          valorDeMercado: soma((i) => i.valorDeMercado),
          resultado: soma((i) => i.resultado),
          custo: itens.filter((i) => !i.vencida).reduce((t, i) => t + Math.sign(i.quantidade) * i.custoDaPosicao, 0),
        };
      });
      const total = (k: 'valorDeMercado' | 'resultado') => grupos.reduce<number | null>((t, g) => (t === null || g[k] === null ? null : t + (g[k] as number)), 0);
      return {
        agora: agora.toISOString(), hoje, mercadoAberto: mercado.aberto,
        grupos,
        totais: { valorDeMercado: total('valorDeMercado'), resultadoEmAberto: total('resultado'), realizadoLiquido: realizado, realizadoBruto, custosPagos },
        premissas: [
          'Preço médio com custos: compras somam os custos da nota ao preço (como na apuração da Receita); vendas não mudam o preço médio.',
          'Opção vendida: o prêmio recebido, menos os custos, é o preço médio; o resultado em aberto ganha quando a opção cai.',
          'Preço de agora: ação pelo último negócio; opção pelo preço de quem encerraria (comprada no bid, vendida no ask) ou, sem oferta, pelo último.',
          'Entram todas as estratégias abertas em Posições. Opção vencida com quantidade aparece separada para você conferir.',
          'Lotes: um por compra; as vendas abatem dos lotes mais antigos primeiro. O preço médio geral continua o da Receita.',
          'Call sugerida por lote: série mensal do primeiro vencimento com 5 dias ou mais, menor strike que não fica abaixo do custo do lote; prêmio pelo bid. É uma referência, não recomendação.',
        ],
      };
    });
  });
}
