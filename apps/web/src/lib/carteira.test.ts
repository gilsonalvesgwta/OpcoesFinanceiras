import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notaPronta, pctBr } from './carteira.ts';

test('nota pronta para importar e porcentagem', () => {
  const neg = { lado: 'compra' as const, mercado: 'vista', codigo: 'BBAS3', tipo: 'ativo' as const, strike: null, vencimento: null, ativoObjeto: 'BBAS3', vencimentoEstimado: false, quantidade: 100, preco: 1412, valor: 141200, custos: 41, observacao: '', falta: [], alertas: [] };
  assert.equal(notaPronta({ arquivo: 'a.pdf', negocios: [neg] }), true);
  assert.equal(notaPronta({ arquivo: 'a.pdf', jaImportada: true, negocios: [neg] }), false);
  assert.equal(notaPronta({ arquivo: 'a.pdf', negocios: [{ ...neg, falta: ['strike'] }] }), false);
  assert.equal(notaPronta({ arquivo: 'a.pdf', erro: 'nao_e_pdf' }), false);
  assert.equal(pctBr(0.0146), '+1,46%');
  assert.equal(pctBr(-0.5), '−50,00%');
  assert.equal(pctBr(null), '—');
});
