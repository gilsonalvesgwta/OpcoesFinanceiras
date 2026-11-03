import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalaDoPainel, extremosComAgora, marcasDeTempo, marcasDeValor, variacao } from './painel.ts';

test('variação contra o fechamento anterior', () => {
  const v = variacao(16299, 16540);
  assert.equal(v?.valor, -241);
  assert.ok(Math.abs((v?.fracao ?? 0) + 0.01457) < 0.0001);
  assert.equal(variacao(100, null), null);
  assert.equal(variacao(null, 100), null);
});

test('máxima e mínima incluem o preço de agora', () => {
  assert.deepEqual(extremosComAgora(16389, 16281, 16270), { maxima: 16389, minima: 16270 });
  assert.deepEqual(extremosComAgora(null, null, 100), { maxima: 100, minima: 100 });
});

test('escala do 1D cobre o pregão inteiro e o fechamento anterior', () => {
  const pontos = [{ t: '2026-11-03T13:00:00Z', p: 16300 }, { t: '2026-11-03T13:54:00Z', p: 16299 }];
  const e = escalaDoPainel(pontos, '1D', '2026-11-03', { abertura: '10:00', fechamento: '17:00' }, 16540);
  assert.ok(e);
  assert.equal(e?.t0, Date.parse('2026-11-03T10:00:00-03:00'));
  assert.equal(e?.t1, Date.parse('2026-11-03T17:00:00-03:00'));
  assert.ok((e?.v1 ?? 0) > 16540, 'fechamento anterior dentro da escala');
  assert.match(e?.caminho ?? '', /^M[\d.]+,[\d.]+ L/);
  assert.equal(escalaDoPainel([], '1D', '2026-11-03', null, null), null);
  const marcas = marcasDeTempo(e?.t0 as number, e?.t1 as number, '1D').map((x) => x.rotulo);
  assert.deepEqual(marcas, ['10:00', '12:00', '14:00', '16:00']);
});

test('eixo de preço em valores redondos', () => {
  assert.deepEqual(marcasDeValor(16191, 16540), [16100, 16200, 16300, 16400, 16500, 16600]);
  assert.deepEqual(marcasDeValor(3910, 3980), [3900, 3920, 3940, 3960, 3980]);
  assert.ok(marcasDeValor(100, 100).length > 1);
});
