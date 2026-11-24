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
