import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasParaColetar, lerSerieSgs, mesesParaCarregar, ultimoPregaoEncerrado, urlDaSerieSgs, urlDoCotahistDiario, urlDoCotahistMensal } from './coleta.ts';
import type { ConfiguracaoDoCalendario } from './calendario.ts';

const cfg: ConfiguracaoDoCalendario = {
  feriados: new Set(['2026-10-12', '2026-11-02']), sessaoPadrao: { abertura: '10:00', fechamento: '17:00' }, sessoesEspeciais: new Map(),
};

test('endereços das fontes', () => {
  assert.equal(urlDoCotahistDiario('2026-10-16'), 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D16102026.ZIP');
  assert.equal(urlDaSerieSgs(1178, 5), 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1178/dados/ultimos/5?formato=json');
});

test('Selic do SGS: datas brasileiras, ordenada, ponto ilegível descartado', () => {
  const p = lerSerieSgs([
    { data: '16/10/2026', valor: '14.90' },
    { data: '15/10/2026', valor: '14,90' },
    { data: 'ontem', valor: '1' },
    { data: '14/10/2026', valor: '' },
    { data: '13/10/2026', valor: 14.9 },
  ]);
  assert.deepEqual(p, [{ dia: '2026-10-13', valor: 14.9 }, { dia: '2026-10-15', valor: 14.9 }, { dia: '2026-10-16', valor: 14.9 }]);
  assert.throws(() => lerSerieSgs({ erro: 'x' }), /resposta_sgs_invalida/);
});

test('quais pregões buscar: pula fim de semana, feriado, já importado e o dia antes da liberação', () => {
  const sexta1930 = new Date('2026-10-16T22:30:00Z'); // 19:30 em Brasília
  const importados = new Set(['2026-10-07', '2026-10-08']);
  assert.deepEqual(diasParaColetar(sexta1930, cfg, importados, new Map()), ['2026-10-06', '2026-10-09', '2026-10-13', '2026-10-14', '2026-10-15']);
  const sexta2030 = new Date('2026-10-16T23:30:00Z');
  assert.ok(diasParaColetar(sexta2030, cfg, importados, new Map()).includes('2026-10-16'));
});

test('não insiste antes da espera entre tentativas', () => {
  const agora = new Date('2026-10-16T23:30:00Z');
  const tentativa = new Map([['2026-10-16', '2026-10-16T23:00:00Z'], ['2026-10-15', '2026-10-16T21:00:00Z']]);
  const dias = diasParaColetar(agora, cfg, new Set(), tentativa, { diasParaTras: 1, liberacao: '20:00', esperaEntreTentativasMin: 60 });
  assert.deepEqual(dias, ['2026-10-15']);
});

test('último pregão encerrado', () => {
  assert.equal(ultimoPregaoEncerrado(new Date('2026-10-16T21:00:00Z'), cfg), '2026-10-16'); // sexta 18:00
  assert.equal(ultimoPregaoEncerrado(new Date('2026-10-16T15:00:00Z'), cfg), '2026-10-15'); // sexta 12:00
  assert.equal(ultimoPregaoEncerrado(new Date('2026-10-18T15:00:00Z'), cfg), '2026-10-16'); // domingo
  assert.equal(ultimoPregaoEncerrado(new Date('2026-10-13T12:00:00Z'), cfg), '2026-10-09'); // terça 9h, segunda feriado
});

test('carga do histórico: meses completos, do mais recente ao mais antigo', () => {
  assert.equal(urlDoCotahistMensal('2026-09'), 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M092026.ZIP');
  const agora = new Date('2026-10-20T15:00:00Z');
  assert.deepEqual(mesesParaCarregar(agora, new Set(), new Map(), 3), ['2026-09', '2026-08', '2026-07']);
  assert.deepEqual(mesesParaCarregar(agora, new Set(['2026-09']), new Map([['2026-08', '2026-10-20T14:00:00Z']]), 3), ['2026-07']);
  assert.deepEqual(mesesParaCarregar(new Date('2026-01-10T15:00:00Z'), new Set(), new Map(), 2), ['2025-12', '2025-11']);
});
