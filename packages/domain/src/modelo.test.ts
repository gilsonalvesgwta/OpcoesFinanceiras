// Referências: exemplos clássicos de Hull, "Options, Futures and Other Derivatives".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anosUteis, blackScholes, normalAcumulada, taxaContinua, volatilidadeImplicita } from './modelo.ts';

const perto = (a: number, b: number, tol: number, nome: string) => assert.ok(Math.abs(a - b) <= tol, `${nome}: ${a} ≠ ${b}`);

test('normal acumulada nos pontos conhecidos', () => {
  perto(normalAcumulada(0), 0.5, 1e-7, 'N(0)');
  perto(normalAcumulada(1.96), 0.9750021, 1e-6, 'N(1,96)');
  perto(normalAcumulada(-1), 0.1586553, 1e-6, 'N(-1)');
});

test('preço de call e put (S=42, K=40, r=10%, σ=20%, T=0,5): 4,76 e 0,81', () => {
  const base = { s: 42, k: 40, r: 0.1, sigma: 0.2, t: 0.5 };
  perto(blackScholes({ ...base, tipo: 'call' }).preco, 4.76, 0.005, 'call');
  perto(blackScholes({ ...base, tipo: 'put' }).preco, 0.81, 0.005, 'put');
});

test('gregas da call (S=49, K=50, r=5%, σ=20%, T=0,3846)', () => {
  const g = blackScholes({ tipo: 'call', s: 49, k: 50, r: 0.05, sigma: 0.2, t: 0.3846 });
  perto(g.preco, 2.40, 0.01, 'preço');
  perto(g.delta, 0.522, 0.001, 'delta');
  perto(g.gamma, 0.066, 0.001, 'gamma');
  perto(g.vega * 100, 12.1, 0.05, 'vega por 100%');
  perto(g.theta * 252, -4.31, 0.01, 'theta ao ano');
  perto(g.rho * 100, 8.91, 0.01, 'rho por 100%');
});

test('paridade put-call vale para o modelo', () => {
  const base = { s: 37.2, k: 38, r: taxaContinua(0.15), sigma: 0.32, t: anosUteis(23) };
  const c = blackScholes({ ...base, tipo: 'call' }).preco;
  const p = blackScholes({ ...base, tipo: 'put' }).preco;
  perto(c - p, base.s - base.k * Math.exp(-base.r * base.t), 1e-9, 'paridade');
});

test('volatilidade implícita recupera a volatilidade usada', () => {
  const base = { tipo: 'put' as const, s: 37.2, k: 36, r: 0.13, t: anosUteis(30) };
  const premio = blackScholes({ ...base, sigma: 0.41 }).preco;
  const r = volatilidadeImplicita(premio, base);
  assert.ok(r.ok);
  if (r.ok) perto(r.sigma, 0.41, 1e-4, 'sigma');
});

test('prêmio abaixo do valor intrínseco não inventa volatilidade', () => {
  const r = volatilidadeImplicita(0.5, { tipo: 'call', s: 40, k: 35, r: 0.1, t: 0.1 });
  assert.deepEqual(r, { ok: false, motivo: 'abaixo_do_valor_intrinseco' });
});

test('entradas inválidas são recusadas', () => {
  assert.throws(() => blackScholes({ tipo: 'call', s: 40, k: 40, r: 0.1, sigma: 0, t: 0.1 }), /sigma_invalido/);
  assert.throws(() => blackScholes({ tipo: 'call', s: 40, k: 40, r: 0.1, sigma: 0.2, t: 0 }), /t_invalido/);
  assert.throws(() => anosUteis(0), /dias_uteis_invalidos/);
});
