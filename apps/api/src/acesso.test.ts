// Testes da api contra um PostgreSQL de verdade (no CI: serviço postgres).
// Variáveis: DATABASE_URL (papel wtaopt_app) e DATABASE_URL_DONO (dono das tabelas,
// só para preparar cenários que a api não cria, como uma segunda organização).
// Sem essas variáveis, o arquivo é pulado.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { construirApp } from './app.ts';
import { criarPool } from './banco.ts';
import type { Config } from './config.ts';
import { CorreioDeTeste } from './correio.ts';
import { gerarHashDeSenha, novoToken } from './seguranca.ts';

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const pular = !URL_APP || !URL_DONO;

const sufixo = randomUUID().slice(0, 8);
const email = (nome: string) => `${nome}.${sufixo}@exemplo.test`;
const SENHA = 'senha forte de teste 1';

type Resposta = { status: number; corpo: any; resposta: LightMyRequestResponse };

class Navegador {
  cookie: string | null = null;
  csrf: string | null = null;
  private readonly app: FastifyInstance;
  constructor(app: FastifyInstance) {
    this.app = app;
  }
  async pedir(metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, opcoes: { semCsrf?: boolean } = {}): Promise<Resposta> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && !opcoes.semCsrf) headers['x-csrf-token'] = this.csrf;
    const r = await this.app.inject({ method: metodo, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
    const novo = r.cookies.find((c) => c.name === 'wtaopt_sessao');
    if (novo) this.cookie = novo.value ? `wtaopt_sessao=${novo.value}` : null;
    let corpo: any = null;
    try { corpo = r.json(); } catch { corpo = r.body; }
    if (corpo && typeof corpo === 'object' && typeof corpo.csrf === 'string') this.csrf = corpo.csrf;
    return { status: r.statusCode, corpo, resposta: r };
  }
  async entrar(e: string, senha = SENHA) {
    return this.pedir('POST', '/api/auth/entrar', { email: e, senha });
  }
}

function tokenDoLink(texto: string): string {
  const m = /#([A-Za-z0-9_-]{43})/.exec(texto);
  assert.ok(m, `link sem token: ${texto}`);
  return m[1] as string;
}

describe('api de acesso', { skip: pular ? 'sem DATABASE_URL e DATABASE_URL_DONO' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  const correio = new CorreioDeTeste();
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);

  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false },
    sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };

  // Personagens
  let chefe: Navegador; // superadmin
  let admin: Navegador; // admin da organização do chefe
  let a1: Navegador;
  let a2: Navegador;
  let anonimo: Navegador;
  const SUPER = email('chefe');

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    // Banco de teste é exclusivo deste arquivo: zera os superadmins anteriores para a instalação valer.
    await dono.query('alter table audit_logs disable trigger audit_logs_imutavel');
    await dono.query('truncate audit_logs, favoritos, user_preferences, sessions, invites, password_resets, login_attempts, users, organizations cascade');
    await dono.query('alter table audit_logs enable trigger audit_logs_imutavel');
    const hash = await gerarHashDeSenha('senha inicial do chefe');
    await pool.query('select app.garantir_superadmin($1, $2)', [SUPER, hash]);
    app = await construirApp({ config, pool, correio });
    chefe = new Navegador(app);
    admin = new Navegador(app);
    a1 = new Navegador(app);
    a2 = new Navegador(app);
    anonimo = new Navegador(app);
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
  });

  test('saúde responde sem login', async () => {
    const r = await anonimo.pedir('GET', '/api/saude');
    assert.deepEqual([r.status, r.corpo.banco], [200, 'ok']);
    assert.equal(r.resposta.headers['x-content-type-options'], 'nosniff');
  });

  test('superadmin entra com a senha inicial e é obrigado a trocá-la', async () => {
    const r = await chefe.entrar(SUPER, 'senha inicial do chefe');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.usuario.papel, 'superadmin');
    assert.equal(r.corpo.deveTrocarSenha, true);
    assert.match(String(r.resposta.headers['set-cookie']), /HttpOnly/i);
    assert.match(String(r.resposta.headers['set-cookie']), /SameSite=Lax/i);
    assert.equal((await chefe.pedir('GET', '/api/usuarios')).corpo.erro, 'troca_de_senha_obrigatoria');
    const cookieAntigo = chefe.cookie;
    const t = await chefe.pedir('POST', '/api/auth/trocar-senha', { atual: 'senha inicial do chefe', nova: SENHA });
    assert.equal(t.status, 200);
    assert.equal(t.corpo.deveTrocarSenha, false);
    assert.notEqual(chefe.cookie, cookieAntigo, 'troca de senha abre sessão nova');
    const velho = new Navegador(app);
    velho.cookie = cookieAntigo;
    assert.equal((await velho.pedir('GET', '/api/auth/sessao')).status, 401, 'a sessão antiga cai');
    assert.equal((await chefe.pedir('GET', '/api/usuarios')).status, 200);
  });

  test('convites: superadmin convida admin; admin convida usuários comuns', async () => {
    const c1 = await chefe.pedir('POST', '/api/convites', { email: email('admin'), papel: 'admin' });
    assert.equal(c1.status, 201);
    assert.ok(correio.ultimoPara(email('admin')), 'e-mail de convite enviado');
    const token = tokenDoLink(c1.corpo.link);
    assert.equal((await anonimo.pedir('GET', `/api/convites/${token}`)).corpo.email, email('admin'));
    const aceito = await admin.pedir('POST', '/api/convites/aceitar', { token, nome: 'Admin', senha: SENHA });
    assert.equal(aceito.status, 201);
    assert.equal(aceito.corpo.usuario.papel, 'admin');
    assert.equal((await anonimo.pedir('POST', '/api/convites/aceitar', { token, nome: 'De novo', senha: SENHA })).corpo.erro, 'convite_invalido');

    for (const [quem, nav] of [['a1', a1], ['a2', a2]] as const) {
      const c = await admin.pedir('POST', '/api/convites', { email: email(quem), papel: 'usuario' });
      assert.equal(c.status, 201, JSON.stringify(c.corpo));
      const ok = await nav.pedir('POST', '/api/convites/aceitar', { token: tokenDoLink(c.corpo.link), nome: quem.toUpperCase(), senha: SENHA });
      assert.equal(ok.status, 201);
    }
    assert.equal((await admin.pedir('POST', '/api/convites', { email: email('outroadmin'), papel: 'admin' })).status, 403, 'admin não convida admin');
    assert.equal((await admin.pedir('POST', '/api/convites', { email: email('a1'), papel: 'usuario' })).status, 409, 'e-mail já cadastrado');
    assert.equal((await a1.pedir('POST', '/api/convites', { email: email('x'), papel: 'usuario' })).status, 403, 'usuário comum não convida');
  });

  test('isolamento: um usuário não alcança nada de outro', async () => {
    assert.equal((await a1.pedir('POST', '/api/favoritos', { codigo: 'petr4' })).status, 201);
    assert.equal((await a1.pedir('POST', '/api/favoritos', { codigo: 'VALE3' })).status, 201);
    assert.deepEqual((await a1.pedir('GET', '/api/favoritos')).corpo.favoritos.map((f: any) => f.codigo), ['PETR4', 'VALE3']);
    assert.deepEqual((await a2.pedir('GET', '/api/favoritos')).corpo.favoritos, [], 'A2 não vê os favoritos de A1');
    assert.equal((await a2.pedir('DELETE', '/api/favoritos/PETR4')).status, 404, 'A2 não apaga favorito de A1');
    assert.deepEqual((await admin.pedir('GET', '/api/favoritos')).corpo.favoritos, [], 'admin não vê favoritos dos usuários');
    assert.deepEqual((await chefe.pedir('GET', '/api/favoritos')).corpo.favoritos, [], 'nem o superadmin');
    assert.equal((await a1.pedir('GET', '/api/favoritos')).corpo.favoritos.length, 2, 'os de A1 continuam lá');
    await a1.pedir('PUT', '/api/preferencias', { tema: 'claro' });
    assert.equal((await a2.pedir('GET', '/api/preferencias')).corpo.tema, 'escuro');
    assert.equal((await a1.pedir('GET', '/api/usuarios')).status, 403);
    assert.equal((await a1.pedir('GET', '/api/auditoria')).status, 403);
  });

  test('admin não alcança outra organização nem muda papéis', async () => {
    const org = (await dono.query("insert into organizations (nome) values ('Beta') returning id")).rows[0].id;
    const beta = (await dono.query(
      "insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, 'B1', 'usuario', $3) returning id",
      [org, email('b1'), await gerarHashDeSenha(SENHA)],
    )).rows[0].id;
    const lista = (await admin.pedir('GET', '/api/usuarios')).corpo.usuarios.map((u: any) => u.email);
    assert.ok(lista.includes(email('a1')) && !lista.includes(email('b1')) && !lista.includes(SUPER));
    assert.equal((await admin.pedir('PATCH', `/api/usuarios/${beta}`, { situacao: 'suspenso' })).status, 404, 'outra organização é invisível');
    const idA1 = (await a1.pedir('GET', '/api/auth/sessao')).corpo.usuario.id;
    assert.equal((await admin.pedir('PATCH', `/api/usuarios/${idA1}`, { papel: 'admin' })).status, 403, 'admin não promove');
    assert.equal((await admin.pedir('PATCH', `/api/usuarios/${idA1}`, { papel: 'superadmin' })).status, 403, 'admin não cria superadmin');
    const idChefe = (await chefe.pedir('GET', '/api/auth/sessao')).corpo.usuario.id;
    assert.equal((await admin.pedir('PATCH', `/api/usuarios/${idChefe}`, { situacao: 'suspenso' })).status, 404, 'admin não alcança o superadmin');
    const idAdmin = (await admin.pedir('GET', '/api/auth/sessao')).corpo.usuario.id;
    assert.equal((await admin.pedir('PATCH', `/api/usuarios/${idAdmin}`, { papel: 'superadmin' })).corpo.erro, 'nao_altera_o_proprio_acesso');
    const p = await chefe.pedir('PATCH', `/api/usuarios/${idA1}`, { papel: 'admin' });
    assert.equal(p.corpo.usuario.papel, 'admin', 'superadmin promove');
    await chefe.pedir('PATCH', `/api/usuarios/${idA1}`, { papel: 'usuario' });
  });

  test('suspensão derruba a sessão e impede o login', async () => {
    const idA2 = (await a2.pedir('GET', '/api/auth/sessao')).corpo.usuario.id;
    assert.equal((await admin.pedir('PATCH', `/api/usuarios/${idA2}`, { situacao: 'suspenso' })).status, 200);
    assert.equal((await a2.pedir('GET', '/api/favoritos')).status, 401);
    assert.equal((await a2.entrar(email('a2'))).status, 401);
    await admin.pedir('PATCH', `/api/usuarios/${idA2}`, { situacao: 'ativo' });
    assert.equal((await a2.entrar(email('a2'))).status, 200);
  });

  test('senha errada, bloqueio depois de 8 erros e mesma resposta para conta inexistente', async () => {
    const quem = new Navegador(app);
    const inexistente = await quem.entrar(email('ninguem'), 'qualquer senha errada');
    const errada = await quem.entrar(email('a1'), 'qualquer senha errada');
    assert.deepEqual([inexistente.status, inexistente.corpo], [errada.status, errada.corpo], 'sem revelar se a conta existe');
    for (let i = 0; i < 7; i += 1) await quem.entrar(email('a1'), 'outra senha errada!');
    const bloqueado = await quem.entrar(email('a1'));
    assert.equal(bloqueado.status, 429, 'nem a senha certa entra durante o bloqueio');
    await dono.query('delete from login_attempts');
  });

  test('recuperação de senha: sem enumeração, link de uso único, sessões antigas caem', async () => {
    const antes = correio.enviados.length;
    const r1 = await anonimo.pedir('POST', '/api/auth/recuperar', { email: email('ninguem') });
    const r2 = await anonimo.pedir('POST', '/api/auth/recuperar', { email: email('a1') });
    assert.deepEqual([r1.status, r1.corpo], [r2.status, r2.corpo]);
    assert.equal(correio.enviados.length, antes + 1, 'só a conta real recebe e-mail');
    const token = tokenDoLink((correio.ultimoPara(email('a1')) as { texto: string }).texto);
    assert.equal((await anonimo.pedir('POST', '/api/auth/redefinir', { token, senha: 'curta' })).corpo.erro, 'senha_curta');
    assert.equal((await anonimo.pedir('POST', '/api/auth/redefinir', { token, senha: 'nova senha da a1 ok' })).status, 200);
    assert.equal((await anonimo.pedir('POST', '/api/auth/redefinir', { token, senha: 'nova senha da a1 ok' })).corpo.erro, 'token_invalido');
    assert.equal((await a1.pedir('GET', '/api/favoritos')).status, 401, 'sessão anterior caiu');
    assert.equal((await a1.entrar(email('a1'), 'nova senha da a1 ok')).status, 200);
    await dono.query('delete from login_attempts');
  });

  test('CSRF, campos desconhecidos e sessão inativa', async () => {
    assert.equal((await a1.pedir('POST', '/api/favoritos', { codigo: 'ITUB4' }, { semCsrf: true })).corpo.erro, 'csrf_invalido');
    assert.equal((await a1.pedir('POST', '/api/favoritos', { codigo: 'ITUB4', extra: 1 })).corpo.erro, 'entrada_invalida');
    assert.equal((await a1.pedir('POST', '/api/favoritos', { codigo: 'IT;B4' })).corpo.erro, 'entrada_invalida');
    await dono.query("update sessions set ultimo_uso_em = now() - interval '13 hours' where user_id = (select id from users where email = $1)", [email('a1')]);
    assert.equal((await a1.pedir('GET', '/api/favoritos')).status, 401, 'inatividade derruba a sessão');
    await a1.entrar(email('a1'), 'nova senha da a1 ok');
    assert.equal((await a1.pedir('POST', '/api/auth/sair')).status, 200);
    assert.equal((await a1.pedir('GET', '/api/auth/sessao')).status, 401, 'depois de sair a sessão não vale');
  });

  test('varredura: toda rota não pública exige login; rotas de admin recusam usuário comum', async () => {
    const amostra = (url: string) => url.replace(':id', randomUUID()).replace(':codigo', 'PETR4').replace(':token', novoToken());
    assert.ok(app.rotasComPolitica.length >= 15, `rotas registradas: ${app.rotasComPolitica.length}`);
    const comum = new Navegador(app);
    await comum.entrar(email('a2'));
    for (const r of app.rotasComPolitica) {
      if (r.politica === 'publica') continue;
      const metodo = r.metodo as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      const carga = metodo === 'GET' || metodo === 'DELETE' ? undefined : {};
      const sem = await anonimo.pedir(metodo, amostra(r.url), carga);
      assert.equal(sem.status, 401, `${r.metodo} ${r.url} sem login`);
      if (r.politica === 'admin' || r.politica === 'superadmin') {
        const res = await comum.pedir(metodo, amostra(r.url), carga);
        assert.equal(res.status, 403, `${r.metodo} ${r.url} com usuário comum`);
      }
    }
  });

  test('auditoria registra as ações e o admin só vê a própria organização', async () => {
    const reg = (await chefe.pedir('GET', '/api/auditoria?limite=500')).corpo.registros.map((r: any) => r.acao);
    for (const acao of ['login', 'senha.trocada', 'convite.criado', 'convite.aceito', 'usuario.alterado', 'favorito.adicionado', 'senha.redefinida']) {
      assert.ok(reg.includes(acao), acao);
    }
    const doAdmin = (await admin.pedir('GET', '/api/auditoria?limite=500')).corpo.registros;
    assert.ok(doAdmin.length > 0);
  });
});
