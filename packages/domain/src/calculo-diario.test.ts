import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularDoFechamento, premioDoFechamento, type EntradaDoCalculoDiario } from './calculo-diario.ts';
import { anosUteis, blackScholes, taxaContinua } from './modelo.ts';
import type { ConfiguracaoDoCalendario } from './calendario.ts';

const cfg: ConfiguracaoDoCalendario = {
  feriados: new Set(['2026-11-02', '2026-11-20']), sessaoPadrao: { abertura: '10:00', fechamento: '17:00' }, sessoesEspeciais: new Map(),
};
// De 16/10 (sexta) a 23/11 (segunda): 26 dias de semana, menos 02/11 e 20/11 = 24 pregões.
const base: EntradaDoCalculoDiario = {
  dia: '2026-10-16', tipo: 'call', strike: 3800, vencimento: '2026-11-23', ultimo: null, bid: null, ask: null, ativoObjeto: 3847, selic: 14.9,
};

test('prêmio: meio do livro quando o spread é razoável; senão o último negócio', () => {
  assert.deepEqual(premioDoFechamento(92, 95, 93), { valor: 93.5, origem: 'meio_do_livro' });
  assert.deepEqual(premioDoFechamento(10, 40, 30), { valor: 30, origem: 'ultimo_negocio' }); // spread de 120% do meio
  assert.deepEqual(premioDoFechamento(null, 95, 93), { valor: 93, origem: 'ultimo_negocio' });
  assert.deepEqual(premioDoFechamento(96, 95, 93), { valor: 93, origem: 'ultimo_negocio' }); // livro cruzado não vale
  assert.equal(premioDoFechamento(null, null, null), null);
});

test('recupera a volatilidade usada para gerar o prêmio, e as gregas batem com o modelo', () => {
  const sigma = 0.32;
  const t = anosUteis(24);
  const r = taxaContinua(0.149);
  const teorico = blackScholes({ tipo: 'call', s: 38.47, k: 38, t, r, sigma });
  const premio = Math.round(teorico.preco * 100); // em centavos, como no arquivo
  const c = calcularDoFechamento({ ...base, ultimo: premio }, cfg);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.diasUteis, 24);
  assert.equal(c.origem, 'ultimo_negocio');
  assert.ok(Math.abs(c.volImplicita - sigma) < 0.003, `vol ${c.volImplicita}`);
  assert.ok(Math.abs(c.gregas.delta - teorico.delta) < 0.005);
  assert.ok(c.gregas.theta < 0, 'call comprada perde valor com o tempo');
  assert.ok(Math.abs(c.taxaContinua - Math.log(1.149)) < 1e-12);
});

test('put também, com delta negativo', () => {
  const t = anosUteis(24);
  const r = taxaContinua(0.149);
  const teorico = blackScholes({ tipo: 'put', s: 38.47, k: 36, t, r, sigma: 0.4 });
  const c = calcularDoFechamento({ ...base, tipo: 'put', strike: 3600, bid: Math.floor(teorico.preco * 100), ask: Math.ceil(teorico.preco * 100) }, cfg);
  assert.ok(c.ok && c.origem === 'meio_do_livro' && c.gregas.delta < 0 && Math.abs(c.volImplicita - 0.4) < 0.01);
});

test('sem dado não calcula e diz o porquê', () => {
  assert.equal(calcularDoFechamento({ ...base, ultimo: 150 }, cfg).ok, true);
  assert.deepEqual(calcularDoFechamento(base, cfg), { ok: false, motivo: 'sem_premio', diasUteis: 24 });
  assert.deepEqual(calcularDoFechamento({ ...base, ultimo: 93, ativoObjeto: null }, cfg), { ok: false, motivo: 'sem_ativo_objeto', diasUteis: 24 });
  assert.deepEqual(calcularDoFechamento({ ...base, ultimo: 93, selic: null }, cfg), { ok: false, motivo: 'sem_selic', diasUteis: 24 });
  assert.deepEqual(calcularDoFechamento({ ...base, ultimo: 93, vencimento: '2026-10-16' }, cfg), { ok: false, motivo: 'vence_no_dia', diasUteis: 0 });
  assert.deepEqual(calcularDoFechamento({ ...base, ultimo: 93, vencimento: '2026-10-15' }, cfg), { ok: false, motivo: 'vencida', diasUteis: null });
  // Prêmio abaixo do valor intrínseco descontado (call muito dentro do dinheiro a 1 centavo).
  assert.equal((calcularDoFechamento({ ...base, strike: 2000, ultimo: 1 }, cfg) as { motivo: string }).motivo, 'abaixo_do_valor_intrinseco');
});
