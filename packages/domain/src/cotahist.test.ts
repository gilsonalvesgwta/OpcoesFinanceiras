import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cotacaoDoFechamento, lerCotahist, lerLinhaCotahist, seriesDeOpcoes } from './cotahist.ts';
import { qualidadeDaCotacao } from './cotacoes.ts';

// Monta uma linha de 245 posições seguindo o layout oficial (posições 1-indexadas).
type Campos = {
  data?: string; codbdi?: string; codigo: string; tpmerc: number; nome?: string; especi?: string;
  abe?: number; max?: number; min?: number; med?: number; ult?: number; ofc?: number; ofv?: number;
  neg?: number; qua?: number; vol?: number; exe?: number; venc?: string; fat?: number; isin?: string;
};
function linha(c: Campos): string {
  const l = Array(245).fill(' ');
  const pos = (de: number, ate: number, v: string, num = false) => {
    const tam = ate - de + 1;
    const s = num ? v.padStart(tam, '0') : v.padEnd(tam, ' ');
    if (s.length !== tam) throw new Error(`tamanho errado em ${de}`);
    for (let i = 0; i < tam; i += 1) l[de - 1 + i] = s[i] as string;
  };
  const n = (de: number, ate: number, v: number) => pos(de, ate, String(v), true);
  pos(1, 2, '01');
  pos(3, 10, c.data ?? '20261015');
  pos(11, 12, c.codbdi ?? '02');
  pos(13, 24, c.codigo);
  n(25, 27, c.tpmerc);
  pos(28, 39, c.nome ?? 'PETROBRAS');
  pos(40, 49, c.especi ?? 'PN');
  pos(53, 56, 'R$');
  n(57, 69, c.abe ?? 0); n(70, 82, c.max ?? 0); n(83, 95, c.min ?? 0); n(96, 108, c.med ?? 0);
  n(109, 121, c.ult ?? 0); n(122, 134, c.ofc ?? 0); n(135, 147, c.ofv ?? 0);
  n(148, 152, c.neg ?? 0); n(153, 170, c.qua ?? 0); n(171, 188, c.vol ?? 0);
  n(189, 201, c.exe ?? 0); n(202, 202, 0); pos(203, 210, c.venc ?? '99991231');
  n(211, 217, c.fat ?? 1); n(218, 230, 0); pos(231, 242, c.isin ?? 'BRPETRACNPR6'); n(243, 245, 100);
  return l.join('');
}

const PETR4 = linha({ codigo: 'PETR4', tpmerc: 10, especi: 'PN N2', abe: 3800, max: 3870, min: 3790, med: 3830, ult: 3850, ofc: 3849, ofv: 3851, neg: 50000, qua: 30000000, vol: 115000000000 });
const PETR3 = linha({ codigo: 'PETR3', tpmerc: 10, especi: 'ON N2', ult: 4100 });
const CALL = linha({ codigo: 'PETRK400', tpmerc: 70, especi: 'PN', ult: 85, ofc: 84, ofv: 86, neg: 120, qua: 500000, vol: 4250000, exe: 4000, venc: '20261120' });
const PUT_SEM_OFERTA = linha({ codigo: 'PETRW360', tpmerc: 80, especi: 'PN', ult: 40, exe: 3600, venc: '20261120' });
const CALL_ON = linha({ codigo: 'PETRK420', tpmerc: 70, especi: 'ON', ult: 30, exe: 4200, venc: '20261120' });
const SEM_AVISTA = linha({ codigo: 'XPTOK100', tpmerc: 70, especi: 'PN', ult: 10, exe: 1000, venc: '20261120' });

test('lê ação à vista com preços em centavos', () => {
  const r = lerLinhaCotahist(PETR4)!;
  assert.equal(r.data, '2026-10-15');
  assert.equal(r.codigo, 'PETR4');
  assert.equal(r.ultimo, 3850);
  assert.equal(r.melhorCompra, 3849);
  assert.equal(r.melhorVenda, 3851);
  assert.equal(r.quantidade, 30000000);
  assert.equal(r.volumeFinanceiro, 115000000000);
  assert.equal(r.strike, null);
  assert.equal(r.vencimento, null);
  assert.equal(r.especificacao, 'PN N2');
});

test('lê opção com strike e vencimento; oferta zerada vira null, não preço zero', () => {
  const c = lerLinhaCotahist(CALL)!;
  assert.deepEqual([c.tipoMercado, c.strike, c.vencimento, c.ultimo, c.melhorCompra, c.melhorVenda], [70, 4000, '2026-11-20', 85, 84, 86]);
  const p = lerLinhaCotahist(PUT_SEM_OFERTA)!;
  assert.equal(p.melhorCompra, null);
  assert.equal(p.melhorVenda, null);
});

test('fator de cotação converte para preço por unidade e recusa fração', () => {
  assert.equal(lerLinhaCotahist(linha({ codigo: 'ABCD3', tpmerc: 10, ult: 125000, fat: 1000 }))!.ultimo, 125);
  assert.throws(() => lerLinhaCotahist(linha({ codigo: 'ABCD3', tpmerc: 10, ult: 125001, fat: 1000 })), /fator_de_cotacao_nao_inteiro/);
});

test('arquivo inteiro: cabeçalho, registros, rodapé e linha quebrada', () => {
  const cabecalho = '00COTAHIST.2026BOVESPA 20261015'.padEnd(245, ' ');
  const rodape = '99COTAHIST.2026BOVESPA 20261015'.padEnd(245, ' ');
  const quebrada = '01' + 'x'.repeat(243);
  const l = lerCotahist([cabecalho, PETR4, CALL, quebrada, rodape, ''].join('\r\n'));
  assert.equal(l.dataDoArquivo, '2026-10-15');
  assert.deepEqual(l.registros.map((r) => r.codigo), ['PETR4', 'PETRK400']);
  assert.equal(l.recusadas.length, 1);
  assert.equal(l.recusadas[0]?.linha, 4);
});

test('opção é ligada ao ativo-objeto pela raiz e pela classe; sem certeza fica null', () => {
  const regs = [PETR4, PETR3, CALL, PUT_SEM_OFERTA, CALL_ON, SEM_AVISTA].map((x) => lerLinhaCotahist(x)!);
  const series = seriesDeOpcoes(regs);
  const de = (c: string) => series.find((s) => s.codigo === c);
  assert.equal(de('PETRK400')?.ativoObjeto, 'PETR4');
  assert.equal(de('PETRK400')?.tipo, 'call');
  assert.equal(de('PETRW360')?.tipo, 'put');
  assert.equal(de('PETRK420')?.ativoObjeto, 'PETR3');
  assert.equal(de('XPTOK100')?.ativoObjeto, null);
  assert.equal(de('PETRK400')?.estilo, null);
});

test('cotação do fechamento sai com qualidade "histórico", nunca como atual', () => {
  const cot = cotacaoDoFechamento(lerLinhaCotahist(CALL)!, '2026-10-16T01:00:00Z');
  assert.equal(cot.instanteDaFonte, '2026-10-15T17:00:00-03:00');
  assert.equal(cot.provedor, 'b3-cotahist');
  const q = qualidadeDaCotacao(cot, { nome: 'b3-cotahist', modo: 'fim_de_dia', intervaloSeg: 86400 }, { agora: new Date('2026-10-16T14:00:00Z'), mercadoAberto: true, provedorConectado: true });
  assert.equal(q, 'historico');
});
