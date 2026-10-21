// Simulador de opções: pernas montadas pelo usuário (compra e venda de calls, puts e do
// ativo), inclusive com VENCIMENTOS DIFERENTES, avaliadas em qualquer data até o último
// vencimento. Tudo aqui é ESTIMATIVA DO MODELO (Black-Scholes, ver modelo.ts):
// - perna viva: preço teórico com a volatilidade da perna (+ deslocamento escolhido),
//   juros contínuos e os pregões que faltam a partir da data avaliada;
// - perna vencida na data avaliada: valor intrínseco;
// - ativo-objeto: o próprio preço.
// Opção viva sem volatilidade não vira zero: o resultado fica null e diz qual faltou.

import { blackScholes } from './modelo.ts';
import type { Lado } from './payoff.ts';

export type PernaSimulada = {
  codigo: string;
  tipo: 'call' | 'put' | 'ativo';
  strike?: number; // centavos
  vencimento?: string; // AAAA-MM-DD
  lado: Lado;
  quantidade: number;
  preco: number; // centavos por unidade, preço de entrada
  vol: number | null; // volatilidade anual da série (0,30 = 30%)
  multiplicador?: number;
};

export type AvaliacaoDaSimulacao = {
  taxa: number; // contínua ao ano
  restam: (vencimento: string) => number; // pregões entre a data avaliada e o vencimento
  deslocamentoDeVol?: number; // somado à vol de cada perna (0,05 = +5 pontos)
};

const sinal = (p: PernaSimulada) => (p.lado === 'compra' ? 1 : -1);
const exposicao = (p: PernaSimulada) => sinal(p) * p.quantidade * (p.multiplicador ?? 1);

// Valor de uma unidade da perna (centavos) com o ativo a `spot` centavos.
export function valorDaPerna(p: PernaSimulada, spot: number, a: AvaliacaoDaSimulacao): number | null {
  if (p.tipo === 'ativo') return spot;
  const k = p.strike as number;
  const intrinseco = p.tipo === 'call' ? Math.max(spot - k, 0) : Math.max(k - spot, 0);
  const restam = a.restam(p.vencimento as string);
  if (restam <= 0) return intrinseco;
  if (p.vol === null || !(p.vol > 0)) return null;
  const sigma = Math.max(0.01, p.vol + (a.deslocamentoDeVol ?? 0));
  return blackScholes({ tipo: p.tipo, s: spot / 100, k: k / 100, t: restam / 252, r: a.taxa, sigma }).preco * 100;
}

// Resultado (centavos) da montagem inteira contra os preços de entrada.
export function resultadoDaSimulacao(pernas: readonly PernaSimulada[], spot: number, a: AvaliacaoDaSimulacao): { resultado: number | null; semVol: string[] } {
  let total = 0;
  const semVol: string[] = [];
  for (const p of pernas) {
    const v = valorDaPerna(p, spot, a);
    if (v === null) { semVol.push(p.codigo); continue; }
    total += exposicao(p) * (v - p.preco);
  }
  return semVol.length ? { resultado: null, semVol } : { resultado: Math.round(total), semVol };
}

// Caixa da montagem: positivo = crédito recebido, negativo = débito pago.
export function caixaDaMontagem(pernas: readonly PernaSimulada[]): number {
  return Math.round(pernas.reduce((t, p) => t - exposicao(p) * p.preco, 0));
}

export type PontoDaCurva = { s: number; resultado: number | null };

export function curvaDaSimulacao(pernas: readonly PernaSimulada[], de: number, ate: number, a: AvaliacaoDaSimulacao, passos = 120): PontoDaCurva[] {
  if (!(ate > de) || de < 0) return [];
  const precos = new Set<number>();
  for (let i = 0; i <= passos; i += 1) precos.add(Math.round(de + ((ate - de) * i) / passos));
  for (const p of pernas) if (p.strike !== undefined && p.strike >= de && p.strike <= ate) precos.add(p.strike);
  return [...precos].sort((x, y) => x - y).map((s) => ({ s: Math.max(1, s), resultado: resultadoDaSimulacao(pernas, Math.max(1, s), a).resultado }));
}

// Pontos de equilíbrio (em centavos) por interpolação entre os pontos da curva.
export function equilibriosDaCurva(curva: readonly PontoDaCurva[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < curva.length; i += 1) {
    const a = curva[i - 1] as PontoDaCurva;
    const b = curva[i] as PontoDaCurva;
    if (a.resultado === null || b.resultado === null) continue;
    if (a.resultado === 0) { if (!r.includes(a.s)) r.push(a.s); continue; }
    if ((a.resultado < 0 && b.resultado > 0) || (a.resultado > 0 && b.resultado < 0)) {
      r.push(Math.round(a.s + ((-a.resultado) * (b.s - a.s)) / (b.resultado - a.resultado)));
    }
  }
  const ultimo = curva[curva.length - 1];
  if (ultimo?.resultado === 0 && !r.includes(ultimo.s)) r.push(ultimo.s);
  return r;
}

// Maior ganho e maior perda DENTRO da faixa desenhada (não é o teórico até o infinito).
export function extremosDaCurva(curva: readonly PontoDaCurva[]): { maximo: { valor: number; emPreco: number } | null; minimo: { valor: number; emPreco: number } | null } {
  let maximo: { valor: number; emPreco: number } | null = null;
  let minimo: { valor: number; emPreco: number } | null = null;
  for (const p of curva) {
    if (p.resultado === null) continue;
    if (!maximo || p.resultado > maximo.valor) maximo = { valor: p.resultado, emPreco: p.s };
    if (!minimo || p.resultado < minimo.valor) minimo = { valor: p.resultado, emPreco: p.s };
  }
  return { maximo, minimo };
}

export type GregasDaSimulacao = {
  delta: number; // em ações equivalentes
  gamma: number; // variação do delta por R$ 1,00 no ativo
  theta: number; // centavos por pregão
  vega: number; // centavos por 1 ponto de volatilidade
  semVol: string[];
};

export function gregasDaSimulacao(pernas: readonly PernaSimulada[], spot: number, a: AvaliacaoDaSimulacao): GregasDaSimulacao {
  const g: GregasDaSimulacao = { delta: 0, gamma: 0, theta: 0, vega: 0, semVol: [] };
  for (const p of pernas) {
    const e = exposicao(p);
    if (p.tipo === 'ativo') { g.delta += e; continue; }
    const restam = a.restam(p.vencimento as string);
    if (restam <= 0) {
      // Vencida: só o intrínseco conta (delta 0 ou 1, sem tempo nem volatilidade).
      const dentro = p.tipo === 'call' ? spot > (p.strike as number) : spot < (p.strike as number);
      if (dentro) g.delta += e * (p.tipo === 'call' ? 1 : -1);
      continue;
    }
    if (p.vol === null || !(p.vol > 0)) { g.semVol.push(p.codigo); continue; }
    const sigma = Math.max(0.01, p.vol + (a.deslocamentoDeVol ?? 0));
    const x = blackScholes({ tipo: p.tipo, s: spot / 100, k: (p.strike as number) / 100, t: restam / 252, r: a.taxa, sigma });
    g.delta += e * x.delta;
    g.gamma += e * x.gamma;
    g.theta += e * x.theta * 100;
    g.vega += e * x.vega * 100;
  }
  return { ...g, delta: Math.round(g.delta * 100) / 100, gamma: Math.round(g.gamma * 1000) / 1000, theta: Math.round(g.theta), vega: Math.round(g.vega) };
}

// Datas que importam: hoje, cada vencimento distinto (o primeiro é o "vencimento" do gráfico).
export function vencimentosDaSimulacao(pernas: readonly PernaSimulada[]): string[] {
  return [...new Set(pernas.filter((p) => p.tipo !== 'ativo' && p.vencimento).map((p) => p.vencimento as string))].sort();
}

// Faixa de preços do gráfico: ±25% do ativo, alargada para caber os strikes.
export function faixaDaSimulacao(pernas: readonly PernaSimulada[], spot: number, folga = 0.25): { de: number; ate: number } {
  const strikes = pernas.filter((p) => p.strike !== undefined).map((p) => p.strike as number);
  const de = Math.min(spot * (1 - folga), ...strikes.map((k) => k * 0.9));
  const ate = Math.max(spot * (1 + folga), ...strikes.map((k) => k * 1.1));
  return { de: Math.max(1, Math.round(de)), ate: Math.round(ate) };
}
