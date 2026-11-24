import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigoDaEspecificacao, lerNotaDeCorretagem, lerValorBr, mercadoDe, ratearCustos, type TrechoDaNota } from './nota-corretagem.ts';

// Nota sintética no layout Sinacor (posições como as de uma nota real da BTG, sem dados pessoais).
export function notaDeExemplo(): TrechoDaNota[] {
  const t: TrechoDaNota[] = [];
  const p = (x: number, y: number, texto: string) => t.push({ x, y, texto, pagina: 1 });
  p(116, 797, 'NOTA DE CORRETAGEM');
  p(402, 792, ' Nr. nota'); p(457, 792, 'Folha'); p(512, 792, 'Data pregão');
  p(416, 783, '123456'); p(483, 783, '1'); p(525, 783, '24/11/2026');
  p(126, 770, 'Corretora Exemplo CTVM S.A.');
  p(126, 731, 'C.N.P.J: 00.000.000/0001-00');
  p(26, 616, 'Negócios realizados');
  [[28, 'Q'], [38, 'Negociação'], [88, 'C/V'], [106, 'Tipo Mercado'], [188, 'Prazo'], [214, 'Especificação do título'], [308, 'Obs. (*)'],
    [342, 'Quantidade'], [391, 'Preço / Ajuste'], [452, 'Valor Operação / Ajuste'], [552, 'D/C']].forEach(([x, s]) => p(x as number, 604, s as string));
  [[38, '1-BOVESPA'], [88, 'C'], [106, 'VISTA'], [214, 'BBAS3'], [254, 'ON'], [342, '200'], [391, '14,34'], [452, '2.868,00'], [552, 'D']].forEach(([x, s]) => p(x as number, 593, s as string));
  [[38, '1-BOVESPA'], [88, 'V'], [106, 'OPCAO DE COMPRA'], [188, '12/26'], [214, 'BBASL145W1'], [254, 'ON'], [342, '200'], [391, '0,37'], [452, '74,00'], [552, 'C']].forEach(([x, s]) => p(x as number, 584, s as string));
  p(28, 348, 'Resumo dos Negócios'); p(300, 348, 'Resumo Financeiro');
  p(300, 339, 'Clearing');
  p(300, 330, 'Valor líquido das operações'); p(537, 330, '2.794,00'); p(557, 330, 'D');
  p(300, 321, 'Taxa de liquidação/CCP'); p(541, 321, '0,65'); p(557, 321, 'D');
  p(300, 312, 'Taxa de registro'); p(541, 312, '0,03'); p(557, 312, 'D');
  p(300, 267, 'Emolumentos'); p(541, 267, '0,15'); p(557, 267, 'D');
  p(300, 240, 'Taxa de Transferencia de Ativos'); p(541, 240, '0,07'); p(557, 240, 'D');
  p(300, 206, 'Clearing'); p(541, 206, '0,00');
  p(300, 179, 'ISS* (SÃO PAULO - SP)'); p(541, 179, '0,00');
  p(300, 170, 'I.R.R.F. s/ operações, base R$'); p(406, 170, '74,00'); p(541, 170, '0,00');
  p(300, 139, 'Líquido para 26/11/2026'); p(537, 138, '2.794,90'); p(557, 138, 'D');
  return t;
}

test('lê a nota: cabeçalho, negócios, custos, conferência e rateio', () => {
  const n = lerNotaDeCorretagem(notaDeExemplo());
  assert.ok(!('erro' in n), JSON.stringify(n));
  if ('erro' in n) return;
  assert.deepEqual([n.corretora, n.numero, n.dataPregao], ['Corretora Exemplo CTVM S.A.', '123456', '2026-11-24']);
  assert.deepEqual(n.negocios.map((x) => [x.lado, x.mercado, x.codigo, x.quantidade, x.preco, x.valor]), [
    ['compra', 'vista', 'BBAS3', 200, 1434, 286800],
    ['venda', 'opcao_compra', 'BBASL145W1', 200, 37, 7400],
  ]);
  assert.equal(n.custoTotal, 90);
  assert.equal(n.liquido, -279490);
  assert.equal(n.conferida, true);
  assert.deepEqual(n.negocios.map((x) => x.custos), [88, 2], 'rateio pelo valor, soma exata');
  assert.deepEqual(n.avisos, []);
});

test('nota que não confere avisa; arquivo que não é nota é recusado', () => {
  const t = notaDeExemplo().map((x) => (x.texto === '2.794,90' ? { ...x, texto: '2.795,90' } : x));
  const n = lerNotaDeCorretagem(t);
  assert.ok(!('erro' in n) && !n.conferida && n.avisos.includes('liquido_nao_confere'));
  assert.deepEqual(lerNotaDeCorretagem([{ x: 0, y: 0, texto: 'Fatura do cartão', pagina: 1 }]), { erro: 'nao_e_nota_de_corretagem' });
});

test('peças: valores, mercado, código e rateio', () => {
  assert.equal(lerValorBr('1.412,00'), 1412);
  assert.equal(lerValorBr('0,10'), 0.1);
  assert.equal(lerValorBr('abc'), null);
  assert.equal(mercadoDe('OPCAO DE VENDA'), 'opcao_venda');
  assert.equal(mercadoDe('EXERC OPC COMPRA'), 'exercicio_compra');
  assert.equal(mercadoDe('FRACIONARIO'), 'fracionario');
  assert.equal(codigoDaEspecificacao('BBAS3F ON NM', 'fracionario'), 'BBAS3');
  assert.equal(codigoDaEspecificacao('PETRL380 PN', 'opcao_compra'), 'PETRL380');
  assert.equal(codigoDaEspecificacao('BANCO DO BRASIL ON NM', 'vista'), null);
  assert.deepEqual(ratearCustos([100, 100, 100], 10), [4, 3, 3]);
  assert.deepEqual(ratearCustos([], 10), []);
});

test('vencimento estimado pelo código: mensal 3ª sexta (antecipa feriado), semanal Wn, ano pelo prazo', async () => {
  const { vencimentoEstimado } = await import('./nota-corretagem.ts');
  const cfg = { feriados: new Set(['2026-11-20']), sessaoPadrao: { abertura: '10:00', fechamento: '17:00' }, sessoesEspeciais: new Map() };
  assert.equal(vencimentoEstimado('BOVAK157', '2026-10-13', null, cfg), '2026-11-19', '20/11 é feriado: antecipa');
  assert.equal(vencimentoEstimado('BOVAL64', '2026-11-16', null, cfg), '2026-12-18');
  assert.equal(vencimentoEstimado('BBASL145W1', '2026-11-24', null, cfg), '2026-12-04');
  assert.equal(vencimentoEstimado('BBASA150', '2026-11-24', null, cfg), '2027-01-15', 'janeiro do ano seguinte');
  assert.equal(vencimentoEstimado('BBASK196', '2026-10-29', '11/26', cfg), '2026-11-19');
  assert.equal(vencimentoEstimado('PETRX30', '2026-11-24', null, cfg), '2026-12-18', 'X = put de dezembro');
  assert.equal(vencimentoEstimado('BBAS3', '2026-11-24', null, cfg), null);
});
