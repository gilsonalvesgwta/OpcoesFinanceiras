import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caixaDaMontagem, curvaDaSimulacao, equilibriosDaCurva, extremosDaCurva, faixaDaSimulacao, gregasDaSimulacao, resultadoDaSimulacao,
  valorDaPerna, vencimentosDaSimulacao, type AvaliacaoDaSimulacao, type PernaSimulada,
} from './simulador.ts';
import { analisarPayoff } from './payoff.ts';
import { blackScholes } from './modelo.ts';

const NOV = '2026-11-23';
const DEZ = '2026-12-18';
const call = (codigo: string, k: number, venc: string, lado: 'compra' | 'venda', preco: number, vol: number | null = 0.3): PernaSimulada =>
  ({ codigo, tipo: 'call', strike: k, vencimento: venc, lado, quantidade: 100, preco, vol });
const restam = (porVenc: Record<string, number>) => (v: string) => porVenc[v] ?? 0;
const noVencimento: AvaliacaoDaSimulacao = { taxa: 0.14, restam: restam({}) };

test('no vencimento, bate com o payoff exato (trava de alta)', () => {
  const trava = [call('K38', 3800, NOV, 'compra', 120), call('K40', 4000, NOV, 'venda', 50)];
  assert.equal(caixaDaMontagem(trava), -7000);
  const curva = curvaDaSimulacao(trava, 3000, 5000, noVencimento, 40);
  const exata = analisarPayoff(trava.map(({ vol: _v, codigo: _c, ...p }) => p));
  assert.deepEqual(equilibriosDaCurva(curva).map((s) => s / 100), exata.pontosDeEquilibrio);
  const { maximo, minimo } = extremosDaCurva(curva);
  assert.equal(maximo?.valor, 13000);
  assert.equal(minimo?.valor, -7000);
});

test('antes do vencimento: Black-Scholes com os pregões que faltam e o deslocamento de vol', () => {
  const p = call('K40', 4000, NOV, 'compra', 100);
  const a: AvaliacaoDaSimulacao = { taxa: 0.14, restam: restam({ [NOV]: 20 }) };
  const esperado = blackScholes({ tipo: 'call', s: 39, k: 40, t: 20 / 252, r: 0.14, sigma: 0.3 }).preco * 100;
  assert.ok(Math.abs((valorDaPerna(p, 3900, a) as number) - esperado) < 1e-9);
  const maisVol = valorDaPerna(p, 3900, { ...a, deslocamentoDeVol: 0.1 }) as number;
  assert.ok(maisVol > esperado, 'mais volatilidade, call mais cara');
});

test('calendário: vencimentos diferentes, avaliado no primeiro vencimento', () => {
  const cal = [call('K40', 4000, NOV, 'venda', 80), call('L40', 4000, DEZ, 'compra', 160)];
  assert.deepEqual(vencimentosDaSimulacao(cal), [NOV, DEZ]);
  const a: AvaliacaoDaSimulacao = { taxa: 0.14, restam: restam({ [NOV]: 0, [DEZ]: 18 }) };
  const curva = curvaDaSimulacao(cal, 3000, 5000, a, 50);
  const { maximo } = extremosDaCurva(curva);
  assert.ok(maximo && Math.abs(maximo.emPreco - 4000) <= 50, `máximo perto do strike: ${maximo?.emPreco}`);
  assert.equal(equilibriosDaCurva(curva).length, 2, 'dois equilíbrios, um de cada lado');
});

test('sem volatilidade numa opção viva: null com o código, nunca zero', () => {
  const a: AvaliacaoDaSimulacao = { taxa: 0.14, restam: restam({ [NOV]: 10 }) };
  assert.deepEqual(resultadoDaSimulacao([call('K40', 4000, NOV, 'compra', 100, null)], 4000, a), { resultado: null, semVol: ['K40'] });
  assert.deepEqual(resultadoDaSimulacao([call('K40', 4000, NOV, 'compra', 100, null)], 4200, noVencimento).resultado, 10000, 'vencida: intrínseco, sem vol');
  assert.deepEqual(gregasDaSimulacao([call('K40', 4000, NOV, 'compra', 100, null)], 4000, a).semVol, ['K40']);
});

test('gregas somadas: venda coberta', () => {
  const vc: PernaSimulada[] = [
    { codigo: 'X3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3800, vol: null },
    call('K40', 4000, NOV, 'venda', 80),
  ];
  const g = gregasDaSimulacao(vc, 3900, { taxa: 0.14, restam: restam({ [NOV]: 20 }) });
  const x = blackScholes({ tipo: 'call', s: 39, k: 40, t: 20 / 252, r: 0.14, sigma: 0.3 });
  assert.equal(g.delta, Math.round((100 - 100 * x.delta) * 100) / 100);
  assert.ok(g.theta > 0, 'vendido em opção: o tempo ajuda');
  assert.ok(g.vega < 0, 'vendido em opção: volatilidade atrapalha');
});

test('faixa do gráfico cobre o ativo e os strikes', () => {
  assert.deepEqual(faixaDaSimulacao([call('K', 6000, NOV, 'compra', 1)], 4000), { de: 3000, ate: 6600 });
});
