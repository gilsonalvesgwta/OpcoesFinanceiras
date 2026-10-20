import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descreverCondicao, descreverRearme, textoDoAviso, valoresDaCotacao } from './alertas-texto.ts';

test('condição em português, com reais e percentuais', () => {
  assert.equal(descreverCondicao({ tipo: 'comparacao', campo: 'ultimo', operador: 'cruza_acima', valor: 3850 }), 'último preço cruzar para cima de R$ 38,50');
  assert.equal(descreverCondicao({ tipo: 'comparacao', campo: 'variacao_dia_pct', operador: '<=', valor: -3 }), 'variação do dia igual ou abaixo de -3%');
  assert.equal(descreverCondicao({ tipo: 'comparacao', campo: 'ultimo', operador: 'fora', valor: 3700, valor2: 3900 }), 'último preço fora da faixa de R$ 37,00 e R$ 39,00');
  assert.equal(descreverCondicao({
    tipo: 'e', filhos: [
      { tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 3800 },
      { tipo: 'ou', filhos: [{ tipo: 'comparacao', campo: 'volume', operador: '>', valor: 1000000 }, { tipo: 'comparacao', campo: 'bid', operador: '>=', valor: 3790 }] },
    ],
  }), 'último preço acima de R$ 38,00 e (volume do dia acima de 1.000.000 ou melhor oferta de compra igual ou acima de R$ 37,90)');
  assert.equal(descreverCondicao({ tipo: 'comparacao', campo: 'rsi_14', operador: 'cruza_abaixo', valor: 30 }), 'RSI de 14 dias cruzar para baixo de 30');
  assert.equal(descreverCondicao({ tipo: 'comparacao', campo: 'dist_maxima_20_pct', operador: 'cruza_acima', valor: 0 }), 'distância da máxima de 20 pregões cruzar para cima de 0%');
  assert.equal(descreverCondicao({ tipo: 'comparacao', campo: 'volume_relativo_20', operador: '>=', valor: 2 }), 'volume em relação à média de 20 pregões igual ou acima de 2 vezes');
  assert.equal(descreverRearme({ tipo: 'intervalo', minutos: 30 }), 'avisa de novo depois de 30 minutos, se ainda valer');
});

test('texto do aviso: escapa o que o usuário escreveu e diz fonte e qualidade', () => {
  const t = textoDoAviso({
    codigo: 'PETR4', nomeDaRegra: 'Rompimento <topo> & cia', fonte: 'MetaTrader 5',
    condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'cruza_acima', valor: 3850 },
    obs: { instante: '2026-10-16T17:52:07Z', qualidade: 'tempo_real', valores: { ultimo: 3852, bid: 3851, ask: null } },
  });
  assert.equal(t, [
    '<b>PETR4</b>: último preço cruzar para cima de R$ 38,50',
    'Último: R$ 38,52',
    'Compra R$ 38,51 · Venda —',
    'Às 14:52:07 (tempo real, MetaTrader 5)',
    'Regra: Rompimento &lt;topo&gt; &amp; cia',
  ].join('\n'));
});

test('valores da cotação para as regras: variação em %, ausente fica null', () => {
  assert.deepEqual(valoresDaCotacao({ ultimo: 3847, bid: 3846, ask: null, volume: 1000, fechamentoAnterior: 3800 }),
    { ultimo: 3847, bid: 3846, ask: null, volume: 1000, variacao_dia_pct: 1.24 });
  assert.equal(valoresDaCotacao({ ultimo: null, bid: null, ask: null, volume: null, fechamentoAnterior: 3800 }).variacao_dia_pct, null);
});
