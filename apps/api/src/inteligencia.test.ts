// Testes da inteligência operacional: preferências com consentimento, avisos das posições
// gerados pelo worker (uma vez por chave, só na janela do dia), sugestão de rolagem,
// histórico com CSV, desempenho das regras e cenários.

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
import { cicloDeAvisosDePosicao } from './coleta/avisos-posicao.ts';
import { csvDoHistorico } from './rotas/inteligencia.ts';

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const URL_COLETA = process.env.DATABASE_URL_COLETA;
const pular = !URL_APP || !URL_DONO || !URL_COLETA;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam as URLs do banco');

test('CSV do histórico: separador ponto e vírgula, vírgula decimal e aspas', () => {
  const csv = csvDoHistorico([
    { tipo: 'operacao', instante: '2026-11-17T13:05:00Z', codigo: 'PETR4', estrategia: 'Venda; coberta', titulo: 'Compra de 100 PETR4 a R$ 38,00', detalhe: 'diz "oi"', valor: -380000, custos: 490 },
  ]);
  const [cab, linha] = csv.replace('﻿', '').split('\r\n');
  assert.equal(cab, 'Data;Tipo;Código;Estratégia;O que houve;Detalhe;Valor (R$);Custos (R$)');
  assert.equal(linha, '17/11/2026 10:05;Operação;PETR4;"Venda; coberta";Compra de 100 PETR4 a R$ 38,00;"diz ""oi""";-3800,00;4,90');
  assert.ok(csv.startsWith('﻿'), 'com BOM para o Excel');
});

describe('inteligência operacional de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  let coleta: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  // Terça 17/11/2026, 10:00 em Brasília.
  let agora = new Date('2026-11-17T13:00:00Z');
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};
  let estrategiaId = '';
  let anaId = '';

  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.93', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.headers['content-type']?.toString().startsWith('application/json') ? r.json() : r.body, headers: r.headers };
  }

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    coleta = criarPool(URL_COLETA as string);
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Inteligencia ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto']) {
      const id = (await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4) returning id", [org, `${quem}.intel.${sufixo}@exemplo.test`, quem, hash])).rows[0].id;
      if (quem === 'ana') anaId = id;
    }
    await dono.query(
      `insert into fechamentos (dia, codigo, tipo_mercado, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume) values
         ('2026-11-16', 'INTE3', 10, 3950, 3949, 3951, 1000, 100000, 395000000),
         ('2026-11-16', 'INTEK400', 70, 125, 120, 130, 80, 8000, 1000000),
         ('2026-11-16', 'INTEL420', 70, 95, 90, 100, 40, 4000, 400000)
       on conflict do nothing`,
    );
    await dono.query(
      `insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
         ('INTEK400', '2026-11-23', 'INTE3', 'call', 4000, '2026-10-15', '2026-11-16'),
         ('INTEL420', '2026-12-18', 'INTE3', 'call', 4200, '2026-10-15', '2026-11-16')
       on conflict do nothing`,
    );
    await dono.query("insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, vol_implicita, delta) values ('2026-11-16', 'INTEK400', '2026-11-23', 'INTE3', 0.3, 0.4) on conflict do nothing");
    await dono.query("insert into taxas_juros (serie, dia, valor, fonte) values ('selic', '2026-11-16', 14.9, 'teste') on conflict do nothing");
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.93', payload: { email: `${quem}.intel.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
    // 100 ações e 300 calls vendidas: 200 sem cobertura, strike a 1,25% do fechamento.
    const r = await pedir('ana', 'POST', '/api/posicoes', {
      nome: 'Calls INTE3', ativoObjeto: 'INTE3',
      execucoes: [
        { codigo: 'INTE3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3800, instante: '2026-11-03T11:00:00-03:00' },
        { codigo: 'INTEK400', tipo: 'call', strike: 4000, vencimento: '2026-11-23', lado: 'venda', quantidade: 300, preco: 80, instante: '2026-11-03T11:01:00-03:00' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    estrategiaId = r.corpo.id;
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await coleta?.end();
    await dono?.end();
  });

  test('preferências: padrão sem sugestões; consentimento fica na auditoria', async () => {
    const g = await pedir('ana', 'GET', '/api/avisos-posicao/preferencias');
    assert.equal(g.status, 200);
    assert.deepEqual([g.corpo.preferencias.vencimento, g.corpo.preferencias.sugestoes, g.corpo.salvo, g.corpo.telegramVinculado], [true, false, false, false]);
    const p = await pedir('ana', 'PUT', '/api/avisos-posicao/preferencias', { preferencias: { sugestoes: true, diasAntes: [5] }, criterios: { diasMin: 20, senha: 'x' } });
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    assert.deepEqual(p.corpo.criterios, { diasMin: 20 }, 'critério desconhecido é descartado');
    assert.deepEqual(p.corpo.preferencias.diasAntes, [5]);
    assert.equal((await pedir('ana', 'PUT', '/api/avisos-posicao/preferencias', { preferencias: { distanciaStrikePct: 99 } })).status, 400);
    const a = await dono.query("select acao from audit_logs where ator_id = $1 and acao like 'avisos_posicao.%'", [anaId]);
    assert.deepEqual(a.rows.map((l) => l.acao), ['avisos_posicao.sugestoes_autorizadas']);
  });

  test('worker gera os avisos uma vez só, com sugestão de rolagem, e respeita a janela do dia', async () => {
    const fora = await cicloDeAvisosDePosicao(coleta, new Date('2026-11-17T02:00:00Z'));
    assert.equal(fora.fora_da_janela, true, '23:00 em Brasília: não manda nada');
    await cicloDeAvisosDePosicao(coleta, agora);
    const v = await pedir('ana', 'GET', '/api/avisos-posicao');
    assert.equal(v.status, 200);
    const tipos = v.corpo.eventos.map((e: { tipo: string }) => e.tipo).sort();
    assert.deepEqual(tipos, ['descoberta', 'risco_strike', 'sugestao_rolagem', 'vencimento']);
    assert.equal(v.corpo.naoLidos, 4);
    const sug = v.corpo.eventos.find((e: { tipo: string }) => e.tipo === 'sugestao_rolagem');
    assert.match(sug.texto, /INTEL420 \(strike 42,00, 18\/12\): débito de R\$ 120,00/);
    assert.match(sug.texto, /nada foi enviado à corretora/);
    assert.match(v.corpo.eventos.find((e: { tipo: string }) => e.tipo === 'risco_strike').texto, /a 1,3% do strike/);
    assert.match(v.corpo.eventos.find((e: { tipo: string }) => e.tipo === 'descoberta').texto, /200 calls/);
    // De novo: nada repete.
    await cicloDeAvisosDePosicao(coleta, new Date(agora.getTime() + 10 * 60_000));
    assert.equal((await pedir('ana', 'GET', '/api/avisos-posicao')).corpo.eventos.length, 4);
    const avisos = await dono.query("select count(*)::int as n from avisos where user_id = $1 and chave like 'posicao:%'", [anaId]);
    assert.equal(avisos.rows[0].n, 4, 'um aviso do Telegram por evento');
    const l = await pedir('ana', 'POST', '/api/avisos-posicao/lidos', {});
    assert.equal(l.corpo.marcados, 4);
    assert.equal((await pedir('ana', 'GET', '/api/avisos-posicao')).corpo.naoLidos, 0);
    assert.deepEqual((await pedir('beto', 'GET', '/api/avisos-posicao')).corpo.eventos, [], 'outro usuário não vê');
  });

  test('histórico unificado com filtro e exportação', async () => {
    const h = await pedir('ana', 'GET', '/api/historico?tipos=operacao,posicao&codigo=inte');
    assert.equal(h.status, 200);
    const ops = h.corpo.itens.filter((i: { tipo: string }) => i.tipo === 'operacao');
    assert.equal(ops.length, 2);
    assert.ok(ops.some((i: { titulo: string; valor: number }) => i.titulo === 'Venda de 300 INTEK400 a R$ 0,80' && i.valor === 24000));
    assert.equal(h.corpo.itens.filter((i: { tipo: string }) => i.tipo === 'posicao').length, 4);
    assert.deepEqual((await pedir('ana', 'GET', '/api/historico?tipos=operacao&de=2026-11-04&ate=2026-11-30')).corpo.itens, [], 'fora do período');
    assert.equal((await pedir('ana', 'GET', '/api/historico?de=2026-11-30&ate=2026-11-01')).corpo.erro, 'periodo_invalido');
    const csv = await pedir('ana', 'GET', '/api/historico?tipos=operacao&formato=csv');
    assert.equal(csv.status, 200);
    assert.match(String(csv.headers['content-type']), /text\/csv/);
    assert.match(String(csv.headers['content-disposition']), /historico-wta-2026-11-17\.csv/);
    assert.match(String(csv.corpo), /Venda de 300 INTEK400 a R\$ 0,80;;240,00;0,00/);
    assert.deepEqual((await pedir('beto', 'GET', '/api/historico')).corpo.itens, []);
  });

  test('desempenho das regras e cenários "e se"', async () => {
    const d = await pedir('ana', 'GET', '/api/alertas/desempenho');
    assert.equal(d.status, 200);
    assert.deepEqual(d.corpo.regras, []);
    const c = await pedir('ana', 'POST', `/api/posicoes/${estrategiaId}/cenarios`, {});
    assert.equal(c.status, 200, JSON.stringify(c.corpo));
    assert.equal(c.corpo.grade.linhas.length, 9);
    assert.equal(c.corpo.grade.colunas[0].rotulo, 'Hoje');
    assert.match(c.corpo.grade.colunas.at(-1).rotulo, /^No vencimento \(23\/11\)/);
    // Preço igual (39,50) no vencimento: ações +150,00 e calls viram pó (+240,00).
    const zero = c.corpo.grade.linhas.find((l: { variacao: number }) => l.variacao === 0);
    assert.equal(zero.resultados.at(-1), 39000);
    assert.deepEqual(c.corpo.vols, [{ codigo: 'INTEK400', volPct: 30, origem: 'implícita do fechamento de 16/11' }]);
    const v = await pedir('ana', 'POST', `/api/posicoes/${estrategiaId}/cenarios`, { volPct: 45, variacoesPct: [0] });
    assert.equal(v.corpo.vols[0].origem, 'informada por você');
    assert.ok(v.corpo.grade.linhas[0].resultados[0] < c.corpo.grade.linhas.find((l: { variacao: number }) => l.variacao === 0).resultados[0], 'vol maior encarece a call vendida');
    assert.equal((await pedir('beto', 'POST', `/api/posicoes/${estrategiaId}/cenarios`, {})).status, 404);
  });
});
