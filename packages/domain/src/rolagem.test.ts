import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarCarteira, type Execucao } from './posicoes.ts';
import { compararRolagens, simularRolagem } from './rolagem.ts';

const NOV = '2026-11-20';
const DEZ = '2026-12-18';
const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 13, min)).toISOString();

// Venda coberta: 100 PETR4 a 30,00 e 100 calls 32,00 de novembro vendidas a 0,80.
const vendaCoberta: Execucao[] = [
  { codigo: 'PETR4', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3000, instante: t(1) },
  { codigo: 'PETRK320', tipo: 'call', strike: 3200, vencimento: NOV, lado: 'venda', quantidade: 100, preco: 80, instante: t(2) },
];

test('rolagem para cima e para frente com débito: números e avisos', () => {
  const carteira = montarCarteira(vendaCoberta);
  const r = simularRolagem(carteira, {
    instante: t(10),
    encerrar: [{ codigo: 'PETRK320', quantidade: 100, preco: 140 }],
    abrir: [{ codigo: 'PETRL340', tipo: 'call', strike: 3400, vencimento: DEZ, lado: 'venda', quantidade: 100, preco: 100 }],
  });
  assert.deepEqual(r.fluxo, { encerramento: -14000, abertura: 10000, custos: 0, liquido: -4000, natureza: 'debito' });
  assert.equal(r.realizadoNoEncerramento, -6000);
  assert.deepEqual(r.realizadoAcumulado, { antes: 0, depois: -6000 });
  // Estratégia depois: ação 30,00 + call 34,00 vendida a 1,00 + realizado −60,00.
  assert.deepEqual(r.payoff.depois?.pontosDeEquilibrio, [29.6]);
  assert.deepEqual(r.payoff.depois?.lucroMaximo, { tipo: 'limitado', valor: 40000 - 6000 + 10000, emPreco: 3400 });
  assert.deepEqual(r.payoff.antes?.pontosDeEquilibrio, [29.2]);
  assert.deepEqual(r.ultimoVencimento, { antes: NOV, depois: DEZ });
  assert.deepEqual(r.avisos.sort(), ['perda_maxima_aumentou', 'prazo_prolongado']);
  // Histórico preservado: a carteira original não mudou e a rolagem virou duas execuções.
  assert.equal(carteira.get('PETRK320')?.quantidade, -100);
  assert.equal(r.execucoes.length, 2);
  assert.equal(r.execucoes[0]?.lado, 'compra');
});

test('rolagem com crédito que dobra a quantidade vendida não é tratada como lucro', () => {
  const carteira = montarCarteira([
    { codigo: 'PETRW300', tipo: 'put', strike: 3000, vencimento: NOV, lado: 'venda', quantidade: 100, preco: 120, instante: t(1) },
  ]);
  const r = simularRolagem(carteira, {
    instante: t(10),
    encerrar: [{ codigo: 'PETRW300', quantidade: 100, preco: 30 }],
    abrir: [{ codigo: 'PETRX290', tipo: 'put', strike: 2900, vencimento: DEZ, lado: 'venda', quantidade: 200, preco: 40, custos: 300 }],
  });
  assert.equal(r.fluxo.natureza, 'credito');
  assert.equal(r.fluxo.liquido, -3000 + 8000 - 300);
  assert.equal(r.realizadoNoEncerramento, 9000);
  for (const aviso of ['credito_nao_e_lucro', 'quantidade_aumentou', 'perda_maxima_aumentou', 'prazo_prolongado'] as const) {
    assert.ok(r.avisos.includes(aviso), aviso);
  }
  // Perda máxima da estratégia depois: 200 × 29,00 vendidos + 80,00 de prêmio + 90,00 realizados − 3,00 de custos.
  assert.deepEqual(r.payoff.depois?.perdaMaxima, { tipo: 'limitado', valor: -580000 + 8000 + 9000 - 300, emPreco: 0 });
});

test('encerramento parcial mantém o restante aberto', () => {
  const carteira = montarCarteira(vendaCoberta);
  const r = simularRolagem(carteira, { instante: t(10), encerrar: [{ codigo: 'PETRK320', quantidade: 40, preco: 50 }], abrir: [] });
  assert.equal(r.carteiraDepois.get('PETRK320')?.quantidade, -60);
  assert.equal(r.realizadoNoEncerramento, 40 * 30);
  assert.equal(r.fluxo.natureza, 'debito');
});

test('troca para vencimentos misturados avisa que o payoff no vencimento não se aplica', () => {
  const carteira = montarCarteira(vendaCoberta);
  const r = simularRolagem(carteira, {
    instante: t(10),
    encerrar: [{ codigo: 'PETRK320', quantidade: 50, preco: 100 }],
    abrir: [{ codigo: 'PETRL340', tipo: 'call', strike: 3400, vencimento: DEZ, lado: 'venda', quantidade: 50, preco: 90, estimativa: true }],
  });
  assert.equal(r.payoff.depois, null);
  assert.ok(r.avisos.includes('payoff_indisponivel'));
  assert.ok(r.avisos.includes('usa_preco_estimado'));
});

test('pedidos impossíveis são recusados', () => {
  const carteira = montarCarteira(vendaCoberta);
  assert.throws(() => simularRolagem(carteira, { instante: t(10), encerrar: [], abrir: [] }), /rolagem_vazia/);
  assert.throws(() => simularRolagem(carteira, { instante: t(10), encerrar: [{ codigo: 'PETRK320', quantidade: 101, preco: 50 }], abrir: [] }), /quantidade_a_encerrar_invalida/);
  assert.throws(() => simularRolagem(carteira, { instante: t(10), encerrar: [{ codigo: 'VALEK600', quantidade: 1, preco: 50 }], abrir: [] }), /nada_aberto/);
});

test('o comparador mantém a ordem e não elege vencedor pelo crédito', () => {
  const carteira = montarCarteira(vendaCoberta);
  const base = { instante: t(10), encerrar: [{ codigo: 'PETRK320', quantidade: 100, preco: 140 }] };
  const lista = compararRolagens(carteira, [
    { nome: 'A', pedido: { ...base, abrir: [{ codigo: 'PETRL340', tipo: 'call', strike: 3400, vencimento: DEZ, lado: 'venda', quantidade: 100, preco: 100 }] } },
    { nome: 'B', pedido: { ...base, abrir: [{ codigo: 'PETRL320', tipo: 'call', strike: 3200, vencimento: DEZ, lado: 'venda', quantidade: 100, preco: 220 }] } },
    { nome: 'C', pedido: { ...base, encerrar: [{ codigo: 'PETRK320', quantidade: 999, preco: 1 }], abrir: [] } },
  ]);
  assert.deepEqual(lista.map((l) => l.nome), ['A', 'B', 'C']);
  assert.equal(lista[1]?.ok && lista[1].resultado.fluxo.natureza, 'credito');
  assert.equal(lista[2]?.ok, false);
});
