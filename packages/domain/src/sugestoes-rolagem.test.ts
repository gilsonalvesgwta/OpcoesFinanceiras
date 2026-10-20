import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarCandidato, precoParaAbrir, resumoDaAvaliacao, spreadPct, type CandidatoDeRolagem } from './sugestoes-rolagem.ts';
import type { Cotacao } from './cotacoes.ts';

const cot = (bid: number | null, ask: number | null, ultimo: number | null): Cotacao => ({
  codigo: 'X', provedor: 't', ultimo, bid, ask, referencia: null, volume: null, negocios: null, instanteDaFonte: null, instanteDeRecebimento: '2026-10-16T17:00:00Z',
});

test('preço para abrir: venda recebe o bid, compra paga o ask; sem lado, último como estimativa', () => {
  assert.deepEqual(precoParaAbrir(cot(98, 102, 100), 'venda'), { ok: true, valor: 98, origem: 'bid', estimativa: false });
  assert.deepEqual(precoParaAbrir(cot(98, 102, 100), 'compra'), { ok: true, valor: 102, origem: 'ask', estimativa: false });
  assert.equal(precoParaAbrir(cot(null, 102, 100), 'venda').ok, false);
  assert.deepEqual(precoParaAbrir(cot(null, 102, 100), 'venda', 'executavel_ou_ultimo'), { ok: true, valor: 100, origem: 'ultimo', estimativa: true });
});

test('spread relativo ao meio', () => {
  assert.equal(spreadPct(90, 110), 20);
  assert.equal(spreadPct(null, 110), null);
  assert.equal(spreadPct(110, 90), null);
});

const base: CandidatoDeRolagem = { codigo: 'PETRL340', strike: 3400, strikeAtual: 3200, dias: 35, delta: -0.31, negocios: 120, bid: 95, ask: 105, liquido: 2500, perdaMaximaPiorou: false };

test('critérios atendidos, não atendidos e sem dado', () => {
  const a = avaliarCandidato(base, { diasMin: 20, diasMax: 45, deltaMin: 0.2, deltaMax: 0.35, creditoMinimo: 2000, negociosMin: 50, spreadMaximoPct: 15, strike: 'acima', perdaMaximaNaoAumenta: true });
  assert.ok(a.every((x) => x.situacao === 'atendido'), JSON.stringify(a));
  assert.equal(a.find((x) => x.criterio === 'dias')?.texto, 'vence entre 20 e 45 dias');
  assert.equal(a.find((x) => x.criterio === 'creditoMinimo')?.texto, 'crédito de pelo menos R$ 20,00');
  assert.deepEqual(resumoDaAvaliacao(a), { atendidos: 7, naoAtendidos: 0, semDado: 0, todos: true });

  const b = avaliarCandidato({ ...base, delta: null, liquido: -500, negocios: null, strike: 3200 }, { deltaMax: 0.3, debitoMaximo: 300, negociosMin: 1, strike: 'manter', creditoMinimo: 0 });
  const s = Object.fromEntries(b.map((x) => [x.criterio, x.situacao]));
  assert.deepEqual(s, { delta: 'sem_dado', creditoMinimo: 'nao_atendido', debitoMaximo: 'nao_atendido', negociosMin: 'sem_dado', strike: 'atendido' });
  assert.deepEqual(resumoDaAvaliacao(b), { atendidos: 1, naoAtendidos: 2, semDado: 2, todos: false });
  assert.deepEqual(avaliarCandidato(base, {}), [], 'sem critério, nada a avaliar');
  assert.equal(avaliarCandidato({ ...base, liquido: null }, { debitoMaximo: 100 })[0]?.situacao, 'sem_dado', 'sem preço: sem dado, nunca zero');
});
