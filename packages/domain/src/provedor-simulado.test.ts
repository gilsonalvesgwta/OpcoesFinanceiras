import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProvedorSimulado } from './provedor-simulado.ts';
import { ErroDoProvedor } from './provedor.ts';
import { qualidadeDaCotacao } from './cotacoes.ts';

const relogio = { t: new Date('2026-10-15T15:00:00Z') };
const cenario = {
  agora: () => relogio.t,
  precos: new Map([['PETR4', { ultimo: 3850, bid: 3849, ask: 3851 }]]),
  cadeias: new Map(),
  falhar: null as ErroDoProvedor | null,
};

test('cotação simulada é sempre marcada como simulada', async () => {
  const p = new ProvedorSimulado(cenario);
  const [c] = await p.cotacoes(['PETR4', 'NAOEXISTE3']);
  assert.equal(c?.ultimo, 3850);
  assert.equal(qualidadeDaCotacao(c ?? null, p.capacidades.acoes, { agora: relogio.t, mercadoAberto: true, provedorConectado: true }), 'simulado');
});

test('falha do provedor aparece no estado e não devolve dado velho', async () => {
  const p = new ProvedorSimulado(cenario);
  await p.cotacoes(['PETR4']);
  cenario.falhar = new ErroDoProvedor('indisponivel', 'fora do ar', 30);
  await assert.rejects(p.cotacoes(['PETR4']), (e: unknown) => e instanceof ErroDoProvedor && e.tentarDepoisSeg === 30);
  assert.equal(p.estado().conectado, false);
  assert.equal(p.estado().ultimoErro?.mensagem, 'fora do ar');
  cenario.falhar = null;
  assert.equal(p.estado().conectado, true);
});

test('recurso não suportado é declarado, não inventado', async () => {
  const p = new ProvedorSimulado(cenario);
  assert.equal(p.capacidades.gregas, false);
  await assert.rejects(p.gregas(), /não fornece gregas/);
  await assert.rejects(p.cadeia('PETR4', '2026-11-20'), /sem cadeia/);
});
