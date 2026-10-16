// Testes de cotações, instrumentos, calendário e dinheiro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precoParaEncerrar, problemasDaCotacao, qualidadeDaCotacao, spreadRelativo, type Cotacao, type PerfilDoProvedor } from './cotacoes.ts';
import { lerCodigoDeOpcao, pareceAtivoObjeto, validarContrato } from './instrumentos.ts';
import { diasDePregaoEntre, situacaoDoMercado, terceiraSexta, vencimentoMensal, type ConfiguracaoDoCalendario } from './calendario.ts';
import { formatarReais, reaisParaCentavos, somar } from './dinheiro.ts';

const agora = new Date('2026-10-15T15:00:00Z'); // 12:00 em Brasília
const cot = (extra: Partial<Cotacao> = {}): Cotacao => ({
  codigo: 'PETR4', provedor: 'brapi', ultimo: 3850, bid: 3849, ask: 3851, referencia: null, volume: 1000, negocios: 10,
  instanteDaFonte: new Date(agora.getTime() - 4 * 60_000).toISOString(), instanteDeRecebimento: agora.toISOString(), ...extra,
});
const periodico: PerfilDoProvedor = { nome: 'brapi', modo: 'periodico', intervaloSeg: 300 };
const ctx = { agora, mercadoAberto: true, provedorConectado: true };

test('qualidade: periódica em dia, atrasada, desconectada, indisponível, histórico, simulado', () => {
  assert.equal(qualidadeDaCotacao(cot(), periodico, ctx), 'periodica');
  assert.equal(qualidadeDaCotacao(cot({ instanteDaFonte: new Date(agora.getTime() - 11 * 60_000).toISOString() }), periodico, ctx), 'atrasada');
  assert.equal(qualidadeDaCotacao(cot(), periodico, { ...ctx, provedorConectado: false }), 'desconectado');
  assert.equal(qualidadeDaCotacao(cot({ ultimo: null, bid: null, ask: null }), periodico, ctx), 'indisponivel');
  assert.equal(qualidadeDaCotacao(null, periodico, ctx), 'indisponivel');
  assert.equal(qualidadeDaCotacao(cot(), { nome: 'brapi', modo: 'fim_de_dia', intervaloSeg: 86400 }, ctx), 'historico');
  assert.equal(qualidadeDaCotacao(cot(), periodico, { ...ctx, mercadoAberto: false }), 'historico');
  assert.equal(qualidadeDaCotacao(cot(), { nome: 'mock', modo: 'simulado', intervaloSeg: 1 }, ctx), 'simulado');
  assert.equal(qualidadeDaCotacao(cot({ instanteDaFonte: null }), periodico, ctx), 'atrasada');
  assert.equal(qualidadeDaCotacao(cot({ instanteDaFonte: new Date(agora.getTime() - 2_000).toISOString() }), { nome: 'rt', modo: 'tempo_real', intervaloSeg: 5 }, ctx), 'tempo_real');
});

test('preço de encerramento e spread', () => {
  assert.deepEqual(precoParaEncerrar(cot(), 'comprada'), { ok: true, valor: 3849, origem: 'bid', estimativa: false });
  assert.deepEqual(precoParaEncerrar(cot(), 'vendida'), { ok: true, valor: 3851, origem: 'ask', estimativa: false });
  assert.deepEqual(precoParaEncerrar(cot(), 'comprada', 'medio'), { ok: true, valor: 3850, origem: 'medio', estimativa: true });
  assert.deepEqual(precoParaEncerrar(cot({ bid: 0 }), 'comprada'), { ok: false, motivo: 'sem_bid' });
  assert.equal(spreadRelativo(cot({ bid: 90, ask: 110 })), 0.2);
  assert.equal(spreadRelativo(cot({ bid: null })), null);
});

test('sanidade da cotação', () => {
  assert.deepEqual(problemasDaCotacao(cot()), []);
  assert.deepEqual(problemasDaCotacao(cot({ bid: 3900, ask: 3800 })), ['book_cruzado']);
  assert.deepEqual(problemasDaCotacao(cot({ ultimo: -1 })), ['ultimo_invalido']);
  assert.deepEqual(problemasDaCotacao(cot({ instanteDaFonte: '2026-10-15T16:00:00Z' })), ['instante_no_futuro']);
});

test('código de opção: tipo e mês pela letra; série não é strike', () => {
  assert.deepEqual(lerCodigoDeOpcao('petre370'), { raiz: 'PETR', tipo: 'call', mes: 5, serie: '370' });
  assert.deepEqual(lerCodigoDeOpcao('PETRQ28'), { raiz: 'PETR', tipo: 'put', mes: 5, serie: '28' });
  assert.deepEqual(lerCodigoDeOpcao('BOVAX130W2'), { raiz: 'BOVA', tipo: 'put', mes: 12, serie: '130W2' });
  assert.equal(lerCodigoDeOpcao('PETR4'), null);
  assert.equal(lerCodigoDeOpcao('PETRY10'), null);
  assert.ok(pareceAtivoObjeto('TAEE11'));
  assert.deepEqual(validarContrato({ codigo: 'PETRK320', ativoObjeto: 'PETR4', tipo: 'put', estilo: 'americana', strike: 3200, vencimento: '2026-11-20', multiplicador: 1, loteDeNegociacao: 100 }), ['tipo_diferente_do_codigo']);
});

const cfg: ConfiguracaoDoCalendario = {
  feriados: new Set(['2026-11-02', '2026-11-20', '2026-12-25']),
  sessaoPadrao: { abertura: '10:00', fechamento: '17:00' },
  sessoesEspeciais: new Map([['2026-12-24', { abertura: '10:00', fechamento: '13:00' }]]),
};

test('calendário: pregão, fim de semana, feriado e sessão especial vêm da configuração', () => {
  assert.equal(situacaoDoMercado(agora, cfg).aberto, true);
  assert.equal(situacaoDoMercado(new Date('2026-10-17T15:00:00Z'), cfg).motivo, 'sem_pregao'); // sábado
  assert.equal(situacaoDoMercado(new Date('2026-11-02T15:00:00Z'), cfg).motivo, 'sem_pregao'); // feriado configurado
  assert.equal(situacaoDoMercado(new Date('2026-10-15T12:00:00Z'), cfg).motivo, 'antes'); // 09:00
  assert.equal(situacaoDoMercado(new Date('2026-12-24T17:00:00Z'), cfg).motivo, 'depois'); // 14:00, sessão até 13:00
  assert.equal(diasDePregaoEntre('2026-10-30', '2026-11-06', cfg), 4); // 2/11 é feriado
});

test('vencimento mensal: terceira sexta, adiado se não houver pregão', () => {
  assert.equal(terceiraSexta(2026, 12), '2026-12-18');
  assert.equal(terceiraSexta(2026, 11), '2026-11-20');
  assert.equal(vencimentoMensal(2026, 11, cfg), '2026-11-23'); // 20/11 configurado como feriado
});

test('dinheiro em centavos', () => {
  assert.equal(reaisParaCentavos('38,50'), 3850);
  assert.equal(reaisParaCentavos('1.234,56'), 123456);
  assert.equal(reaisParaCentavos('R$ 0,05'), 5);
  assert.equal(reaisParaCentavos(0.1), 10);
  assert.equal(reaisParaCentavos('-2.5'), -250);
  assert.throws(() => reaisParaCentavos('1,234'), /mais_de_duas_casas/);
  assert.throws(() => reaisParaCentavos('abc'), /valor_em_reais_invalido/);
  assert.equal(formatarReais(123456).replace(/\s/g, ' '), 'R$ 1.234,56');
  assert.throws(() => somar(Number.MAX_SAFE_INTEGER, 1), /estouro/);
});
