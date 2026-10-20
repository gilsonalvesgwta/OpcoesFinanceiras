import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Grupo } from '@wta/domain';
import { FORMULARIO_VAZIO, formularioDaRegra, lerNumero, regraDoFormulario, type FormularioDaRegra } from './alertas.ts';

test('números como a pessoa digita', () => {
  assert.equal(lerNumero('38,50'), 38.5);
  assert.equal(lerNumero('R$ 1.234,56'), 1234.56);
  assert.equal(lerNumero('38.5'), 38.5);
  assert.equal(lerNumero('-3'), -3);
  assert.equal(lerNumero('3%'), 3);
  assert.equal(lerNumero(''), null);
  assert.equal(lerNumero('abc'), null);
});

const f = (x: Partial<FormularioDaRegra>): FormularioDaRegra => ({ ...FORMULARIO_VAZIO, nome: 'Teste', codigo: 'petr4', ...x });

test('formulário vira regra: preço em centavos, uma condição sem grupo', () => {
  const r = regraDoFormulario(f({ linhas: [{ campo: 'ultimo', operador: 'cruza_acima', valor: '38,50', valor2: '' }] }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.regra, {
    nome: 'Teste', codigo: 'PETR4', condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'cruza_acima', valor: 3850 },
    rearme: { tipo: 'ao_desfazer' }, limitePorDia: 5, aceitarPeriodica: true, janela: null,
  });
});

test('várias condições viram um grupo; faixa e intervalo conferidos', () => {
  const r = regraDoFormulario(f({
    juncao: 'ou', rearme: 'intervalo', minutos: '15', usarJanela: true,
    linhas: [{ campo: 'variacao_dia_pct', operador: '<=', valor: '-3', valor2: '' }, { campo: 'ultimo', operador: 'fora', valor: '37', valor2: '39,5' }],
  }));
  if (!r.ok) return assert.fail(r.erro);
  const grupo = r.regra.condicao as Grupo;
  assert.equal(grupo.tipo, 'ou');
  assert.equal(grupo.filhos.length, 2);
  assert.deepEqual(grupo.filhos[1], { tipo: 'comparacao', campo: 'ultimo', operador: 'fora', valor: 3700, valor2: 3950 });
  assert.deepEqual(r.regra.rearme, { tipo: 'intervalo', minutos: 15 });
  assert.deepEqual(r.regra.janela, { inicio: '10:15', fim: '16:55' });
  assert.equal((regraDoFormulario(f({ linhas: [{ campo: 'ultimo', operador: 'dentro', valor: '40', valor2: '39' }] })) as { erro: string }).erro, 'Condição 1: o segundo valor precisa ser maior que o primeiro.');
  assert.equal((regraDoFormulario(f({ codigo: 'x' })) as { erro: string }).erro, 'Escreva o código do ativo, como PETR4 ou BOVA11.');
  assert.equal((regraDoFormulario(f({ linhas: [{ campo: 'ultimo', operador: '>', valor: '', valor2: '' }] })) as { erro: string }).erro, 'Condição 1: preencha o valor.');
  assert.equal((regraDoFormulario(f({ rearme: 'intervalo', minutos: '0', linhas: [{ campo: 'ultimo', operador: '>', valor: '1', valor2: '' }] })) as { erro: string }).erro, 'O intervalo precisa ser de 1 a 1440 minutos.');
});

test('regra volta para o formulário para editar (ida e volta)', () => {
  const ida = regraDoFormulario(f({ juncao: 'ou', linhas: [{ campo: 'ultimo', operador: 'dentro', valor: '37,00', valor2: '39,50' }, { campo: 'volume', operador: '>', valor: '1000000', valor2: '' }] }));
  assert.ok(ida.ok);
  if (!ida.ok) return;
  const volta = formularioDaRegra(ida.regra);
  assert.ok(volta);
  assert.deepEqual(volta?.linhas, [{ campo: 'ultimo', operador: 'dentro', valor: '37,00', valor2: '39,50' }, { campo: 'volume', operador: '>', valor: '1000000', valor2: '' }]);
  assert.equal(volta?.juncao, 'ou');
});
