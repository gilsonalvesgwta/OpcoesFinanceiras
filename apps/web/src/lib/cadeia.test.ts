import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dentroDoDinheiro, montarLinhas, pontosDoSorriso, preco, vol, type Serie } from './cadeia.ts';

const s = (codigo: string, tipo: 'call' | 'put', strike: number, negocios = 1, calc = true): Serie => ({
  codigo, tipo, strike, ultimo: 100, bid: 99, ask: 101, negocios, quantidade: 100,
  calculo: calc ? { volImplicita: 0.3, precoTeorico: 1, delta: 0.5, gamma: 0.1, theta: -0.01, vega: 0.05, rho: 0.01, premio: 100, origemPremio: 'meio_do_livro', diasUteis: 24, selic: 14.9 } : { motivo: 'sem_premio' },
});

test('linhas por strike, faixa em torno do preço e a linha no dinheiro', () => {
  const series = [s('C34', 'call', 3400), s('C38', 'call', 3800), s('P38', 'put', 3800), s('C42', 'call', 4200, 0), s('P50', 'put', 5000)];
  const l = montarLinhas(series, 3847, 10, false);
  assert.deepEqual(l.map((x) => [x.strike, x.call?.codigo ?? null, x.put?.codigo ?? null, x.noDinheiro]), [
    [3800, 'C38', 'P38', true],
    [4200, 'C42', null, false],
  ]);
  assert.deepEqual(montarLinhas(series, 3847, 'todas', true).map((x) => x.strike), [3400, 3800, 5000], 'só com negócios');
  assert.equal(montarLinhas(series, null, 10, false).length, 4, 'sem preço do ativo: sem faixa');
});

test('no mesmo strike fica a série mais negociada', () => {
  const l = montarLinhas([s('A', 'call', 3800, 5), s('B', 'call', 3800, 50)], 3800, 'todas', false);
  assert.equal(l[0]?.call?.codigo, 'B');
});

test('dentro do dinheiro, sorriso e formatos', () => {
  assert.equal(dentroDoDinheiro('call', 3600, 3800), true);
  assert.equal(dentroDoDinheiro('put', 3600, 3800), false);
  const l = montarLinhas([s('C', 'call', 3800), s('P', 'put', 3800, 1, false)], 3800, 'todas', false);
  assert.deepEqual(pontosDoSorriso(l, 'call'), [{ strike: 3800, vol: 0.3 }]);
  assert.deepEqual(pontosDoSorriso(l, 'put'), []);
  assert.equal(vol(0.3215), '32,2%');
  assert.equal(preco(93), '0,93');
  assert.equal(preco(null), '—');
});
