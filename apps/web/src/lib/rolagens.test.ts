import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alternativaDoCandidato, consultaDasSugestoes, corpoDaConfirmacao, CRITERIOS_PADRAO, linhasDaConfirmacao, nomeDaAlternativa,
  textoDoErroDaAlternativa, textoDoFluxo, textoDoLiquido, type Simulada,
} from './rolagens.ts';
import { formatarReais } from './formatos.ts';

test('consulta das sugestões: campos vazios ficam de fora, valores em centavos e delta em fração', () => {
  const r = consultaDasSugestoes('e1', 'PETRK380', { ...CRITERIOS_PADRAO, deltaMax: '30', creditoMinimo: '50,00', spreadMaximoPct: '20', strike: 'acima', perdaMaximaNaoAumenta: true });
  assert.ok(r.ok);
  assert.equal(r.consulta, 'estrategiaId=e1&codigo=PETRK380&diasMin=20&diasMax=70&negociosMin=1&deltaMax=0.3&creditoMinimo=5000&spreadMaximoPct=20&strike=acima&perdaMaximaNaoAumenta=true');
  const vazio = consultaDasSugestoes('e1', 'X', { ...CRITERIOS_PADRAO, diasMin: '', diasMax: '', negociosMin: '' });
  assert.ok(vazio.ok);
  assert.equal(vazio.consulta, 'estrategiaId=e1&codigo=X');
});

test('consulta das sugestões recusa o que não faz sentido', () => {
  const erro = (x: Partial<typeof CRITERIOS_PADRAO>) => { const r = consultaDasSugestoes('e', 'c', { ...CRITERIOS_PADRAO, ...x }); return r.ok ? null : r.erro; };
  assert.match(erro({ diasMin: '2,5' }) ?? '', /inteiro/);
  assert.match(erro({ deltaMax: '150' }) ?? '', /entre 0 e 1/);
  assert.match(erro({ creditoMinimo: 'muito' }) ?? '', /reais/);
  assert.match(erro({ diasMin: '80', diasMax: '30' }) ?? '', /passam/);
});

test('textos do fluxo: crédito, débito e sem preço', () => {
  assert.equal(textoDoFluxo({ liquido: 5000 }), `Crédito de ${formatarReais(5000)}`);
  assert.equal(textoDoFluxo({ liquido: -3500 }), `Débito de ${formatarReais(3500)}`);
  assert.equal(textoDoFluxo({ liquido: 0 }), 'Sem crédito nem débito');
  assert.equal(textoDoLiquido(null), 'Sem preço');
  assert.equal(textoDoErroDaAlternativa({ erro: 'sem_preco', codigo: 'X1' }), 'X1: sem preço para este código (nem oferta nem negócio)');
  assert.equal(textoDoErroDaAlternativa({ erro: 'rolagem_vazia' }), 'Nada para encerrar nem abrir');
});

test('alternativa a partir de um candidato mantém lado e quantidade', () => {
  const c = { codigo: 'PETRL400', strike: 4000, vencimento: '2026-12-18' };
  assert.equal(nomeDaAlternativa(c), 'PETRL400 (40,00, dez)');
  assert.deepEqual(alternativaDoCandidato({ codigo: 'PETRK380', quantidade: -300 }, c), {
    nome: 'PETRL400 (40,00, dez)', encerrar: [{ codigo: 'PETRK380', quantidade: 300 }], abrir: [{ codigo: 'PETRL400', lado: 'venda', quantidade: 300 }],
  });
});

test('confirmação: preços da simulação viram o formulário e voltam em centavos', () => {
  const s = {
    nome: 'a', ok: true,
    precos: [{ acao: 'encerrar' }, { acao: 'abrir' }],
    execucoes: [
      { codigo: 'K', tipo: 'call', strike: 3800, vencimento: '2026-11-23', lado: 'compra', quantidade: 100, preco: 130, custos: 0 },
      { codigo: 'L', tipo: 'call', strike: 4000, vencimento: '2026-12-18', lado: 'venda', quantidade: 100, preco: 180, custos: 0 },
    ],
  } as unknown as Extract<Simulada, { ok: true }>;
  const linhas = linhasDaConfirmacao(s);
  assert.deepEqual(linhas.map((l) => [l.acao, l.codigo, l.preco]), [['encerrar', 'K', '1,30'], ['abrir', 'L', '1,80']]);
  const agora = new Date('2026-10-16T17:00:00Z');
  const ok = corpoDaConfirmacao('e1', [{ ...linhas[0]!, preco: '1,28', custos: '3,00' }, linhas[1]!], '2026-10-16', '13:50', ' rolei ', agora);
  assert.ok(ok.ok);
  assert.deepEqual(ok.corpo, {
    estrategiaId: 'e1', instante: '2026-10-16T16:50:00.000Z', observacao: 'rolei',
    encerrar: [{ codigo: 'K', quantidade: 100, preco: 128, custos: 300 }],
    abrir: [{ codigo: 'L', lado: 'venda', quantidade: 100, preco: 180, custos: 0, tipo: 'call', strike: 4000, vencimento: '2026-12-18' }],
  });
  const futuro = corpoDaConfirmacao('e1', linhas, '2026-10-17', '10:00', '', agora);
  assert.ok(!futuro.ok && /futuro/.test(futuro.erro));
  const semPreco = corpoDaConfirmacao('e1', [{ ...linhas[0]!, preco: '' }], '2026-10-16', '13:50', '', agora);
  assert.ok(!semPreco.ok && /preço/.test(semPreco.erro));
});

test('gráfico comparado usa uma escala só para todas as curvas', async () => {
  const { graficoComparado } = await import('./rolagens.ts');
  const g = graficoComparado([[{ s: 3000, resultado: -100 }, { s: 4000, resultado: 200 }], null, [{ s: 3500, resultado: -500 }, { s: 4500, resultado: 0 }]]);
  assert.ok(g);
  assert.deepEqual([g.de, g.ate], [3000, 4500]);
  assert.ok(g.min < -500 && g.max > 200);
  assert.equal(g.caminhos[1], null);
  assert.ok(g.caminhos[0]?.startsWith('M92.0'));
  assert.equal(graficoComparado([null]), null);
});

test('critérios do formulário para guardar nos avisos', async () => {
  const { criteriosDoFormulario } = await import('./rolagens.ts');
  const r = criteriosDoFormulario({ ...CRITERIOS_PADRAO, deltaMax: '0,3', creditoMinimo: '10', strike: 'manter', mesmoVencimento: true, perdaMaximaNaoAumenta: true });
  assert.deepEqual(r, { ok: true, criterios: { diasMin: 20, diasMax: 70, negociosMin: 1, deltaMax: 0.3, creditoMinimo: 1000, strike: 'manter', perdaMaximaNaoAumenta: true } });
  assert.equal(criteriosDoFormulario({ ...CRITERIOS_PADRAO, diasMin: 'x' }).ok, false);
});
