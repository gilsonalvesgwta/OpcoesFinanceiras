// Simulador de opções: cadeia para montar (preço da ponte MT5 quando houver; senão
// brapi/fechamento da B3), e carteiras simuladas guardadas para acompanhar com o preço
// real. Carteira simulada não tem ligação com as posições reais. Nada envia ordem.

import type { FastifyInstance } from 'fastify';
import { montarCarteira, resumoDeResultado, situacaoDoMercado, ErroDeValor, type Cotacao, type Execucao } from '@wta/domain';
import { ErroHttp, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, type Cliente } from '../banco.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario, paraCotacao } from '../cotacoes.ts';
import { observarCadeia, resumoDaCotacao, tiposDosVencimentos } from '../cadeia-ao-vivo.ts';

const UUID = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } as const;
const CODIGO = { type: 'string', pattern: '^[A-Za-z0-9]{4,12}$' } as const;
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const MAXIMO_DE_SIMULACOES = 200;
const MAXIMO_DE_EXECUCOES = 300;

const EXECUCAO = {
  type: 'object', additionalProperties: false, required: ['codigo', 'tipo', 'lado', 'quantidade', 'preco'],
  properties: {
    codigo: CODIGO, tipo: { type: 'string', enum: ['call', 'put', 'ativo'] },
    strike: { type: 'integer', minimum: 1, maximum: 100_000_000 }, vencimento: DIA,
    lado: { type: 'string', enum: ['compra', 'venda'] }, quantidade: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    preco: { type: 'integer', minimum: 0, maximum: 100_000_000 }, custos: { type: 'integer', minimum: 0, maximum: 100_000_000 },
    vol: { type: ['number', 'null'], exclusiveMinimum: 0, exclusiveMaximum: 5 },
    instante: { type: 'string', minLength: 10, maxLength: 40 }, observacao: { type: 'string', maxLength: 300 },
  },
} as const;

type CorpoDaExecucao = {
  codigo: string; tipo: 'call' | 'put' | 'ativo'; strike?: number; vencimento?: string; lado: 'compra' | 'venda'; quantidade: number;
  preco: number; custos?: number; vol?: number | null; instante?: string; observacao?: string;
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function lerExecucao(b: CorpoDaExecucao, agora: Date): CorpoDaExecucao & { instante: string } {
  if (b.tipo === 'ativo' && (b.strike !== undefined || b.vencimento !== undefined)) throw new ErroHttp(400, 'ativo_sem_strike_nem_vencimento');
  if (b.tipo !== 'ativo' && (b.strike === undefined || b.vencimento === undefined)) throw new ErroHttp(400, 'opcao_sem_strike_ou_vencimento');
  const t = b.instante ? Date.parse(b.instante) : agora.getTime();
  if (Number.isNaN(t) || t < Date.parse('2000-01-01T00:00:00Z')) throw new ErroHttp(400, 'instante_invalido');
  if (t > agora.getTime() + 5 * 60_000) throw new ErroHttp(400, 'instante_no_futuro');
  return { ...b, codigo: b.codigo.toUpperCase(), instante: new Date(t).toISOString() };
}

async function inserir(c: Cliente, userId: string, simulacaoId: string, e: CorpoDaExecucao & { instante: string }) {
  await c.query(
    `insert into execucoes_simuladas (user_id, simulacao_id, codigo, tipo, strike, vencimento, lado, quantidade, preco, custos, vol, instante, observacao)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [userId, simulacaoId, e.codigo, e.tipo, e.strike ?? null, e.vencimento ?? null, e.lado, e.quantidade, e.preco, e.custos ?? 0, e.vol ?? null, e.instante, e.observacao?.trim() || null],
  );
}

function paraDominio(l: Record<string, any>): Execucao {
  return {
    codigo: l.codigo, tipo: l.tipo, lado: l.lado, quantidade: Number(l.quantidade), preco: Number(l.preco), custos: Number(l.custos),
    multiplicador: Number(l.multiplicador), instante: new Date(l.instante).toISOString(),
    ...(l.strike !== null ? { strike: Number(l.strike) } : {}), ...(l.vencimento !== null ? { vencimento: l.vencimento as string } : {}),
  };
}

const SELECAO = `select id, simulacao_id, codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade,
                        preco, custos, vol, instante, observacao from execucoes_simuladas`;

// A simulação inteira precisa continuar montável e com cada código sempre igual.
async function conferir(c: Cliente, simulacaoId: string): Promise<void> {
  const r = (await c.query(`${SELECAO} where simulacao_id = $1`, [simulacaoId])).rows;
  if (r.length > MAXIMO_DE_EXECUCOES) throw new ErroHttp(409, 'limite_de_execucoes');
  const vistos = new Map<string, string>();
  for (const l of r) {
    const a = `${l.tipo}|${l.strike}|${l.vencimento}`;
    if (vistos.has(l.codigo) && vistos.get(l.codigo) !== a) throw new ErroHttp(400, 'codigo_com_dados_diferentes', { codigo: l.codigo });
    vistos.set(l.codigo, a);
  }
  try { montarCarteira(r.map(paraDominio)); } catch (e) { if (e instanceof ErroDeValor) throw new ErroHttp(400, e.message); throw e; }
  await c.query('update simulacoes set atualizada_em = now() where id = $1', [simulacaoId]);
}

export async function rotasDoSimulador(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  // ---------- Cadeia para montar ----------

  app.get('/api/simulador/cadeia', {
    config: { politica: 'autenticado' },
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['ativo'], properties: { ativo: CODIGO, vencimento: DIA } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const q = req.query as { ativo: string; vencimento?: string };
    const ativo = q.ativo.toUpperCase();
    const agora = relogio();
    const cfg = await calendario.obter();
    return emTransacao(pool, s.usuarioId, async (c) => {
      const base = (await c.query(
        "select to_char(max(dia), 'YYYY-MM-DD') as dia from fechamentos where codigo = $1 and tipo_mercado = 10", [ativo],
      )).rows[0]?.dia as string | null;
      if (!base) throw new ErroHttp(404, 'sem_fechamento');
      const vencimentos = (await c.query(
        `select distinct to_char(vencimento, 'YYYY-MM-DD') as v from series_opcoes
         where ativo_objeto = $1 and visto_ultimo >= $2 and vencimento >= $3 order by v`, [ativo, base, situacaoDoMercado(agora, cfg).dia],
      )).rows.map((l) => l.v as string);
      const vencimento = q.vencimento && vencimentos.includes(q.vencimento) ? q.vencimento : vencimentos[0] ?? null;
      await observarCadeia(c, s.usuarioId, ativo, base, vencimento, vencimentos);
      const tipos = await tiposDosVencimentos(c, ativo, base, vencimentos);
      const linhas = vencimento ? (await c.query(
        `select s.codigo, s.tipo, s.strike, f.negocios, k.vol_implicita, k.delta
         from series_opcoes s
         left join fechamentos f on f.codigo = s.codigo and f.dia = $2
         left join calculos_opcoes k on k.codigo = s.codigo and k.dia = $2 and k.motivo is null
         where s.ativo_objeto = $1 and s.vencimento = $3 and s.visto_ultimo >= $2
         order by s.strike, s.tipo`, [ativo, base, vencimento],
      )).rows : [];
      const cotacoes = new Map((await cotacoesDoUsuario(c, [ativo, ...linhas.map((l) => l.codigo as string)], agora, cfg)).map((x) => [x.codigo, x]));
      const selic = (await c.query("select to_char(dia, 'YYYY-MM-DD') as dia, valor::float8 as valor from taxas_juros where serie = 'selic' order by dia desc limit 1")).rows[0] ?? null;
      const resumo = resumoDaCotacao;
      return {
        agora: agora.toISOString(), hoje: situacaoDoMercado(agora, cfg).dia, dia: base, mercadoAberto: situacaoDoMercado(agora, cfg).aberto,
        ativo: { codigo: ativo, cotacao: resumo(cotacoes.get(ativo)) },
        vencimentos, vencimento, tipos,
        series: linhas.map((l) => ({
          codigo: l.codigo, tipo: l.tipo, strike: Number(l.strike), negocios: num(l.negocios),
          vol: l.vol_implicita === null ? null : Number(l.vol_implicita), delta: l.delta === null ? null : Number(l.delta),
          cotacao: resumo(cotacoes.get(l.codigo)),
        })),
        selic,
      };
    });
  });

  // ---------- Carteiras simuladas ----------

  async function montar(c: Cliente, linhas: Record<string, any>[], agora: Date) {
    const cfg = await calendario.obter();
    let carteira: ReturnType<typeof montarCarteira>;
    try { carteira = montarCarteira(linhas.map(paraDominio)); } catch { return null; }
    const abertos = [...carteira.values()].filter((i) => i.quantidade !== 0);
    const cot = new Map((await cotacoesDoUsuario(c, abertos.map((i) => i.codigo), agora, cfg)).map((x) => [x.codigo, x]));
    const resultado = resumoDeResultado(carteira, new Map<string, Cotacao>([...cot.values()].map((x) => [x.codigo, paraCotacao(x)])), 'executavel_ou_ultimo');
    // Volatilidade para o simulador: a implícita mais recente da série; sem ela, a usada na montagem.
    const vols = new Map<string, number>();
    const opcoes = abertos.filter((i) => i.tipo !== 'ativo').map((i) => i.codigo);
    if (opcoes.length) {
      const r = await c.query(
        `select distinct on (codigo) codigo, vol_implicita from calculos_opcoes where codigo = any($1::text[]) and motivo is null order by codigo, dia desc`, [opcoes],
      );
      for (const l of r.rows) vols.set(l.codigo, Number(l.vol_implicita));
    }
    for (const l of linhas) if (!vols.has(l.codigo) && l.vol !== null) vols.set(l.codigo, Number(l.vol));
    return {
      resultado,
      abertos: abertos.map((i) => ({
        codigo: i.codigo, tipo: i.tipo, strike: i.strike ?? null, vencimento: i.vencimento ?? null, quantidade: i.quantidade,
        precoMedio: i.precoMedio, vol: vols.get(i.codigo) ?? null, cotacao: cot.get(i.codigo) ?? null,
      })),
    };
  }

  app.get('/api/simulacoes', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = relogio();
    return emTransacao(pool, s.usuarioId, async (c) => {
      const sims = (await c.query('select * from simulacoes order by situacao, atualizada_em desc')).rows;
      const execs = (await c.query(`${SELECAO} order by instante, criada_em`)).rows;
      const lista = [];
      for (const x of sims) {
        const dela = execs.filter((e) => e.simulacao_id === x.id);
        const m = await montar(c, dela, agora);
        lista.push({
          id: x.id, nome: x.nome, ativoObjeto: x.ativo_objeto, observacao: x.observacao, situacao: x.situacao,
          criadaEm: iso(x.criada_em), atualizadaEm: iso(x.atualizada_em), operacoes: dela.length,
          resultado: m?.resultado ?? null, abertos: m?.abertos.length ?? 0,
        });
      }
      return { simulacoes: lista };
    });
  });

  app.get('/api/simulacoes/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const x = (await c.query('select * from simulacoes where id = $1', [id])).rows[0];
      if (!x) throw new ErroHttp(404, 'nao_encontrado');
      const execs = (await c.query(`${SELECAO} where simulacao_id = $1 order by instante, criada_em`, [id])).rows;
      const m = await montar(c, execs, relogio());
      return {
        id: x.id, nome: x.nome, ativoObjeto: x.ativo_objeto, observacao: x.observacao, situacao: x.situacao, criadaEm: iso(x.criada_em),
        execucoes: execs.map((l) => ({
          id: l.id, codigo: l.codigo, tipo: l.tipo, strike: num(l.strike), vencimento: l.vencimento, lado: l.lado, quantidade: Number(l.quantidade),
          preco: Number(l.preco), custos: Number(l.custos), vol: num(l.vol), instante: iso(l.instante), observacao: l.observacao,
        })),
        resultado: m?.resultado ?? null, abertos: m?.abertos ?? [],
      };
    });
  });

  app.post('/api/simulacoes', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['nome', 'ativoObjeto', 'execucoes'],
        properties: { nome: { type: 'string', minLength: 1, maxLength: 80 }, ativoObjeto: CODIGO, observacao: { type: 'string', maxLength: 1000 }, execucoes: { type: 'array', minItems: 1, maxItems: 30, items: EXECUCAO } },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { nome: string; ativoObjeto: string; observacao?: string; execucoes: CorpoDaExecucao[] };
    const agora = relogio();
    const nome = b.nome.trim();
    if (!nome) throw new ErroHttp(400, 'nome_obrigatorio');
    const execucoes = b.execucoes.map((e) => lerExecucao(e, agora));
    const id = await emTransacao(pool, s.usuarioId, async (c) => {
      const n = Number((await c.query('select count(*) as n from simulacoes')).rows[0]?.n ?? 0);
      if (n >= MAXIMO_DE_SIMULACOES) throw new ErroHttp(409, 'limite_de_simulacoes');
      const nova = (await c.query('insert into simulacoes (user_id, nome, ativo_objeto, observacao) values ($1, $2, $3, $4) returning id',
        [s.usuarioId, nome, b.ativoObjeto.toUpperCase(), b.observacao?.trim() || null])).rows[0].id as string;
      for (const e of execucoes) await inserir(c, s.usuarioId, nova, e);
      await conferir(c, nova);
      return nova;
    });
    return reply.status(201).send({ id });
  });

  app.post('/api/simulacoes/:id/execucoes', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } },
      body: { type: 'object', additionalProperties: false, required: ['execucoes'], properties: { execucoes: { type: 'array', minItems: 1, maxItems: 30, items: EXECUCAO }, observacao: { type: 'string', maxLength: 300 } } },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = req.body as { execucoes: CorpoDaExecucao[]; observacao?: string };
    const agora = relogio();
    const execucoes = b.execucoes.map((e) => lerExecucao({ ...e, ...(b.observacao && !e.observacao ? { observacao: b.observacao } : {}) }, agora));
    await emTransacao(pool, s.usuarioId, async (c) => {
      const x = (await c.query('select situacao from simulacoes where id = $1 for update', [id])).rows[0];
      if (!x) throw new ErroHttp(404, 'nao_encontrado');
      if (x.situacao !== 'aberta') throw new ErroHttp(409, 'simulacao_encerrada');
      for (const e of execucoes) await inserir(c, s.usuarioId, id, e);
      await conferir(c, id);
    });
    return reply.status(201).send({ ok: true, registradas: execucoes.length });
  });

  app.delete('/api/simulacoes/:id/execucoes/:execId', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id', 'execId'], properties: { id: UUID, execId: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id, execId } = req.params as { id: string; execId: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from execucoes_simuladas where id = $1 and simulacao_id = $2', [execId, id]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await conferir(c, id);
      return { ok: true };
    });
  });

  app.patch('/api/simulacoes/:id', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } },
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
        nome: { type: 'string', minLength: 1, maxLength: 80 }, observacao: { type: ['string', 'null'], maxLength: 1000 }, situacao: { type: 'string', enum: ['aberta', 'encerrada'] },
      } },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = req.body as { nome?: string; observacao?: string | null; situacao?: 'aberta' | 'encerrada' };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const x = (await c.query('select * from simulacoes where id = $1 for update', [id])).rows[0];
      if (!x) throw new ErroHttp(404, 'nao_encontrado');
      const nome = b.nome?.trim() ?? x.nome;
      if (!nome) throw new ErroHttp(400, 'nome_obrigatorio');
      await c.query('update simulacoes set nome = $2, observacao = $3, situacao = $4, atualizada_em = now() where id = $1',
        [id, nome, b.observacao === undefined ? x.observacao : (b.observacao?.trim() || null), b.situacao ?? x.situacao]);
      return { ok: true };
    });
  });

  app.delete('/api/simulacoes/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from simulacoes where id = $1', [id]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return { ok: true };
    });
  });
}
