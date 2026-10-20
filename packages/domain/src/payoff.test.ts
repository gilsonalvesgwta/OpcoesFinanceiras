// Casos de referência calculados à mão (valores em centavos, lote de 100).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisarPayoff, curvaDePayoff, ErroDePosicao, fluxoDeMontagem, resultadoNoVencimento, type Perna } from './payoff.ts';

const V = '2026-11-20';
const call = (lado: 'compra' | 'venda', strike: number, preco: number, quantidade = 100, extra: Partial<Perna> = {}): Perna =>
  ({ tipo: 'call', lado, strike, preco, quantidade, vencimento: V, ...extra });
const put = (lado: 'compra' | 'venda', strike: number, preco: number, quantidade = 100, extra: Partial<Perna> = {}): Perna =>
  ({ tipo: 'put', lado, strike, preco, quantidade, vencimento: V, ...extra });
const acao = (lado: 'compra' | 'venda', preco: number, quantidade = 100): Perna => ({ tipo: 'ativo', lado, preco, quantidade });

test('compra de call: débito, equilíbrio no strike + prêmio, lucro ilimitado', () => {
  const p = [call('compra', 3000, 150)];
  assert.deepEqual(fluxoDeMontagem(p), { bruto: -15000, custos: 0, liquido: -15000 });
  assert.equal(resultadoNoVencimento(p, 3500), 35000);
  assert.equal(resultadoNoVencimento(p, 2800), -15000);
  const a = analisarPayoff(p);
  assert.deepEqual(a.pontosDeEquilibrio, [31.5]);
  assert.deepEqual(a.lucroMaximo, { tipo: 'ilimitado' });
  assert.deepEqual(a.perdaMaxima, { tipo: 'limitado', valor: -15000, emPreco: 0 });
});

test('venda de put: crédito, perda limitada pelo preço zero (não ilimitada)', () => {
  const a = analisarPayoff([put('venda', 3000, 120)]);
  assert.equal(a.fluxo.liquido, 12000);
  assert.deepEqual(a.pontosDeEquilibrio, [28.8]);
  assert.deepEqual(a.lucroMaximo, { tipo: 'limitado', valor: 12000, emPreco: 3000 });
  assert.deepEqual(a.perdaMaxima, { tipo: 'limitado', valor: -288000, emPreco: 0 });
});

test('venda coberta: ação + call vendida', () => {
  const a = analisarPayoff([acao('compra', 3000), call('venda', 3200, 80)]);
  assert.equal(a.fluxo.liquido, -292000);
  assert.deepEqual(a.pontosDeEquilibrio, [29.2]);
  assert.deepEqual(a.lucroMaximo, { tipo: 'limitado', valor: 28000, emPreco: 3200 });
  assert.deepEqual(a.perdaMaxima, { tipo: 'limitado', valor: -292000, emPreco: 0 });
  assert.equal(a.inclinacaoAcimaDoUltimoStrike, 0);
});

test('trava de alta com calls (débito)', () => {
  const a = analisarPayoff([call('compra', 3000, 200), call('venda', 3300, 70)]);
  assert.equal(a.fluxo.liquido, -13000);
  assert.deepEqual(a.pontosDeEquilibrio, [31.3]);
  assert.deepEqual(a.lucroMaximo, { tipo: 'limitado', valor: 17000, emPreco: 3300 });
  assert.deepEqual(a.perdaMaxima, { tipo: 'limitado', valor: -13000, emPreco: 0 });
});

test('straddle vendido: dois equilíbrios e perda ilimitada', () => {
  const a = analisarPayoff([call('venda', 3000, 150), put('venda', 3000, 140)]);
  assert.equal(a.fluxo.liquido, 29000);
  assert.deepEqual(a.pontosDeEquilibrio, [27.1, 32.9]);
  assert.deepEqual(a.lucroMaximo, { tipo: 'limitado', valor: 29000, emPreco: 3000 });
  assert.deepEqual(a.perdaMaxima, { tipo: 'ilimitado' });
});

test('iron condor: crédito, perda limitada pela largura das asas', () => {
  const a = analisarPayoff([put('compra', 2600, 20), put('venda', 2800, 60), call('venda', 3200, 55), call('compra', 3400, 15)]);
  assert.equal(a.fluxo.liquido, 8000);
  assert.deepEqual(a.pontosDeEquilibrio, [27.2, 32.8]);
  assert.deepEqual(a.lucroMaximo, { tipo: 'limitado', valor: 8000, emPreco: 2800 });
  assert.equal(a.perdaMaxima.tipo, 'limitado');
  assert.equal(a.perdaMaxima.tipo === 'limitado' && a.perdaMaxima.valor, -12000);
});

test('custos entram no resultado e deslocam o equilíbrio', () => {
  const a = analisarPayoff([call('compra', 3000, 150, 100, { custos: 1000 })]);
  assert.deepEqual(a.fluxo, { bruto: -15000, custos: 1000, liquido: -16000 });
  assert.deepEqual(a.pontosDeEquilibrio, [31.6]);
});

test('equilíbrio fora do centavo exato sai com 4 casas, em reais', () => {
  const a = analisarPayoff([call('compra', 3000, 150, 300, { custos: 100 })]);
  assert.deepEqual(a.pontosDeEquilibrio, [31.5033]);
});

test('segmento plano sobre o zero vira faixa, não ponto', () => {
  const a = analisarPayoff([call('compra', 3000, 0)]);
  assert.deepEqual(a.faixasNoZero, [{ de: 0, ate: 30 }]);
  assert.deepEqual(a.pontosDeEquilibrio, []);
});

test('multiplicador diferente de 1 é respeitado', () => {
  assert.equal(resultadoNoVencimento([call('compra', 3000, 150, 1, { multiplicador: 100 })], 3500), 35000);
});

test('pernas com vencimentos diferentes são recusadas pelo payoff no vencimento', () => {
  assert.throws(() => analisarPayoff([call('compra', 3000, 150), call('venda', 3200, 80, 100, { vencimento: '2026-12-18' })]), ErroDePosicao);
});

test('entradas inválidas são recusadas, não viram zero', () => {
  assert.throws(() => analisarPayoff([]), /posicao_vazia/);
  assert.throws(() => analisarPayoff([call('compra', 3000, 150, 0)]), /quantidade_invalida/);
  assert.throws(() => analisarPayoff([{ tipo: 'call', lado: 'compra', quantidade: 100, preco: 150, vencimento: V }]), /strike_invalido/);
  assert.throws(() => analisarPayoff([call('compra', 3000, 1.5)]), /preco_invalido/);
  assert.throws(() => resultadoNoVencimento([call('compra', 3000, 150)], -1), /preco_negativo/);
});

test('curva inclui as quinas dos strikes', () => {
  const curva = curvaDePayoff([call('compra', 3050, 150)], 2500, 3500, 4);
  assert.ok(curva.some((p) => p.s === 3050 && p.resultado === -15000));
  assert.equal(curva[0]?.s, 2500);
  assert.equal(curva.at(-1)?.s, 3500);
  const comAjuste = curvaDePayoff([call('compra', 3050, 150)], 2500, 3500, 4, 5000);
  assert.ok(comAjuste.some((p) => p.s === 3050 && p.resultado === -10000), 'o ajuste (já realizado) entra na curva');
});
