// Regras de alerta do usuário, histórico de disparos e vínculo com o Telegram.
// Tudo do dono (RLS). O envio das mensagens é do worker.

import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  CAMPOS_DE_ALERTA, descreverCondicao, descreverRearme, validarRegra, type Comparacao, type Condicao, type PoliticaDeRearme,
} from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import { regraDaLinha } from '../alertas/motor.ts';

const UUID = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } as const;
const HORA = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } as const;
const OPERADORES = new Set<Comparacao['operador']>(['>', '>=', '<', '<=', 'igual', 'cruza_acima', 'cruza_abaixo', 'dentro', 'fora']);
const MAXIMO_DE_REGRAS = 100;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0, I/1

export { hashDoCodigo as hashDoCodigoTelegram } from '../coleta/telegram.ts';
import { hashDoCodigo as hashDoCodigoTelegram } from '../coleta/telegram.ts';

// Lê a condição enviada pela tela, sem confiar em nada: campos conhecidos, no máximo
// 3 níveis e 10 comparações.
export function lerCondicao(x: unknown): Condicao {
  let comparacoes = 0;
  const ler = (v: unknown, nivel: number): Condicao => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ErroHttp(400, 'condicao_invalida');
    const o = v as Record<string, unknown>;
    if (o.tipo === 'e' || o.tipo === 'ou') {
      if (nivel >= 3 || !Array.isArray(o.filhos) || o.filhos.length === 0 || o.filhos.length > 10) throw new ErroHttp(400, 'condicao_invalida');
      return { tipo: o.tipo, filhos: o.filhos.map((f) => ler(f, nivel + 1)) };
    }
    if (o.tipo !== 'comparacao') throw new ErroHttp(400, 'condicao_invalida');
    comparacoes += 1;
    if (comparacoes > 10) throw new ErroHttp(400, 'condicao_grande_demais');
    if (typeof o.campo !== 'string' || !(o.campo in CAMPOS_DE_ALERTA)) throw new ErroHttp(400, 'campo_invalido');
    if (typeof o.operador !== 'string' || !OPERADORES.has(o.operador as Comparacao['operador'])) throw new ErroHttp(400, 'operador_invalido');
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e13 ? n : undefined);
    const valor = num(o.valor);
    if (valor === undefined) throw new ErroHttp(400, 'valor_invalido');
    const c: Comparacao = { tipo: 'comparacao', campo: o.campo, operador: o.operador as Comparacao['operador'], valor };
    if (o.valor2 !== undefined) { const v2 = num(o.valor2); if (v2 === undefined) throw new ErroHttp(400, 'valor_invalido'); c.valor2 = v2; }
    if (o.tolerancia !== undefined) { const t = num(o.tolerancia); if (t === undefined) throw new ErroHttp(400, 'valor_invalido'); c.tolerancia = t; }
    return c;
  };
  return ler(x, 0);
}

export function lerRearme(x: unknown): PoliticaDeRearme {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  if (o.tipo === 'uma_vez') return { tipo: 'uma_vez' };
  if (o.tipo === 'ao_desfazer') {
    if (o.histerese === undefined) return { tipo: 'ao_desfazer' };
    if (typeof o.histerese === 'number' && Number.isFinite(o.histerese) && o.histerese >= 0) return { tipo: 'ao_desfazer', histerese: o.histerese };
  }
  if (o.tipo === 'intervalo' && Number.isInteger(o.minutos) && (o.minutos as number) >= 1 && (o.minutos as number) <= 1440) {
    return { tipo: 'intervalo', minutos: o.minutos as number };
  }
  throw new ErroHttp(400, 'rearme_invalido');
}

type Janela = { inicio: string; fim: string } | null;
type CorpoDaRegra = {
  nome?: string; codigo?: string; condicao?: unknown; rearme?: unknown; limitePorDia?: number; aceitarPeriodica?: boolean; janela?: Janela; ativa?: boolean;
};

const PROPRIEDADES = {
  nome: { type: 'string', minLength: 1, maxLength: 80 },
  codigo: { type: 'string', pattern: '^[A-Za-z0-9]{4,12}$' },
  condicao: { type: 'object' },
  rearme: { type: 'object' },
  limitePorDia: { type: 'integer', minimum: 1, maximum: 50 },
  aceitarPeriodica: { type: 'boolean' },
  janela: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['inicio', 'fim'], properties: { inicio: HORA, fim: HORA } }] },
  ativa: { type: 'boolean' },
} as const;

function regraPublica(l: Record<string, any>) {
  return {
    id: l.id, nome: l.nome, codigo: l.codigo, condicao: l.condicao, descricao: descreverCondicao(l.condicao),
    rearme: l.rearme, descricaoRearme: descreverRearme(l.rearme), limitePorDia: l.limite_por_dia, aceitarPeriodica: l.aceitar_periodica,
    janela: l.janela_inicio ? { inicio: l.janela_inicio, fim: l.janela_fim } : null, ativa: l.ativa, versao: l.versao,
    criadaEm: new Date(l.criada_em).toISOString(),
    disparos: l.estado && l.estado_versao === l.versao ? l.estado.disparos : 0,
    ultimoDisparo: l.ultimo_disparo ? new Date(l.ultimo_disparo).toISOString() : null,
  };
}

export async function rotasDeAlertas(app: FastifyInstance, dep: Dependencias): Promise<void> {
  const { pool } = dep;

  app.get('/api/alertas', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const regras = (await c.query(
        `select r.*, e.estado, e.versao as estado_versao,
                (select max(instante) from eventos_alerta v where v.regra_id = r.id) as ultimo_disparo
         from regras_alerta r left join estados_alerta e on e.regra_id = r.id
         order by r.ativa desc, r.criada_em desc`,
      )).rows;
      const eventos = (await c.query(
        `select v.id, v.regra_id, v.codigo, v.descricao, v.instante, v.qualidade, v.fonte, v.valores, v.criado_em,
                r.nome as regra, a.situacao as aviso, a.enviado_em, a.erro
         from eventos_alerta v left join regras_alerta r on r.id = v.regra_id
         left join avisos a on a.evento_id = v.id
         order by v.criado_em desc limit 50`,
      )).rows;
      return {
        regras: regras.map(regraPublica),
        eventos: eventos.map((e) => ({
          id: Number(e.id), regraId: e.regra_id, regra: e.regra, codigo: e.codigo, descricao: e.descricao,
          instante: new Date(e.instante).toISOString(), qualidade: e.qualidade, fonte: e.fonte, valores: e.valores,
          criadoEm: new Date(e.criado_em).toISOString(),
          aviso: e.aviso ? { situacao: e.aviso, enviadoEm: e.enviado_em ? new Date(e.enviado_em).toISOString() : null, erro: e.erro } : null,
        })),
      };
    });
  });

  app.post('/api/alertas', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['nome', 'codigo', 'condicao', 'rearme'], properties: PROPRIEDADES } },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const b = req.body as CorpoDaRegra;
    const condicao = lerCondicao(b.condicao);
    const rearme = lerRearme(b.rearme);
    const linha = {
      id: '00000000-0000-0000-0000-000000000000', versao: 1, condicao, rearme, limite_por_dia: b.limitePorDia ?? 5,
      aceitar_periodica: b.aceitarPeriodica ?? true, janela_inicio: b.janela?.inicio ?? null, janela_fim: b.janela?.fim ?? null,
    };
    const erros = validarRegra(regraDaLinha(linha));
    if (erros.length) throw new ErroHttp(400, erros[0] as string);
    const nome = (b.nome as string).trim();
    if (!nome) throw new ErroHttp(400, 'nome_obrigatorio');
    const r = await emTransacao(pool, s.usuarioId, async (c) => {
      const n = Number((await c.query('select count(*) as n from regras_alerta')).rows[0]?.n ?? 0);
      if (n >= MAXIMO_DE_REGRAS) throw new ErroHttp(409, 'limite_de_regras');
      const nova = (await c.query(
        `insert into regras_alerta (user_id, nome, codigo, condicao, rearme, limite_por_dia, aceitar_periodica, janela_inicio, janela_fim)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
        [s.usuarioId, nome, (b.codigo as string).toUpperCase(), JSON.stringify(condicao), JSON.stringify(rearme), linha.limite_por_dia, linha.aceitar_periodica, linha.janela_inicio, linha.janela_fim],
      )).rows[0];
      await auditar(c, s, 'alerta.criado', { tipo: 'regra_alerta', id: nova.id, depois: { nome, codigo: nova.codigo, descricao: descreverCondicao(condicao) } }, ipDe(req));
      return nova;
    });
    return reply.status(201).send(regraPublica(r));
  });

  app.patch('/api/alertas/:id', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } },
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: PROPRIEDADES },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = req.body as CorpoDaRegra;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const atual = (await c.query('select * from regras_alerta where id = $1 for update', [id])).rows[0];
      if (!atual) throw new ErroHttp(404, 'nao_encontrado');
      const novo = {
        nome: b.nome?.trim() ?? atual.nome,
        codigo: b.codigo?.toUpperCase() ?? atual.codigo,
        condicao: b.condicao !== undefined ? lerCondicao(b.condicao) : atual.condicao,
        rearme: b.rearme !== undefined ? lerRearme(b.rearme) : atual.rearme,
        limite_por_dia: b.limitePorDia ?? atual.limite_por_dia,
        aceitar_periodica: b.aceitarPeriodica ?? atual.aceitar_periodica,
        janela_inicio: b.janela === undefined ? atual.janela_inicio : b.janela?.inicio ?? null,
        janela_fim: b.janela === undefined ? atual.janela_fim : b.janela?.fim ?? null,
        ativa: b.ativa ?? atual.ativa,
      };
      if (!novo.nome) throw new ErroHttp(400, 'nome_obrigatorio');
      const erros = validarRegra(regraDaLinha({ id, versao: atual.versao, ...novo }));
      if (erros.length) throw new ErroHttp(400, erros[0] as string);
      // Mudou o que a regra observa, ou religou uma regra: recomeça o estado (versão nova).
      const recomeca = b.codigo !== undefined || b.condicao !== undefined || b.rearme !== undefined || b.limitePorDia !== undefined
        || b.aceitarPeriodica !== undefined || b.janela !== undefined || (b.ativa === true && !atual.ativa);
      const r = (await c.query(
        `update regras_alerta set nome = $2, codigo = $3, condicao = $4, rearme = $5, limite_por_dia = $6, aceitar_periodica = $7,
           janela_inicio = $8, janela_fim = $9, ativa = $10, versao = versao + $11, atualizada_em = now()
         where id = $1 returning *`,
        [id, novo.nome, novo.codigo, JSON.stringify(novo.condicao), JSON.stringify(novo.rearme), novo.limite_por_dia, novo.aceitar_periodica,
          novo.janela_inicio, novo.janela_fim, novo.ativa, recomeca ? 1 : 0],
      )).rows[0];
      if (recomeca) await c.query('delete from estados_alerta where regra_id = $1', [id]);
      await auditar(c, s, 'alerta.alterado', { tipo: 'regra_alerta', id, antes: { descricao: descreverCondicao(atual.condicao), ativa: atual.ativa }, depois: { descricao: descreverCondicao(novo.condicao), ativa: novo.ativa } }, ipDe(req));
      return regraPublica(r);
    });
  });

  app.delete('/api/alertas/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from regras_alerta where id = $1 returning nome', [id]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'alerta.removido', { tipo: 'regra_alerta', id, antes: r.rows[0] }, ipDe(req));
      return { ok: true };
    });
  });

  // ---------- Telegram ----------

  const nomeDoBot = () => process.env.TELEGRAM_BOT_NOME?.trim().replace(/^@/, '') || null;

  app.get('/api/telegram', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const v = (await c.query('select nome_telegram, vinculado_em, silencio_ate from vinculos_telegram')).rows[0];
      return {
        botConfigurado: nomeDoBot() !== null,
        bot: nomeDoBot(),
        vinculado: Boolean(v),
        nomeNoTelegram: v?.nome_telegram ?? null,
        vinculadoEm: v ? new Date(v.vinculado_em).toISOString() : null,
        silencioAte: v?.silencio_ate && new Date(v.silencio_ate) > new Date() ? new Date(v.silencio_ate).toISOString() : null,
      };
    });
  });

  // Código de uso único (15 minutos) para mandar ao bot: /start CODIGO.
  app.post('/api/telegram/codigo', { config: { politica: 'autenticado' } }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const bot = nomeDoBot();
    if (!bot) throw new ErroHttp(409, 'telegram_nao_configurado');
    const codigo = Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    await emTransacao(pool, s.usuarioId, async (c) => {
      await c.query("insert into codigos_telegram (codigo_hash, user_id, expira_em) values ($1, $2, now() + interval '15 minutes')", [hashDoCodigoTelegram(codigo), s.usuarioId]);
      await auditar(c, s, 'telegram.codigo_gerado', { tipo: 'usuario', id: s.usuarioId }, ipDe(req));
    });
    return reply.status(201).send({ codigo, link: `https://t.me/${bot}?start=${codigo}`, validoPorMinutos: 15 });
  });

  app.post('/api/telegram/silencio', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['minutos'], properties: { minutos: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1, maximum: 10080 }] } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { minutos } = req.body as { minutos: number | null };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        'update vinculos_telegram set silencio_ate = case when $1::int is null then null else now() + make_interval(mins => $1::int) end returning silencio_ate', [minutos],
      );
      if (r.rowCount === 0) throw new ErroHttp(404, 'telegram_nao_vinculado');
      return { silencioAte: r.rows[0].silencio_ate ? new Date(r.rows[0].silencio_ate).toISOString() : null };
    });
  });

  app.delete('/api/telegram', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from vinculos_telegram where user_id = $1', [s.usuarioId]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'telegram_nao_vinculado');
      await auditar(c, s, 'telegram.desvinculado', { tipo: 'usuario', id: s.usuarioId }, ipDe(req));
      return { ok: true };
    });
  });
}
