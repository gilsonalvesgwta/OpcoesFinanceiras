// Testes dos alertas de ponta a ponta: regra criada pela api, cotação chegando pela
// ponte MT5, evento e aviso gravados, vínculo e envio pelo Telegram (simulado).

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
import { enviarAvisos, minutosDoSilencio, processarAtualizacoes, type Telegram } from './coleta/telegram.ts';
import { lerCondicao } from './rotas/alertas.ts';

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const URL_COLETA = process.env.DATABASE_URL_COLETA;
const pular = !URL_APP || !URL_DONO || !URL_COLETA;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam as URLs do banco');

test('tempo do /silencio', () => {
  assert.equal(minutosDoSilencio(undefined), 60);
  assert.equal(minutosDoSilencio('30m'), 30);
  assert.equal(minutosDoSilencio('2h'), 120);
  assert.equal(minutosDoSilencio('90'), 90);
  assert.equal(minutosDoSilencio('8d'), null);
  assert.equal(minutosDoSilencio('já'), null);
});

test('condição enviada pela tela é conferida', () => {
  assert.throws(() => lerCondicao({ tipo: 'comparacao', campo: 'senha', operador: '>', valor: 1 }), /campo_invalido/);
  assert.throws(() => lerCondicao({ tipo: 'comparacao', campo: 'ultimo', operador: 'apaga', valor: 1 }), /operador_invalido/);
  assert.throws(() => lerCondicao({ tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 'x' }), /valor_invalido/);
  assert.throws(() => lerCondicao({ tipo: 'e', filhos: [] }), /condicao_invalida/);
  const fundo = { tipo: 'e', filhos: [{ tipo: 'ou', filhos: [{ tipo: 'e', filhos: [{ tipo: 'ou', filhos: [] }] }] }] };
  assert.throws(() => lerCondicao(fundo), /condicao_invalida/);
  const muitas = { tipo: 'ou', filhos: Array.from({ length: 10 }, () => ({ tipo: 'e', filhos: [{ tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 1 }, { tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 1 }] })) };
  assert.throws(() => lerCondicao(muitas), /condicao_grande_demais/);
});

describe('alertas de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  let coleta: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  // Relógio do teste: sexta 16/10/2026 às 14:00 em Brasília, pregão aberto.
  let agora = new Date('2026-10-16T17:00:00Z');
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};
  let chave = '';

  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.88', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }
  async function robo(cotacoes: unknown[]) {
    const r = await app.inject({ method: 'POST', url: '/api/ponte/dados', headers: { authorization: `Bearer ${chave}` }, remoteAddress: '203.0.113.89', payload: { versao: '1.0.0', cotacoes } });
    return { status: r.statusCode, corpo: r.json() };
  }
  const cot = (ultimo: number, segundos: number) => ({ codigo: 'PETR4', ultimo, bid: ultimo - 0.01, ask: ultimo + 0.01, fechamento_anterior: 38, volume: 1000, instante: agora.getTime() - 60_000 + segundos * 1000 });

  // Telegram simulado: guarda o que foi enviado e devolve as mensagens da fila.
  const enviados: { chat_id: number; text: string }[] = [];
  let fila: unknown[] = [];
  const tg: Telegram = {
    async chamar(metodo, corpo) {
      if (metodo === 'sendMessage') { enviados.push(corpo as { chat_id: number; text: string }); return { ok: true, status: 200, corpo: { ok: true } }; }
      if (metodo === 'getUpdates') { const r = fila; fila = []; return { ok: true, status: 200, corpo: { ok: true, result: r } }; }
      return { ok: false, status: 404, corpo: { description: 'metodo' } };
    },
  };

  before(async () => {
    process.env.TELEGRAM_BOT_NOME = '@wta_teste_bot';
    dono = new pg.Pool({ connectionString: URL_DONO });
    coleta = criarPool(URL_COLETA as string);
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Alertas ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto']) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, `${quem}.alertas.${sufixo}@exemplo.test`, quem, hash]);
    }
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.88', payload: { email: `${quem}.alertas.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
    chave = (await pedir('ana', 'POST', '/api/ponte', { nome: 'teste' })).corpo.chave;
    // Fila do Telegram limpa (outros testes não usam o bot).
    await dono.query("delete from controle_telegram");
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_NOME;
    await app?.close();
    await pool?.end();
    await coleta?.end();
    await dono?.end();
  });

  let regraId = '';

  test('cria a regra e recusa regra inválida', async () => {
    const r = await pedir('ana', 'POST', '/api/alertas', {
      nome: 'Rompimento de PETR4', codigo: 'petr4', condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'cruza_acima', valor: 3850 },
      rearme: { tipo: 'ao_desfazer' }, limitePorDia: 3,
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.codigo, 'PETR4');
    assert.equal(r.corpo.descricao, 'último preço cruzar para cima de R$ 38,50');
    regraId = r.corpo.id;
    assert.equal((await pedir('ana', 'POST', '/api/alertas', { nome: 'x', codigo: 'PETR4', condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'dentro', valor: 10, valor2: 5 }, rearme: { tipo: 'uma_vez' } })).corpo.erro, 'faixa_invalida');
    assert.equal((await pedir('ana', 'POST', '/api/alertas', { nome: 'x', codigo: 'PETR4', condicao: { tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 1 }, rearme: { tipo: 'intervalo', minutos: 0 } })).corpo.erro, 'rearme_invalido');
  });

  test('cotação pela ponte: só dispara ao cruzar, uma vez, e não repete com a mesma cotação', async () => {
    assert.equal((await robo([cot(38.40, 1)])).corpo.alertas, 0, 'primeira observação é só a base do cruzamento');
    assert.equal((await robo([cot(38.55, 2)])).corpo.alertas, 1, 'cruzou para cima: dispara');
    assert.equal((await robo([cot(38.60, 3)])).corpo.alertas, 0, 'continua acima: não repete');
    assert.equal((await robo([cot(38.55, 2)])).corpo.alertas, 0, 'cotação repetida ou fora de ordem: nada');
    const r = await pedir('ana', 'GET', '/api/alertas');
    assert.equal(r.corpo.eventos.length, 1);
    assert.deepEqual([r.corpo.eventos[0].codigo, r.corpo.eventos[0].fonte, r.corpo.eventos[0].qualidade, r.corpo.eventos[0].aviso.situacao], ['PETR4', 'MetaTrader 5', 'tempo_real', 'pendente']);
    assert.equal(r.corpo.regras[0].disparos, 1);
  });

  test('pregão fechado: cotação vale como histórico e não dispara', async () => {
    agora = new Date('2026-10-16T22:00:00Z'); // 19:00, pregão encerrado
    assert.equal((await robo([cot(38.00, 1)])).corpo.alertas, 0); // desfaz (rearma)
    assert.equal((await robo([cot(38.70, 2)])).corpo.alertas, 0, 'fechado não dispara');
    agora = new Date('2026-10-19T17:00:00Z'); // segunda, 14:00: pregão aberto de novo (o relógio só anda para a frente)
  });

  test('outro usuário não vê nem altera a regra', async () => {
    assert.deepEqual((await pedir('beto', 'GET', '/api/alertas')).corpo.regras, []);
    assert.equal((await pedir('beto', 'PATCH', `/api/alertas/${regraId}`, { ativa: false })).status, 404);
    assert.equal((await pedir('beto', 'DELETE', `/api/alertas/${regraId}`)).status, 404);
  });

  test('Telegram: código de vínculo, /start pelo bot e envio do aviso', async () => {
    const c = await pedir('ana', 'POST', '/api/telegram/codigo');
    assert.equal(c.status, 201);
    assert.match(c.corpo.codigo, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(c.corpo.link, `https://t.me/wta_teste_bot?start=${c.corpo.codigo}`);
    fila = [
      { update_id: 900, message: { chat: { id: 4242, type: 'private' }, text: `/start ${c.corpo.codigo.toLowerCase()}`, from: { username: 'gilson' } } },
      { update_id: 901, message: { chat: { id: 4242, type: 'private' }, text: '/status' } },
      { update_id: 902, message: { chat: { id: 77, type: 'group' }, text: '/start QUALQUER' } }, // grupo: ignorado
    ];
    assert.equal(await processarAtualizacoes(coleta, tg, 0), 3);
    assert.match(enviados[0]?.text ?? '', /^Pronto!/);
    assert.match(enviados[1]?.text ?? '', /Regras ativas: 1/);
    assert.equal(enviados.length, 2, 'grupo não recebe resposta');
    const t = await pedir('ana', 'GET', '/api/telegram');
    assert.deepEqual([t.corpo.vinculado, t.corpo.nomeNoTelegram, t.corpo.bot], [true, 'gilson', 'wta_teste_bot']);

    enviados.length = 0;
    const r = await enviarAvisos(coleta, tg, () => new Date());
    assert.equal(r.enviado, 1);
    assert.equal(enviados[0]?.chat_id, 4242);
    assert.match(enviados[0]?.text ?? '', /<b>PETR4<\/b>: último preço cruzar para cima de R\$ 38,50/);
    assert.equal((await pedir('ana', 'GET', '/api/alertas')).corpo.eventos[0].aviso.situacao, 'enviado');
    // O mesmo código não vincula de novo, e a posição do getUpdates avançou.
    fila = [{ update_id: 903, message: { chat: { id: 5555, type: 'private' }, text: `/start ${c.corpo.codigo}` } }];
    enviados.length = 0;
    await processarAtualizacoes(coleta, tg, 0);
    assert.match(enviados[0]?.text ?? '', /inválido ou vencido/);
    assert.equal(Number((await dono.query("select valor from controle_telegram where chave = 'offset'")).rows[0].valor), 904);
  });

  test('silêncio: aviso é marcado como silenciado e não é enviado', async () => {
    fila = [{ update_id: 904, message: { chat: { id: 4242, type: 'private' }, text: '/silencio 30m' } }];
    enviados.length = 0;
    await processarAtualizacoes(coleta, tg, 0);
    assert.match(enviados[0]?.text ?? '', /em silêncio até/);
    await robo([cot(38.00, 10)]); // desfaz
    assert.equal((await robo([cot(38.80, 11)])).corpo.alertas, 1);
    enviados.length = 0;
    const r = await enviarAvisos(coleta, tg, () => new Date());
    assert.deepEqual([r.enviado, r.silenciado, enviados.length], [0, 1, 0]);
    assert.equal((await pedir('ana', 'POST', '/api/telegram/silencio', { minutos: null })).corpo.silencioAte, null);
  });

  test('editar a regra recomeça o estado; uma_vez desliga a regra depois de avisar', async () => {
    const e = await pedir('ana', 'PATCH', `/api/alertas/${regraId}`, { rearme: { tipo: 'uma_vez' }, condicao: { tipo: 'comparacao', campo: 'variacao_dia_pct', operador: '>=', valor: 3 } });
    assert.equal(e.status, 200, JSON.stringify(e.corpo));
    assert.equal(e.corpo.versao, 2);
    assert.equal(e.corpo.disparos, 0);
    assert.equal((await robo([cot(39.20, 20)])).corpo.alertas, 1, 'variação de 3,16% dispara');
    const r = await pedir('ana', 'GET', '/api/alertas');
    assert.equal(r.corpo.regras[0].ativa, false, 'uma_vez: desligada depois do aviso');
    assert.equal((await robo([cot(39.30, 21)])).corpo.alertas, 0);
    assert.equal((await pedir('ana', 'DELETE', `/api/alertas/${regraId}`)).status, 200);
    const acoes = (await dono.query("select acao from audit_logs where alvo_id = $1 order by quando", [regraId])).rows.map((l) => l.acao);
    assert.deepEqual(acoes, ['alerta.criado', 'alerta.alterado', 'alerta.removido']);
  });

  test('aviso vencido não é enviado', async () => {
    const id = (await dono.query("select id from users where email like $1", [`ana.alertas.${sufixo}%`])).rows[0].id;
    await dono.query("insert into avisos (user_id, canal, chave, texto, criado_em) values ($1, 'telegram', $2, 'velho', now() - interval '2 hours')", [id, `velho-${sufixo}`]);
    enviados.length = 0;
    const r = await enviarAvisos(coleta, tg, () => new Date());
    assert.ok(r.falhou >= 1);
    assert.ok(!enviados.some((m) => m.text === 'velho'), 'o aviso velho não sai');
    const v = (await dono.query('select situacao, erro from avisos where chave = $1', [`velho-${sufixo}`])).rows[0];
    assert.deepEqual([v.situacao, v.erro], ['falhou', 'vencido: mais de 30 minutos sem conseguir enviar']);
  });
});
