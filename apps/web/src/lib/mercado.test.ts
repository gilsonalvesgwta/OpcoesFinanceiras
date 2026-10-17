import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cartaoDaBrapi, cartaoDaCadeia, cartaoDaColeta, cartaoDaSelic, cartaoDoFechamento, dataBr, faltaCalendarioDe, feriadosDoAno, linhaDaTentativa,
  type Diagnostico, type Importacao, type SituacaoDoMercado,
} from './mercado.ts';

const agora = new Date('2026-10-16T23:20:00Z'); // 20:20 em Brasília
const imp = (x: Partial<Importacao>): Importacao => ({
  id: 1, fonte: 'b3-cotahist', referencia: '2026-10-16', situacao: 'ok', registros: 48211, recusados: 0, detalhe: '9112 séries de opções',
  iniciadaEm: '2026-10-16T23:09:00Z', terminadaEm: '2026-10-16T23:10:00Z', ...x,
});
const diag = (x: Partial<Diagnostico> = {}): Diagnostico => ({
  agora: agora.toISOString(), coleta: [{ nome: 'coleta@a', versao: '0.1.0', vistoEm: '2026-10-16T23:18:00Z' }],
  cotahist: { ultimoImportado: '2026-10-16', esperado: '2026-10-16' }, banco: { fechamentosUltimos30Dias: 41380, seriesVigentes: 9112 },
  brapi: { configurada: false }, importacoes: [imp({})], ...x,
});
const sit = (x: Partial<SituacaoDoMercado['fechamento']> = {}, selic: SituacaoDoMercado['selic'] = { dia: '2026-10-16', valor: 14.9 }): SituacaoDoMercado => ({
  agora: agora.toISOString(), mercado: { aberto: false, motivo: 'depois', sessao: { abertura: '10:00', fechamento: '17:00' } },
  fechamento: { ultimoImportado: '2026-10-16', series: 9112, esperado: '2026-10-16', ...x }, selic,
});

test('datas brasileiras com dia da semana', () => {
  assert.equal(dataBr('2026-11-20'), '20/11/2026');
  assert.equal(dataBr('2026-11-20', true), 'sex, 20/11/2026');
  assert.equal(dataBr('2026-02-18', true), 'qua, 18/02/2026');
});

test('cartões do diagnóstico', () => {
  assert.deepEqual([cartaoDaColeta(diag(), agora).estado, cartaoDaColeta(diag(), agora).texto], ['Funcionando', 'Último sinal há 2 minutos. Confere as fontes a cada 10 minutos.']);
  assert.equal(cartaoDaColeta(diag({ coleta: [{ nome: 'c', versao: null, vistoEm: '2026-10-16T22:30:00Z' }] }), agora).estado, 'Parada');
  assert.equal(cartaoDaColeta(diag({ coleta: [] }), agora).estado, 'Ainda não ligada');
  const f = cartaoDoFechamento(diag());
  assert.deepEqual([f.estado, f.texto], ['Em dia: 16/10', 'Arquivo oficial do pregão de sex, 16/10/2026, importado em 16/10 20:10.']);
  assert.equal(cartaoDoFechamento(diag({ cotahist: { ultimoImportado: '2026-10-15', esperado: '2026-10-16' } })).estado, 'Atrasado');
  assert.equal(cartaoDoFechamento(diag({ cotahist: { ultimoImportado: null, esperado: '2026-10-16' } })).estado, 'Nenhum arquivo ainda');
  assert.equal(cartaoDaSelic(sit()).estado, '14,90% ao ano');
  assert.equal(cartaoDaSelic(sit({}, null)).estado, 'Sem dado ainda');
  assert.equal(cartaoDaBrapi(diag()).estado, 'Desligada');
});

test('linhas das tentativas em português', () => {
  assert.deepEqual(linhaDaTentativa(imp({})), {
    quando: '16/10 20:10', fonte: 'B3 (COTAHIST)', pregao: '16/10/2026', resultado: 'Importado', classe: 'selo-alta',
    detalhe: '48.211 ações e opções, 9112 séries de opções, nenhuma linha recusada',
  });
  assert.equal(linhaDaTentativa(imp({ situacao: 'sem_arquivo', detalhe: 'resposta_nao_e_zip' })).detalhe, 'A B3 ainda não tinha publicado o arquivo. Nova tentativa em 1 hora.');
  assert.equal(linhaDaTentativa(imp({ situacao: 'erro', detalhe: 'http_503' })).detalhe, 'A fonte respondeu com erro 503.');
  assert.equal(linhaDaTentativa(imp({ situacao: 'erro', detalhe: 'The operation was aborted due to timeout' })).detalhe, 'A fonte não respondeu a tempo.');
  const s = linhaDaTentativa(imp({ fonte: 'bcb-selic', registros: 10, detalhe: null }));
  assert.deepEqual([s.fonte, s.pregao, s.detalhe], ['Banco Central', '—', '10 dias da Selic']);
});

test('quadro da cadeia no painel', () => {
  assert.equal(cartaoDaCadeia(sit()).titulo, 'Cadeia de opções: 9.112 séries de 16/10');
  assert.equal(cartaoDaCadeia(sit()).texto, 'Selic de 14,90% ao ano (Banco Central), premissa das gregas calculadas.');
  const atrasado = cartaoDaCadeia(sit({ ultimoImportado: '2026-10-15' }));
  assert.deepEqual([atrasado.titulo, atrasado.classe], ['Fechamento de 16/10 ainda não chegou', 'selo-atencao']);
  assert.equal(cartaoDaCadeia(sit({ ultimoImportado: null })).titulo, 'Cadeia de opções: sem arquivo da B3 ainda');
  assert.equal(cartaoDaCadeia(null).titulo, 'Cadeia de opções: sem arquivo da B3 ainda');
});

test('calendário: ordem dos feriados e aviso do ano seguinte', () => {
  const lista = [{ dia: '2026-12-25' }, { dia: '2026-06-04' }, { dia: '2026-11-20' }, { dia: '2026-09-07' }, { dia: '2027-01-01' }];
  assert.deepEqual(feriadosDoAno(lista, '2026', '2026-10-17').map((f) => [f.dia, f.passou]),
    [['2026-11-20', false], ['2026-12-25', false], ['2026-09-07', true], ['2026-06-04', true]]);
  assert.equal(faltaCalendarioDe(lista, '2026-10-17'), null);
  assert.equal(faltaCalendarioDe([{ dia: '2026-12-25' }], '2026-10-17'), '2027');
  assert.equal(faltaCalendarioDe([{ dia: '2026-12-25' }], '2026-05-01'), null);
});
