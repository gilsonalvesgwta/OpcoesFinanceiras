// Montagem do servidor: autenticação, política obrigatória por rota, CSRF,
// cabeçalhos de segurança e tratamento de erros. As rotas ficam em ./rotas.

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { Config } from './config.ts';
import type { Correio } from './correio.ts';
import { emTransacao, erroDoBanco, type Pool } from './banco.ts';
import { hashDoToken, iguaisEmTempoConstante, tokenComFormatoValido } from './seguranca.ts';
import { rotasDeAcesso } from './rotas/acesso.ts';
import { rotasDeAdministracao } from './rotas/administracao.ts';
import { rotasPessoais } from './rotas/pessoais.ts';

export type Politica = 'publica' | 'autenticado' | 'admin' | 'superadmin';
export type Papel = 'superadmin' | 'admin' | 'usuario';

export type Sessao = {
  sessaoId: string;
  usuarioId: string;
  organizacaoId: string;
  papel: Papel;
  email: string;
  nome: string;
  csrf: string;
  deveTrocarSenha: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    sessao: Sessao | null;
  }
  interface FastifyInstance {
    rotasComPolitica: { metodo: string; url: string; politica: Politica }[];
  }
  interface FastifyContextConfig {
    politica?: Politica;
    // Rotas que continuam abertas enquanto a troca de senha obrigatória está pendente.
    liberadaComTrocaPendente?: boolean;
  }
}

export class ErroHttp extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly extra: Record<string, unknown> | undefined;
  constructor(status: number, codigo: string, extra?: Record<string, unknown>) {
    super(codigo);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

export type Dependencias = { config: Config; pool: Pool; correio: Correio };

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function ipDe(req: FastifyRequest): string | null {
  return /^[0-9a-fA-F:.]+$/.test(req.ip) ? req.ip : null;
}

export async function construirApp(dep: Dependencias): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true, // atrás do Traefik
    bodyLimit: 64 * 1024,
    logger: dep.config.producao
      ? {
          level: 'info',
          redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], censor: '[oculto]' },
        }
      : false,
    // Campo desconhecido é recusado, não descartado em silêncio.
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });

  await app.register(cookie);
  app.decorateRequest('sessao', null);

  // Toda rota precisa declarar a política. Rota sem política não sobe.
  const rotas: FastifyInstance['rotasComPolitica'] = [];
  app.decorate('rotasComPolitica', rotas);
  app.addHook('onRoute', (rota) => {
    const politica = rota.config?.politica;
    if (!politica) throw new Error(`rota sem política de acesso: ${String(rota.method)} ${rota.url}`);
    for (const metodo of [rota.method].flat()) if (metodo !== 'HEAD') rotas.push({ metodo, url: rota.url, politica });
  });

  // onRequest: roda antes da leitura e da validação do corpo, então quem não tem
  // acesso recebe 401/403 sem o servidor sequer olhar o que foi enviado.
  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    const politica = req.routeOptions.config.politica;
    // Sem política só a resposta de "não encontrado" (toda rota registrada tem política, ver onRoute).
    if (!politica) return;

    const token = req.cookies[dep.config.cookie.nome];
    if (tokenComFormatoValido(token)) {
      const linha = await emTransacao(dep.pool, null, async (c) =>
        (await c.query('select * from app.sessao_por_token($1, $2::interval)', [hashDoToken(token), dep.config.sessao.inatividade])).rows[0],
      );
      if (linha) {
        req.sessao = {
          sessaoId: linha.sessao_id, usuarioId: linha.user_id, organizacaoId: linha.organization_id, papel: linha.papel,
          email: linha.email, nome: linha.nome, csrf: linha.csrf_token, deveTrocarSenha: linha.deve_trocar_senha,
        };
      }
    }

    if (politica === 'publica') return;
    const s = req.sessao;
    if (!s) throw new ErroHttp(401, 'nao_autenticado');
    if (!METODOS_SEGUROS.has(req.method)) {
      const enviado = req.headers['x-csrf-token'];
      if (typeof enviado !== 'string' || !iguaisEmTempoConstante(enviado, s.csrf)) throw new ErroHttp(403, 'csrf_invalido');
    }
    if (s.deveTrocarSenha && !req.routeOptions.config.liberadaComTrocaPendente) throw new ErroHttp(403, 'troca_de_senha_obrigatoria');
    if (politica === 'admin' && s.papel !== 'admin' && s.papel !== 'superadmin') throw new ErroHttp(403, 'sem_permissao');
    if (politica === 'superadmin' && s.papel !== 'superadmin') throw new ErroHttp(403, 'sem_permissao');
  });

  app.addHook('onSend', async (_req, reply, carga) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('Cache-Control', 'no-store');
    if (dep.config.cookie.seguro) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return carga;
  });

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ erro: erro.codigo, ...erro.extra });
    const e = erro as { validation?: unknown; statusCode?: number; code?: string };
    if (e.validation) return reply.status(400).send({ erro: 'entrada_invalida' });
    if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || e.statusCode === 415) {
      return reply.status(415).send({ erro: 'tipo_de_conteudo_invalido' });
    }
    if (e.statusCode === 413) return reply.status(413).send({ erro: 'corpo_grande_demais' });
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) return reply.status(e.statusCode).send({ erro: 'requisicao_invalida' });
    const doBanco = erroDoBanco(erro);
    if (doBanco) return reply.status(400).send({ erro: doBanco });
    req.log.error({ err: erro }, 'erro interno');
    return reply.status(500).send({ erro: 'erro_interno' });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ erro: 'nao_encontrado' }));

  app.get('/api/saude', { config: { politica: 'publica' } }, async (_req, reply) => {
    try {
      await dep.pool.query('select 1');
      return { ok: true, banco: 'ok' };
    } catch {
      return reply.status(503).send({ ok: false, banco: 'indisponivel' });
    }
  });

  await rotasDeAcesso(app, dep);
  await rotasDeAdministracao(app, dep);
  await rotasPessoais(app, dep);
  return app;
}
