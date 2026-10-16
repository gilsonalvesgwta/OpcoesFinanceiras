import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUSENTE, diasAte, formatarData, formatarDataLonga, formatarReais, formatarVariacao, tempoDesde } from './formatos.ts';
import { estadoDaSessao, marcasDeHora, posicaoNaSessao } from './regua.ts';
import { mensagemDoErro } from './mensagens.ts';
import { tokenDoEndereco } from './api.ts';

const sessao = { abertura: '10:00', fechamento: '17:00' };

test('formatos brasileiros e ausência como traço', () => {
  assert.equal(formatarReais(3847).replace(/\s/g, ' '), 'R$ 38,47');
  assert.equal(formatarReais(null), AUSENTE);
  assert.equal(formatarVariacao(0.0124), '+1,24%');
  assert.equal(formatarVariacao(-0.0085), '−0,85%');
  assert.equal(formatarVariacao(0), '0,00%');
  assert.equal(formatarVariacao(undefined), AUSENTE);
  assert.equal(formatarDataLonga(new Date('2026-10-16T15:00:00Z')), 'Sexta-feira, 16 de outubro de 2026');
  assert.equal(formatarData('2026-12-18'), '18/12/2026');
  assert.equal(diasAte('2026-10-16', '2026-12-18'), 63);
});

test('tempo desde, em palavras', () => {
  const agora = new Date('2026-10-16T17:52:00Z');
  assert.equal(tempoDesde('2026-10-16T17:21:00Z', agora), 'há 31 minutos');
  assert.equal(tempoDesde('2026-10-16T16:52:00Z', agora), 'há 1 hora');
  assert.equal(tempoDesde('2026-10-16T17:51:40Z', agora), 'agora');
});

test('régua: posição no pregão em Brasília, presa nas pontas', () => {
  assert.equal(posicaoNaSessao(new Date('2026-10-16T13:00:00Z'), sessao), 0); // 10:00
  assert.equal(posicaoNaSessao(new Date('2026-10-16T17:52:00Z'), sessao), 69.52); // 14:52
  assert.equal(posicaoNaSessao(new Date('2026-10-16T22:00:00Z'), sessao), 100); // 19:00
  assert.equal(posicaoNaSessao(new Date('2026-10-16T11:00:00Z'), sessao), 0); // 08:00
  assert.equal(estadoDaSessao(new Date('2026-10-16T17:52:00Z'), sessao, true), 'aberta');
  assert.equal(estadoDaSessao(new Date('2026-10-16T12:00:00Z'), sessao, true), 'antes');
  assert.equal(estadoDaSessao(new Date('2026-10-16T20:00:00Z'), sessao, true), 'depois');
  assert.equal(estadoDaSessao(new Date('2026-10-17T15:00:00Z'), sessao, false), 'sem_pregao');
  assert.deepEqual(marcasDeHora(sessao).map((m) => m.rotulo), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
});

test('mensagens de erro em português e token só no formato certo', () => {
  assert.match(mensagemDoErro('credenciais_invalidas'), /E-mail ou senha incorretos/);
  assert.match(mensagemDoErro('codigo_desconhecido'), /não conseguiu concluir/);
  assert.equal(tokenDoEndereco('#' + 'a'.repeat(43)), 'a'.repeat(43));
  assert.equal(tokenDoEndereco('#curto'), null);
  assert.equal(tokenDoEndereco(''), null);
});
