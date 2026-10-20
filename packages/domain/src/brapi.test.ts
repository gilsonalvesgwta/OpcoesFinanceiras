import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultasPorCiclo, lerRespostaDaBrapi } from './brapi.ts';

test('resposta v2: centavos, hora e fechamento anterior pela variação', () => {
  const r = lerRespostaDaBrapi({ results: [{ requestedSymbol: 'PETR4', symbol: 'PETR4', changed: false, data: {
    regularMarketPrice: 41.18, regularMarketChange: 0.43, regularMarketVolume: 34024700, regularMarketTime: '2026-06-14T17:08:02.000Z' } }] }, 'PETR4');
  assert.deepEqual(r, { ok: true, cotacao: { codigo: 'PETR4', ultimo: 4118, fechamentoAnterior: 4075, volume: 34024700, instante: '2026-06-14T17:08:02.000Z' } });
});

test('formato antigo e hora em segundos', () => {
  const r = lerRespostaDaBrapi({ results: [{ symbol: 'VALE3', regularMarketPrice: 61, regularMarketPreviousClose: 60.5, regularMarketTime: 1781456882 }] }, 'VALE3');
  assert.ok(r.ok);
  assert.deepEqual([r.cotacao.ultimo, r.cotacao.fechamentoAnterior, r.cotacao.volume, r.cotacao.instante], [6100, 6050, null, new Date(1781456882000).toISOString()]);
});

test('sem preço ou sem hora: recusa, nunca zero', () => {
  assert.deepEqual(lerRespostaDaBrapi({ results: [{ symbol: 'X', data: { regularMarketPrice: 0, regularMarketTime: '2026-06-14T17:08:02Z' } }] }, 'X'), { ok: false, motivo: 'sem_preco' });
  assert.deepEqual(lerRespostaDaBrapi({ results: [{ symbol: 'X', data: { regularMarketPrice: 10 } }] }, 'X'), { ok: false, motivo: 'sem_horario' });
  assert.deepEqual(lerRespostaDaBrapi({ error: true, message: 'x' }, 'X'), { ok: false, motivo: 'sem_resultado' });
});

test('cota do mês dividida pelos ciclos que faltam', () => {
  // 14 000 consultas, 20 pregões, 46 ciclos por pregão: 15 por ciclo.
  assert.equal(consultasPorCiclo({ restanteNoMes: 14000, pregoesRestantes: 20, ciclosPorPregao: 46, maximo: 30 }), 15);
  assert.equal(consultasPorCiclo({ restanteNoMes: 14000, pregoesRestantes: 1, ciclosPorPregao: 46, maximo: 20 }), 20, 'teto por ciclo');
  assert.equal(consultasPorCiclo({ restanteNoMes: 10, pregoesRestantes: 20, ciclosPorPregao: 46, maximo: 20 }), 1, 'pelo menos uma enquanto houver cota');
  assert.equal(consultasPorCiclo({ restanteNoMes: 0, pregoesRestantes: 20, ciclosPorPregao: 46, maximo: 20 }), 0);
});
