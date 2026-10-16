import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliar, ESTADO_INICIAL, validarRegra, type EstadoDaRegra, type Observacao, type Regra } from './alertas.ts';
import type { Qualidade } from './cotacoes.ts';

// 14:00 UTC = 11:00 em Brasília.
const em = (min: number) => new Date(Date.UTC(2026, 9, 15, 14, min)).toISOString();
const obs = (min: number, ultimo: number | null, qualidade: Qualidade = 'periodica', extra: Observacao['valores'] = {}): Observacao =>
  ({ instante: em(min), qualidade, valores: { ultimo, ...extra } });

const cruzaAcima: Regra = {
  id: 'r1', versao: 1,
  condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'cruza_acima', valor: 3850 },
  rearme: { tipo: 'ao_desfazer', histerese: 20 },
  limitePorDia: 5,
  aceitarAtualizacaoPeriodica: true,
};

function rodar(regra: Regra, sequencia: Observacao[], estado: EstadoDaRegra = ESTADO_INICIAL) {
  const disparos: string[] = [];
  const ignorados: (string | null)[] = [];
  for (const o of sequencia) {
    const r = avaliar(regra, estado, o);
    estado = r.estado;
    if (r.disparo) disparos.push(r.disparo.chave);
    ignorados.push(r.ignorado);
  }
  return { estado, disparos, ignorados };
}

test('cruzamento para cima dispara uma vez e não repete enquanto o preço fica acima', () => {
  const r = rodar(cruzaAcima, [obs(0, 3800), obs(5, 3860), obs(10, 3900), obs(15, 3870)]);
  assert.deepEqual(r.disparos, ['r1:v1:1']);
});

test('primeira observação acima do nível não é cruzamento (transição não observada)', () => {
  assert.deepEqual(rodar(cruzaAcima, [obs(0, 3900), obs(5, 3950)]).disparos, []);
});

test('rearme com histerese: só volta a valer depois de cair abaixo de nível − folga', () => {
  const r = rodar(cruzaAcima, [obs(0, 3800), obs(5, 3860), obs(10, 3840), obs(15, 3860), obs(20, 3820), obs(25, 3855)]);
  // 38,40 não desfaz (folga de 0,20); 38,20 desfaz; o cruzamento seguinte dispara de novo.
  assert.deepEqual(r.disparos, ['r1:v1:1', 'r1:v1:2']);
});

test('cruzamento para baixo', () => {
  const regra: Regra = { ...cruzaAcima, id: 'r2', condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'cruza_abaixo', valor: 3000 } };
  assert.deepEqual(rodar(regra, [obs(0, 3050), obs(5, 2990)]).disparos, ['r2:v1:1']);
});

test('dado atrasado não dispara e quebra a continuidade do cruzamento', () => {
  const r = rodar(cruzaAcima, [obs(0, 3800), obs(5, 3820, 'atrasada'), obs(10, 3900)]);
  assert.deepEqual(r.disparos, []);
  assert.equal(r.ignorados[1], 'qualidade_insuficiente');
});

test('regra que exige tempo real ignora atualização periódica', () => {
  const regra = { ...cruzaAcima, aceitarAtualizacaoPeriodica: false };
  assert.deepEqual(rodar(regra, [obs(0, 3800), obs(5, 3900)]).disparos, []);
  assert.deepEqual(rodar(regra, [obs(0, 3800, 'tempo_real'), obs(5, 3900, 'tempo_real')]).disparos, ['r1:v1:1']);
});

test('observação fora de ordem ou repetida é ignorada (reprocessamento idempotente)', () => {
  const r1 = rodar(cruzaAcima, [obs(0, 3800), obs(5, 3860)]);
  const r2 = rodar(cruzaAcima, [obs(5, 3860), obs(3, 3800)], r1.estado);
  assert.deepEqual(r2.disparos, []);
  assert.deepEqual(r2.ignorados, ['fora_de_ordem', 'fora_de_ordem']);
});

test('estado gravado e relido (reinicialização) continua do mesmo ponto', () => {
  const r1 = rodar(cruzaAcima, [obs(0, 3800)]);
  const relido = JSON.parse(JSON.stringify(r1.estado)) as EstadoDaRegra;
  assert.deepEqual(rodar(cruzaAcima, [obs(5, 3860)], relido).disparos, ['r1:v1:1']);
});

test('condição composta com E e OU', () => {
  const regra: Regra = {
    ...cruzaAcima, id: 'r3', rearme: { tipo: 'ao_desfazer' },
    condicao: { tipo: 'e', filhos: [
      { tipo: 'comparacao', campo: 'ultimo', operador: '>=', valor: 3850 },
      { tipo: 'ou', filhos: [
        { tipo: 'comparacao', campo: 'volume', operador: '>', valor: 1_000_000 },
        { tipo: 'comparacao', campo: 'variacao_dia_pct', operador: '>', valor: 2 },
      ] },
    ] },
  };
  const r = rodar(regra, [
    obs(0, 3860, 'periodica', { volume: 500_000, variacao_dia_pct: 1 }),
    obs(5, 3860, 'periodica', { volume: 1_200_000, variacao_dia_pct: 1 }),
    obs(10, 3870, 'periodica', { volume: 1_300_000, variacao_dia_pct: 1 }),
  ]);
  assert.deepEqual(r.disparos, ['r3:v1:1']);
});

test('dado ausente não vira zero nem dispara', () => {
  const regra: Regra = { ...cruzaAcima, condicao: { tipo: 'comparacao', campo: 'ultimo', operador: '<', valor: 100 } };
  const r = rodar(regra, [obs(0, null)]);
  assert.deepEqual(r.disparos, []);
  assert.equal(r.ignorados[0], 'sem_dado');
});

test('rearme por intervalo e limite diário', () => {
  const regra: Regra = {
    ...cruzaAcima, id: 'r4', limitePorDia: 2, rearme: { tipo: 'intervalo', minutos: 10 },
    condicao: { tipo: 'comparacao', campo: 'ultimo', operador: '>', valor: 3850 },
  };
  const r = rodar(regra, [obs(0, 3900), obs(5, 3900), obs(10, 3900), obs(20, 3900), obs(30, 3900)]);
  assert.deepEqual(r.disparos, ['r4:v1:1', 'r4:v1:2']);
  assert.equal(r.ignorados.at(-1), 'limite_diario');
});

test('uma vez: depois do disparo a regra fica encerrada', () => {
  const regra: Regra = { ...cruzaAcima, rearme: { tipo: 'uma_vez' } };
  const r = rodar(regra, [obs(0, 3800), obs(5, 3860), obs(10, 3800), obs(15, 3860)]);
  assert.deepEqual(r.disparos, ['r1:v1:1']);
  assert.equal(r.estado.encerrada, true);
});

test('janela de horário em Brasília', () => {
  const regra: Regra = { ...cruzaAcima, janela: { inicio: '10:15', fim: '10:55' } }; // as observações são 11:00+
  const r = rodar(regra, [obs(0, 3800), obs(5, 3860)]);
  assert.deepEqual(r.disparos, []);
  assert.equal(r.ignorados[1], 'fora_da_janela');
});

test('validação da regra', () => {
  assert.deepEqual(validarRegra(cruzaAcima), []);
  assert.deepEqual(validarRegra({ ...cruzaAcima, limitePorDia: 0, condicao: { tipo: 'e', filhos: [] } }).sort(), ['grupo_vazio', 'limite_por_dia_invalido']);
  assert.deepEqual(validarRegra({ ...cruzaAcima, condicao: { tipo: 'comparacao', campo: 'ultimo', operador: 'dentro', valor: 10, valor2: 5 } }), ['faixa_invalida']);
});
