import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarExecucao, exposicoes, montarCarteira, pernasAbertas, resumoDeResultado, type Execucao } from './posicoes.ts';
import type { Cotacao } from './cotacoes.ts';

const V = '2026-11-20';
let minuto = 0;
const ex = (codigo: string, lado: 'compra' | 'venda', quantidade: number, preco: number, extra: Partial<Execucao> = {}): Execucao => {
  minuto += 1;
  const opcao = codigo !== 'PETR4';
  return {
    codigo, lado, quantidade, preco,
    tipo: opcao ? (/^PETR[A-L]/.test(codigo) ? 'call' : 'put') : 'ativo',
    ...(opcao ? { strike: 3200, vencimento: V } : {}),
    instante: new Date(Date.UTC(2026, 9, 1, 13, minuto)).toISOString(),
    ...extra,
  };
};
const cot = (codigo: string, bid: number | null, ask: number | null, ultimo: number | null = null): Cotacao => ({
  codigo, provedor: 'teste', bid, ask, ultimo, referencia: null, volume: null, negocios: null,
  instanteDaFonte: '2026-10-01T14:00:00Z', instanteDeRecebimento: '2026-10-01T14:00:01Z',
});

test('preço médio nas compras e resultado realizado na venda parcial', () => {
  const c = montarCarteira([ex('PETR4', 'compra', 100, 3000), ex('PETR4', 'compra', 100, 3200), ex('PETR4', 'venda', 50, 3500)]);
  const i = c.get('PETR4')!;
  assert.equal(i.quantidade, 150);
  assert.equal(i.precoMedio, 3100);
  assert.equal(i.realizadoBruto, 50 * (3500 - 3100));
});

test('opção vendida: recompra mais barata realiza ganho, mais cara realiza perda', () => {
  const ganho = montarCarteira([ex('PETRK320', 'venda', 100, 80), ex('PETRK320', 'compra', 100, 30)]).get('PETRK320')!;
  assert.equal(ganho.quantidade, 0);
  assert.equal(ganho.realizadoBruto, 5000);
  const perda = montarCarteira([ex('PETRK320', 'venda', 100, 80), ex('PETRK320', 'compra', 100, 150)]).get('PETRK320')!;
  assert.equal(perda.realizadoBruto, -7000);
});

test('execução maior que a posição vira de lado com o preço novo', () => {
  const i = montarCarteira([ex('PETR4', 'compra', 100, 3000), ex('PETR4', 'venda', 300, 3100)]).get('PETR4')!;
  assert.equal(i.quantidade, -200);
  assert.equal(i.precoMedio, 3100);
  assert.equal(i.realizadoBruto, 10000);
});

test('aplicar não altera a carteira original (histórico preservado)', () => {
  const c1 = montarCarteira([ex('PETR4', 'compra', 100, 3000)]);
  const c2 = aplicarExecucao(c1, ex('PETR4', 'venda', 100, 3100));
  assert.equal(c1.get('PETR4')!.quantidade, 100);
  assert.equal(c2.get('PETR4')!.quantidade, 0);
});

test('não realizado usa o lado executável: bid para comprada, ask para vendida', () => {
  const c = montarCarteira([ex('PETR4', 'compra', 100, 3000), ex('PETRK320', 'venda', 100, 80, { custos: 500 })]);
  const r = resumoDeResultado(c, new Map([['PETR4', cot('PETR4', 3090, 3100)], ['PETRK320', cot('PETRK320', 50, 60)]]));
  assert.equal(r.naoRealizadoEstimado, 100 * (3090 - 3000) + -100 * (60 - 80));
  assert.equal(r.custosPagos, 500);
  assert.equal(r.usaEstimativa, false);
});

test('sem o lado executável o não realizado fica null, nunca zero', () => {
  const c = montarCarteira([ex('PETRK320', 'venda', 100, 80)]);
  const r = resumoDeResultado(c, new Map([['PETRK320', cot('PETRK320', 50, null, 55)]]));
  assert.equal(r.naoRealizadoEstimado, null);
  assert.deepEqual(r.instrumentosSemPreco, ['PETRK320']);
  const comUltimo = resumoDeResultado(c, new Map([['PETRK320', cot('PETRK320', 50, null, 55)]]), 'executavel_ou_ultimo');
  assert.equal(comUltimo.naoRealizadoEstimado, 2500);
  assert.equal(comUltimo.usaEstimativa, true);
});

test('pernas abertas alimentam o payoff', () => {
  const c = montarCarteira([ex('PETR4', 'compra', 100, 3000), ex('PETRK320', 'venda', 100, 80), ex('PETRK320', 'compra', 100, 40)]);
  const pernas = pernasAbertas(c);
  assert.equal(pernas.length, 1);
  assert.equal(pernas[0]?.tipo, 'ativo');
});

test('exposição aponta call vendida descoberta', () => {
  const c = montarCarteira([ex('PETR4', 'compra', 100, 3000), ex('PETRK320', 'venda', 300, 80)]);
  const e = exposicoes(c, () => 'PETR4').find((g) => g.vencimento === V)!;
  assert.equal(e.quantidadeLiquidaCalls, -300);
  assert.equal(e.callsVendidasDescobertas, 200);
  assert.equal(e.nocionalStrikes, 300 * 3200);
});

test('execução inválida é recusada', () => {
  assert.throws(() => montarCarteira([ex('PETR4', 'compra', 0, 3000)]), /quantidade_invalida/);
  assert.throws(() => montarCarteira([ex('PETRK320', 'compra', 100, 30, { strike: undefined as unknown as number })]), /opcao_sem_strike/);
  assert.throws(() => montarCarteira([ex('PETR4', 'compra', 100, 3000, { instante: 'ontem' })]), /instante_invalido/);
});
