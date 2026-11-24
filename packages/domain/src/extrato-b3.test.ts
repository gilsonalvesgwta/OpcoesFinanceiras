import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerExtratoDaB3, mercadoDoExtrato, numeroDoExtrato } from './extrato-b3.ts';

const CAB = ['Data do Negócio', 'Tipo de Movimentação', 'Mercado', 'Prazo/Vencimento', 'Instituição', 'Código de Negociação', 'Quantidade', 'Preço', 'Valor'];
const celulas = (linhas: (string | number)[][]) => linhas.flatMap((l, linha) => l.map((v, coluna) => ({ linha, coluna, texto: String(v) })));

test('extrato da B3: mercados, fracionário, exercício, renda fixa (ETF) e futuros ignorados', () => {
  const r = lerExtratoDaB3(celulas([
    CAB,
    ['19/11/2026', 'Compra', 'Mercado à Vista', '-', 'BANCO BTG PACTUAL S/A.', 'BBAS3', 100, 14.12, 1412],
    ['17/11/2026', 'Venda', 'Opção de Compra sobre Ações', '18/12/2026', 'BANCO BTG PACTUAL S/A.', 'PETRL447', 500, 2.91, 1455],
    ['21/08/2026', 'Compra', 'Mercado Fracionário', '-', 'BANCO BTG PACTUAL S/A.', 'BBAS3F', 63, 18.61, 1172.43],
    ['14/08/2026', 'Compra', 'Opção de Venda sobre Ações', '18/09/2026', 'CM CAPITAL', 'BOVAU145', 220, 0.16, 35.2],
    ['05/12/2025', 'Venda', 'Exercício de Opção de Compra', '05/12/2025', 'BTG', 'VALEL565W1E', 100, 56.5, 5650],
    ['16/07/2026', 'Compra', 'Renda Fixa', '-', 'BTG', 'LFTS11', 4, 156.4, 625.6],
    ['18/03/2026', 'Compra', 'Futuro', '15/04/2026', 'GENIAL', 'WINJ26', 1, 181815, 36363],
    ['18/03/2026', 'Compra', 'Renda Fixa', '-', 'BTG', 'TESOURO SELIC 2029', 1, 150, 150],
  ]));
  assert.ok(!('erro' in r));
  if ('erro' in r) return;
  assert.deepEqual(r.negocios.map((n) => [n.data, n.lado, n.mercado, n.codigo, n.vencimento, n.quantidade, n.preco, n.valor]), [
    ['2026-11-19', 'compra', 'vista', 'BBAS3', null, 100, 1412, 141200],
    ['2026-11-17', 'venda', 'opcao_compra', 'PETRL447', '2026-12-18', 500, 291, 145500],
    ['2026-08-21', 'compra', 'fracionario', 'BBAS3', null, 63, 1861, 117243],
    ['2026-08-14', 'compra', 'opcao_venda', 'BOVAU145', '2026-09-18', 220, 16, 3520],
    ['2025-12-05', 'venda', 'exercicio_compra', 'VALEL565W1', '2025-12-05', 100, 5650, 565000],
    ['2026-07-16', 'compra', 'vista', 'LFTS11', null, 4, 15640, 62560],
  ]);
  assert.deepEqual(r.ignorados.map((i) => [i.codigo, i.motivo]), [['WINJ26', 'futuro'], ['TESOURO SELIC 2029'.replace(/\s/g, ''), 'renda_fixa']]);
  assert.deepEqual([r.de, r.ate], ['2025-12-05', '2026-11-19']);
  assert.deepEqual(lerExtratoDaB3(celulas([['qualquer', 'coisa']])), { erro: 'nao_e_extrato_da_b3' });
});

test('extrato: números e mercados', () => {
  assert.equal(numeroDoExtrato('14.12'), 14.12);
  assert.equal(numeroDoExtrato('R$ 1.412,00'), 1412);
  assert.equal(numeroDoExtrato('1.000'), 1000);
  assert.equal(numeroDoExtrato(''), null);
  assert.equal(mercadoDoExtrato('Exercício de Opção de Venda'), 'exercicio_venda');
  assert.equal(mercadoDoExtrato('Termo'), null);
});
