// Testes das posições de ponta a ponta: estratégia com pernas, marcação pelo fechamento
// da B3, payoff, "virou pó" no vencimento, importação do MetaTrader 5 e isolamento.

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

describe('posições de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  // Sexta 16/10/2026, 14:00 em Brasília (pregão aberto). O relógio só anda para a frente.
  let agora = new Date('2026-10-16T17:00:00Z');
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};

  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.90', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }
  const perna = (codigo: string, lado: 'compra' | 'venda', strike: number, preco: number, extra: Record<string, unknown> = {}) => ({
    codigo, tipo: 'call', strike, vencimento: '2026-11-23', lado, quantidade: 100, preco, custos: 500, instante: '2026-10-16T13:30:00-03:00', ...extra,
  });

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Posicoes ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto']) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, `${quem}.posicoes.${sufixo}@exemplo.test`, quem, hash]);
    }
    // Fechamento da B3 do pregão anterior e o cadastro das séries (ativo fictício POSI3).
    await dono.query(
      `insert into fechamentos (dia, codigo, tipo_mercado, maxima, minima, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume) values
         ('2026-10-15', 'POSI3', 10, 3950, 3850, 3900, 3899, 3901, 1000, 100000, 390000000),
         ('2026-10-15', 'POSIK380', 70, 160, 140, 155, 150, 158, 50, 5000, 775000),
         ('2026-10-15', 'POSIK400', 70, 70, 50, 55, 52, 60, 30, 3000, 165000)
       on conflict do nothing`,
    );
    await dono.query(
      `insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
         ('POSIK380', '2026-11-23', 'POSI3', 'call', 3800, '2026-10-15', '2026-10-15'),
         ('POSIK400', '2026-11-23', 'POSI3', 'call', 4000, '2026-10-15', '2026-10-15'),
         ('POSIK380', '2025-11-21', 'POSI3', 'call', 3500, '2025-10-15', '2025-10-15')
       on conflict do nothing`,
    );
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.90', payload: { email: `${quem}.posicoes.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
  });

  let travaId = '';

  test('cria a trava de alta com duas pernas e calcula resultado e payoff', async () => {
    const r = await pedir('ana', 'POST', '/api/posicoes', {
      nome: 'Trava de alta POSI3', ativoObjeto: 'posi3',
      execucoes: [perna('POSIK380', 'compra', 3800, 120), perna('posik400', 'venda', 4000, 50)],
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    travaId = r.corpo.id;
    const g = await pedir('ana', 'GET', '/api/posicoes');
    assert.equal(g.status, 200);
    const e = g.corpo.estrategias.find((x: { id: string }) => x.id === travaId);
    assert.equal(e.ativoObjeto, 'POSI3');
    assert.equal(e.execucoes.length, 2);
    // Comprada marcada pelo bid (1,50), vendida pelo ask (0,60): 100×30 − 100×10 = R$ 20,00.
    assert.equal(e.resultado.naoRealizadoEstimado, 2000);
    assert.equal(e.resultado.custosPagos, 1000);
    assert.equal(e.resultado.usaEstimativa, false);
    const k380 = e.instrumentos.find((i: { codigo: string }) => i.codigo === 'POSIK380');
    assert.equal(k380.cotacao.qualidade, 'historico', 'fechamento da B3 aparece como histórico');
    assert.equal(k380.diasCorridos, 38);
    assert.equal(k380.diasDePregao, 24, 'sem fins de semana nem os feriados de 02/11 e 20/11');
    assert.equal(k380.vencido, false);
    // Débito 0,70 × 100 + custos 10,00 = 80,00. Lucro máximo 200 − 80 = 120,00. Equilíbrio em 38,80.
    assert.deepEqual(e.payoff.analise.perdaMaxima, { tipo: 'limitado', valor: -8000, emPreco: 0 });
    assert.equal(e.payoff.analise.lucroMaximo.valor, 12000);
    assert.deepEqual(e.payoff.analise.pontosDeEquilibrio, [38.8]);
    assert.equal(e.payoff.referencia, 3900, 'gráfico centrado no preço do ativo');
    assert.ok(e.payoff.curva.length > 60);
    assert.equal(e.ativo.codigo, 'POSI3');
    assert.deepEqual(g.corpo.liquidoPorCodigo, { POSIK380: 100, POSIK400: -100 });
    assert.ok(g.corpo.premissas.length >= 3);
  });

  test('recusa execução inconsistente', async () => {
    const base = `/api/posicoes/${travaId}/execucoes`;
    assert.equal((await pedir('ana', 'POST', base, { ...perna('POSI3', 'compra', 3800, 3900), tipo: 'ativo' })).corpo.erro, 'ativo_sem_strike_nem_vencimento');
    const semVenc: Record<string, unknown> = perna('POSIK380', 'compra', 3800, 120);
    delete semVenc.vencimento;
    assert.equal((await pedir('ana', 'POST', base, semVenc)).corpo.erro, 'opcao_sem_strike_ou_vencimento');
    assert.equal((await pedir('ana', 'POST', base, perna('POSIK380', 'compra', 3800, 120, { instante: '2026-10-17T10:00:00-03:00' }))).corpo.erro, 'instante_no_futuro');
    const outra = await pedir('ana', 'POST', base, perna('POSIK380', 'compra', 3900, 120));
    assert.equal(outra.status, 400);
    assert.equal(outra.corpo.erro, 'codigo_com_dados_diferentes');
    assert.equal((await pedir('ana', 'POST', base, { ...perna('POSIK380', 'compra', 3800, 120), quantidade: 0 })).status, 400);
    const g = await pedir('ana', 'GET', '/api/posicoes');
    assert.equal(g.corpo.estrategias.find((x: { id: string }) => x.id === travaId).execucoes.length, 2, 'nada foi gravado');
  });

  test('registra e apaga uma execução', async () => {
    const r = await pedir('ana', 'POST', `/api/posicoes/${travaId}/execucoes`, perna('POSIK400', 'venda', 4000, 55, { quantidade: 100 }));
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    let g = await pedir('ana', 'GET', '/api/posicoes');
    assert.equal(g.corpo.liquidoPorCodigo.POSIK400, -200);
    assert.equal(g.corpo.estrategias.find((x: { id: string }) => x.id === travaId).payoff.analise.lucroMaximo.tipo, 'limitado');
    assert.equal((await pedir('ana', 'DELETE', `/api/posicoes/${travaId}/execucoes/${r.corpo.id}`)).status, 200);
    g = await pedir('ana', 'GET', '/api/posicoes');
    assert.equal(g.corpo.liquidoPorCodigo.POSIK400, -100);
  });

  test('vencimentos diferentes: sem payoff no vencimento, com o motivo', async () => {
    const r = await pedir('ana', 'POST', '/api/posicoes', {
      nome: 'Calendário', ativoObjeto: 'POSI3',
      execucoes: [perna('POSIK380', 'compra', 3800, 120), perna('POSIL400', 'venda', 4000, 80, { vencimento: '2026-12-18' })],
    });
    assert.equal(r.status, 201);
    const e = (await pedir('ana', 'GET', '/api/posicoes')).corpo.estrategias.find((x: { id: string }) => x.id === r.corpo.id);
    assert.deepEqual(e.payoff, { motivo: 'vencimentos_diferentes' });
    const semPreco = e.instrumentos.find((i: { codigo: string }) => i.codigo === 'POSIL400');
    assert.equal(semPreco.cotacao, null, 'sem cotação: nada inventado');
    assert.equal(e.resultado.naoRealizadoEstimado, null);
    assert.deepEqual(e.resultado.instrumentosSemPreco, ['POSIL400']);
    assert.equal((await pedir('ana', 'DELETE', `/api/posicoes/${r.corpo.id}`)).status, 200);
  });

  test('série pelo código', async () => {
    const s = await pedir('ana', 'GET', '/api/posicoes/serie/posik380');
    assert.equal(s.status, 200);
    assert.deepEqual([s.corpo.tipo, s.corpo.strike, s.corpo.vencimento, s.corpo.ativoObjeto], ['call', 3800, '2026-11-23', 'POSI3'], 'vencimento que ainda não passou');
    assert.equal(s.corpo.cotacao.ultimo, 155);
    const a = await pedir('ana', 'GET', '/api/posicoes/serie/POSI3');
    assert.deepEqual([a.corpo.tipo, a.corpo.strike, a.corpo.ativoObjeto], ['ativo', null, 'POSI3']);
    assert.equal((await pedir('ana', 'GET', '/api/posicoes/serie/ZZZZK999')).status, 404);
  });

  test('importa a posição que o MetaTrader 5 informou', async () => {
    const chave = (await pedir('ana', 'POST', '/api/ponte', { nome: 'mt5 posições' })).corpo.chave;
    const r = await app.inject({
      method: 'POST', url: '/api/ponte/dados', headers: { authorization: `Bearer ${chave}` }, remoteAddress: '203.0.113.91',
      payload: { versao: '1.0.0', cotacoes: [], posicoes: [{ codigo: 'POSIK400', lado: 'venda', quantidade: 200, preco_medio: 0.61 }] },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await pedir('ana', 'POST', '/api/posicoes/importar', { codigos: ['POSIK999'], nova: { nome: 'x' } })).status, 404);
    assert.equal((await pedir('ana', 'POST', '/api/posicoes/importar', { codigos: ['POSIK400'] })).corpo.erro, 'escolha_estrategia_ou_nova');
    const i = await pedir('ana', 'POST', '/api/posicoes/importar', { codigos: ['POSIK400'], nova: { nome: 'Venda coberta' } });
    assert.equal(i.status, 201, JSON.stringify(i.corpo));
    const e = (await pedir('ana', 'GET', '/api/posicoes')).corpo.estrategias.find((x: { id: string }) => x.id === i.corpo.id);
    assert.equal(e.ativoObjeto, 'POSI3', 'ativo-objeto pelo cadastro da série');
    assert.deepEqual(e.execucoes.map((x: Record<string, unknown>) => [x.codigo, x.lado, x.quantidade, x.preco, x.strike, x.origem]),
      [['POSIK400', 'venda', 200, 61, 4000, 'importada_mt5']]);
    assert.equal(e.payoff.analise.perdaMaxima.tipo, 'ilimitado', 'call vendida sem cobertura');
    const g = await pedir('ana', 'GET', '/api/posicoes');
    const exp = g.corpo.exposicoes.find((x: { ativoObjeto: string; vencimento: string }) => x.ativoObjeto === 'POSI3' && x.vencimento === '2026-11-23');
    assert.equal(exp.callsVendidasDescobertas, 200, '100 da trava se cobrem; as 200 importadas, não');
    assert.equal((await pedir('ana', 'DELETE', `/api/posicoes/${i.corpo.id}`)).status, 200);
  });

  test('outro usuário não vê nem mexe', async () => {
    const g = await pedir('beto', 'GET', '/api/posicoes');
    assert.deepEqual(g.corpo.estrategias, []);
    assert.equal((await pedir('beto', 'PATCH', `/api/posicoes/${travaId}`, { nome: 'minha' })).status, 404);
    assert.equal((await pedir('beto', 'POST', `/api/posicoes/${travaId}/execucoes`, perna('POSIK380', 'compra', 3800, 1))).status, 404);
    assert.equal((await pedir('beto', 'DELETE', `/api/posicoes/${travaId}`)).status, 404);
    assert.equal((await pedir('beto', 'POST', '/api/posicoes/importar', { codigos: ['POSIK400'], nova: { nome: 'x' } })).status, 404, 'posição da corretora é só da dona');
    assert.equal((await app.inject({ method: 'GET', url: '/api/posicoes' })).statusCode, 401);
  });

  test('encerrar: exige saída de tudo; opção vencida "vira pó"', async () => {
    const enc = await pedir('ana', 'PATCH', `/api/posicoes/${travaId}`, { situacao: 'encerrada' });
    assert.equal(enc.status, 409);
    assert.deepEqual(enc.corpo.codigos?.sort(), ['POSIK380', 'POSIK400']);
    assert.equal((await pedir('ana', 'POST', `/api/posicoes/${travaId}/vencer`, { codigo: 'POSIK400' })).corpo.erro, 'ainda_nao_venceu');
    // Dia seguinte ao vencimento (23/11, porque 20/11 é feriado): a call de 40 virou pó; a de 38 foi vendida a 1,95.
    agora = new Date('2026-11-24T15:00:00Z');
    const v = await pedir('ana', 'POST', `/api/posicoes/${travaId}/vencer`, { codigo: 'POSIK400' });
    assert.equal(v.status, 201, JSON.stringify(v.corpo));
    assert.equal((await pedir('ana', 'POST', `/api/posicoes/${travaId}/vencer`, { codigo: 'POSIK400' })).corpo.erro, 'perna_nao_aberta');
    const s = await pedir('ana', 'POST', `/api/posicoes/${travaId}/execucoes`, perna('POSIK380', 'venda', 3800, 195, { instante: '2026-11-23T16:50:00-03:00' }));
    assert.equal(s.status, 201, JSON.stringify(s.corpo));
    const e = (await pedir('ana', 'GET', '/api/posicoes')).corpo.estrategias.find((x: { id: string }) => x.id === travaId);
    // (1,95 − 1,20) × 100 + (0,50 − 0) × 100 = 125,00 bruto; custos 15,00.
    assert.equal(e.resultado.realizadoBruto, 12500);
    assert.equal(e.resultado.realizadoLiquido, 11000);
    assert.deepEqual(e.payoff, { motivo: 'sem_pernas_abertas' });
    const ok = await pedir('ana', 'PATCH', `/api/posicoes/${travaId}`, { situacao: 'encerrada', observacao: 'saiu bem' });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal((await pedir('ana', 'POST', `/api/posicoes/${travaId}/execucoes`, perna('POSIK380', 'compra', 3800, 1, { instante: '2026-11-23T16:55:00-03:00' }))).corpo.erro, 'estrategia_encerrada');
    const fim = (await pedir('ana', 'GET', '/api/posicoes')).corpo.estrategias.find((x: { id: string }) => x.id === travaId);
    assert.equal(fim.situacao, 'encerrada');
    assert.ok(fim.encerradaEm);
    assert.equal(fim.observacao, 'saiu bem');
  });

  test('tudo fica na auditoria', async () => {
    const r = await dono.query(
      `select acao, count(*)::int as n from audit_logs a join users u on u.id = a.ator_id
       where u.email = $1 and acao like 'posicao.%' group by acao order by acao`, [`ana.posicoes.${sufixo}@exemplo.test`],
    );
    const acoes = Object.fromEntries(r.rows.map((l) => [l.acao, l.n]));
    assert.equal(acoes['posicao.criada'], 2);
    assert.equal(acoes['posicao.importada_mt5'], 1);
    assert.equal(acoes['posicao.vencimento_registrado'], 1);
    assert.equal(acoes['posicao.execucao_registrada'], 2);
    assert.equal(acoes['posicao.execucao_excluida'], 1);
    assert.equal(acoes['posicao.excluida'], 2);
    assert.equal(acoes['posicao.alterada'], 1);
  });
});
