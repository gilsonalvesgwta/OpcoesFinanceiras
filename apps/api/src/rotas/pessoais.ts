// Dados do próprio usuário: favoritos e preferências. Ninguém mais lê, nem administradores.

import type { FastifyInstance } from 'fastify';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, violacaoDeUnicidade } from '../banco.ts';
import { auditar } from '../auditoria.ts';

const CODIGO = { type: 'string', pattern: '^[A-Za-z0-9]{4,12}$' } as const;

export async function rotasPessoais(app: FastifyInstance, dep: Dependencias): Promise<void> {
  const { pool } = dep;

  app.get('/api/favoritos', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => ({
      favoritos: (await c.query('select codigo, ordem, criado_em as "criadoEm" from favoritos order by ordem, codigo')).rows,
    }));
  });

  app.post('/api/favoritos', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['codigo'], properties: { codigo: CODIGO } } },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const codigo = (req.body as { codigo: string }).codigo.toUpperCase();
    try {
      await emTransacao(pool, s.usuarioId, async (c) => {
        await c.query('insert into favoritos (user_id, codigo) values ($1, $2)', [s.usuarioId, codigo]);
        await auditar(c, s, 'favorito.adicionado', { tipo: 'favorito', id: codigo }, ipDe(req));
      });
    } catch (e) {
      if (violacaoDeUnicidade(e)) throw new ErroHttp(409, 'ja_favorito');
      throw e;
    }
    return reply.status(201).send({ codigo });
  });

  app.delete('/api/favoritos/:codigo', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['codigo'], properties: { codigo: CODIGO } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const codigo = (req.params as { codigo: string }).codigo.toUpperCase();
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('delete from favoritos where codigo = $1', [codigo]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'favorito.removido', { tipo: 'favorito', id: codigo }, ipDe(req));
      return { ok: true };
    });
  });

  app.get('/api/preferencias', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const l = (await c.query('select tema from user_preferences where user_id = $1', [s.usuarioId])).rows[0];
      return { tema: l?.tema ?? 'escuro' };
    });
  });

  app.put('/api/preferencias', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, required: ['tema'], properties: { tema: { type: 'string', enum: ['escuro', 'claro', 'sistema'] } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { tema } = req.body as { tema: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      await c.query(
        `insert into user_preferences (user_id, tema) values ($1, $2)
         on conflict (user_id) do update set tema = excluded.tema, atualizado_em = now()`,
        [s.usuarioId, tema],
      );
      return { tema };
    });
  });
}
