// Testes do Simulador: cadeia para montar e carteiras simuladas (montar, rolar, acompanhar).

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
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam as URLs do banco');

describe('simulador de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  const agora = new Date('2026-10-16T17:00:00Z');
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};

  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.95', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }
  const perna = (codigo: string, strike: number, vencimento: string, lado: 'compra' | 'venda', preco: number, extra: Record<string, unknown> = {}) =>
    ({ codigo, tipo: 'call', strike, vencimento, lado, quantidade: 100, preco, ...extra });

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Simulador ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto']) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, `${quem}.sim.${sufixo}@exemplo.test`, quem, hash]);
    }
    await dono.query(
      `insert into fechamentos (dia, codigo, tipo_mercado, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume) values
         ('2026-10-15', 'SIMU3', 10, 3950, 3949, 3951, 1000, 100000, 395000000),
         ('2026-10-15', 'SIMUK400', 70, 125, 120, 130, 80, 8000, 1000000),
         ('2026-10-15', 'SIMUK420', 70, 55, 50, 60, 40, 4000, 200000),
         ('2026-10-15', 'SIMUL400', 70, 185, 180, 190, 60, 6000, 1100000)
       on conflict do nothing`,
    );
    await dono.query(
      `insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
         ('SIMUK400', '2026-11-23', 'SIMU3', 'call', 4000, '2026-10-15', '2026-10-15'),
         ('SIMUK420', '2026-11-23', 'SIMU3', 'call', 4200, '2026-10-15', '2026-10-15'),
         ('SIMUL400', '2026-12-18', 'SIMU3', 'call', 4000, '2026-10-15', '2026-10-15')
       on conflict do nothing`,
    );
    await dono.query("insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, vol_implicita, delta) values ('2026-10-15', 'SIMUK400', '2026-11-23', 'SIMU3', 0.3, 0.45) on conflict do nothing");
    await dono.query("insert into taxas_juros (serie, dia, valor, fonte) values ('selic', '2026-10-15', 14.9, 'teste') on conflict do nothing");
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.95', payload: { email: `${quem}.sim.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
  });

  test('cadeia para montar: vencimentos, preços, volatilidade e Selic', async () => {
    const r = await pedir('ana', 'GET', '/api/simulador/cadeia?ativo=simu3');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.vencimentos, ['2026-11-23', '2026-12-18']);
    assert.equal(r.corpo.vencimento, '2026-11-23');
    assert.equal(r.corpo.ativo.cotacao.ultimo, 3950);
    const k400 = r.corpo.series.find((x: { codigo: string }) => x.codigo === 'SIMUK400');
    assert.deepEqual([k400.strike, k400.vol, k400.delta, k400.cotacao.bid, k400.cotacao.ask, k400.cotacao.qualidade], [4000, 0.3, 0.45, 120, 130, 'historico']);
    assert.equal(r.corpo.series.find((x: { codigo: string }) => x.codigo === 'SIMUK420').vol, null, 'sem cálculo: sem vol, nada inventado');
    assert.equal(r.corpo.selic.valor, 14.9);
    const dez = await pedir('ana', 'GET', '/api/simulador/cadeia?ativo=SIMU3&vencimento=2026-12-18');
    assert.deepEqual(dez.corpo.series.map((x: { codigo: string }) => x.codigo), ['SIMUL400']);
    assert.equal((await pedir('ana', 'GET', '/api/simulador/cadeia?ativo=NADA3')).status, 404);
  });

  let simId = '';

  test('guarda a montagem como carteira simulada e acompanha pelo preço real', async () => {
    const r = await pedir('ana', 'POST', '/api/simulacoes', {
      nome: 'Trava simulada', ativoObjeto: 'simu3',
      execucoes: [perna('SIMUK400', 4000, '2026-11-23', 'compra', 125, { vol: 0.31 }), perna('simuk420', 4200, '2026-11-23', 'venda', 55, { vol: 0.25 })],
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    simId = r.corpo.id;
    const l = await pedir('ana', 'GET', '/api/simulacoes');
    const x = l.corpo.simulacoes.find((s: { id: string }) => s.id === simId);
    // Comprada sai no bid (1,20), vendida no ask (0,60): 100×(−5) + (−100)×5 = −10,00.
    assert.deepEqual([x.operacoes, x.abertos, x.resultado.naoRealizadoEstimado], [2, 2, -1000]);
    const d = await pedir('ana', 'GET', `/api/simulacoes/${simId}`);
    const vol = Object.fromEntries(d.corpo.abertos.map((a: { codigo: string; vol: number }) => [a.codigo, a.vol]));
    assert.deepEqual(vol, { SIMUK400: 0.3, SIMUK420: 0.25 }, 'implícita do fechamento; sem ela, a da montagem');
  });

  test('rolagem simulada: sai de uma série e entra em outra, numa operação só', async () => {
    const r = await pedir('ana', 'POST', `/api/simulacoes/${simId}/execucoes`, {
      observacao: 'rolagem simulada',
      execucoes: [perna('SIMUK420', 4200, '2026-11-23', 'compra', 60), perna('SIMUL400', 4000, '2026-12-18', 'venda', 180)],
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const d = await pedir('ana', 'GET', `/api/simulacoes/${simId}`);
    assert.deepEqual(d.corpo.abertos.map((a: { codigo: string; quantidade: number }) => [a.codigo, a.quantidade]).sort(), [['SIMUK400', 100], ['SIMUL400', -100]]);
    assert.equal(d.corpo.resultado.realizadoBruto, -500, 'vendeu a 0,55 e recomprou a 0,60');
    assert.equal(d.corpo.execucoes.filter((e: { observacao: string }) => e.observacao === 'rolagem simulada').length, 2);
  });

  test('recusa o que não fecha', async () => {
    const base = `/api/simulacoes/${simId}/execucoes`;
    assert.equal((await pedir('ana', 'POST', base, { execucoes: [perna('SIMUK400', 4100, '2026-11-23', 'compra', 1)] })).corpo.erro, 'codigo_com_dados_diferentes');
    assert.equal((await pedir('ana', 'POST', base, { execucoes: [{ codigo: 'SIMUK400', tipo: 'call', lado: 'compra', quantidade: 1, preco: 1 }] })).corpo.erro, 'opcao_sem_strike_ou_vencimento');
    assert.equal((await pedir('ana', 'POST', base, { execucoes: [perna('SIMUK400', 4000, '2026-11-23', 'compra', 1, { instante: '2026-10-17T10:00:00-03:00' })] })).corpo.erro, 'instante_no_futuro');
    assert.equal((await pedir('ana', 'POST', base, { execucoes: [perna('SIMUK400', 4000, '2026-11-23', 'compra', 1, { vol: 9 })] })).status, 400);
  });

  test('outro usuário não vê nem opera', async () => {
    assert.deepEqual((await pedir('beto', 'GET', '/api/simulacoes')).corpo.simulacoes, []);
    assert.equal((await pedir('beto', 'GET', `/api/simulacoes/${simId}`)).status, 404);
    assert.equal((await pedir('beto', 'POST', `/api/simulacoes/${simId}/execucoes`, { execucoes: [perna('SIMUK400', 4000, '2026-11-23', 'compra', 1)] })).status, 404);
    assert.equal((await pedir('beto', 'DELETE', `/api/simulacoes/${simId}`)).status, 404);
  });

  test('encerrar, apagar operação e excluir', async () => {
    const d = await pedir('ana', 'GET', `/api/simulacoes/${simId}`);
    const ultima = d.corpo.execucoes.at(-1).id;
    assert.equal((await pedir('ana', 'DELETE', `/api/simulacoes/${simId}/execucoes/${ultima}`)).status, 200);
    assert.equal((await pedir('ana', 'PATCH', `/api/simulacoes/${simId}`, { situacao: 'encerrada', nome: 'Trava (fim)' })).status, 200);
    assert.equal((await pedir('ana', 'POST', `/api/simulacoes/${simId}/execucoes`, { execucoes: [perna('SIMUK400', 4000, '2026-11-23', 'venda', 1)] })).corpo.erro, 'simulacao_encerrada');
    assert.equal((await pedir('ana', 'DELETE', `/api/simulacoes/${simId}`)).status, 200);
    assert.equal((await pedir('ana', 'GET', `/api/simulacoes/${simId}`)).status, 404);
  });
});
