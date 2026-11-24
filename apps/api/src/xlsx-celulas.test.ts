import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celulasDoXlsx, ehXlsx } from './xlsx-celulas.ts';
import { xlsxDeTeste } from './xlsx-de-teste.ts';
import { montarZip } from './coleta/zip.ts';

test('xlsx: textos (com acento e &), números e células vazias da primeira aba', () => {
  const b = xlsxDeTeste([['Data do Negócio', 'Código de Negociação', 'Preço'], ['19/11/2026', 'BBAS3', 14.12], [null, 'A & B', 1412]]);
  assert.equal(ehXlsx(b), true);
  assert.deepEqual(celulasDoXlsx(b), [
    { linha: 0, coluna: 0, texto: 'Data do Negócio' }, { linha: 0, coluna: 1, texto: 'Código de Negociação' }, { linha: 0, coluna: 2, texto: 'Preço' },
    { linha: 1, coluna: 0, texto: '19/11/2026' }, { linha: 1, coluna: 1, texto: 'BBAS3' }, { linha: 1, coluna: 2, texto: '14.12' },
    { linha: 2, coluna: 1, texto: 'A & B' }, { linha: 2, coluna: 2, texto: '1412' },
  ]);
  assert.equal(ehXlsx(montarZip('COTAHIST.TXT', Buffer.from('x'))), false);
});
