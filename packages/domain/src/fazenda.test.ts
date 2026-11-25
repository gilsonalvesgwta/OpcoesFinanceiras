import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisarVaca, chaveDaSerie, dataDaPlanilha, vacaDaPlanilha, type OperacaoDaVaca } from './fazenda.ts';

const op = (data: string, lado: 'compra' | 'venda', tipo: 'call' | 'put', ticker: string, strike: number, vencimento: string | null, preco: number, quantidade = 120): OperacaoDaVaca =>
  ({ id: `${data}${ticker}${lado}`, data, lado, tipo, prazo: null, quantidade, ticker, strike, vencimento, preco, custos: 0, origem: 'planilha', execucaoId: null });

test('vaca: ordenha, saldo, rentabilidade, média mensal, pernas abertas e risco PUT (contas da planilha)', () => {
  const ops = [
    op('2026-10-01', 'venda', 'call', 'BOVAK160W1', 16000, '2026-11-06', 200),
    op('2026-10-01', 'venda', 'put', 'BOVAW160W1', 16000, '2026-11-06', 150),
    op('2026-11-05', 'compra', 'call', 'k160w1', 16000, '2026-11-06', 50), // mesma série, ticker abreviado
    op('2026-11-05', 'venda', 'call', 'BOVAK165W4', 16500, '2026-11-27', 120),
    op('2026-11-05', 'venda', 'put', 'BOVAW150W4', 13000, '2026-11-27', 80),
  ];
  const { linhas, resumo } = analisarVaca({ dataInicio: '2026-10-01', margem: 400000, distancia: 0.1, ativoObjeto: 'BOVA11' }, ops, 16000, '2026-11-24');
  assert.deepEqual(linhas.map((l) => [l.total, l.saldo]), [[24000, 24000], [18000, 42000], [-6000, 36000], [14400, 50400], [9600, 60000]]);
  assert.equal(resumo.ordenhaBruta, 60000);
  assert.equal(resumo.dias, 54);
  assert.equal(resumo.ordenhaMediaMensal, Math.round(60000 / (54 / 30)));
  assert.ok(Math.abs((resumo.rentabilidadeMensal as number) - ((1 + 60000 / 400000) ** (30 / 54) - 1)) < 1e-12);
  // A put de 06/11 venceu; ficam a call 165 e a put 130 (strike distante: mais de 10% abaixo de 160).
  assert.deepEqual(resumo.pernas.map((p) => [p.ticker, p.quantidade, p.atencao]), [['BOVAK165W4', -120, null], ['BOVAW150W4', -120, 'Strike distante']]);
  assert.equal(resumo.riscoPut, 120 * 16000);
  assert.deepEqual([resumo.callsAbertas, resumo.putsAbertas], [120, 120]);
  assert.equal(linhas[3]?.emCustodia, true);
  assert.equal(chaveDaSerie('BOVAL137W2', 'call', 13700), chaveDaSerie('l137w2', 'call', 13700));
});

test('planilha da vaca: datas de série do Excel, linha sem data e preço médio com fração', () => {
  assert.equal(dataDaPlanilha('45798.0'), '2025-05-21');
  assert.equal(dataDaPlanilha('21/05/2025'), '2025-05-21');
  const cel = (l: number, c: number, t: string) => ({ linha: l, coluna: c, texto: t });
  const v = vacaDaPlanilha('PIONEIRA', [
    cel(8, 6, 'Data da Compra'), cel(8, 7, '45798.0'), cel(10, 6, 'Margem'), cel(10, 7, '3761.52'),
    ...['Data da Operação', 'Operação', 'Tipo', 'Prazo', 'Quantidade', 'Ticker', 'Strike', 'Em Custódia', 'Vencimento', 'Preço'].map((t, i) => cel(12, 6 + i, t)),
    ...['45798.0', 'VENDA', 'CALL', 'CURTA', '20.0', 'E135W5', '135.0', 'NÃO', '45807.0', '1.74'].map((t, i) => cel(13, 6 + i, t)),
    ...['', 'COMPRA', 'CALL', 'CURTA', '30.0', 'G134W1', '134.0', 'NÃO', '', '3.365'].map((t, i) => cel(14, 6 + i, t)).filter((c) => c.texto),
  ]);
  assert.ok(v);
  assert.deepEqual([v?.dataInicio, v?.margem, v?.operacoes.length], ['2025-05-21', 376152, 2]);
  assert.deepEqual(v?.operacoes.map((o) => [o.data, o.lado, o.ticker, o.strike, o.vencimento, o.preco]), [
    ['2025-05-21', 'venda', 'E135W5', 13500, '2025-05-30', 174],
    ['2025-05-21', 'compra', 'G134W1', 13400, null, 336.5],
  ]);
});
