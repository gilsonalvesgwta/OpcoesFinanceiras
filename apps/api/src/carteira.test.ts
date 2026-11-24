// Testes da carteira: ler nota de corretagem (PDF), importar sem duplicar, posição inicial,
// carteira consolidada com preço médio com custos, apagar nota e isolamento por usuário.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { construirApp } from './app.ts';
import { criarPool } from './banco.ts';
import type { Config } from './config.ts';
import { CorreioDeTeste } from './correio.ts';
import { gerarHashDeSenha } from './seguranca.ts';
import { xlsDeTeste } from './xls-de-teste.ts';
import { linhaCotahist, zipDoCotahist } from './cotahist-de-teste.ts';
import { xlsxDeTeste } from './xlsx-de-teste.ts';
import { textoDoPdf } from './pdf-texto.ts';

// PDF mínimo no layout Sinacor (Helvetica, WinAnsi), como as notas da BTG, sem dados pessoais.
export function pdfDeNota(linhas: [number, number, string][], comprimir = true): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const conteudo = Buffer.from(linhas.map(([x, y, t]) => `BT /F1 6 Tf 1 0 0 1 ${x} ${y} Tm (${esc(t)}) Tj ET`).join('\n'), 'latin1');
  const dados = comprimir ? deflateSync(conteudo) : conteudo;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    null,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
  ];
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  objs.forEach((o, i) => {
    if (o === null) partes.push(Buffer.from(`${i + 1} 0 obj\n<</Length ${dados.length}${comprimir ? '/Filter/FlateDecode' : ''}>>stream\n`, 'latin1'), dados, Buffer.from('\nendstream\nendobj\n', 'latin1'));
    else partes.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
  });
  partes.push(Buffer.from('trailer\n<</Root 1 0 R>>\n%%EOF\n', 'latin1'));
  return Buffer.concat(partes);
}

const NOTA: [number, number, string][] = [
  [116, 797, 'NOTA DE CORRETAGEM'], [402, 792, ' Nr. nota'], [457, 792, 'Folha'], [512, 792, 'Data pregão'],
  [416, 783, '987654'], [483, 783, '1'], [525, 783, '24/11/2026'], [126, 770, 'Corretora Teste CTVM S.A.'],
  [28, 604, 'Q'], [38, 604, 'Negociação'], [88, 604, 'C/V'], [106, 604, 'Tipo Mercado'], [188, 604, 'Prazo'], [214, 604, 'Especificação do título'],
  [308, 604, 'Obs. (*)'], [342, 604, 'Quantidade'], [391, 604, 'Preço / Ajuste'], [452, 604, 'Valor Operação / Ajuste'], [552, 604, 'D/C'],
  [38, 593, '1-BOVESPA'], [88, 593, 'C'], [106, 593, 'VISTA'], [214, 593, 'CART3'], [254, 593, 'ON'], [342, 593, '200'], [391, 593, '14,34'], [452, 593, '2.868,00'], [552, 593, 'D'],
  [38, 584, '1-BOVESPA'], [88, 584, 'V'], [106, 584, 'OPCAO DE COMPRA'], [188, 584, '12/26'], [214, 584, 'CARTL145'], [254, 584, 'ON'], [342, 584, '200'], [391, 584, '0,37'], [452, 584, '74,00'], [552, 584, 'C'],
  [28, 348, 'Resumo dos Negócios'], [300, 348, 'Resumo Financeiro'],
  [300, 321, 'Taxa de liquidação/CCP'], [541, 321, '0,65'], [557, 321, 'D'],
  [300, 312, 'Taxa de registro'], [541, 312, '0,03'], [557, 312, 'D'],
  [300, 267, 'Emolumentos'], [541, 267, '0,15'], [557, 267, 'D'],
  [300, 240, 'Taxa de Transferencia de Ativos'], [541, 240, '0,07'], [557, 240, 'D'],
  [300, 170, 'I.R.R.F. s/ operações, base R$'], [406, 170, '74,00'], [541, 170, '0,00'],
  [300, 139, 'Líquido para 26/11/2026'], [537, 138, '2.794,90'], [557, 138, 'D'],
];

test('texto do PDF: posições e acentos (com e sem compressão)', () => {
  for (const comp of [true, false]) {
    const t = textoDoPdf(pdfDeNota(NOTA, comp));
    assert.ok(t.some((x) => x.texto === 'Data pregão' && x.x === 512 && x.y === 792));
    assert.equal(t.length, NOTA.length);
  }
  assert.throws(() => textoDoPdf(Buffer.from('não é pdf')), /nao_e_pdf/);
});

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const pular = !URL_APP || !URL_DONO;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam as URLs do banco');

describe('carteira de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  const agora = new Date('2026-11-24T17:00:00Z');
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};
  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.96', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Carteira ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto', 'carla']) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, `${quem}.cart.${sufixo}@exemplo.test`, quem, hash]);
    }
    await dono.query("insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values ('CARTL145', '2026-12-18', 'CART3', 'call', 1450, '2026-11-23', '2026-11-23') on conflict do nothing");
    await dono.query("update series_opcoes set visto_ultimo = (select max(visto_ultimo) from series_opcoes) where codigo = 'CARTL145'");
    await dono.query(`insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
      ('CARTT130', '2026-08-21', 'CART3', 'put', 1300, '2026-08-01', '2026-08-21'),
      ('CARTG150', '2026-07-17', 'CART3', 'call', 1500, '2026-07-01', '2026-07-17') on conflict do nothing`);
    // Internet simulada: o arquivo COTAHIST da B3 do dia 24/11/2026 com uma série antiga.
    const arquivoB3 = zipDoCotahist('2026-11-24', [
      linhaCotahist({ codigo: 'CART3', tpmerc: 10, ult: 1434 }),
      linhaCotahist({ codigo: 'CARTH140', tpmerc: 70, ult: 20, exe: 1400, venc: '20260821' }),
    ]);
    const buscar = async (url: string) => {
      const ok = url.endsWith('COTAHIST_D24112026.ZIP');
      return { ok, status: ok ? 200 : 404, arrayBuffer: async () => { const b = ok ? arquivoB3 : Buffer.alloc(0); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer; }, json: async () => ({}) };
    };
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora, buscar });
    for (const quem of ['ana', 'beto', 'carla']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.96', payload: { email: `${quem}.cart.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
  });
  after(async () => { await app?.close(); await pool?.end(); await dono?.end(); });

  let previa: Record<string, any>;

  test('lê a nota: negócios, custos rateados, conferência e cadastro da opção', async () => {
    const r = await pedir('ana', 'POST', '/api/notas/ler', { arquivos: [{ nome: 'nota.pdf', conteudo: pdfDeNota(NOTA).toString('base64') }, { nome: 'outro.pdf', conteudo: Buffer.from('%PDF-1.4 nada').toString('base64') }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    previa = r.corpo.notas[0];
    assert.deepEqual([previa.numero, previa.dataPregao, previa.custoTotal, previa.conferida, previa.jaImportada], ['987654', '2026-11-24', 90, true, false]);
    assert.deepEqual(previa.negocios.map((n: any) => [n.lado, n.codigo, n.tipo, n.strike, n.vencimento, n.ativoObjeto, n.preco, n.custos, n.falta.length]), [
      ['compra', 'CART3', 'ativo', null, null, 'CART3', 1434, 88, 0],
      ['venda', 'CARTL145', 'call', 1450, '2026-12-18', 'CART3', 37, 2, 0],
    ]);
    assert.ok(r.corpo.notas[1].erro, 'arquivo que não é nota volta com erro, sem derrubar os outros');
  });

  test('série fora do cadastro: strike e vencimento vêm do arquivo da B3 do dia da nota', async () => {
    const antiga = NOTA.map(([x, y, t]) => [x, y, t === 'CARTL145' ? 'CARTH140' : t === '987654' ? '987600' : t] as [number, number, string]);
    const r = await pedir('ana', 'POST', '/api/notas/ler', { arquivos: [{ nome: 'antiga.pdf', conteudo: pdfDeNota(antiga).toString('base64') }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const opc = r.corpo.notas[0].negocios.find((n: any) => n.codigo === 'CARTH140');
    assert.deepEqual([opc.tipo, opc.strike, opc.vencimento, opc.vencimentoEstimado, opc.ativoObjeto, opc.falta], ['call', 1400, '2026-08-21', false, 'CART3', []]);
  });

  test('lê a nota em planilha XLS (formato da CM Capital)', async () => {
    const xls = xlsDeTeste([
      ['CLIENTE:', '000000001', 'ANA', 'DATA PREGÃO', '20112026', 'NUM NOTA', '4455'],
      [],
      ['PRAÇA', 'C/V', 'TIPO DE MERCADO', 'ESPECIFICAÇÃO DO TÍTULO', 'OBS(*)', 'QUANTIDADE', 'PREÇO DE LIQUIDAÇÃO(R$)', 'COMPRA/VENDA (R$)', 'D/C'],
      ['1-Bovespa', 'C', 'VIS', 'CART3 ON', null, '100', '14,00', '1.400,00', 'D'],
      [],
      ['RESUMO DOS NEGÓCIOS', null, null, null, null, 'RESUMO FINANCEIRO'],
      [null, null, null, null, null, 'VALOR LÍQ. DAS OPER.(1):', '1400.00 D', 'TAXA DE LIQUIDAÇÃO / CCP (2):', '0.35 D'],
      [null, null, null, null, null, 'EMOLUMENTOS:', '0.05 D', 'TOTAL:', '-0.05 D'],
      [null, null, null, null, null, null, null, 'LIQ.(A+B) P/ 24/11/2026:', '1400.40 D'],
    ]);
    const r = await pedir('ana', 'POST', '/api/notas/ler', { arquivos: [{ nome: 'nota.xls', conteudo: xls.toString('base64') }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const n = r.corpo.notas[0];
    assert.deepEqual([n.corretora, n.numero, n.dataPregao, n.custoTotal, n.liquido, n.conferida], ['CM CAPITAL MARKETS CCTVM LTDA.', '4455', '2026-11-20', 40, -140040, true]);
    assert.deepEqual(n.negocios.map((x: any) => [x.lado, x.codigo, x.tipo, x.quantidade, x.preco, x.custos]), [['compra', 'CART3', 'ativo', 100, 1400, 40]]);
  });

  test('importa uma vez só; a carteira mostra preço médio com custos e cobertura', async () => {
    const corpo = { notas: [previa] };
    const r = await pedir('ana', 'POST', '/api/notas/importar', corpo);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.notas, [{ numero: '987654', situacao: 'importada', execucoes: 2 }]);
    assert.equal((await pedir('ana', 'POST', '/api/notas/importar', corpo)).corpo.notas[0].situacao, 'ja_importada');
    const c = await pedir('ana', 'GET', '/api/carteira');
    assert.equal(c.status, 200, JSON.stringify(c.corpo));
    const g = c.corpo.grupos.find((x: any) => x.ativoObjeto === 'CART3');
    const acao = g.itens.find((i: any) => i.codigo === 'CART3');
    const call = g.itens.find((i: any) => i.codigo === 'CARTL145');
    assert.deepEqual([acao.quantidade, acao.precoMedio, acao.precoMedioComCustos], [200, 1434, 1434.44]);
    assert.deepEqual([call.quantidade, call.precoMedioComCustos], [-200, 36.99]);
    assert.deepEqual(g.cobertura, { acoes: 200, callsVendidas: 200, callsCompradas: 0, descobertas: 0 });
    assert.equal((await pedir('ana', 'GET', '/api/notas')).corpo.notas[0].negocios, 2);
  });

  test('posição inicial soma ao preço médio; apagar a nota tira só o que veio dela', async () => {
    const p = await pedir('ana', 'POST', '/api/carteira/posicao-inicial', { codigo: 'cart3', lado: 'compra', quantidade: 100, preco: 1400, data: '2026-11-01' });
    assert.equal(p.status, 201, JSON.stringify(p.corpo));
    let g = (await pedir('ana', 'GET', '/api/carteira')).corpo.grupos.find((x: any) => x.ativoObjeto === 'CART3');
    assert.deepEqual([g.itens[0].quantidade, g.itens[0].precoMedioComCustos], [300, 1422.96]); // (140000 + 286888) / 300
    // Lotes: um por compra, cada um com o próprio custo e a call sugerida para cobri-lo.
    assert.deepEqual(g.itens[0].lotes.map((l: any) => [l.data, l.quantidade, l.preco, l.precoComCustos, l.sugestao?.codigo]), [
      ['2026-11-01', 100, 1400, 1400, 'CARTL145'],
      ['2026-11-24', 200, 1434, 1434.44, 'CARTL145'],
    ]);
    assert.equal(g.itens[0].lotes[0].sugestao.strike, 1450);
    assert.equal((await pedir('ana', 'POST', '/api/carteira/posicao-inicial', { codigo: 'CART3', lado: 'compra', quantidade: 1, preco: 1, data: '2026-12-01' })).corpo.erro, 'data_no_futuro');
    const id = (await pedir('ana', 'GET', '/api/notas')).corpo.notas[0].id;
    assert.equal((await pedir('ana', 'DELETE', `/api/notas/${id}`)).status, 200);
    g = (await pedir('ana', 'GET', '/api/carteira')).corpo.grupos.find((x: any) => x.ativoObjeto === 'CART3');
    assert.deepEqual(g.itens.map((i: any) => [i.codigo, i.quantidade]), [['CART3', 100]]);
  });

  test('outro usuário não vê nada', async () => {
    assert.deepEqual((await pedir('beto', 'GET', '/api/notas')).corpo.notas, []);
    assert.deepEqual((await pedir('beto', 'GET', '/api/carteira')).corpo.grupos, []);
    const id = (await dono.query("select n.id from notas_corretagem n join users u on u.id = n.user_id where u.email = $1 limit 1", [`ana.cart.${sufixo}@exemplo.test`])).rows[0]?.id;
    if (id) assert.equal((await pedir('beto', 'DELETE', `/api/notas/${id}`)).status, 404);
  });

  test('zerar a carteira: pede confirmação e apaga só a do próprio usuário', async () => {
    assert.equal((await pedir('beto', 'POST', '/api/carteira/posicao-inicial', { codigo: 'CART3', lado: 'compra', quantidade: 100, preco: 1400, data: '2026-11-01' })).status, 201);
    assert.equal((await pedir('ana', 'POST', '/api/carteira/zerar', { confirmacao: 'sim' })).corpo.erro, 'confirmacao_invalida');
    const r = await pedir('ana', 'POST', '/api/carteira/zerar', { confirmacao: 'ZERAR' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.ok(r.corpo.apagado.estrategias >= 1);
    assert.deepEqual((await pedir('ana', 'GET', '/api/carteira')).corpo.grupos, []);
    assert.deepEqual((await pedir('ana', 'GET', '/api/notas')).corpo.notas, []);
    assert.equal((await pedir('beto', 'GET', '/api/carteira')).corpo.grupos.length, 1);
  });

  test('importar: código com strike/vencimento diferentes em duas notas diz qual código e quais notas', async () => {
    const nota = (numero: string, vencimento: string) => ({
      corretora: 'Corretora Teste CTVM S.A.', numero, dataPregao: '2026-11-20', custoTotal: 0, conferida: true, custos: {},
      negocios: [{ lado: 'venda', codigo: 'CARTL145', tipo: 'call', strike: 1450, vencimento, ativoObjeto: 'CART3', quantidade: 100, preco: 30, custos: 0 }],
    });
    // Mesma série com strike ajustado por provento entre as notas: vale o da nota mais nova.
    const ajustada = (numero: string, dataPregao: string, strike: number) => ({ ...nota(numero, '2026-12-18'), dataPregao, negocios: [{ ...nota(numero, '2026-12-18').negocios[0], strike }] });
    const a = await pedir('beto', 'POST', '/api/notas/importar', { notas: [ajustada('2001', '2026-11-03', 1406), ajustada('2002', '2026-11-10', 1395)] });
    assert.equal(a.status, 201, JSON.stringify(a.corpo));
    const strikes = (await dono.query("select distinct x.strike from execucoes x join users u on u.id = x.user_id where u.email = $1 and x.codigo = 'CARTL145'", [`beto.cart.${sufixo}@exemplo.test`])).rows.map((x) => Number(x.strike));
    assert.deepEqual(strikes, [1395]);
    const r = await pedir('beto', 'POST', '/api/notas/importar', { notas: [nota('1001', '2026-12-18'), nota('1002', '2026-12-11')] });
    assert.equal(r.status, 400, JSON.stringify(r.corpo));
    assert.equal(r.corpo.erro, 'codigo_com_dados_diferentes');
    assert.equal(r.corpo.codigo, 'CARTL145');
    assert.deepEqual(r.corpo.notas, ['1001', '1002']);
    assert.equal(r.corpo.versoes.length, 2);
  });

  test('extrato da B3: prévia, importação com exercício e vencida, sem duplicar; a nota completa os custos', async () => {
    const CAB = ['Data do Negócio', 'Tipo de Movimentação', 'Mercado', 'Prazo/Vencimento', 'Instituição', 'Código de Negociação', 'Quantidade', 'Preço', 'Valor'];
    const xlsx = xlsxDeTeste([
      CAB,
      ['05/11/2026', 'Venda', 'Opção de Compra sobre Ações', '18/12/2026', 'BTG', 'CARTL145', 100, 0.4, 40],
      ['05/11/2026', 'Compra', 'Mercado Fracionário', '-', 'BTG', 'CART3F', 10, 14.1, 141],
      ['03/11/2026', 'Compra', 'Mercado à Vista', '-', 'BTG', 'CART3', 100, 14, 1400],
      ['10/08/2026', 'Venda', 'Opção de Venda sobre Ações', '21/08/2026', 'CM', 'CARTT130', 100, 0.2, 20],
      ['17/07/2026', 'Venda', 'Exercício de Opção de Compra', '17/07/2026', 'BTG', 'CARTG150E', 100, 15, 1500],
      ['10/07/2026', 'Venda', 'Opção de Compra sobre Ações', '17/07/2026', 'BTG', 'CARTG150', 100, 0.3, 30],
      ['01/06/2026', 'Compra', 'Mercado à Vista', '-', 'BTG', 'CART3', 100, 12, 1200],
      ['16/07/2026', 'Compra', 'Renda Fixa', '-', 'BTG', 'LFTS11', 4, 156.4, 625.6],
      ['18/03/2026', 'Compra', 'Futuro', '15/04/2026', 'GENIAL', 'WINJ26', 1, 181815, 36363],
      ['02/06/2026', 'Compra', 'Opção de Compra sobre Ações', '19/06/2026', 'BTG', 'CARTF999', 100, 0.1, 10],
    ]);
    const ler = await pedir('carla', 'POST', '/api/extrato-b3/ler', { arquivo: { nome: 'negociacao.xlsx', conteudo: xlsx.toString('base64') } });
    assert.equal(ler.status, 200, JSON.stringify(ler.corpo));
    const p = ler.corpo;
    assert.equal(p.negocios.length, 9);
    assert.deepEqual(p.ignorados.map((i: any) => i.motivo), ['futuro']);
    assert.deepEqual(p.anosPendentes, [2026]);
    const ex = p.negocios.find((n: any) => n.mercado === 'exercicio_compra');
    assert.deepEqual([ex.codigo, ex.acao, ex.strike, ex.tipo], ['CARTG150', 'CART3', 1500, 'call']);
    assert.ok(p.negocios.find((n: any) => n.codigo === 'CARTF999').falta.includes('strike'));
    const novos = p.negocios.filter((n: any) => !n.ja && !n.falta.length);
    assert.equal(novos.length, 8);
    const imp = await pedir('carla', 'POST', '/api/extrato-b3/importar', { negocios: novos });
    assert.equal(imp.status, 201, JSON.stringify(imp.corpo));
    assert.deepEqual(imp.corpo, { inseridos: 8, jaExistiam: 0, exercicios: 1, viraramPo: 1 });
    const g = (await pedir('carla', 'GET', '/api/carteira')).corpo.grupos;
    const cart = g.find((x: any) => x.ativoObjeto === 'CART3');
    assert.deepEqual(cart.itens.filter((i: any) => !i.vencida).map((i: any) => [i.codigo, i.quantidade]), [['CART3', 110], ['CARTL145', -100]]);
    assert.equal(g.find((x: any) => x.ativoObjeto === 'LFTS11').itens[0].quantidade, 4);
    assert.deepEqual([cart.classe, g.find((x: any) => x.ativoObjeto === 'LFTS11').classe], ['acoes', 'renda_fixa']);
    // Lucros e perdas das opções: a put vendida que virou pó ficou com 100% do prêmio.
    const opc = (await pedir('carla', 'GET', '/api/carteira')).corpo.opcoes;
    const put = opc.series.find((o: any) => o.codigo === 'CARTT130');
    assert.deepEqual([put.lado, put.base, put.resultado, put.fracao, put.encerrada], ['vendida', 2000, 2000, 1, true]);
    assert.equal(opc.encerradas.series, 2);
    // O mesmo extrato de novo: tudo já está no sistema.
    const de_novo = (await pedir('carla', 'POST', '/api/extrato-b3/ler', { arquivo: { nome: 'negociacao.xlsx', conteudo: xlsx.toString('base64') } })).corpo;
    assert.equal(de_novo.negocios.filter((n: any) => !n.ja && !n.falta.length).length, 0);
    const imp2 = await pedir('carla', 'POST', '/api/extrato-b3/importar', { negocios: novos });
    assert.deepEqual([imp2.corpo.inseridos, imp2.corpo.jaExistiam], [0, 8]);
    // Nota do mesmo negócio (03/11, 100 CART3 a 14,00): completa os custos, não duplica.
    const notaDe = NOTA.filter(([, y]) => y !== 584).map(([x, y, t]) => [x, y,
      t === '987654' ? '444001' : t === '24/11/2026' ? '03/11/2026' : t === '200' ? '100' : t === '14,34' ? '14,00' : t === '2.868,00' ? '1.400,00' : t === '2.794,90' ? '1.400,90' : t,
    ] as [number, number, string]);
    const lida = (await pedir('carla', 'POST', '/api/notas/ler', { arquivos: [{ nome: 'n.pdf', conteudo: pdfDeNota(notaDe).toString('base64') }] })).corpo.notas[0];
    assert.equal(lida.conferida, true, JSON.stringify(lida));
    assert.equal((await pedir('carla', 'POST', '/api/notas/importar', { notas: [lida] })).status, 201);
    const cart2 = (await pedir('carla', 'GET', '/api/carteira')).corpo.grupos.find((x: any) => x.ativoObjeto === 'CART3');
    const acao = cart2.itens.find((i: any) => i.codigo === 'CART3');
    assert.equal(acao.quantidade, 110);
    assert.ok(acao.precoMedioComCustos > acao.precoMedio, 'os custos da nota entraram no preço médio');
  });
});
