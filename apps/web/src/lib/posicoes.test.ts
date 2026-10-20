import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferirComCorretora, dataEHoraEmBrasilia, descreverExecucao, descreverInstrumento, descreverPosicao, execucaoDoFormulario,
  montarGrafico, pernaVazia, textoDoExtremo, type FormularioDaPerna,
} from './posicoes.ts';
import { formatarReais } from './formatos.ts';

const agora = new Date('2026-10-16T17:00:00Z'); // 14:00 em Brasília
const f = (x: Partial<FormularioDaPerna>): FormularioDaPerna => ({
  ...pernaVazia(agora), codigo: 'petrk380', strike: '38,00', vencimento: '2026-11-23', preco: '1,25', custos: '4,90', ...x,
});

test('formulário vazio começa agora, em Brasília', () => {
  assert.deepEqual(dataEHoraEmBrasilia(agora), { data: '2026-10-16', hora: '14:00' });
  assert.equal(pernaVazia(agora).quantidade, '100');
});

test('execução do formulário em centavos, com o fuso de Brasília', () => {
  const r = execucaoDoFormulario(f({}), agora);
  assert.ok(r.ok);
  assert.deepEqual(r.execucao, {
    codigo: 'PETRK380', tipo: 'call', lado: 'venda', quantidade: 100, preco: 125, custos: 490, instante: '2026-10-16T17:00:00.000Z', strike: 3800, vencimento: '2026-11-23',
  });
  const acao = execucaoDoFormulario(f({ codigo: 'PETR4', tipo: 'ativo', lado: 'compra', preco: '38,12', custos: '', quantidade: '1.000' }), agora);
  assert.ok(acao.ok);
  assert.deepEqual([acao.execucao.preco, acao.execucao.custos, acao.execucao.quantidade, 'strike' in acao.execucao], [3812, 0, 1000, false]);
});

test('formulário recusa o que não dá para gravar', () => {
  const erro = (x: Partial<FormularioDaPerna>) => { const r = execucaoDoFormulario(f(x), agora); return r.ok ? null : r.erro; };
  assert.match(erro({ codigo: 'X' }) ?? '', /código/);
  assert.match(erro({ quantidade: '0' }) ?? '', /quantidade/);
  assert.match(erro({ quantidade: '1,5' }) ?? '', /quantidade/);
  assert.match(erro({ preco: '' }) ?? '', /preço/);
  assert.match(erro({ custos: 'abc' }) ?? '', /custos/);
  assert.match(erro({ strike: '' }) ?? '', /strike/);
  assert.match(erro({ vencimento: '' }) ?? '', /vencimento/);
  assert.match(erro({ data: '2026-10-17' }) ?? '', /futuro/);
});

test('textos das pernas', () => {
  assert.equal(descreverInstrumento({ tipo: 'call', strike: 3800, vencimento: '2026-11-23' }), 'Call 38,00 · vence 23/11');
  assert.equal(descreverInstrumento({ tipo: 'ativo', strike: null, vencimento: null }), 'Ação');
  assert.equal(descreverPosicao(-1500), 'Vendido 1.500');
  assert.equal(descreverPosicao(0), 'Encerrada');
  assert.equal(descreverExecucao({ lado: 'compra', quantidade: 100, codigo: 'PETRK380', preco: 125 }), 'Compra de 100 PETRK380 a R$ 1,25');
  assert.equal(textoDoExtremo({ tipo: 'limitado', valor: -8000, emPreco: 0 }), formatarReais(-8000));
  assert.match(textoDoExtremo({ tipo: 'ilimitado' }), /Sem limite/);
});

test('conferência com a corretora', () => {
  const c = conferirComCorretora(
    [{ codigo: 'B', lado: 'venda', quantidade: 300, precoMedio: 72 }, { codigo: 'A', lado: 'compra', quantidade: 100, precoMedio: 10 }, { codigo: 'C', lado: 'compra', quantidade: 5, precoMedio: 1 }],
    { A: 100, B: -200, D: 50 },
  );
  assert.deepEqual(c.map((x) => [x.codigo, x.situacao, x.corretora, x.registrado]), [
    ['A', 'confere', 100, 100], ['B', 'diferente', -300, -200], ['C', 'nao_registrada', 5, 0], ['D', 'so_no_sistema', 0, 50],
  ]);
});

test('gráfico: zero dentro da escala, áreas fechadas', () => {
  const g = montarGrafico([{ s: 3000, resultado: -8000 }, { s: 3800, resultado: -8000 }, { s: 4000, resultado: 12000 }, { s: 5000, resultado: 12000 }]);
  assert.ok(g);
  assert.ok(g.min < -8000 && g.max > 12000);
  assert.equal(g.x(3000), 92);
  assert.equal(g.x(5000), 640 - 12);
  assert.ok((g.yZero as number) > g.y(12000) && (g.yZero as number) < g.y(-8000));
  assert.ok(g.caminhoLucro.endsWith('Z') && g.caminhoPrejuizo.startsWith('M92.0'));
  assert.equal(montarGrafico([{ s: 1, resultado: 0 }]), null);
  const plano = montarGrafico([{ s: 1, resultado: 0 }, { s: 2, resultado: 0 }]);
  assert.ok(plano && plano.max > plano.min, 'curva plana não divide por zero');
});
