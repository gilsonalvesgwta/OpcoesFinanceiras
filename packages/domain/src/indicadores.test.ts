import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atr, indicadoresDoMomento, mediaSimples, rsi, type Barra } from './indicadores.ts';

test('média simples', () => {
  assert.equal(mediaSimples([1, 2, 3, 4], 2), 3.5);
  assert.equal(mediaSimples([1, 2], 3), null);
});

test('RSI de Wilder: valor de referência (Wilder, 14 períodos)', () => {
  // Série clássica do livro de Wilder / StockCharts: RSI(14) do 15º fechamento ≈ 70,46.
  const s = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  assert.ok(Math.abs((rsi(s, 14) as number) - 70.46) < 0.05, `rsi ${rsi(s, 14)}`);
  // Próximo fechamento 46.00: RSI ≈ 66,25 (suavização de Wilder).
  assert.ok(Math.abs((rsi([...s, 46.0], 14) as number) - 66.25) < 0.1, `rsi ${rsi([...s, 46.0], 14)}`);
  assert.equal(rsi([1, 2, 3], 14), null);
  assert.equal(rsi(Array(20).fill(10), 14), 50);
});

test('ATR: amplitude verdadeira com gap', () => {
  const b = (max: number, min: number, f: number): Barra => ({ dia: '', maxima: max, minima: min, fechamento: f, quantidade: 1 });
  // TR: [12-10=2, |15-11|=4 (gap), 2]; ATR(3) = média = 8/3.
  assert.ok(Math.abs((atr([b(11, 9, 10), b(12, 10, 11), b(15, 14, 15), b(16, 14, 15)], 3) as number) - 8 / 3) < 1e-9);
  assert.equal(atr([b(11, 9, 10)], 3), null);
});

test('indicadores do momento: rompimento, médias, volume e ATR; sem histórico fica null', () => {
  const hist: Barra[] = Array.from({ length: 30 }, (_, i) => ({ dia: `d${i}`, maxima: 3900, minima: 3700, fechamento: 3800, quantidade: 1000 }));
  const v = indicadoresDoMomento(hist, 3939, 2500);
  assert.equal(v.dist_media_20_pct, 3.66);
  assert.equal(v.dist_maxima_20_pct, 1, 'acima da máxima de 20 pregões: rompimento');
  assert.equal(v.dist_minima_20_pct, 6.46);
  assert.equal(v.volume_relativo_20, 2.5);
  assert.equal(v.variacao_em_atr, 0.7, '(39,39 - 38,00) / 2,00');
  assert.equal(v.dist_media_50_pct, null, 'só 30 pregões: sem média de 50');
  assert.equal(v.rsi_14, 100);
  const nada = indicadoresDoMomento([], 3939, 2500);
  assert.ok(Object.values(nada).every((x) => x === null));
  assert.ok(Object.values(indicadoresDoMomento(hist, null, null)).every((x) => x === null));
  // Barra sem fechamento corta a série: só valem as barras depois dela.
  const cortado = [...hist.slice(0, 25), { dia: 'x', maxima: null, minima: null, fechamento: null, quantidade: null }, ...hist.slice(0, 4)];
  assert.equal(indicadoresDoMomento(cortado, 3939, 2500).dist_media_20_pct, null);
});
