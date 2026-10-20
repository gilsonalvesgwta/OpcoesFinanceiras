// Testes da brapi: coleta no worker (janela, cota, chave no cabeçalho, sem inventar dado),
// cotação mesclada para o usuário e alertas com dado periódico.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { construirApp } from './app.ts';
import { criarPool, emTransacao } from './banco.ts';
import type { Config } from './config.ts';
import { CorreioDeTeste } from './correio.ts';
import { gerarHashDeSenha } from './seguranca.ts';
import { lerCalendario } from './calendario.ts';
import { cicloDaBrapi, configuracaoDaBrapi, dentroDaJanela, type ConfiguracaoDaBrapi } from './coleta/brapi.ts';
import { avaliarAlertasDaBrapi } from './alertas/brapi.ts';
import type { Buscar } from './coleta/coleta.ts';

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const URL_COLETA = process.env.DATABASE_URL_COLETA;
const pular = !URL_APP || !URL_DONO || !URL_COLETA;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam as URLs do banco');

test('configuração da brapi pelo ambiente', () => {
  assert.equal(configuracaoDaBrapi({}), null);
  assert.equal(configuracaoDaBrapi({ BRAPI_API_KEY: '  ' }), null);
  assert.deepEqual(configuracaoDaBrapi({ BRAPI_API_KEY: 'abc', BRAPI_LIMITE_MENSAL: '9000' }), { chave: 'abc', limiteMensal: 9000, maximoPorCiclo: 20, intervaloMin: 10 });
});

test('janela: pregão até 40 minutos depois do fechamento', () => {
  const cfg = { feriados: new Set(['2026-11-20']), sessaoPadrao: { abertura: '10:00', fechamento: '17:00' }, sessoesEspeciais: new Map() };
  assert.equal(dentroDaJanela(new Date('2026-10-16T12:59:00Z'), cfg), false, '09:59');
  assert.equal(dentroDaJanela(new Date('2026-10-16T13:00:00Z'), cfg), true, '10:00');
  assert.equal(dentroDaJanela(new Date('2026-10-16T20:40:00Z'), cfg), true, '17:40');
  assert.equal(dentroDaJanela(new Date('2026-10-16T20:41:00Z'), cfg), false, '17:41');
  assert.equal(dentroDaJanela(new Date('2026-10-17T15:00:00Z'), cfg), false, 'sábado');
  assert.equal(dentroDaJanela(new Date('2026-11-20T15:00:00Z'), cfg), false, 'feriado');
});

describe('brapi de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  let coleta: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  const agora = new Date('2026-10-16T17:00:00Z'); // sexta, 14:00 em Brasília
  const conf: ConfiguracaoDaBrapi = { chave: 'chave-secreta-de-teste', limiteMensal: 14000, maximoPorCiclo: 20, intervaloMin: 10 };
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};
  const ids: Record<string, string> = {};
  const pedidos: { url: string; auth: string | undefined }[] = [];

  // brapi simulada: responde às ações BRAP*; as outras (de outros testes) dão 404.
  const resposta = (status: number, corpo: unknown) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => new ArrayBuffer(0), json: async () => corpo });
  const brapi = (status = 200): Buscar => async (url, init) => {
    pedidos.push({ url, auth: init?.headers?.authorization });
    const codigo = new URL(url).searchParams.get('symbols') ?? '';
    if (status !== 200) return resposta(status, { error: true });
    if (!codigo.startsWith('BRAP')) return resposta(404, { error: true });
    const preco = codigo === 'BRAP4' ? 10.5 : 20.25;
    return resposta(200, { results: [{ requestedSymbol: codigo, symbol: codigo, data: {
      regularMarketPrice: preco, regularMarketChange: 0.25, regularMarketVolume: 5000, regularMarketTime: new Date(agora.getTime() - 30 * 60_000).toISOString() } }] });
  };

  async function pedir(quem: string, metodo: 'GET' | 'POST', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.94', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    coleta = criarPool(URL_COLETA as string);
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Brapi ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto']) {
      ids[quem] = (await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4) returning id", [org, `${quem}.brapi.${sufixo}@exemplo.test`, quem, hash])).rows[0].id;
    }
    await dono.query("insert into favoritos (user_id, codigo) values ($1, 'BRAP3'), ($1, 'BRAPK100')", [ids.ana]);
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.94', payload: { email: `${quem}.brapi.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
    // Ana aceita dado periódico; Beto só quer tempo real.
    for (const [quem, aceita] of [['ana', true], ['beto', false]] as const) {
      const r = await pedir(quem, 'POST', '/api/alertas', {
        nome: `BRAP4 acima de 10 (${quem})`, codigo: 'BRAP4', condicao: { tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 1000 },
        rearme: { tipo: 'ao_desfazer' }, aceitarPeriodica: aceita,
      });
      assert.equal(r.status, 201, JSON.stringify(r.corpo));
    }
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await coleta?.end();
    await dono?.end();
  });

  test('fora da janela ou sem chave: não consulta', async () => {
    assert.equal((await cicloDaBrapi(coleta, brapi(), new Date('2026-10-16T23:30:00Z'), conf)).situacao, 'fora_da_janela');
    assert.equal((await cicloDaBrapi(coleta, brapi(), agora, null)).situacao, 'sem_chave');
    assert.equal(pedidos.length, 0);
  });

  test('consulta as ações (não as opções), com a chave no cabeçalho, e conta a cota', async () => {
    const r = await cicloDaBrapi(coleta, brapi(), agora, conf);
    assert.equal(r.situacao, 'ok');
    assert.ok(r.gravadas >= 2, JSON.stringify(r));
    const urls = pedidos.map((p) => new URL(p.url).searchParams.get('symbols'));
    assert.ok(urls.includes('BRAP4') && urls.includes('BRAP3'), 'alerta e favorito');
    assert.ok(!urls.includes('BRAPK100'), 'opção fica de fora');
    assert.ok(pedidos.every((p) => p.auth === 'Bearer chave-secreta-de-teste' && !p.url.includes('chave-secreta')), 'chave só no cabeçalho');
    const q = (await dono.query("select ultimo, fechamento_anterior, volume from cotacoes_brapi where codigo = 'BRAP4'")).rows[0];
    assert.deepEqual([Number(q.ultimo), Number(q.fechamento_anterior), Number(q.volume)], [1050, 1025, 5000]);
    const uso = (await dono.query("select consultas from uso_brapi where mes = '2026-10'")).rows[0];
    assert.ok(Number(uso.consultas) >= r.consultas);
    const imp = (await dono.query("select situacao, registros from importacoes where fonte = 'brapi' order by id desc limit 1")).rows[0];
    assert.equal(imp.situacao, 'ok');
  });

  test('a cotação aparece para o usuário como atualização periódica, sem oferta', async () => {
    const r = await pedir('ana', 'GET', '/api/cotacoes');
    const q = r.corpo.cotacoes.find((x: { codigo: string }) => x.codigo === 'BRAP3');
    assert.deepEqual([q.provedor, q.qualidade, q.ultimo, q.bid, q.ask], ['brapi', 'periodica', 2025, null, null]);
  });

  test('alerta dispara só para quem aceita dado periódico, uma vez', async () => {
    const cfg = await emTransacao(pool, null, lerCalendario);
    const r = await avaliarAlertasDaBrapi(pool, agora, cfg);
    assert.ok(r.disparos >= 1, JSON.stringify(r));
    const ev = await dono.query(
      `select u.email, v.qualidade, v.fonte from eventos_alerta v join users u on u.id = v.user_id where v.codigo = 'BRAP4' and u.email like $1`, [`%.brapi.${sufixo}@exemplo.test`],
    );
    assert.deepEqual(ev.rows.map((l) => [l.email.split('.')[0], l.qualidade]), [['ana', 'periodica']]);
    assert.match(ev.rows[0].fonte, /brapi/);
    assert.equal((await avaliarAlertasDaBrapi(pool, agora, cfg)).disparos, 0, 'a mesma cotação não é avaliada de novo');
  });

  test('chave recusada: para na primeira consulta', async () => {
    const antes = pedidos.length;
    const r = await cicloDaBrapi(coleta, brapi(401), agora, conf);
    assert.equal(r.situacao, 'chave_recusada');
    assert.equal(pedidos.length - antes, 1);
    const uso = (await dono.query("select ultima_falha from uso_brapi where mes = '2026-10'")).rows[0];
    assert.match(uso.ultima_falha, /chave recusada/);
  });
});
