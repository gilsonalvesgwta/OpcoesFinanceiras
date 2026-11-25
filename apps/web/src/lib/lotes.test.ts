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

test('faixas dos lotes: no máximo 8, com quantidade, custo médio e a call do lote mais caro', async () => {
  const { faixasDosLotes, passoDasFaixas } = await import('./lotes.ts');
  const lote = (data: string, quantidade: number, precoComCustos: number, strike: number | null) => ({
    instante: data, data, quantidadeOriginal: quantidade, quantidade, preco: Math.round(precoComCustos), precoComCustos, custo: Math.round(quantidade * precoComCustos),
    resultado: null, resultadoFracao: null,
    sugestao: strike === null ? null : { codigo: `BBAS${strike}`, strike, vencimento: '2026-12-18', dias: 23, premio: 40, origemDoPremio: 'bid' as const, qualidade: null, receita: null, premioFracao: null, seExercido: null, seExercidoFracao: null },
  });
  const f = faixasDosLotes([lote('a', 100, 1412, 1450), lote('b', 200, 1434, 1450), lote('c', 200, 1512, 1550), lote('d', 100, 2850, 2900)], 1416, 1914);
  assert.equal(passoDasFaixas(1412, 2850), 200);
  assert.deepEqual(f.map((x) => [x.de, x.ate, x.quantidade, x.lotes.length, x.sugestao?.strike]), [[1400, 1600, 500, 3, 1550], [2800, 3000, 100, 1, 2900]]);
  assert.equal(f[0]?.temAgora, true);
  assert.equal(f[0]?.sugestao?.receitaDaFaixa, 500 * 40);
  assert.equal(f[0]?.sugestao?.seExercidoDaFaixa, 500 * 1550 - (141200 + 286800 + 302400) + 20000);
});
