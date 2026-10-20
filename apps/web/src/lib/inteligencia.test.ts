import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultaDoHistorico, descreverCriterios, lerVolatilidade, rotuloDaVariacao } from './inteligencia.ts';

test('critérios guardados em texto simples', () => {
  assert.equal(descreverCriterios({}), 'nenhum definido (todas as séries entram)');
  assert.equal(descreverCriterios({ diasMin: 20, diasMax: 60, deltaMax: 0.3, creditoMinimo: 5000, strike: 'acima', perdaMaximaNaoAumenta: true }),
    'vence entre 20 e 60 dias, delta entre 0 e 0,3, crédito de pelo menos R$ 50,00, strike acima do atual, perda máxima não aumenta');
  assert.equal(descreverCriterios({ diasMin: 30 }), 'vence em 30 dias ou mais');
});

test('consulta do histórico', () => {
  const todos = ['operacao', 'rolagem', 'alerta', 'posicao'] as const;
  assert.deepEqual(consultaDoHistorico({ tipos: [...todos], codigo: '', de: '', ate: '' }), { ok: true, consulta: '' });
  assert.deepEqual(consultaDoHistorico({ tipos: ['posicao', 'operacao'], codigo: 'petr', de: '2026-10-01', ate: '2026-10-31' }, 'csv'),
    { ok: true, consulta: 'tipos=operacao%2Cposicao&codigo=PETR&de=2026-10-01&ate=2026-10-31&formato=csv' });
  assert.equal(consultaDoHistorico({ tipos: [], codigo: '', de: '', ate: '' }).ok, false);
  assert.equal(consultaDoHistorico({ tipos: [...todos], codigo: 'PE-TR', de: '', ate: '' }).ok, false);
  assert.equal(consultaDoHistorico({ tipos: [...todos], codigo: '', de: '2026-11-01', ate: '2026-10-01' }).ok, false);
});

test('cenários: rótulos e volatilidade digitada', () => {
  assert.equal(rotuloDaVariacao(-0.1), '−10%');
  assert.equal(rotuloDaVariacao(0.05), '+5%');
  assert.equal(rotuloDaVariacao(0), 'Igual');
  assert.deepEqual(lerVolatilidade(''), { ok: true, volPct: null });
  assert.deepEqual(lerVolatilidade('35,5%'), { ok: true, volPct: 35.5 });
  assert.equal(lerVolatilidade('0').ok, false);
  assert.equal(lerVolatilidade('abc').ok, false);
});
