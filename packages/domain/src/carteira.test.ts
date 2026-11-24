import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidarCarteira, resultadoEmAberto } from './carteira.ts';

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
