import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contaDaPonte, detalheDaCotacao, encerrarAgora, estadoDaPonte, formatarPreco, formatarPrecoMedio, formatarResultado, haQuanto, variacaoDoDia,
  type CotacaoDaApi, type Ponte,
} from './ponte.ts';

const agora = new Date('2026-10-16T17:52:10Z'); // 14:52:10 em Brasília
const cot = (extra: Partial<CotacaoDaApi> = {}): CotacaoDaApi => ({
  codigo: 'PETR4', provedor: 'mt5', ultimo: 3847, bid: 3846, ask: 3848, fechamentoAnterior: 3800, volume: 1000,
  instanteDaFonte: '2026-10-16T17:52:07Z', instanteDeRecebimento: '2026-10-16T17:52:08Z', sinalDaPonteEm: '2026-10-16T17:52:08Z',
  qualidade: 'tempo_real', ...extra,
});
const nb = (t: string) => t.replace(/\s/g, ' ');

test('linha de apoio de cada estado', () => {
  assert.equal(detalheDaCotacao(cot(), agora), 'mudou às 14:52:07');
  assert.equal(detalheDaCotacao(cot({ provedor: 'brapi', qualidade: 'periodica' }), agora), 'brapi, com uns 30 min de atraso: preço de 16/10 às 14:52');
  assert.equal(detalheDaCotacao(cot({ qualidade: 'atrasada', sinalDaPonteEm: '2026-10-16T17:51:45Z' }), agora), 'sem sinal há 25 segundos');
  assert.equal(detalheDaCotacao(cot({ qualidade: 'desconectado', sinalDaPonteEm: '2026-10-16T17:31:00Z' }), agora), 'último sinal em 16/10 às 14:31');
  assert.equal(detalheDaCotacao(cot({ qualidade: 'historico', instanteDaFonte: '2026-10-16T19:54:00Z' }), agora), 'preço de 16/10 às 16:54');
  assert.equal(detalheDaCotacao(cot({ instanteDaFonte: null }), agora), '');
});

test('há quanto tempo', () => {
  assert.equal(haQuanto('2026-10-16T17:52:08Z', agora), 'há 2 segundos');
  assert.equal(haQuanto('2026-10-16T17:49:10Z', agora), 'há 3 minutos');
  assert.equal(haQuanto(null, agora), 'nunca');
});

test('variação do dia não inventa zero', () => {
  assert.ok(Math.abs((variacaoDoDia(cot()) as number) - 0.012368) < 1e-5);
  assert.equal(variacaoDoDia(cot({ ultimo: null })), null);
  assert.equal(variacaoDoDia(cot({ fechamentoAnterior: null })), null);
});

test('encerrar agora: comprado pelo bid, vendido pelo ask, sem oferta sem resultado', () => {
  assert.deepEqual(encerrarAgora({ lado: 'compra', quantidade: 300, precoMedio: 3656 }, cot()), { ok: true, preco: 3846, origem: 'melhor compra', resultado: 57000 });
  assert.deepEqual(encerrarAgora({ lado: 'venda', quantidade: 300, precoMedio: 72 }, cot({ bid: 92, ask: 95 })), { ok: true, preco: 95, origem: 'melhor venda', resultado: -6900 });
  assert.deepEqual(encerrarAgora({ lado: 'compra', quantidade: 1, precoMedio: 1 }, cot({ bid: null })), { ok: false, motivo: 'sem oferta de compra' });
  assert.deepEqual(encerrarAgora({ lado: 'venda', quantidade: 1, precoMedio: 1 }, cot({ ask: null })), { ok: false, motivo: 'sem oferta de venda' });
  assert.deepEqual(encerrarAgora({ lado: 'venda', quantidade: 1, precoMedio: 1 }, undefined), { ok: false, motivo: 'sem cotação' });
  assert.equal(encerrarAgora({ lado: 'compra', quantidade: 100, precoMedio: 3655.5 }, cot()).ok && (encerrarAgora({ lado: 'compra', quantidade: 100, precoMedio: 3655.5 }, cot()) as { resultado: number }).resultado, 19050);
});

test('formatos de preço e resultado', () => {
  assert.equal(nb(formatarResultado(57000)), '+R$ 570,00');
  assert.equal(nb(formatarResultado(-6900)), '−R$ 69,00');
  assert.equal(formatarPreco(3846), '38,46');
  assert.equal(formatarPreco(null), '—');
  assert.equal(nb(formatarPrecoMedio(3655.5)), 'R$ 36,555');
  assert.equal(nb(formatarPrecoMedio(72)), 'R$ 0,72');
});

test('estado e conta da ponte', () => {
  const p: Ponte = {
    id: 'x', nome: 'Genial', criadaEm: null, revogadaEm: null, ultimoContatoEm: null, versao: null,
    conta: { login: null, servidor: null, corretora: null }, estado: 'desconectado',
  };
  assert.equal(estadoDaPonte(p).texto, 'Aguardando o primeiro sinal');
  assert.equal(estadoDaPonte({ ...p, ultimoContatoEm: '2026-10-16T17:52:08Z', estado: 'tempo_real' }).texto, 'Conectada');
  assert.equal(estadoDaPonte({ ...p, ultimoContatoEm: '2026-10-16T17:00:00Z' }).texto, 'Desconectada');
  assert.equal(estadoDaPonte({ ...p, revogadaEm: '2026-10-16T17:00:00Z', estado: 'revogada' }).texto, 'Revogada');
  assert.equal(contaDaPonte(p), 'Conta ainda não informada');
  assert.equal(contaDaPonte({ ...p, conta: { login: '123456', servidor: 'GenialInvestimentos-PRD', corretora: 'Genial Investimentos' } }),
    'Conta 123456 · GenialInvestimentos-PRD · Genial Investimentos');
});
