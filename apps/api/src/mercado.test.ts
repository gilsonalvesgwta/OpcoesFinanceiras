// Testes da coleta gratuita (B3 + Banco Central) e das rotas de mercado, calendário e
// diagnóstico. A rede é simulada: o "buscar" devolve um ZIP montado aqui.
// Variáveis: DATABASE_URL (wtaopt_app), DATABASE_URL_DONO e DATABASE_URL_COLETA (wtaopt_coleta).

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
import { cicloDeColeta, importarCotahist, type Buscar } from './coleta/coleta.ts';
import { ErroDeZip, extrairPrimeiroArquivo, montarZip } from './coleta/zip.ts';

// ---------- Linhas do COTAHIST (layout oficial, posições 1-indexadas) ----------
type Campos = { data?: string; codigo: string; tpmerc: number; especi?: string; ult?: number; ofc?: number; ofv?: number; neg?: number; qua?: number; vol?: number; exe?: number; venc?: string; fat?: number };
function linha(c: Campos): string {
  const l = Array(245).fill(' ');
  const pos = (de: number, ate: number, v: string, num = false) => {
    const tam = ate - de + 1;
    const s = num ? v.padStart(tam, '0') : v.padEnd(tam, ' ');
    for (let i = 0; i < tam; i += 1) l[de - 1 + i] = s[i] as string;
  };
  const n = (de: number, ate: number, v: number) => pos(de, ate, String(v), true);
  pos(1, 2, '01'); pos(3, 10, c.data ?? '20261016'); pos(11, 12, '02'); pos(13, 24, c.codigo); n(25, 27, c.tpmerc);
  pos(28, 39, 'PETROBRAS'); pos(40, 49, c.especi ?? 'PN'); pos(53, 56, 'R$');
  n(57, 69, c.ult ?? 0); n(70, 82, c.ult ?? 0); n(83, 95, c.ult ?? 0); n(96, 108, c.ult ?? 0); n(109, 121, c.ult ?? 0);
  n(122, 134, c.ofc ?? 0); n(135, 147, c.ofv ?? 0); n(148, 152, c.neg ?? 1); n(153, 170, c.qua ?? 100); n(171, 188, c.vol ?? 1000);
  n(189, 201, c.exe ?? 0); n(202, 202, 0); pos(203, 210, c.venc ?? '99991231'); n(211, 217, c.fat ?? 1); n(218, 230, 0);
  pos(231, 242, 'BRPETRACNPR6'); n(243, 245, 100);
  return l.join('');
}
const cabecalho = (d: string) => `00COTAHIST.${d.slice(0, 4)}BOVESPA ${d}`.padEnd(245, ' ');
function arquivo(dia: string, linhas: string[]): Buffer {
  const d = dia.replaceAll('-', '');
  return Buffer.from([cabecalho(d), ...linhas, '99COTAHIST'.padEnd(245, ' ')].join('\r\n'), 'latin1');
}

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const URL_COLETA = process.env.DATABASE_URL_COLETA;
const pular = !URL_APP || !URL_DONO || !URL_COLETA;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam DATABASE_URL, DATABASE_URL_DONO ou DATABASE_URL_COLETA');

test('zip: lê o que montou, recusa o que não é zip e o corrompido', () => {
  const conteudo = Buffer.from('01'.repeat(50_000));
  const z = montarZip('COTAHIST_D16102026.TXT', conteudo);
  const r = extrairPrimeiroArquivo(z);
  assert.equal(r.nome, 'COTAHIST_D16102026.TXT');
  assert.ok(r.conteudo.equals(conteudo));
  assert.throws(() => extrairPrimeiroArquivo(Buffer.from('<html>não encontrado</html>')), ErroDeZip);
  const ruim = Buffer.from(z);
  ruim[70] = (ruim[70] as number) ^ 0xff; // dentro dos dados comprimidos
  assert.throws(() => extrairPrimeiroArquivo(ruim));
  assert.throws(() => extrairPrimeiroArquivo(z, 10), /arquivo_grande_demais/);
});

describe('coleta gratuita e rotas de mercado', { skip: pular ? 'sem as três URLs do banco' : false }, () => {
  let dono: pg.Pool;
  let coleta: pg.Pool;
  let app: FastifyInstance;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false },
    sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const cookies: Record<string, { cookie: string; csrf: string }> = {};

  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
    const s = cookies[quem];
    const headers: Record<string, string> = {};
    if (s) { headers.cookie = s.cookie; headers['x-csrf-token'] = s.csrf; }
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.77', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }

  // Rede simulada: arquivos por URL; o resto é 404.
  const arquivos = new Map<string, Buffer>();
  let selic: unknown = [{ data: '16/10/2026', valor: '14.90' }, { data: '15/10/2026', valor: '14.90' }];
  const pedidas: string[] = [];
  const buscar: Buscar = async (url) => {
    pedidas.push(url);
    const corpo = arquivos.get(url);
    if (url.includes('bcdata.sgs')) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), json: async () => selic };
    if (!corpo) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), json: async () => null };
    return { ok: true, status: 200, arrayBuffer: async () => corpo.buffer.slice(corpo.byteOffset, corpo.byteOffset + corpo.byteLength) as ArrayBuffer, json: async () => null };
  };
  const urlDo = (dia: string) => `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${dia.slice(8, 10)}${dia.slice(5, 7)}${dia.slice(0, 4)}.ZIP`;

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    coleta = criarPool(URL_COLETA as string);
    await dono.query('truncate fechamentos, series_opcoes, taxas_juros, importacoes, pulso_coleta');
    // O teste de acesso apaga os usuários em cascata, o que leva junto o calendário: recoloca o que estes testes usam.
    await dono.query("insert into feriados (dia, descricao) values ('2026-10-12', 'Nossa Senhora Aparecida'), ('2026-11-20', 'Consciência Negra') on conflict do nothing");
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Mercado ${sufixo}`])).rows[0].id;
    for (const [quem, papel] of [['chefe', 'superadmin'], ['ana', 'usuario']] as const) {
      await dono.query('insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, $4, $5)', [org, `${quem}.mercado.${sufixo}@exemplo.test`, quem, papel, hash]);
    }
    app = await construirApp({ config, pool, correio: new CorreioDeTeste() });
    for (const quem of ['chefe', 'ana']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.77', payload: { email: `${quem}.mercado.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      cookies[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
    assert.equal((await pedir('ana', 'POST', '/api/favoritos', { codigo: 'PETR4' })).status, 201);
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await coleta?.end();
    await dono?.end();
  });

  test('importa o COTAHIST: ações e opções em centavos, série com ativo-objeto, linhas ruins contadas', async () => {
    const texto = arquivo('2026-10-15', [
      linha({ data: '20261015', codigo: 'PETR4', tpmerc: 10, especi: 'PN N2', ult: 3800, ofc: 3799, ofv: 3801 }),
      linha({ data: '20261015', codigo: 'PETRK380', tpmerc: 70, ult: 72, ofc: 71, ofv: 0, exe: 3800, venc: '20261120' }),
      linha({ data: '20261015', codigo: 'PETR4F', tpmerc: 20, ult: 3800 }), // fracionário: fora
      linha({ data: '20261015', codigo: 'XXXX3', tpmerc: 10, ult: 105, fat: 1000 }), // fator que não dá centavo exato
    ]).toString('latin1');
    const r = await emTransacao(coleta, null, (c) => importarCotahist(c, '2026-10-15', texto));
    assert.deepEqual(r, { registros: 2, recusados: 1, series: 1 });
    const f = (await dono.query("select codigo, ultimo, melhor_compra, melhor_venda from fechamentos where dia = '2026-10-15' order by codigo")).rows;
    assert.deepEqual(f.map((l) => [l.codigo, Number(l.ultimo), l.melhor_compra === null ? null : Number(l.melhor_compra), l.melhor_venda === null ? null : Number(l.melhor_venda)]),
      [['PETR4', 3800, 3799, 3801], ['PETRK380', 72, 71, null]]);
    const s = (await dono.query("select ativo_objeto, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as v from series_opcoes where codigo = 'PETRK380'")).rows[0];
    assert.deepEqual([s.ativo_objeto, s.tipo, Number(s.strike), s.v], ['PETR4', 'call', 3800, '2026-11-20']);
    await assert.rejects(emTransacao(coleta, null, (c) => importarCotahist(c, '2026-10-16', texto)), /arquivo_de_outro_dia/);
  });

  test('ciclo: baixa o que falta, registra arquivo ausente, pula feriado e busca a Selic', async () => {
    arquivos.set(urlDo('2026-10-16'), montarZip('COTAHIST_D16102026.TXT', arquivo('2026-10-16', [
      linha({ codigo: 'PETR4', tpmerc: 10, especi: 'PN N2', ult: 3847, ofc: 3846, ofv: 3848 }),
      linha({ codigo: 'PETRK380', tpmerc: 70, ult: 93, ofc: 120, ofv: 126, exe: 3800, venc: '20261120' }),
      linha({ codigo: 'PETRW360', tpmerc: 80, ult: 0, ofc: 0, ofv: 0, exe: 3600, venc: '20261120' }), // sem negócio nem oferta
    ])));
    const agora = new Date('2026-10-16T23:30:00Z'); // sexta, 20:30 em Brasília
    const r = await cicloDeColeta({ pool: coleta, buscar, agora: () => agora, nome: 'teste' });
    assert.equal(r.cotahist['2026-10-16'], 'ok');
    assert.equal(r.cotahist['2026-10-14'], 'sem_arquivo');
    assert.equal(r.selic, 'ok');
    assert.deepEqual(r.calculos['2026-10-16'], { calculadas: 1, semCalculo: 1 }, 'gregas calculadas já com a Selic do mesmo ciclo');
    assert.ok(!pedidas.some((u) => u.includes('D12102026')), 'feriado de 12/10 não é buscado');
    assert.ok(!pedidas.some((u) => u.includes('D11102026') || u.includes('D10102026')), 'fim de semana não é buscado');

    // Segundo ciclo logo em seguida: não repete o que já tentou nem o que já tem; a Selic está em dia.
    // (Segue recuperando pregões mais antigos que ainda faltam, até 3 por ciclo.)
    pedidas.length = 0;
    const r2 = await cicloDeColeta({ pool: coleta, buscar, agora: () => new Date(agora.getTime() + 60_000), nome: 'teste' });
    assert.equal(r2.selic, 'em_dia');
    assert.deepEqual(Object.keys(r2.cotahist).sort(), ['2026-10-08', '2026-10-09', '2026-10-13']);
    assert.ok(!pedidas.some((u) => /D1[456]102026/.test(u)), 'não insiste em 14, 15 e 16');
  });

  test('Selic com resposta inválida fica registrada como erro, sem gravar zero', async () => {
    selic = { erro: 'indisponível' };
    await dono.query("delete from importacoes where fonte = 'bcb-selic'");
    const r = await cicloDeColeta({ pool: coleta, buscar, agora: () => new Date('2026-10-17T15:00:00Z'), nome: 'teste' });
    assert.equal(r.selic, 'erro');
    const linhas = (await dono.query("select situacao, detalhe from importacoes where fonte = 'bcb-selic'")).rows;
    assert.deepEqual(linhas.map((l) => [l.situacao, l.detalhe]), [['erro', 'resposta_sgs_invalida']]);
    assert.equal(Number((await dono.query("select valor from taxas_juros order by dia desc limit 1")).rows[0].valor), 14.9);
  });

  test('painel: favorito sem ponte MT5 recebe o fechamento da B3 como histórico, com variação', async () => {
    const r = await pedir('ana', 'GET', '/api/cotacoes');
    const petr = r.corpo.cotacoes.find((c: { codigo: string }) => c.codigo === 'PETR4');
    assert.deepEqual([petr.provedor, petr.qualidade, petr.ultimo, petr.bid, petr.ask, petr.fechamentoAnterior],
      ['b3-cotahist', 'historico', 3847, 3846, 3848, 3800]);
    assert.equal(petr.instanteDaFonte, '2026-10-16T20:00:00.000Z', 'fim do pregão: 17h em Brasília');
    const sit = await pedir('ana', 'GET', '/api/mercado/situacao');
    assert.equal(sit.corpo.fechamento.ultimoImportado, '2026-10-16');
    assert.equal(sit.corpo.fechamento.series, 2, 'PETRK380 e PETRW360 vistas no arquivo de 16/10 e ainda não vencidas');
    assert.deepEqual(sit.corpo.selic, { dia: '2026-10-16', valor: 14.9 });
    const f = await pedir('ana', 'GET', '/api/mercado/fechamentos?codigos=petrk380,VALE3');
    assert.deepEqual(f.corpo.fechamentos.map((x: { codigo: string; ultimo: number }) => [x.codigo, x.ultimo]), [['PETRK380', 93]]);
  });

  test('cadeia: séries do vencimento com volatilidade implícita, gregas, motivo e premissas', async () => {
    const r = await pedir('ana', 'GET', '/api/mercado/cadeia?ativo=petr4');
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.ativo.codigo, r.corpo.ativo.ultimo, r.corpo.ativo.dia, r.corpo.vencimento], ['PETR4', 3847, '2026-10-16', '2026-11-20']);
    const call = r.corpo.series.find((x: { codigo: string }) => x.codigo === 'PETRK380');
    assert.equal(call.calculo.origemPremio, 'meio_do_livro');
    assert.equal(call.calculo.premio, 123);
    assert.ok(call.calculo.volImplicita > 0.05 && call.calculo.volImplicita < 2, `vol ${call.calculo.volImplicita}`);
    assert.ok(call.calculo.delta > 0 && call.calculo.delta < 1);
    assert.ok(call.calculo.theta < 0);
    const put = r.corpo.series.find((x: { codigo: string }) => x.codigo === 'PETRW360');
    assert.deepEqual([put.ultimo, put.bid, put.ask, put.calculo], [null, null, null, { motivo: 'sem_premio' }], 'sem preço: nada de zero');
    assert.ok(r.corpo.premissas.some((p: string) => p.includes('Black-Scholes')));
    assert.equal((await pedir('ana', 'GET', '/api/mercado/cadeia?ativo=XXXX3')).corpo.erro, 'sem_fechamento');
  });

  test('calendário: todos leem; só o superadmin altera, com auditoria', async () => {
    const cal = await pedir('ana', 'GET', '/api/calendario');
    assert.ok(cal.corpo.feriados.some((f: { dia: string }) => f.dia === '2026-11-20'));
    assert.equal((await pedir('ana', 'POST', '/api/calendario/feriados', { dia: '2027-01-01', descricao: 'Ano novo' })).status, 403);
    assert.equal((await pedir('chefe', 'POST', '/api/calendario/feriados', { dia: '2027-01-01', descricao: 'Confraternização Universal' })).status, 201);
    assert.equal((await pedir('chefe', 'POST', '/api/calendario/feriados', { dia: '2027-01-01', descricao: 'De novo' })).corpo.erro, 'dia_ja_cadastrado');
    assert.equal((await pedir('chefe', 'POST', '/api/calendario/feriados', { dia: '2027-02-30', descricao: 'x' })).corpo.erro, 'data_invalida');
    assert.equal((await pedir('chefe', 'POST', '/api/calendario/sessoes-especiais', { dia: '2027-02-10', abertura: '13:00', fechamento: '12:00', descricao: 'x' })).corpo.erro, 'horario_invalido');
    assert.equal((await pedir('chefe', 'POST', '/api/calendario/sessoes-especiais', { dia: '2027-02-10', abertura: '13:00', fechamento: '17:00', descricao: 'Quarta-feira de Cinzas' })).status, 201);
    assert.equal((await pedir('chefe', 'DELETE', '/api/calendario/feriados/2027-01-01')).status, 200);
    assert.equal((await pedir('chefe', 'DELETE', '/api/calendario/feriados/2027-01-01')).status, 404);
    const acoes = (await dono.query("select acao from audit_logs where alvo_id in ('2027-01-01', '2027-02-10') order by quando")).rows.map((l) => l.acao);
    assert.deepEqual(acoes, ['calendario.feriado_criado', 'calendario.sessao_criada', 'calendario.feriado_removido']);
  });

  test('diagnóstico: só o superadmin vê pulso e importações', async () => {
    assert.equal((await pedir('ana', 'GET', '/api/diagnostico')).status, 403);
    const d = await pedir('chefe', 'GET', '/api/diagnostico');
    assert.equal(d.status, 200);
    assert.equal(d.corpo.coleta[0].nome, 'teste');
    assert.equal(d.corpo.cotahist.ultimoImportado, '2026-10-16');
    assert.equal(typeof d.corpo.brapi.configurada, 'boolean');
    assert.ok(!JSON.stringify(d.corpo).includes('BRAPI'), 'a chave nunca aparece');
    assert.ok(d.corpo.importacoes.some((i: { situacao: string; referencia: string }) => i.situacao === 'sem_arquivo' && i.referencia === '2026-10-14'));
  });
});
