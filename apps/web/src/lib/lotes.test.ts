import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalaDosLotes, lerLote, linkParaSimularLote } from './lotes.ts';

test('régua dos lotes: folga nas pontas e marcas redondas', () => {
  const { x, marcas } = escalaDosLotes([2015, 2145, 2031, 2100], 40, 960);
  assert.ok(x(2015) > 40 && x(2145) < 960);
  assert.ok(x(2015) < x(2031) && x(2031) < x(2145));
  assert.deepEqual(marcas, [2050, 2100, 2150]);
  assert.ok(marcas.length >= 2 && marcas.length <= 7);
  const um = escalaDosLotes([1000], 0, 100);
  assert.ok(um.x(1000) > 0 && um.x(1000) < 100);
});

test('link para simular o lote e leitura do ?lote', () => {
  const href = linkParaSimularLote('BBAS3', { quantidade: 300, precoComCustos: 2015.3 }, { codigo: 'BBASL210', vencimento: '2026-12-18' });
  assert.equal(href, '/simulador?ativo=BBAS3&vencimento=2026-12-18&lote=300%3A2015&montar=BBASL210%3Avenda');
  const q = new URLSearchParams(href.split('?')[1]);
  assert.deepEqual(lerLote(q.get('lote')), { quantidade: 300, preco: 2015 });
  assert.equal(lerLote('abc'), null);
  assert.equal(lerLote('0:10'), null);
});
