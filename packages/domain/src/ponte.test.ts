// Testes da ponte com o MetaTrader 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerLoteDaPonte, precoDaPonte, qualidadeDaPonte, LIMITES_DA_PONTE } from './ponte.ts';

const agora = new Date('2026-10-16T15:00:00Z'); // 12:00 em Brasília
const ms = agora.getTime();
const cot = (extra: Record<string, unknown> = {}) => ({
  codigo: 'PETR4', ultimo: 38.12, bid: 38.11, ask: 38.13, fechamento_anterior: 37.9, volume: 1500, instante: ms - 2000, ...extra,
});
const ler = (corpo: unknown) => {
  const r = lerLoteDaPonte(corpo, agora);
  if (!r.ok) throw new Error(r.erro);
  return r.lote;
};

test('preço em reais vira centavos; zero e ausente viram null; fração de centavo é recusada', () => {
  assert.equal(precoDaPonte(38.12), 3812);
  assert.equal(precoDaPonte(0.29), 29); // 0.29 * 100 = 28.999999999999996 em ponto flutuante
  assert.equal(precoDaPonte(1234567.89), 123456789);
  assert.equal(precoDaPonte(0), null);
  assert.equal(precoDaPonte(null), null);
  assert.equal(precoDaPonte(undefined), null);
  assert.equal(precoDaPonte(38.125), undefined);
  assert.equal(precoDaPonte(-1), undefined);
  assert.equal(precoDaPonte('38.12'), undefined);
  assert.equal(precoDaPonte(Number.NaN), undefined);
});

test('lote válido: centavos, ISO, conta e versão', () => {
  const l = ler({ versao: '1.0.0', conta: { login: 123456, servidor: 'GenialInvestimentos-PRD', corretora: 'Genial' }, cotacoes: [cot()] });
  assert.deepEqual(l.conta, { login: '123456', servidor: 'GenialInvestimentos-PRD', corretora: 'Genial' });
  assert.deepEqual(l.cotacoes, [{
    codigo: 'PETR4', ultimo: 3812, bid: 3811, ask: 3813, fechamento_anterior: 3790, volume: 1500, instante: new Date(ms - 2000).toISOString(),
  }]);
  assert.equal(l.posicoes, null);
  assert.deepEqual(l.avisos, []);
});

test('livro vazio do MT5 (bid/ask 0) não vira preço zero', () => {
  const [c] = ler({ cotacoes: [cot({ bid: 0, ask: 0, ultimo: 0 })] }).cotacoes;
  assert.equal(c?.bid, null);
  assert.equal(c?.ask, null);
  assert.equal(c?.ultimo, null);
});

test('item ruim é descartado e contado, sem derrubar o lote', () => {
  const l = ler({
    cotacoes: [
      cot({ codigo: 'vale3' }), // minúsculas são aceitas e normalizadas
      cot({ codigo: 'X' }),
      cot({ codigo: 'ITUB4', instante: ms + LIMITES_DA_PONTE.futuroMs + 1 }), // fuso errado: 3 h no futuro, por ex.
      cot({ codigo: 'BBAS3', instante: ms - LIMITES_DA_PONTE.passadoMs - 1 }),
      cot({ codigo: 'BBDC4', bid: 10.2, ask: 10.1 }),
      cot({ codigo: 'ABEV3', ultimo: 12.345 }),
      cot({ codigo: 'WEGE3', volume: -1 }),
      'lixo',
    ],
  });
  assert.deepEqual(l.cotacoes.map((c) => c.codigo), ['VALE3']);
  assert.deepEqual(l.avisos, ['codigo_invalido', 'horario_fora_do_intervalo', 'horario_fora_do_intervalo', 'livro_cruzado', 'preco_invalido', 'volume_invalido', 'cotacao_invalida']);
});

test('ativo repetido no lote: fica o mais recente', () => {
  const l = ler({ cotacoes: [cot({ ultimo: 38.2, instante: ms - 1000 }), cot({ ultimo: 38.0, instante: ms - 5000 })] });
  assert.equal(l.cotacoes.length, 1);
  assert.equal(l.cotacoes[0]?.ultimo, 3820);
});

test('erros de estrutura recusam o lote inteiro', () => {
  assert.deepEqual(lerLoteDaPonte(null, agora), { ok: false, erro: 'corpo_invalido' });
  assert.deepEqual(lerLoteDaPonte({ cotacoes: 'x' }, agora), { ok: false, erro: 'cotacoes_invalidas' });
  assert.deepEqual(lerLoteDaPonte({ cotacoes: Array(LIMITES_DA_PONTE.cotacoes + 1).fill(cot()) }, agora), { ok: false, erro: 'lote_grande_demais' });
  assert.deepEqual(lerLoteDaPonte({ posicoes: {} }, agora), { ok: false, erro: 'posicoes_invalidas' });
});

test('posições: preço médio com fração de centavo; lista vazia é "sem posições"', () => {
  const l = ler({ posicoes: [{ codigo: 'PETR4', lado: 'compra', quantidade: 300, preco_medio: 36.555 }, { codigo: 'PETRK380', lado: 'venda', quantidade: 300, preco_medio: 0.72 }] });
  assert.deepEqual(l.posicoes, [
    { codigo: 'PETR4', lado: 'compra', quantidade: 300, preco_medio: 3655.5 },
    { codigo: 'PETRK380', lado: 'venda', quantidade: 300, preco_medio: 72 },
  ]);
  assert.deepEqual(ler({ posicoes: [] }).posicoes, []);
});

test('posições repetidas do mesmo lado são somadas com preço médio ponderado', () => {
  const l = ler({ posicoes: [{ codigo: 'VALE3', lado: 'compra', quantidade: 100, preco_medio: 60 }, { codigo: 'VALE3', lado: 'compra', quantidade: 300, preco_medio: 62 }] });
  assert.deepEqual(l.posicoes, [{ codigo: 'VALE3', lado: 'compra', quantidade: 400, preco_medio: 6150 }]);
});

test('posição ilegível ou de conta hedging não apaga as posições guardadas', () => {
  const ruim = ler({ posicoes: [{ codigo: 'PETR4', lado: 'compra', quantidade: 100, preco_medio: 36 }, { codigo: 'VALE3', lado: 'x', quantidade: 1, preco_medio: 1 }] });
  assert.equal(ruim.posicoes, null);
  assert.deepEqual(ruim.avisos, ['lado_invalido']);
  const hedge = ler({ posicoes: [{ codigo: 'PETR4', lado: 'compra', quantidade: 100, preco_medio: 36 }, { codigo: 'PETR4', lado: 'venda', quantidade: 100, preco_medio: 37 }] });
  assert.equal(hedge.posicoes, null);
  assert.deepEqual(hedge.avisos, ['posicao_hedge_nao_suportada']);
  for (const q of [0, -1, 1.5]) assert.equal(ler({ posicoes: [{ codigo: 'PETR4', lado: 'compra', quantidade: q, preco_medio: 1 }] }).posicoes, null);
});

test('qualidade pelo pulso da ponte', () => {
  const ha = (s: number) => new Date(ms - s * 1000).toISOString();
  assert.equal(qualidadeDaPonte(ha(3), agora, true), 'tempo_real');
  assert.equal(qualidadeDaPonte(ha(15), agora, true), 'tempo_real');
  assert.equal(qualidadeDaPonte(ha(16), agora, true), 'atrasada');
  assert.equal(qualidadeDaPonte(ha(61), agora, true), 'desconectado');
  assert.equal(qualidadeDaPonte(ha(3), agora, false), 'historico');
  assert.equal(qualidadeDaPonte(ha(61), agora, false), 'desconectado');
  assert.equal(qualidadeDaPonte(null, agora, true), 'desconectado');
  assert.equal(qualidadeDaPonte('lixo', agora, true), 'desconectado');
});
