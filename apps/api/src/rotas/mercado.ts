// Dados de mercado gratuitos (fechamento da B3, Selic), calendário e diagnóstico.

import type { FastifyInstance } from 'fastify';
import { situacaoDoMercado, ultimoPregaoEncerrado } from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, violacaoDeUnicidade } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';

const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const HORA = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } as const;
const DESCRICAO = { type: 'string', minLength: 1, maxLength: 120 } as const;

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

function diaValido(dia: string): boolean {
  const d = new Date(`${dia}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

export async function rotasDeMercado(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;

  // Situação das fontes gratuitas, para o painel.
  app.get('/api/mercado/situacao', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = new Date();
    const cfg = await calendario.obter();
    const mercado = situacaoDoMercado(agora, cfg);
    return emTransacao(pool, s.usuarioId, async (c) => {
      const f = (await c.query("select to_char(max(dia), 'YYYY-MM-DD') as dia from fechamentos")).rows[0];
      const selic = (await c.query("select to_char(dia, 'YYYY-MM-DD') as dia, valor::float8 as valor from taxas_juros where serie = 'selic' order by dia desc limit 1")).rows[0];
      return {
        agora: agora.toISOString(),
        mercado: { aberto: mercado.aberto, motivo: mercado.motivo, sessao: mercado.sessao },
        fechamento: { ultimoImportado: f?.dia ?? null, esperado: ultimoPregaoEncerrado(agora, cfg, mercado.sessao?.fechamento ?? '17:00') },
        selic: selic ? { dia: selic.dia, valor: selic.valor } : null,
      };
    });
  });

  // Último fechamento de cada código pedido (até 100).
  app.get('/api/mercado/fechamentos', {
    config: { politica: 'autenticado' },
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['codigos'], properties: { codigos: { type: 'string', pattern: '^[A-Za-z0-9]{4,12}(,[A-Za-z0-9]{4,12}){0,99}$' } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const codigos = [...new Set((req.query as { codigos: string }).codigos.toUpperCase().split(','))];
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        `select distinct on (codigo) codigo, to_char(dia, 'YYYY-MM-DD') as dia, tipo_mercado, abertura, maxima, minima, ultimo,
                melhor_compra, melhor_venda, negocios, quantidade, volume
         from fechamentos where codigo = any($1::text[]) order by codigo, dia desc`, [codigos],
      );
      return { fechamentos: r.rows.map((l) => ({
        codigo: l.codigo, dia: l.dia, tipoMercado: l.tipo_mercado,
        abertura: num(l.abertura), maxima: num(l.maxima), minima: num(l.minima), ultimo: num(l.ultimo),
        melhorCompra: num(l.melhor_compra), melhorVenda: num(l.melhor_venda),
        negocios: l.negocios, quantidade: num(l.quantidade), volume: num(l.volume),
      })) };
    });
  });

  // ---------- Calendário ----------

  app.get('/api/calendario', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => ({
      feriados: (await c.query("select to_char(dia, 'YYYY-MM-DD') as dia, descricao from feriados order by dia")).rows,
      sessoesEspeciais: (await c.query(
        "select to_char(dia, 'YYYY-MM-DD') as dia, to_char(abertura, 'HH24:MI') as abertura, to_char(fechamento, 'HH24:MI') as fechamento, descricao from sessoes_especiais order by dia",
      )).rows,
      sessaoPadrao: { abertura: '10:00', fechamento: '17:00' },
    }));
  });

  app.post('/api/calendario/feriados', {
    config: { politica: 'superadmin' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['dia', 'descricao'], properties: { dia: DIA, descricao: DESCRICAO } } },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { dia, descricao } = req.body as { dia: string; descricao: string };
    if (!diaValido(dia)) throw new ErroHttp(400, 'data_invalida');
    try {
      await emTransacao(pool, s.usuarioId, async (c) => {
        await c.query('insert into feriados (dia, descricao, criado_por) values ($1, $2, $3)', [dia, descricao.trim(), s.usuarioId]);
        await auditar(c, s, 'calendario.feriado_criado', { tipo: 'feriado', id: dia, depois: { descricao } }, ipDe(req));
      });
    } catch (e) {
      if (violacaoDeUnicidade(e)) throw new ErroHttp(409, 'dia_ja_cadastrado');
      throw e;
    }
    calendario.esquecer();
    return reply.status(201).send({ dia });
  });

  app.delete('/api/calendario/feriados/:dia', {
    config: { politica: 'superadmin' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['dia'], properties: { dia: DIA } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { dia } = req.params as { dia: string };
    await emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from feriados where dia = $1 returning descricao', [dia]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'calendario.feriado_removido', { tipo: 'feriado', id: dia, antes: r.rows[0] }, ipDe(req));
    });
    calendario.esquecer();
    return { ok: true };
  });

  app.post('/api/calendario/sessoes-especiais', {
    config: { politica: 'superadmin' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['dia', 'abertura', 'fechamento', 'descricao'],
        properties: { dia: DIA, abertura: HORA, fechamento: HORA, descricao: DESCRICAO },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as { dia: string; abertura: string; fechamento: string; descricao: string };
    if (!diaValido(b.dia)) throw new ErroHttp(400, 'data_invalida');
    if (b.fechamento <= b.abertura) throw new ErroHttp(400, 'horario_invalido');
    try {
      await emTransacao(pool, s.usuarioId, async (c) => {
        await c.query('insert into sessoes_especiais (dia, abertura, fechamento, descricao, criado_por) values ($1, $2, $3, $4, $5)',
          [b.dia, b.abertura, b.fechamento, b.descricao.trim(), s.usuarioId]);
        await auditar(c, s, 'calendario.sessao_criada', { tipo: 'sessao_especial', id: b.dia, depois: b }, ipDe(req));
      });
    } catch (e) {
      if (violacaoDeUnicidade(e)) throw new ErroHttp(409, 'dia_ja_cadastrado');
      throw e;
    }
    calendario.esquecer();
    return reply.status(201).send({ dia: b.dia });
  });

  app.delete('/api/calendario/sessoes-especiais/:dia', {
    config: { politica: 'superadmin' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['dia'], properties: { dia: DIA } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { dia } = req.params as { dia: string };
    await emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from sessoes_especiais where dia = $1 returning descricao', [dia]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'calendario.sessao_removida', { tipo: 'sessao_especial', id: dia, antes: r.rows[0] }, ipDe(req));
    });
    calendario.esquecer();
    return { ok: true };
  });

  // ---------- Diagnóstico (superadministrador) ----------

  app.get('/api/diagnostico', { config: { politica: 'superadmin' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = new Date();
    const cfg = await calendario.obter();
    return emTransacao(pool, s.usuarioId, async (c) => {
      const pulsos = (await c.query('select nome, versao, visto_em from pulso_coleta order by visto_em desc')).rows;
      const importacoes = (await c.query(
        `select id, fonte, to_char(referencia, 'YYYY-MM-DD') as referencia, situacao, registros, recusados, detalhe, iniciada_em, terminada_em
         from importacoes order by terminada_em desc limit 40`,
      )).rows;
      const ultimoOk = (await c.query(
        "select to_char(max(referencia), 'YYYY-MM-DD') as dia from importacoes where fonte = 'b3-cotahist' and situacao = 'ok'",
      )).rows[0]?.dia ?? null;
      const banco = (await c.query("select count(*)::int as fechamentos, (select count(*)::int from series_opcoes where vencimento >= current_date) as series_vigentes from fechamentos where dia >= current_date - 30")).rows[0];
      return {
        agora: agora.toISOString(),
        coleta: pulsos.map((p) => ({ nome: p.nome, versao: p.versao, vistoEm: iso(p.visto_em) })),
        cotahist: { ultimoImportado: ultimoOk, esperado: ultimoPregaoEncerrado(agora, cfg) },
        banco: { fechamentosUltimos30Dias: banco?.fechamentos ?? 0, seriesVigentes: banco?.series_vigentes ?? 0 },
        importacoes: importacoes.map((l) => ({
          id: Number(l.id), fonte: l.fonte, referencia: l.referencia, situacao: l.situacao, registros: l.registros, recusados: l.recusados,
          detalhe: l.detalhe, iniciadaEm: iso(l.iniciada_em), terminadaEm: iso(l.terminada_em),
        })),
      };
    });
  });
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
