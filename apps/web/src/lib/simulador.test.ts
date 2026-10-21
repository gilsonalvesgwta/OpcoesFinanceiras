import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultadoDaSimulacao } from '@wta/domain';
import {
  adicionarPerna, avaliacaoNaData, configDoCalendario, diasEntre, escalaDoGrafico, execucoesParaApi, pernaDaSerie, pernaDoAtivo, pernaQueEncerra,
  precoDeMercado, resultadoEmPreco, somarDias, type SerieDaCadeia,
} from './simulador.ts';

const cot = (bid: number | null, ask: number | null, ultimo: number | null) => ({ bid, ask, ultimo, qualidade: 'historico', provedor: 'b3-cotahist', instanteDaFonte: null });
const serie: SerieDaCadeia = { codigo: 'PETRK400', tipo: 'call', strike: 4000, negocios: 10, vol: 0.3, delta: 0.4, cotacao: cot(120, 130, 125) };
const cfg = configDoCalendario({ feriados: [{ dia: '2026-11-20' }], sessoesEspeciais: [], sessaoPadrao: { abertura: '10:00', fechamento: '17:00' } });

test('preço de mercado para montar', () => {
  assert.deepEqual(precoDeMercado(cot(120, 130, 125), 'compra'), { preco: 130, origem: 'ask' });
  assert.deepEqual(precoDeMercado(cot(120, 130, 125), 'venda'), { preco: 120, origem: 'bid' });
  assert.deepEqual(precoDeMercado(cot(null, null, 125), 'venda'), { preco: 125, origem: 'ultimo' });
  assert.equal(precoDeMercado(cot(null, null, null), 'venda'), null);
  assert.equal(precoDeMercado(null, 'compra'), null);
});

test('pernas: da cadeia, do ativo, somando e encerrando', () => {
  const v = pernaDaSerie(serie, '2026-11-23', 'venda');
  assert.deepEqual([v.lado, v.preco, v.vol, v.quantidade, v.strike], ['venda', 120, 0.3, 100, 4000]);
  const soma = adicionarPerna([v], { ...pernaDaSerie(serie, '2026-11-23', 'venda', 300), preco: 100 });
  assert.equal(soma.length, 1);
  assert.deepEqual([soma[0]?.quantidade, soma[0]?.preco], [400, 105], 'preço médio ponderado');
  assert.equal(adicionarPerna([{ ...v, base: true }], pernaDaSerie(serie, '2026-11-23', 'venda')).length, 2, 'a posição da carteira não se mistura com o ajuste');
  const zera = pernaQueEncerra({ ...v, base: true }, 130);
  assert.deepEqual([zera.lado, zera.quantidade, zera.preco, zera.base], ['compra', 100, 130, undefined]);
  assert.deepEqual([pernaDoAtivo('PETR4', cot(3899, 3901, 3900), 'compra').preco], [3901]);
});

test('datas e pregões até o vencimento', () => {
  assert.equal(somarDias('2026-10-30', 3), '2026-11-02');
  assert.equal(diasEntre('2026-10-21', '2026-11-23'), 33);
  const a = avaliacaoNaData('2026-11-16', cfg, 14.9);
  assert.equal(a.restam('2026-11-23'), 4, '17, 18, 19 e 23 (20 é feriado)');
  assert.equal(a.restam('2026-11-16'), 0);
  assert.equal(avaliacaoNaData('2026-11-16', cfg, 14.9, 5).deslocamentoDeVol, 0.05);
});

test('montar e desmontar a mesma perna dá o custo da diferença de preço', () => {
  const compra = { ...pernaDaSerie(serie, '2026-11-23', 'compra'), base: true };
  const venda = pernaQueEncerra(compra, 120);
  const a = avaliacaoNaData('2026-10-21', cfg, 14.9);
  assert.equal(resultadoDaSimulacao([compra, venda], 3900, a).resultado, -1000, 'comprou a 1,30 e vendeu a 1,20');
});

test('gráfico: linha interrompida onde falta resultado; leitura num preço', () => {
  const pontos = [{ s: 100, resultado: -10 }, { s: 200, resultado: 10 }, { s: 300, resultado: null }, { s: 400, resultado: 30 }, { s: 500, resultado: 40 }];
  const g = escalaDoGrafico([{ nome: 'a', pontos }]);
  assert.ok(g);
  assert.equal((g.caminhos[0]?.match(/M/g) ?? []).length, 2, 'dois trechos');
  assert.equal(resultadoEmPreco(pontos, 150), 0);
  assert.equal(resultadoEmPreco(pontos, 250), null);
  assert.equal(resultadoEmPreco(pontos, 450), 35);
});

test('corpo para guardar: só o que é novo, em centavos', () => {
  const base = { ...pernaDaSerie(serie, '2026-11-23', 'compra'), base: true };
  const nova = { ...pernaDaSerie(serie, '2026-11-23', 'venda'), preco: 120.4 };
  assert.deepEqual(execucoesParaApi([base, nova, pernaDoAtivo('PETR4', cot(1, 2, 2), 'compra')]), [
    { codigo: 'PETRK400', tipo: 'call', lado: 'venda', quantidade: 100, preco: 120, strike: 4000, vencimento: '2026-11-23', vol: 0.3 },
    { codigo: 'PETR4', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 2 },
  ]);
});
