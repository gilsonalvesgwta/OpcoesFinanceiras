// Gestão de usuários, convites e auditoria. A checagem aqui é a primeira barreira;
// as regras por linha do banco são a segunda (um admin nunca alcança outra
// organização, nem cria superadministrador, mesmo que esta camada falhe).

import type { FastifyInstance } from 'fastify';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, violacaoDeUnicidade } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import { hashDoToken, normalizarEmail, novoToken } from '../seguranca.ts';

const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } as const;
const COLUNAS = 'id, organization_id as "organizacaoId", email, nome, papel, situacao, ultimo_login_em as "ultimoLogin", criado_em as "criadoEm"';

export async function rotasDeAdministracao(app: FastifyInstance, dep: Dependencias): Promise<void> {
  const { pool, config, correio } = dep;

  app.get('/api/usuarios', { config: { politica: 'admin' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => ({
      usuarios: (await c.query(`select ${COLUNAS} from users order by email`)).rows,
    }));
  });

  app.patch('/api/usuarios/:id', {
    config: { politica: 'admin' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          nome: { type: 'string', maxLength: 120 },
          papel: { type: 'string', enum: ['superadmin', 'admin', 'usuario'] },
          situacao: { type: 'string', enum: ['ativo', 'suspenso'] },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const mudar = req.body as { nome?: string; papel?: string; situacao?: string };
    if (id === s.usuarioId && (mudar.papel !== undefined || mudar.situacao !== undefined)) {
      throw new ErroHttp(400, 'nao_altera_o_proprio_acesso');
    }
    // Mudar papel é só do superadministrador; o admin gerencia usuários comuns.
    if (mudar.papel !== undefined && s.papel !== 'superadmin') throw new ErroHttp(403, 'sem_permissao');
    return emTransacao(pool, s.usuarioId, async (c) => {
      const antes = (await c.query(`select ${COLUNAS} from users where id = $1`, [id])).rows[0];
      if (!antes) throw new ErroHttp(404, 'nao_encontrado');
      if (antes.papel !== 'usuario' && s.papel !== 'superadmin') throw new ErroHttp(403, 'sem_permissao');
      const r = await c.query(
        `update users set nome = coalesce($2, nome), papel = coalesce($3, papel), situacao = coalesce($4, situacao)
         where id = $1 returning ${COLUNAS}`,
        [id, mudar.nome ?? null, mudar.papel ?? null, mudar.situacao ?? null],
      );
      const depois = r.rows[0];
      if (!depois) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'usuario.alterado', { tipo: 'usuario', id, antes, depois }, ipDe(req));
      return { usuario: depois };
    });
  });

  app.get('/api/convites', { config: { politica: 'admin' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => ({
      convites: (await c.query(
        `select id, email, papel, criado_em as "criadoEm", expira_em as "expiraEm", usado_em as "usadoEm", cancelado_em as "canceladoEm"
         from invites order by criado_em desc limit 200`,
      )).rows,
    }));
  });

  app.post('/api/convites', {
    config: { politica: 'admin' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'papel'],
        properties: { email: { type: 'string', maxLength: 254 }, papel: { type: 'string', enum: ['admin', 'usuario'] } },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { email: bruto, papel } = req.body as { email: string; papel: 'admin' | 'usuario' };
    const email = normalizarEmail(bruto);
    if (!email) throw new ErroHttp(400, 'email_invalido');
    if (papel === 'admin' && s.papel !== 'superadmin') throw new ErroHttp(403, 'sem_permissao');
    const token = novoToken();
    const convite = await emTransacao(pool, s.usuarioId, async (c) => {
      // Conta já existente: a consulta passa pela função de login (o admin pode não enxergar a conta).
      const existe = (await c.query('select 1 from app.usuario_para_login($1)', [email])).rowCount;
      if (existe) throw new ErroHttp(409, 'email_ja_cadastrado');
      try {
        const r = await c.query(
          `insert into invites (organization_id, email, papel, token_hash, criado_por, expira_em)
           values ($1, $2, $3, $4, $5, now() + $6::interval) returning id, expira_em as "expiraEm"`,
          [s.organizacaoId, email, papel, hashDoToken(token), s.usuarioId, config.convite.validade],
        );
        await auditar(c, s, 'convite.criado', { tipo: 'convite', id: r.rows[0].id, depois: { email, papel } }, ipDe(req));
        return r.rows[0];
      } catch (e) {
        if (violacaoDeUnicidade(e)) throw new ErroHttp(409, 'convite_repetido');
        throw e;
      }
    });
    const link = `${config.urlPublica}/convite#${token}`;
    await correio.enviar({
      para: email,
      assunto: 'Convite — WTA Options Intelligence',
      texto: `Você foi convidado para o WTA Options Intelligence.\n\nPara criar seu acesso, abra o link abaixo (vale por 7 dias):\n\n${link}`,
    });
    // O link volta para quem convidou, que pode enviá-lo por outro meio se o e-mail não estiver configurado.
    return reply.status(201).send({ id: convite.id, expiraEm: convite.expiraEm, link, emailEnviado: correio.configurado });
  });

  app.delete('/api/convites/:id', {
    config: { politica: 'admin' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('update invites set cancelado_em = now() where id = $1 and usado_em is null and cancelado_em is null returning id', [id]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'convite.cancelado', { tipo: 'convite', id }, ipDe(req));
      return { ok: true };
    });
  });

  app.get('/api/auditoria', {
    config: { politica: 'admin' },
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { limite: { type: 'integer', minimum: 1, maximum: 500 }, acao: { type: 'string', maxLength: 60 } },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { limite = 100, acao } = req.query as { limite?: number; acao?: string };
    return emTransacao(pool, s.usuarioId, async (c) => ({
      registros: (await c.query(
        `select a.id, a.quando, a.acao, a.alvo_tipo as "alvoTipo", a.alvo_id as "alvoId", a.antes, a.depois, a.ator_id as "atorId"
         from audit_logs a where ($2::text is null or a.acao = $2) order by a.id desc limit $1`,
        [limite, acao ?? null],
      )).rows,
    }));
  });
}
