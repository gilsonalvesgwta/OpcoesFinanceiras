// Entrar, sair, sessão, troca e recuperação de senha, convite (lado de quem é convidado).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, erroDoBanco } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import {
  conferirSenha, gerarHashDeSenha, hashDoToken, normalizarEmail, novoToken, problemaDaSenha, tokenComFormatoValido,
} from '../seguranca.ts';

const LIMITE_POR_IP = 30; // falhas de login por IP em 15 minutos
const LIMITE_RECUPERACAO_POR_IP = 10;

function corpo(propriedades: Record<string, unknown>, obrigatorias: string[]) {
  return { type: 'object', additionalProperties: false, required: obrigatorias, properties: propriedades } as const;
}
const texto = (max: number) => ({ type: 'string', maxLength: max });

function sessaoPublica(s: Sessao) {
  return {
    usuario: { id: s.usuarioId, email: s.email, nome: s.nome, papel: s.papel, organizacaoId: s.organizacaoId },
    csrf: s.csrf,
    deveTrocarSenha: s.deveTrocarSenha,
  };
}

export async function rotasDeAcesso(app: FastifyInstance, dep: Dependencias): Promise<void> {
  const { pool, config, correio } = dep;

  async function abrirSessao(reply: FastifyReply, usuarioId: string, ip: string | null, agente: string | undefined) {
    const token = novoToken();
    const csrf = novoToken();
    await emTransacao(pool, null, (c) =>
      c.query('select app.criar_sessao($1, $2, $3, $4::interval, $5::inet, $6)', [usuarioId, hashDoToken(token), csrf, config.sessao.idadeMaxima, ip, agente ?? null]),
    );
    reply.setCookie(config.cookie.nome, token, { httpOnly: true, secure: config.cookie.seguro, sameSite: 'lax', path: '/' });
    return token;
  }

  async function sessaoDoToken(token: string): Promise<Sessao> {
    const l = await emTransacao(pool, null, async (c) =>
      (await c.query('select * from app.sessao_por_token($1, $2::interval)', [hashDoToken(token), config.sessao.inatividade])).rows[0],
    );
    if (!l) throw new ErroHttp(500, 'sessao_nao_criada');
    return {
      sessaoId: l.sessao_id, usuarioId: l.user_id, organizacaoId: l.organization_id, papel: l.papel, email: l.email,
      nome: l.nome, csrf: l.csrf_token, deveTrocarSenha: l.deve_trocar_senha,
    };
  }

  async function bloqueado(chave: string): Promise<Date | null> {
    const r = await emTransacao(pool, null, (c) => c.query('select app.tentativa_bloqueada($1) as ate', [chave]));
    return r.rows[0]?.ate ?? null;
  }

  // ---- Entrar ----
  app.post('/api/auth/entrar', {
    config: { politica: 'publica' },
    schema: { body: corpo({ email: texto(254), senha: texto(200) }, ['email', 'senha']) },
  }, async (req, reply) => {
    const { email: bruto, senha } = req.body as { email: string; senha: string };
    const email = normalizarEmail(bruto) ?? '';
    const ip = ipDe(req);
    const chaves = [`email:${email}`, ...(ip ? [`ip:${ip}`] : [])];
    for (const chave of chaves) {
      const ate = await bloqueado(chave);
      if (ate) throw new ErroHttp(429, 'muitas_tentativas', { tentarDepois: ate });
    }
    const conta = email
      ? (await emTransacao(pool, null, (c) => c.query('select * from app.usuario_para_login($1)', [email]))).rows[0]
      : undefined;
    const certa = await conferirSenha(senha, conta?.senha_hash ?? null);
    if (!conta || !certa) {
      await emTransacao(pool, null, async (c) => {
        if (email) await c.query('select app.registrar_falha($1)', [`email:${email}`]);
        if (ip) await c.query('select app.registrar_falha($1, $2)', [`ip:${ip}`, LIMITE_POR_IP]);
      });
      throw new ErroHttp(401, 'credenciais_invalidas');
    }
    await emTransacao(pool, null, (c) => c.query('select app.limpar_falhas($1)', [`email:${email}`]));
    const token = await abrirSessao(reply, conta.id, ip, req.headers['user-agent']);
    const s = await sessaoDoToken(token);
    await emTransacao(pool, s.usuarioId, (c) => auditar(c, s, 'login', { tipo: 'usuario', id: s.usuarioId }, ip));
    return sessaoPublica(s);
  });

  // ---- Sair ----
  app.post('/api/auth/sair', { config: { politica: 'autenticado', liberadaComTrocaPendente: true } }, async (req, reply) => {
    const token = req.cookies[config.cookie.nome];
    if (tokenComFormatoValido(token)) {
      await emTransacao(pool, null, (c) => c.query('select app.revogar_sessao_por_token($1)', [hashDoToken(token)]));
    }
    reply.clearCookie(config.cookie.nome, { path: '/' });
    return { ok: true };
  });

  // ---- Sessão atual ----
  app.get('/api/auth/sessao', { config: { politica: 'autenticado', liberadaComTrocaPendente: true } }, async (req) =>
    sessaoPublica(req.sessao as Sessao),
  );

  // ---- Trocar a própria senha (exige a atual) ----
  app.post('/api/auth/trocar-senha', {
    config: { politica: 'autenticado', liberadaComTrocaPendente: true },
    schema: { body: corpo({ atual: texto(200), nova: texto(200) }, ['atual', 'nova']) },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const { atual, nova } = req.body as { atual: string; nova: string };
    const problema = problemaDaSenha(nova);
    if (problema) throw new ErroHttp(400, problema);
    if (nova === atual) throw new ErroHttp(400, 'senha_igual_a_atual');
    const conta = (await emTransacao(pool, null, (c) => c.query('select * from app.usuario_para_login($1)', [s.email]))).rows[0];
    if (!conta || !(await conferirSenha(atual, conta.senha_hash))) throw new ErroHttp(400, 'senha_atual_incorreta');
    const hash = await gerarHashDeSenha(nova);
    await emTransacao(pool, s.usuarioId, async (c) => {
      // A troca derruba todas as sessões (gatilho no banco); uma nova é aberta logo abaixo.
      await c.query('update users set senha_hash = $1, deve_trocar_senha = false where id = $2', [hash, s.usuarioId]);
      await auditar(c, s, 'senha.trocada', { tipo: 'usuario', id: s.usuarioId }, ipDe(req));
    });
    const token = await abrirSessao(reply, s.usuarioId, ipDe(req), req.headers['user-agent']);
    return sessaoPublica(await sessaoDoToken(token));
  });

  // ---- Pedir link de recuperação: mesma resposta exista ou não a conta ----
  app.post('/api/auth/recuperar', {
    config: { politica: 'publica' },
    schema: { body: corpo({ email: texto(254) }, ['email']) },
  }, async (req, reply) => {
    const ip = ipDe(req);
    if (ip) {
      const ate = await bloqueado(`recuperar:${ip}`);
      if (ate) throw new ErroHttp(429, 'muitas_tentativas', { tentarDepois: ate });
      await emTransacao(pool, null, (c) => c.query('select app.registrar_falha($1, $2)', [`recuperar:${ip}`, LIMITE_RECUPERACAO_POR_IP]));
    }
    const email = normalizarEmail((req.body as { email: string }).email);
    if (email) {
      const token = novoToken();
      const usuario = (await emTransacao(pool, null, (c) =>
        c.query('select app.criar_recuperacao($1, $2, $3::interval) as id', [email, hashDoToken(token), config.recuperacao.validade]),
      )).rows[0]?.id;
      if (usuario) {
        await correio.enviar({
          para: email,
          assunto: 'Redefinir sua senha — WTA Options Intelligence',
          texto: `Para criar uma senha nova, abra o link abaixo (vale por 30 minutos e uma única vez):\n\n${config.urlPublica}/redefinir-senha#${token}\n\nSe não foi você, ignore este e-mail.`,
        });
      }
    }
    return reply.status(202).send({ ok: true });
  });

  // ---- Redefinir pelo link ----
  app.post('/api/auth/redefinir', {
    config: { politica: 'publica' },
    schema: { body: corpo({ token: texto(100), senha: texto(200) }, ['token', 'senha']) },
  }, async (req) => {
    const { token, senha } = req.body as { token: string; senha: string };
    if (!tokenComFormatoValido(token)) throw new ErroHttp(400, 'token_invalido');
    const problema = problemaDaSenha(senha);
    if (problema) throw new ErroHttp(400, problema);
    const hash = await gerarHashDeSenha(senha);
    try {
      await emTransacao(pool, null, (c) => c.query('select app.redefinir_senha($1, $2)', [hashDoToken(token), hash]));
    } catch (e) {
      if (erroDoBanco(e) === 'token_invalido') throw new ErroHttp(400, 'token_invalido');
      throw e;
    }
    return { ok: true };
  });

  // ---- Convite: consultar e aceitar ----
  app.get('/api/convites/:token', {
    config: { politica: 'publica' },
    schema: { params: corpo({ token: texto(100) }, ['token']) },
  }, async (req) => {
    const { token } = req.params as { token: string };
    if (!tokenComFormatoValido(token)) throw new ErroHttp(404, 'convite_invalido');
    const l = (await emTransacao(pool, null, (c) => c.query('select * from app.convite_valido($1)', [hashDoToken(token)]))).rows[0];
    if (!l) throw new ErroHttp(404, 'convite_invalido');
    return { email: l.email, papel: l.papel, organizacao: l.organizacao };
  });

  app.post('/api/convites/aceitar', {
    config: { politica: 'publica' },
    schema: { body: corpo({ token: texto(100), nome: { type: 'string', minLength: 1, maxLength: 120 }, senha: texto(200) }, ['token', 'nome', 'senha']) },
  }, async (req, reply) => {
    const { token, nome, senha } = req.body as { token: string; nome: string; senha: string };
    if (!tokenComFormatoValido(token)) throw new ErroHttp(400, 'convite_invalido');
    const problema = problemaDaSenha(senha);
    if (problema) throw new ErroHttp(400, problema);
    if (nome.trim() === '') throw new ErroHttp(400, 'nome_obrigatorio');
    const hash = await gerarHashDeSenha(senha);
    let usuarioId: string;
    try {
      usuarioId = (await emTransacao(pool, null, (c) => c.query('select app.aceitar_convite($1, $2, $3) as id', [hashDoToken(token), nome, hash]))).rows[0].id;
    } catch (e) {
      const motivo = erroDoBanco(e);
      if (motivo === 'convite_invalido' || motivo === 'email_ja_cadastrado') throw new ErroHttp(400, motivo);
      throw e;
    }
    const sessao = await abrirSessao(reply, usuarioId, ipDe(req), req.headers['user-agent']);
    return reply.status(201).send(sessaoPublica(await sessaoDoToken(sessao)));
  });
}
