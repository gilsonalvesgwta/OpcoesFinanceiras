// Testes da ponte com o MetaTrader 5, contra um PostgreSQL de verdade.
// Mesmas variáveis de acesso.test.ts. Os usuários deste arquivo são criados direto
// no banco (com o papel dono) e têm e-mails próprios, sem interferir no outro arquivo.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { construirApp } from './app.ts';
import { criarPool } from './banco.ts';
import type { Config } from './config.ts';
import { CorreioDeTeste } from './correio.ts';
import { gerarHashDeSenha } from './seguranca.ts';

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const pular = !URL_APP || !URL_DONO;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas DATABASE_URL ou DATABASE_URL_DONO não foram definidas');

const sufixo = randomUUID().slice(0, 8);
const email = (nome: string) => `${nome}.ponte.${sufixo}@exemplo.test`;
const SENHA = 'senha forte de teste 1';

class Pessoa {
  cookie: string | null = null;
  csrf: string | null = null;
  private readonly app: FastifyInstance;
  constructor(app: FastifyInstance) {
    this.app = app;
  }
  async pedir(metodo: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    const r = await this.app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.50', ...(payload === undefined ? {} : { payload: payload as object }) });
    const novo = r.cookies.find((c) => c.name === 'wtaopt_sessao');
    if (novo) this.cookie = `wtaopt_sessao=${novo.value}`;
    const corpo = r.json();
    if (typeof corpo?.csrf === 'string') this.csrf = corpo.csrf;
    return { status: r.statusCode, corpo };
  }
}

describe('ponte com o MetaTrader 5', { skip: pular ? 'sem DATABASE_URL e DATABASE_URL_DONO' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false },
    sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  let ana: Pessoa;
  let beto: Pessoa;
  let chaveDaAna = '';
  let idDaPonte = '';

  // O robô: sem cookie, só a chave no cabeçalho. Cada teste usa um IP próprio para o bloqueio não vazar.
  async function robo(metodo: 'GET' | 'POST', url: string, chave: string | null, payload?: unknown, ip = '198.51.100.10') {
    const headers: Record<string, string> = {};
    if (chave !== null) headers.authorization = `Bearer ${chave}`;
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: ip, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query("insert into organizations (nome) values ($1) returning id", [`Ponte ${sufixo}`])).rows[0].id;
    for (const [e, n] of [[email('ana'), 'Ana'], [email('beto'), 'Beto']]) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, e, n, hash]);
    }
    app = await construirApp({ config, pool, correio: new CorreioDeTeste() });
    ana = new Pessoa(app);
    beto = new Pessoa(app);
    for (const [p, e] of [[ana, email('ana')], [beto, email('beto')]] as const) {
      assert.equal((await p.pedir('POST', '/api/auth/entrar', { email: e, senha: SENHA })).status, 200);
    }
    assert.equal((await ana.pedir('POST', '/api/favoritos', { codigo: 'PETR4' })).status, 201);
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
  });

  test('rotas da ponte têm a política certa', () => {
    const pol = (m: string, u: string) => app.rotasComPolitica.find((r) => r.metodo === m && r.url === u)?.politica;
    assert.equal(pol('POST', '/api/ponte'), 'autenticado');
    assert.equal(pol('GET', '/api/cotacoes'), 'autenticado');
    assert.equal(pol('GET', '/api/posicoes-corretora'), 'autenticado');
    assert.equal(pol('POST', '/api/ponte/dados'), 'publica'); // protegida pela chave da ponte
    assert.equal(pol('GET', '/api/ponte/simbolos'), 'publica');
  });

  test('sem login não se cria ponte nem se leem cotações', async () => {
    const anonimo = new Pessoa(app);
    assert.equal((await anonimo.pedir('POST', '/api/ponte', {})).status, 401);
    assert.equal((await anonimo.pedir('GET', '/api/cotacoes')).status, 401);
    assert.equal((await anonimo.pedir('GET', '/api/posicoes-corretora')).status, 401);
  });

  test('usuária cria a ponte e vê a chave uma única vez', async () => {
    const r = await ana.pedir('POST', '/api/ponte', { nome: 'Genial na VPS' });
    assert.equal(r.status, 201);
    assert.match(r.corpo.chave, /^[A-Za-z0-9_-]{43}$/);
    chaveDaAna = r.corpo.chave;
    idDaPonte = r.corpo.id;
    const lista = await ana.pedir('GET', '/api/ponte');
    assert.equal(lista.corpo.pontes.length, 1);
    assert.equal(lista.corpo.pontes[0].estado, 'desconectado', 'antes do primeiro contato a ponte está desconectada');
    assert.ok(!JSON.stringify(lista.corpo).includes(chaveDaAna), 'a chave não volta na listagem');
  });

  test('robô sem chave ou com chave errada é recusado', async () => {
    assert.equal((await robo('GET', '/api/ponte/simbolos', null)).status, 401);
    assert.equal((await robo('GET', '/api/ponte/simbolos', 'x'.repeat(43))).corpo.erro, 'chave_da_ponte_invalida');
    assert.equal((await robo('POST', '/api/ponte/dados', 'curta', { cotacoes: [] })).status, 401);
  });

  test('robô busca os ativos e envia cotações e posições', async () => {
    assert.deepEqual((await robo('GET', '/api/ponte/simbolos', chaveDaAna)).corpo, { simbolos: ['PETR4'] });
    const agora = Date.now();
    const r = await robo('POST', '/api/ponte/dados', chaveDaAna, {
      versao: '1.0.0',
      conta: { login: 123456, servidor: 'GenialInvestimentos-PRD', corretora: 'Genial Investimentos' },
      cotacoes: [
        { codigo: 'PETR4', ultimo: 38.12, bid: 38.11, ask: 38.13, fechamento_anterior: 37.9, volume: 1500, instante: agora - 1000 },
        { codigo: 'VALE3', ultimo: 0, bid: 0, ask: 0, fechamento_anterior: 61, volume: 0, instante: agora - 1000 },
        { codigo: 'ITUB4', ultimo: 30, bid: 30, ask: 30.01, instante: agora + 3 * 3600_000 }, // fuso errado
      ],
      posicoes: [{ codigo: 'PETRK380', lado: 'venda', quantidade: 300, preco_medio: 0.72 }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo, { gravadas: 2, ignoradas: 0, posicoes: 1, descartadas: 1, avisos: ['horario_fora_do_intervalo'] });
    assert.deepEqual((await robo('GET', '/api/ponte/simbolos', chaveDaAna)).corpo, { simbolos: ['PETR4', 'PETRK380'] }, 'o que está em posição também é acompanhado');
  });

  test('dona lê cotações em centavos, sem zeros inventados, e as posições da corretora', async () => {
    const c = await ana.pedir('GET', '/api/cotacoes');
    assert.equal(c.status, 200);
    const petr = c.corpo.cotacoes.find((x: { codigo: string }) => x.codigo === 'PETR4');
    assert.deepEqual([petr.ultimo, petr.bid, petr.ask, petr.fechamentoAnterior, petr.volume, petr.provedor], [3812, 3811, 3813, 3790, 1500, 'mt5']);
    assert.ok(['tempo_real', 'historico'].includes(petr.qualidade), petr.qualidade);
    assert.ok(petr.sinalDaPonteEm, 'a resposta traz o último sinal da ponte');
    const vale = c.corpo.cotacoes.find((x: { codigo: string }) => x.codigo === 'VALE3');
    assert.deepEqual([vale.ultimo, vale.bid, vale.ask], [null, null, null], 'zero do MT5 vira "sem dado"');
    const p = await ana.pedir('GET', '/api/posicoes-corretora');
    assert.deepEqual(p.corpo.posicoes.map((x: Record<string, unknown>) => [x.codigo, x.lado, x.quantidade, x.precoMedio, x.corretora]),
      [['PETRK380', 'venda', 300, 72, 'Genial Investimentos']]);
    const ponte = (await ana.pedir('GET', '/api/ponte')).corpo.pontes[0];
    assert.equal(ponte.conta.login, '123456');
    assert.ok(ponte.ultimoContatoEm);
  });

  test('outro usuário não vê nada da ponte alheia nem a revoga', async () => {
    assert.deepEqual((await beto.pedir('GET', '/api/cotacoes')).corpo.cotacoes, []);
    assert.deepEqual((await beto.pedir('GET', '/api/posicoes-corretora')).corpo.posicoes, []);
    assert.deepEqual((await beto.pedir('GET', '/api/ponte')).corpo.pontes, []);
    assert.equal((await beto.pedir('DELETE', `/api/ponte/${idDaPonte}`)).status, 404);
  });

  test('lote malformado é recusado inteiro', async () => {
    assert.equal((await robo('POST', '/api/ponte/dados', chaveDaAna, { cotacoes: 'x' })).corpo.erro, 'cotacoes_invalidas');
    const grande = Array.from({ length: 501 }, () => ({ codigo: 'PETR4', ultimo: 1, instante: Date.now() }));
    assert.equal((await robo('POST', '/api/ponte/dados', chaveDaAna, { cotacoes: grande })).corpo.erro, 'lote_grande_demais');
  });

  test('no máximo 3 pontes ativas por usuário', async () => {
    assert.equal((await ana.pedir('POST', '/api/ponte', {})).status, 201);
    assert.equal((await ana.pedir('POST', '/api/ponte', {})).status, 201);
    assert.equal((await ana.pedir('POST', '/api/ponte', {})).corpo.erro, 'limite_de_pontes');
  });

  test('chave revogada para de funcionar na hora', async () => {
    assert.equal((await ana.pedir('DELETE', `/api/ponte/${idDaPonte}`)).status, 200);
    assert.equal((await robo('GET', '/api/ponte/simbolos', chaveDaAna)).status, 401);
    assert.equal((await robo('POST', '/api/ponte/dados', chaveDaAna, { cotacoes: [] })).status, 401);
    const c = (await ana.pedir('GET', '/api/cotacoes')).corpo.cotacoes;
    assert.ok(c.every((x: { qualidade: string }) => x.qualidade === 'desconectado'), 'cotação de ponte revogada não passa por atual');
    const auditoria = (await dono.query("select acao from audit_logs where alvo_id = $1 order by quando", [idDaPonte])).rows.map((l) => l.acao);
    assert.deepEqual(auditoria, ['ponte.criada', 'ponte.revogada']);
  });

  test('chaves erradas em sequência bloqueiam o IP', async () => {
    const ip = '198.51.100.99';
    for (let i = 0; i < 30; i += 1) await robo('GET', '/api/ponte/simbolos', 'y'.repeat(43), undefined, ip);
    assert.equal((await robo('GET', '/api/ponte/simbolos', 'y'.repeat(43), undefined, ip)).status, 429);
    assert.equal((await robo('GET', '/api/ponte/simbolos', 'y'.repeat(43), undefined, '198.51.100.98')).status, 401, 'outro IP não é afetado');
  });
});
