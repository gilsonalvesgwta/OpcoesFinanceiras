// Régua de preços dos lotes (escala e marcas redondas) e o link para simular um lote.

import type { LoteDaCarteira, SugestaoDoLote } from './carteira.ts';

// Escala linear dos preços (centavos) para a largura do desenho, com folga nas pontas,
// e 4 a 6 marcas em valores redondos (0,10 · 0,25 · 0,50 · 1 · 2 · 5 · 10...).
export function escalaDosLotes(valores: readonly number[], x0: number, x1: number): { x: (v: number) => number; marcas: number[] } {
  const v = valores.filter((n) => Number.isFinite(n));
  let min = v.length ? Math.min(...v) : 0;
  let max = v.length ? Math.max(...v) : 100;
  if (max - min < 20) { min -= 10; max += 10; }
  const folga = (max - min) * 0.08;
  min -= folga; max += folga;
  const passos = [10, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  const passo = passos.find((p) => (max - min) / p <= 6) ?? 10000;
  const marcas: number[] = [];
  for (let m = Math.ceil(min / passo) * passo; m <= max; m += passo) marcas.push(m);
  const x = (n: number) => x0 + ((n - min) / (max - min)) * (x1 - x0);
  return { x, marcas };
}

// Simulador com a ação do lote como base e a venda da call sugerida na quantidade do lote.
export function linkParaSimularLote(ativo: string, l: Pick<LoteDaCarteira, 'quantidade' | 'precoComCustos'>, s: Pick<SugestaoDoLote, 'codigo' | 'vencimento'>): string {
  const q = new URLSearchParams({ ativo, vencimento: s.vencimento, lote: `${l.quantidade}:${Math.round(l.precoComCustos)}`, montar: `${s.codigo}:venda` });
  return `/simulador?${q.toString()}`;
}

// Lê o ?lote=300:2015 do simulador.
export function lerLote(texto: string | null): { quantidade: number; preco: number } | null {
  const m = /^(\d{1,9}):(\d{1,9})$/.exec(texto ?? '');
  if (!m) return null;
  const quantidade = Number(m[1]);
  const preco = Number(m[2]);
  return quantidade > 0 && preco > 0 ? { quantidade, preco } : null;
}

// Faixas de preço dos lotes: com muitos lotes, agrupa por faixas redondas (0,25 · 0,50 ·
// 1 · 2 · 5 · 10 reais...) para ficar no máximo 8 faixas. Cada faixa traz a quantidade,
// o custo médio, o resultado agora e a call sugerida para cobrir a faixa inteira: a do lote
// mais caro da faixa (assim, se for exercida, nenhum lote da faixa dá prejuízo).
export type FaixaDosLotes = {
  de: number; ate: number; quantidade: number; lotes: LoteDaCarteira[]; custoMedio: number; custo: number;
  resultado: number | null; resultadoFracao: number | null; temPm: boolean; temAgora: boolean;
  sugestao: (SugestaoDoLote & { receitaDaFaixa: number | null; seExercidoDaFaixa: number | null; fracaoSeExercido: number | null }) | null;
};

export function passoDasFaixas(min: number, max: number): number {
  const passos = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  return passos.find((p) => Math.floor(max / p) - Math.floor(min / p) + 1 <= 8) ?? 50000;
}

export function faixasDosLotes(lotes: readonly LoteDaCarteira[], preco: number | null, precoMedio: number): FaixaDosLotes[] {
  if (!lotes.length) return [];
  const custos = lotes.map((l) => l.precoComCustos);
  const passo = passoDasFaixas(Math.min(...custos), Math.max(...custos));
  const grupos = new Map<number, LoteDaCarteira[]>();
  for (const l of lotes) {
    const k = Math.floor(l.precoComCustos / passo);
    if (!grupos.has(k)) grupos.set(k, []);
    (grupos.get(k) as LoteDaCarteira[]).push(l);
  }
  return [...grupos.entries()].sort((a, b) => a[0] - b[0]).map(([k, ls]) => {
    const de = k * passo;
    const ate = de + passo;
    const quantidade = ls.reduce((t, l) => t + l.quantidade, 0);
    const custo = ls.reduce((t, l) => t + l.custo, 0);
    const resultado = preco === null ? null : Math.round(quantidade * preco - custo);
    const maisCaro = [...ls].filter((l) => l.sugestao).sort((a, b) => b.precoComCustos - a.precoComCustos)[0];
    const s = maisCaro?.sugestao ?? null;
    const receitaDaFaixa = s?.premio != null ? Math.round(s.premio * quantidade) : null;
    const seExercidoDaFaixa = s ? Math.round(quantidade * s.strike - custo + (receitaDaFaixa ?? 0)) : null;
    return {
      de, ate, quantidade, lotes: ls, custo, custoMedio: Math.round((custo / quantidade) * 100) / 100,
      resultado, resultadoFracao: resultado !== null && custo > 0 ? resultado / custo : null,
      temPm: precoMedio >= de && precoMedio < ate, temAgora: preco !== null && preco >= de && preco < ate,
      sugestao: s ? { ...s, receitaDaFaixa, seExercidoDaFaixa, fracaoSeExercido: seExercidoDaFaixa !== null && custo > 0 ? seExercidoDaFaixa / custo : null } : null,
    };
  });
}
