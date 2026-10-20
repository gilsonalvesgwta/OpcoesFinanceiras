import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosDasEstrategias, lerPreferencias, PREFERENCIAS_PADRAO, type ContextoDosAvisos } from './avisos-posicao.ts';
import { montarCarteira, type Execucao } from './posicoes.ts';

const t = (m: number) => new Date(Date.UTC(2026, 9, 1, 13, m)).toISOString();
const exec = (x: Partial<Execucao> & Pick<Execucao, 'codigo' | 'tipo' | 'lado' | 'quantidade' | 'preco'>, m: number): Execucao => ({ instante: t(m), ...x });
const est = (id: string, execs: Execucao[]) => ({ id, nome: `E${id}`, ativoObjeto: 'X3', carteira: montarCarteira(execs) });
const ctx = (pregoes: number, spot: number | null): ContextoDosAvisos => ({
  hoje: '2026-11-16', diasDePregaoAte: () => pregoes, spot: () => (spot === null ? null : { valor: spot, dia: '2026-11-13' }),
});

const vendaCoberta = est('1', [
  exec({ codigo: 'X3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3800 }, 1),
  exec({ codigo: 'XK400', tipo: 'call', strike: 4000, vencimento: '2026-11-23', lado: 'venda', quantidade: 100, preco: 80 }, 2),
]);

test('vencimento: só o limite mais próximo, com a situação no dinheiro', () => {
  const a = avisosDasEstrategias([vendaCoberta], ctx(4, 3950), { ...PREFERENCIAS_PADRAO, risco: false });
  assert.equal(a.length, 1);
  assert.equal(a[0]?.chave, 'venc:1:XK400:2026-11-23:5');
  assert.equal(a[0]?.titulo, 'XK400 vence em 4 pregões (23/11)');
  assert.match(a[0]?.texto ?? '', /fora do dinheiro/);
  const ultimo = avisosDasEstrategias([vendaCoberta], ctx(1, 4100), { ...PREFERENCIAS_PADRAO, risco: false });
  assert.equal(ultimo[0]?.chave, 'venc:1:XK400:2026-11-23:1');
  assert.match(ultimo[0]?.texto ?? '', /dentro do dinheiro e pode ser exercida contra você/);
  assert.deepEqual(avisosDasEstrategias([vendaCoberta], ctx(8, 3800), PREFERENCIAS_PADRAO), [], 'longe do vencimento e do strike: nada');
});

test('risco: opção vendida a menos de X% do strike ou dentro do dinheiro, um por pregão', () => {
  const pref = { ...PREFERENCIAS_PADRAO, vencimento: false };
  const perto = avisosDasEstrategias([vendaCoberta], ctx(10, 3930), pref);
  assert.equal(perto.length, 1);
  assert.equal(perto[0]?.chave, 'risco:1:XK400:2026-11-13');
  assert.match(perto[0]?.texto ?? '', /a 1,8% do strike/);
  assert.match(avisosDasEstrategias([vendaCoberta], ctx(10, 4100), pref)[0]?.texto ?? '', /já está dentro do dinheiro \(2,5% além do strike\)/);
  assert.deepEqual(avisosDasEstrategias([vendaCoberta], ctx(10, 3900), pref), [], 'a 2,5%: fora do limite de 2%');
  assert.deepEqual(avisosDasEstrategias([vendaCoberta], ctx(10, null), pref), [], 'sem fechamento: sem aviso de risco');
});

test('calls sem cobertura: chave muda com a quantidade', () => {
  const nua = est('2', [exec({ codigo: 'XK400', tipo: 'call', strike: 4000, vencimento: '2026-11-23', lado: 'venda', quantidade: 300, preco: 80 }, 1),
    exec({ codigo: 'X3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3800 }, 2)]);
  const a = avisosDasEstrategias([nua, vendaCoberta], ctx(10, 3000), { ...PREFERENCIAS_PADRAO, vencimento: false, risco: false });
  assert.deepEqual(a.map((x) => x.chave), ['descoberta:2:200']);
});

test('preferências: lê o que veio e completa com o padrão', () => {
  assert.deepEqual(lerPreferencias({}), PREFERENCIAS_PADRAO);
  const p = lerPreferencias({ diasAntes: [1, 5, 5, 99, -1, 2.5, 10], risco: false, distanciaStrikePct: 50, sugestoes: true, telegram: 'sim' });
  assert.deepEqual(p.diasAntes, [10, 5, 1]);
  assert.equal(p.risco, false);
  assert.equal(p.distanciaStrikePct, 2);
  assert.equal(p.sugestoes, true);
  assert.equal(p.telegram, true);
});
