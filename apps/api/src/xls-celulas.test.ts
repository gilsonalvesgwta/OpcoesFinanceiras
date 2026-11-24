import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celulasDoXls, ehXls } from './xls-celulas.ts';
import { xlsDeTeste } from './xls-de-teste.ts';

test('xls: lê textos (com acento) e números da primeira planilha, no mini-fluxo', () => {
  const b = xlsDeTeste([['DATA PREGÃO', '16112026', null, 'NUM NOTA', '910971'], [], ['C/V', 'QUANTIDADE'], ['C', 220, 11.55]]);
  assert.equal(ehXls(b), true);
  assert.deepEqual(celulasDoXls(b), [
    { linha: 0, coluna: 0, texto: 'DATA PREGÃO' }, { linha: 0, coluna: 1, texto: '16112026' }, { linha: 0, coluna: 3, texto: 'NUM NOTA' }, { linha: 0, coluna: 4, texto: '910971' },
    { linha: 2, coluna: 0, texto: 'C/V' }, { linha: 2, coluna: 1, texto: 'QUANTIDADE' },
    { linha: 3, coluna: 0, texto: 'C' }, { linha: 3, coluna: 1, texto: '220' }, { linha: 3, coluna: 2, texto: '11.55' },
  ]);
});

test('xls: recusa o que não é planilha', () => {
  assert.equal(ehXls(Buffer.from('%PDF-1.4 qualquer coisa'.padEnd(600, ' '))), false);
  assert.throws(() => celulasDoXls(Buffer.from('nada'.padEnd(600, ' '))), /nao_e_xls/);
});
