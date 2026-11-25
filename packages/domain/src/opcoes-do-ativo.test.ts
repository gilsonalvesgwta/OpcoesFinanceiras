import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fluxoDasOpcoes, mesesNoPeriodo } from './opcoes-do-ativo.ts';

test('opções do ativo: prêmio líquido por mês e saldo acumulado (com custos)', () => {
  const { operacoes, meses } = fluxoDasOpcoes([
    { codigo: 'BBASK196', tipo: 'call', strike: 1960, vencimento: '2026-11-19', lado: 'venda', quantidade: 100, preco: 52, custos: 10, instante: '2026-10-13T13:00:00Z' },
    { codigo: 'BBASK196', tipo: 'call', strike: 1960, vencimento: '2026-11-19', lado: 'compra', quantidade: 100, preco: 10, custos: 5, instante: '2026-11-03T13:00:00Z' },
    { codigo: 'BBASL150', tipo: 'call', strike: 1500, vencimento: '2026-12-18', lado: 'venda', quantidade: 200, preco: 30, instante: '2026-11-10T13:00:00Z' },
    { codigo: 'BBAS3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 1412, instante: '2026-11-10T13:00:00Z' },
  ]);
  assert.deepEqual(operacoes.map((o) => [o.data, o.total, o.saldo]), [['2026-10-13', 5190, 5190], ['2026-11-03', -1005, 4185], ['2026-11-10', 6000, 10185]]);
  assert.deepEqual(meses.map((m) => [m.mes, m.vendas, m.compras, m.custos, m.liquido, m.operacoes]), [['2026-10', 5200, 0, 10, 5190, 1], ['2026-11', 6000, 1000, 5, 4995, 2]]);
  assert.equal(mesesNoPeriodo('2025-11', '2026-11'), 13);
});
