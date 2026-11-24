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
    for (const quem of ['ana', 'beto']) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, `${quem}.cart.${sufixo}@exemplo.test`, quem, hash]);
    }
    await dono.query("insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values ('CARTL145', '2026-12-18', 'CART3', 'call', 1450, '2026-11-23', '2026-11-23') on conflict do nothing");
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
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
});
