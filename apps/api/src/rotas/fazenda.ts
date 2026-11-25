// Vaca (Fazenda): as vacas do usuário (estruturas de venda de call e put roladas), as
// operações de cada uma e as contas da planilha (ordenha, rentabilidade, risco PUT...).
//
// "Atualiza sozinho ao importar notas": a cada consulta, as execuções novas de opção do
// ativo da vaca (vindas das notas, do extrato da B3 ou lançadas em Posições) com a mesma
// quantidade da perna da vaca entram nela. Se a mesma operação já veio da planilha antiga
// (mesmo dia, lado, tipo, quantidade e preço), ela só é ligada à execução (ganha custos e o
// código certo). O que não dá para saber de qual vaca é aparece em "Para distribuir".

import type { FastifyInstance } from 'fastify';
import { analisarVaca, chaveDaOperacao, situacaoDoMercado, vacaDaPlanilha, type OperacaoDaVaca } from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, type Cliente } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario } from '../cotacoes.ts';
import { planilhasDoXlsx, ehXlsx } from '../xlsx-celulas.ts';
import { UUID } from './posicoes.ts';

const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const COD = { type: 'string', pattern: '^[A-Z0-9]{4,12}$' } as const;

type LinhaDeVaca = { id: string; nome: string; ativo_objeto: string; data_inicio: string; margem: string; quantidade: number | null; distancia: string; situacao: string; observacao: string | null };
type ExecucaoLivre = { id: string; dia: string; codigo: string; tipo: 'call' | 'put'; lado: 'compra' | 'venda'; quantidade: number; preco: number; custos: number; strike: number | null; vencimento: string | null; ativo: string };

const paraOperacao = (l: Record<string, unknown>): OperacaoDaVaca => ({
  id: l.id as string, data: l.data as string, lado: l.lado as 'compra' | 'venda', tipo: l.tipo as 'call' | 'put' | 'ativo', prazo: (l.prazo as 'CURTA' | 'LONGA' | null) ?? null,
  quantidade: Number(l.quantidade), ticker: l.ticker as string, strike: l.strike === null ? null : Number(l.strike), vencimento: (l.vencimento as string | null) ?? null,
  preco: Number(l.preco), custos: Number(l.custos), origem: l.origem as OperacaoDaVaca['origem'], execucaoId: (l.execucao_id as string | null) ?? null,
});

async function execucoesLivres(c: Cliente, ativos: readonly string[], desde: string, quantidade?: number): Promise<ExecucaoLivre[]> {
  if (!ativos.length) return [];
  const r = await c.query(
    `select x.id, to_char(x.instante at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, x.codigo, x.tipo, x.lado, x.quantidade, x.preco, x.custos,
            x.strike, to_char(x.vencimento, 'YYYY-MM-DD') as vencimento, e.ativo_objeto as ativo
     from execucoes x join estrategias e on e.id = x.estrategia_id
     where x.tipo in ('call', 'put') and e.ativo_objeto = any($1) and (x.instante at time zone 'America/Sao_Paulo')::date >= $2::date
       and ($3::int is null or x.quantidade = $3) and not exists (select 1 from vaca_operacoes o where o.execucao_id = x.id)
     order by x.instante desc limit 400`,
    [ativos, desde, quantidade ?? null],
  );
  return r.rows.map((l) => ({ ...l, quantidade: Number(l.quantidade), preco: Number(l.preco), custos: Number(l.custos), strike: l.strike === null ? null : Number(l.strike) })) as ExecucaoLivre[];
}

// Põe a execução na vaca: liga à operação igual da planilha, se houver; senão cria.
async function distribuir(c: Cliente, userId: string, vacaId: string, x: ExecucaoLivre): Promise<'ligada' | 'nova'> {
  const igual = (await c.query(
    `select id from vaca_operacoes where vaca_id = $1 and execucao_id is null and data = $2 and lado = $3 and tipo = $4 and quantidade = $5 and round(preco) = $6 order by criada_em limit 1`,
    [vacaId, x.dia, x.lado, x.tipo, x.quantidade, Math.round(x.preco)],
  )).rows[0];
  if (igual) {
    await c.query(
      `update vaca_operacoes set execucao_id = $2, custos = $3, ticker = $4, strike = coalesce($5, strike), vencimento = coalesce($6::date, vencimento) where id = $1`,
      [igual.id, x.id, x.custos, x.codigo, x.strike, x.vencimento],
    );
    return 'ligada';
  }
  await c.query(
    `insert into vaca_operacoes (user_id, vaca_id, execucao_id, data, lado, tipo, quantidade, ticker, strike, vencimento, preco, custos, origem)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'nota')`,
    [userId, vacaId, x.id, x.dia, x.lado, x.tipo, x.quantidade, x.codigo, x.strike, x.vencimento, x.preco, x.custos],
  );
  return 'nova';
}

// Distribuição automática: vaca ativa com tamanho de perna único para o ativo.
async function sincronizar(c: Cliente, userId: string, vacas: readonly LinhaDeVaca[]): Promise<number> {
  const ativas = vacas.filter((v) => v.situacao === 'ativa' && v.quantidade);
  let n = 0;
  for (const v of ativas) {
    if (ativas.filter((o) => o.ativo_objeto === v.ativo_objeto && o.quantidade === v.quantidade).length > 1) continue; // ambíguo: fica para distribuir
    for (const x of await execucoesLivres(c, [v.ativo_objeto], v.data_inicio, v.quantidade as number)) {
      await distribuir(c, userId, v.id, x);
      n += 1;
    }
  }
  return n;
}

export async function rotasDaFazenda(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());
  const lerVacas = async (c: Cliente) => (await c.query(
    `select id, nome, ativo_objeto, to_char(data_inicio, 'YYYY-MM-DD') as data_inicio, margem, quantidade, distancia, situacao, observacao from vacas order by situacao, data_inicio`,
  )).rows as LinhaDeVaca[];

  app.get('/api/fazenda', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = relogio();
    const cfg = await calendario.obter();
    const mercado = situacaoDoMercado(agora, cfg);
    const hoje = mercado.dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      let vacas = await lerVacas(c);
      const novas = await sincronizar(c, s.usuarioId, vacas);
      if (novas) vacas = await lerVacas(c);
      const ops = (await c.query(
        `select id, vaca_id, to_char(data, 'YYYY-MM-DD') as data, lado, tipo, prazo, quantidade, ticker, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento,
                preco, custos, origem, execucao_id from vaca_operacoes order by data, criada_em`,
      )).rows;
      const ativos = [...new Set(vacas.map((v) => v.ativo_objeto))];
      const cot = new Map((await cotacoesDoUsuario(c, ativos, agora, cfg)).map((q) => [q.codigo, q]));
      const lista = vacas.map((v) => {
        const q = cot.get(v.ativo_objeto) ?? null;
        const spot = q?.ultimo ?? null;
        const a = analisarVaca({ dataInicio: v.data_inicio, margem: Number(v.margem), distancia: Number(v.distancia), ativoObjeto: v.ativo_objeto },
          ops.filter((o) => o.vaca_id === v.id).map(paraOperacao), spot, hoje);
        return {
          id: v.id, nome: v.nome, ativoObjeto: v.ativo_objeto, dataInicio: v.data_inicio, margem: Number(v.margem), quantidade: v.quantidade,
          distancia: Number(v.distancia), situacao: v.situacao, observacao: v.observacao,
          cotacao: q ? { ultimo: q.ultimo, qualidade: q.qualidade, provedor: q.provedor } : null, ...a,
        };
      });
      const ativas = vacas.filter((v) => v.situacao === 'ativa');
      const desde = ativas.map((v) => v.data_inicio).sort()[0];
      const livres = desde ? await execucoesLivres(c, [...new Set(ativas.map((v) => v.ativo_objeto))], desde) : [];
      return {
        hoje, mercadoAberto: mercado.aberto, vacas: lista, distribuidasAgora: novas,
        paraDistribuir: livres.map((x) => ({ ...x, sugestao: ativas.filter((v) => v.ativo_objeto === x.ativo && v.quantidade === x.quantidade).map((v) => v.id) })),
      };
    });
  });

  const CORPO_DA_VACA = {
    nome: { type: 'string', minLength: 1, maxLength: 40 }, ativoObjeto: COD, dataInicio: DIA, margem: { type: 'integer', minimum: 0, maximum: 1e13 },
    quantidade: { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000 }, distancia: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
    observacao: { type: ['string', 'null'], maxLength: 500 }, situacao: { enum: ['ativa', 'encerrada'] },
  } as const;

  app.post('/api/fazenda/vacas', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['nome', 'dataInicio'], properties: CORPO_DA_VACA } },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { nome: string; ativoObjeto?: string; dataInicio: string; margem?: number; quantidade?: number | null; distancia?: number; observacao?: string | null };
    const id = await emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        `insert into vacas (user_id, nome, ativo_objeto, data_inicio, margem, quantidade, distancia, observacao)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (user_id, nome) do nothing returning id`,
        [s.usuarioId, b.nome.trim().toUpperCase(), b.ativoObjeto ?? 'BOVA11', b.dataInicio, b.margem ?? 0, b.quantidade ?? null, b.distancia ?? 0.1, b.observacao ?? null],
      );
      if (!r.rows[0]) throw new ErroHttp(409, 'vaca_ja_existe');
      await auditar(c, s, 'fazenda.vaca_criada', { tipo: 'vaca', id: r.rows[0].id, depois: { nome: b.nome } }, ipDe(req));
      return r.rows[0].id as string;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/api/fazenda/vacas/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', properties: { id: UUID } }, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: CORPO_DA_VACA } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = req.body as Record<string, unknown>;
    const colunas: Record<string, string> = { nome: 'nome', ativoObjeto: 'ativo_objeto', dataInicio: 'data_inicio', margem: 'margem', quantidade: 'quantidade', distancia: 'distancia', observacao: 'observacao', situacao: 'situacao' };
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, col] of Object.entries(colunas)) if (k in b) { vals.push(k === 'nome' ? String(b[k]).trim().toUpperCase() : b[k]); sets.push(`${col} = $${vals.length}`); }
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(`update vacas set ${sets.join(', ')} where id = $1 returning id`, vals);
      if (!r.rows[0]) throw new ErroHttp(404, 'nao_encontrado');
      return { ok: true };
    });
  });

  app.delete('/api/fazenda/vacas/:id', { config: { politica: 'autenticado' }, schema: { params: { type: 'object', properties: { id: UUID } } } }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from vacas where id = $1 returning nome', [id]);
      if (!r.rows[0]) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'fazenda.vaca_apagada', { tipo: 'vaca', id, antes: { nome: r.rows[0].nome } }, ipDe(req));
      return { ok: true };
    });
  });

  app.post('/api/fazenda/vacas/:id/operacoes', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', properties: { id: UUID } },
      body: {
        type: 'object', additionalProperties: false, required: ['data', 'lado', 'tipo', 'quantidade', 'ticker', 'preco'],
        properties: {
          data: DIA, lado: { enum: ['compra', 'venda'] }, tipo: { enum: ['call', 'put'] }, prazo: { enum: ['CURTA', 'LONGA', null] },
          quantidade: { type: 'integer', minimum: 1, maximum: 100_000_000 }, ticker: { type: 'string', pattern: '^[A-Za-z0-9]{1,16}$' },
          strike: { type: ['integer', 'null'], minimum: 1 }, vencimento: { anyOf: [DIA, { type: 'null' }] }, preco: { type: 'number', minimum: 0, maximum: 1e11 },
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = req.body as { data: string; lado: string; tipo: string; prazo?: string | null; quantidade: number; ticker: string; strike?: number | null; vencimento?: string | null; preco: number };
    const novo = await emTransacao(pool, s.usuarioId, async (c) => {
      if (!(await c.query('select 1 from vacas where id = $1', [id])).rows[0]) throw new ErroHttp(404, 'nao_encontrado');
      const r = await c.query(
        `insert into vaca_operacoes (user_id, vaca_id, data, lado, tipo, prazo, quantidade, ticker, strike, vencimento, preco, origem)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual') returning id`,
        [s.usuarioId, id, b.data, b.lado, b.tipo, b.prazo ?? null, b.quantidade, b.ticker.toUpperCase(), b.strike ?? null, b.vencimento ?? null, b.preco],
      );
      return r.rows[0].id as string;
    });
    return reply.status(201).send({ id: novo });
  });

  app.delete('/api/fazenda/operacoes/:id', { config: { politica: 'autenticado' }, schema: { params: { type: 'object', properties: { id: UUID } } } }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from vaca_operacoes where id = $1 returning id', [id]);
      if (!r.rows[0]) throw new ErroHttp(404, 'nao_encontrado');
      return { ok: true };
    });
  });

  app.post('/api/fazenda/distribuir', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['execucaoId', 'vacaId'], properties: { execucaoId: UUID, vacaId: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const b = req.body as { execucaoId: string; vacaId: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const v = (await c.query("select ativo_objeto, to_char(data_inicio, 'YYYY-MM-DD') as d from vacas where id = $1", [b.vacaId])).rows[0];
      if (!v) throw new ErroHttp(404, 'nao_encontrado');
      const x = (await execucoesLivres(c, [v.ativo_objeto], '1900-01-01')).find((e) => e.id === b.execucaoId);
      if (!x) throw new ErroHttp(404, 'execucao_nao_encontrada');
      return { resultado: await distribuir(c, s.usuarioId, b.vacaId, x) };
    });
  });

  // Planilha antiga (Excel/Google Sheets): uma aba por vaca. Cria as vacas que não existem
  // e traz as operações; importar de novo não duplica (as da planilha são refeitas, as
  // ligadas a notas ficam).
  app.post('/api/fazenda/importar', {
    config: { politica: 'autenticado' },
    bodyLimit: 18 * 1024 * 1024,
    schema: { body: { type: 'object', additionalProperties: false, required: ['arquivo'], properties: { arquivo: { type: 'object', additionalProperties: false, required: ['nome', 'conteudo'], properties: { nome: { type: 'string', maxLength: 200 }, conteudo: { type: 'string', maxLength: 17_000_000 } } } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const bytes = Buffer.from((req.body as { arquivo: { conteudo: string } }).arquivo.conteudo, 'base64');
    if (!ehXlsx(bytes)) throw new ErroHttp(400, 'fazenda_nao_e_planilha');
    let abas;
    try { abas = planilhasDoXlsx(bytes); } catch { throw new ErroHttp(400, 'fazenda_planilha_ilegivel'); }
    const achadas = abas.map((a) => vacaDaPlanilha(a.nome, a.celulas)).filter((v): v is NonNullable<typeof v> => v !== null);
    if (!achadas.length) throw new ErroHttp(400, 'fazenda_sem_vacas');
    return emTransacao(pool, s.usuarioId, async (c) => {
      const saida: { nome: string; operacoes: number; nova: boolean }[] = [];
      for (const v of achadas) {
        const nome = v.nome.toUpperCase();
        let id = (await c.query('select id from vacas where nome = $1', [nome])).rows[0]?.id as string | undefined;
        const nova = !id;
        if (!id) {
          id = (await c.query(
            'insert into vacas (user_id, nome, ativo_objeto, data_inicio, margem, quantidade) values ($1, $2, $3, $4, $5, $6) returning id',
            [s.usuarioId, nome, 'BOVA11', v.dataInicio, v.margem, v.quantidade],
          )).rows[0].id as string;
        }
        await c.query("delete from vaca_operacoes where vaca_id = $1 and origem = 'planilha' and execucao_id is null", [id]);
        const ficam = new Set((await c.query(
          "select to_char(data, 'YYYY-MM-DD') as data, lado, tipo, quantidade, round(preco) as preco from vaca_operacoes where vaca_id = $1", [id],
        )).rows.map((o) => chaveDaOperacao({ data: o.data, lado: o.lado, tipo: o.tipo, quantidade: Number(o.quantidade), preco: Number(o.preco) })));
        let n = 0;
        for (const o of v.operacoes) {
          if (ficam.has(chaveDaOperacao({ ...o, preco: Math.round(o.preco) }))) continue;
          await c.query(
            `insert into vaca_operacoes (user_id, vaca_id, data, lado, tipo, prazo, quantidade, ticker, strike, vencimento, preco, origem)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planilha')`,
            [s.usuarioId, id, o.data, o.lado, o.tipo, o.prazo, o.quantidade, o.ticker, o.strike, o.vencimento, o.preco],
          );
          n += 1;
        }
        saida.push({ nome, operacoes: n, nova });
      }
      await auditar(c, s, 'fazenda.planilha_importada', { tipo: 'vacas', depois: { vacas: saida } }, ipDe(req));
      return { vacas: saida };
    });
  });
}
