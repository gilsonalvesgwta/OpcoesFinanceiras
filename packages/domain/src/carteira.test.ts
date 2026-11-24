import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidarCarteira, lotesAbertos, resultadoEmAberto, strikeParaOLote } from './carteira.ts';

test('preço médio com custos (Receita): compras somam custos; venda parcial realiza sem mudar o médio', () => {
  // Notas da BTG: 200 BBAS3 a 15,12 (custos 0,89) e 100 a 14,12 (custos 0,41).
  const [p] = consolidarCarteira([
    { codigo: 'BBAS3', tipo: 'ativo', lado: 'compra', quantidade: 200, preco: 1512, custos: 89, instante: '2026-11-16T13:00:00Z' },
    { codigo: 'BBAS3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 1412, custos: 41, instante: '2026-11-19T13:00:00Z' },
  ]);
  assert.equal(p?.quantidade, 300);
  assert.equal(p?.precoMedio, 1478.67); // (200×15,12 + 100×14,12) / 300
  assert.equal(p?.precoMedioComCustos, 1479.1); // (302400 + 89 + 141200 + 41) / 300 = 1479,10
  assert.equal(p?.custoDaPosicao, 443730);
  const [q] = consolidarCarteira([
    { codigo: 'BBAS3', tipo: 'ativo', lado: 'compra', quantidade: 200, preco: 1512, custos: 89, instante: '2026-11-16T13:00:00Z' },
    { codigo: 'BBAS3', tipo: 'ativo', lado: 'venda', quantidade: 100, preco: 1600, custos: 40, instante: '2026-11-20T13:00:00Z' },
  ]);
  assert.equal(q?.quantidade, 100);
  assert.equal(q?.precoMedioComCustos, 1512.45);
  assert.equal(q?.realizadoBruto, 8800);
  assert.equal(q?.realizadoLiquido, 8716); // 100×(16,00 − 15,12445) − 0,40 = 87,155 → 87,16
});

test('opção lançada: prêmio líquido vira o médio; recompra realiza', () => {
  const [c] = consolidarCarteira([
    { codigo: 'BBASL145W1', tipo: 'call', strike: 1450, vencimento: '2026-12-04', lado: 'venda', quantidade: 200, preco: 37, custos: 10, instante: '2026-11-24T13:54:00Z' },
  ]);
  assert.equal(c?.quantidade, -200);
  assert.equal(c?.precoMedioComCustos, 36.95);
  const r = resultadoEmAberto(c as never, 20);
  assert.equal(r.valor, 3390);
  assert.ok(Math.abs((r.fracao ?? 0) - 3390 / 7390) < 1e-9);
});

test('lotes: um por compra, vendas abatem dos mais antigos, preço com custos de cada lote', () => {
  const ex = [
    { codigo: 'BBAS3', tipo: 'ativo' as const, lado: 'compra' as const, quantidade: 100, preco: 2145, custos: 50, instante: '2026-10-01T13:00:00Z' },
    { codigo: 'BBAS3', tipo: 'ativo' as const, lado: 'compra' as const, quantidade: 300, preco: 2015, custos: 90, instante: '2026-10-10T13:00:00Z' },
    { codigo: 'BBAS3', tipo: 'ativo' as const, lado: 'compra' as const, quantidade: 200, preco: 1900, custos: 0, instante: '2026-10-20T13:00:00Z' },
    { codigo: 'BBAS3', tipo: 'ativo' as const, lado: 'venda' as const, quantidade: 150, preco: 2200, custos: 0, instante: '2026-11-01T13:00:00Z' },
    { codigo: 'BBASL210', tipo: 'call' as const, strike: 2100, vencimento: '2026-12-18', lado: 'venda' as const, quantidade: 100, preco: 40, custos: 0, instante: '2026-11-02T13:00:00Z' },
  ];
  const lotes = lotesAbertos(ex).get('BBAS3') ?? [];
  assert.deepEqual(lotes.map((l) => [l.quantidadeOriginal, l.quantidade, l.preco, l.precoComCustos]), [
    [300, 250, 2015, 2015.3], // o lote de 100 saiu inteiro e 50 deste
    [200, 200, 1900, 1900],
  ]);
  assert.equal(lotesAbertos(ex).has('BBASL210'), false);
  assert.equal(lotes.reduce((t, l) => t + l.quantidade, 0), consolidarCarteira(ex).find((p) => p.codigo === 'BBAS3')?.quantidade);
  // venda maior que a posição zera os lotes
  assert.deepEqual(lotesAbertos([...ex, { codigo: 'BBAS3', tipo: 'ativo', lado: 'venda', quantidade: 9999, preco: 2000, instante: '2026-11-05T13:00:00Z' }]).get('BBAS3'), []);
});

test('strike sugerido para cobrir o lote: o menor que não fica abaixo do custo', () => {
  const series = [{ codigo: 'A', strike: 1950 }, { codigo: 'B', strike: 2050 }, { codigo: 'C', strike: 2150 }, { codigo: 'D', strike: 2016 }];
  assert.equal(strikeParaOLote(2015.3, series)?.codigo, 'D');
  assert.equal(strikeParaOLote(2145.5, series)?.codigo, 'C');
  assert.equal(strikeParaOLote(1800, series)?.codigo, 'A');
  assert.equal(strikeParaOLote(2200, series), null);
});
