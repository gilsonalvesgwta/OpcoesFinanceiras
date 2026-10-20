import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeDeCenarios, resultadoNoCenario, type PremissasDoCenario } from './cenarios.ts';
import { blackScholes } from './modelo.ts';
import { montarCarteira } from './posicoes.ts';

const t = (m: number) => new Date(Date.UTC(2026, 9, 1, 13, m)).toISOString();
// Venda coberta: 100 ações a 38,00, call 40,00 vendida a 0,80, custos 10,00.
const carteira = montarCarteira([
  { codigo: 'X3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3800, instante: t(1) },
  { codigo: 'XK400', tipo: 'call', strike: 4000, vencimento: '2026-11-23', lado: 'venda', quantidade: 100, preco: 80, custos: 1000, instante: t(2) },
]);
const p: PremissasDoCenario = { taxa: 0.14, vol: () => 0.3, diasDePregaoAte: () => 25 };

test('no vencimento vale o intrínseco: bate com o payoff', () => {
  // A 42,00: ação +400, call −(200 − 0,80) × 100 = −120, custos −10 → +270,00.
  assert.deepEqual(resultadoNoCenario(carteira, 4200, 25, p), { resultado: 27000, semVol: [] });
  assert.deepEqual(resultadoNoCenario(carteira, 3700, 30, p), { resultado: -10000 + 8000 - 1000, semVol: [] });
});

test('antes do vencimento: Black-Scholes com o tempo que sobra', () => {
  const call = blackScholes({ tipo: 'call', s: 39, k: 40, t: 15 / 252, r: 0.14, sigma: 0.3 }).preco * 100;
  const esperado = Math.round(100 * (3900 - 3800) - 100 * (call - 80) - 1000);
  assert.deepEqual(resultadoNoCenario(carteira, 3900, 10, p), { resultado: esperado, semVol: [] });
});

test('sem volatilidade: null com o código que faltou, nunca zero', () => {
  assert.deepEqual(resultadoNoCenario(carteira, 3900, 0, { ...p, vol: () => null }), { resultado: null, semVol: ['XK400'] });
  assert.equal(resultadoNoCenario(carteira, 0, 0, p).resultado, null);
});

test('grade de preços × momentos', () => {
  const g = gradeDeCenarios(carteira, 4000, [-0.1, 0, 0.1], [{ rotulo: 'Hoje', pregoes: 0 }, { rotulo: 'Vencimento', pregoes: 25 }], p);
  assert.deepEqual(g.precos, [3600, 4000, 4400]);
  assert.equal(g.linhas[2]?.resultados[1], 27000, 'a 44,00 no vencimento: ganho travado no strike');
  assert.ok((g.linhas[0]?.resultados[0] as number) < (g.linhas[2]?.resultados[0] as number));
  assert.deepEqual(g.semVol, []);
});
