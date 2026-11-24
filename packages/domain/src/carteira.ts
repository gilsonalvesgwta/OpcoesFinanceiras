// Carteira consolidada do usuário: todas as execuções de todas as estratégias abertas,
// somadas por código, com o preço médio do jeito da apuração brasileira (Receita):
// - compras somam quantidade e custo (preço × quantidade + custos da compra);
// - vendas que reduzem a posição não mudam o preço médio; o resultado realizado é
//   (preço de venda − preço médio) × quantidade − custos da venda;
// - posição vendida (opção lançada) é o espelho: o prêmio líquido recebido vira o preço
//   médio, e a recompra realiza (médio − preço) × quantidade − custos da recompra.

import type { Execucao } from './posicoes.ts';

export type PosicaoConsolidada = {
  codigo: string;
  tipo: Execucao['tipo'];
  strike?: number;
  vencimento?: string;
  multiplicador: number;
  quantidade: number; // com sinal: + comprada, − vendida
  precoMedio: number; // centavos, sem custos
  precoMedioComCustos: number; // centavos, com os custos das entradas (Receita)
  custoDaPosicao: number; // centavos: |quantidade| × preço médio com custos × multiplicador
  realizadoBruto: number; // centavos
  realizadoLiquido: number; // centavos, já sem os custos de entradas encerradas e de saídas
  custosPagos: number;
  operacoes: number;
  primeira: string; // instante da primeira execução
};

export function consolidarCarteira(execucoes: readonly Execucao[]): PosicaoConsolidada[] {
  const porCodigo = new Map<string, PosicaoConsolidada>();
  const ordenadas = [...execucoes].sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante));
  for (const e of ordenadas) {
    const mult = e.multiplicador ?? 1;
    const custos = e.custos ?? 0;
    let p = porCodigo.get(e.codigo);
    if (p && p.quantidade === 0 && (p.vencimento !== e.vencimento || p.tipo !== e.tipo)) {
      // Mesmo código, outra série (a B3 reaproveita códigos de um ano para o outro): o que
      // foi realizado fica, e a posição recomeça com os dados da série nova.
      p.tipo = e.tipo;
      if (e.strike !== undefined) p.strike = e.strike; else delete p.strike;
      if (e.vencimento !== undefined) p.vencimento = e.vencimento; else delete p.vencimento;
    }
    if (!p) {
      p = {
        codigo: e.codigo, tipo: e.tipo, multiplicador: mult, quantidade: 0, precoMedio: 0, precoMedioComCustos: 0, custoDaPosicao: 0,
        realizadoBruto: 0, realizadoLiquido: 0, custosPagos: 0, operacoes: 0, primeira: e.instante,
        ...(e.strike !== undefined ? { strike: e.strike } : {}),
        ...(e.vencimento !== undefined ? { vencimento: e.vencimento } : {}),
      };
      porCodigo.set(e.codigo, p);
    }
    p.operacoes += 1;
    p.custosPagos += custos;
    const delta = e.lado === 'compra' ? e.quantidade : -e.quantidade;
    const custoUnit = custos / e.quantidade;
    if (p.quantidade === 0 || Math.sign(p.quantidade) === Math.sign(delta)) {
      // Abrindo ou aumentando: comprada soma custos ao preço; vendida desconta do prêmio.
      const q = Math.abs(p.quantidade);
      const efetivo = e.lado === 'compra' ? e.preco + custoUnit : e.preco - custoUnit;
      p.precoMedio = (q * p.precoMedio + e.quantidade * e.preco) / (q + e.quantidade);
      p.precoMedioComCustos = (q * p.precoMedioComCustos + e.quantidade * efetivo) / (q + e.quantidade);
      p.quantidade += delta;
    } else {
      const encerrada = Math.min(Math.abs(p.quantidade), e.quantidade);
      const sinal = Math.sign(p.quantidade);
      const custosDoEncerramento = custoUnit * encerrada;
      p.realizadoBruto += encerrada * (e.preco - p.precoMedio) * sinal * mult;
      p.realizadoLiquido += encerrada * (e.preco - p.precoMedioComCustos) * sinal * mult - custosDoEncerramento;
      const resto = e.quantidade - encerrada;
      p.quantidade += Math.sign(delta) * encerrada;
      if (resto > 0) {
        p.quantidade = Math.sign(delta) * resto;
        p.precoMedio = e.preco;
        p.precoMedioComCustos = e.lado === 'compra' ? e.preco + custoUnit : e.preco - custoUnit;
      } else if (p.quantidade === 0) {
        p.precoMedio = 0;
        p.precoMedioComCustos = 0;
      }
    }
    p.custoDaPosicao = Math.abs(p.quantidade) * p.precoMedioComCustos * p.multiplicador;
  }
  return [...porCodigo.values()].map((p) => ({
    ...p,
    precoMedio: Math.round(p.precoMedio * 100) / 100,
    precoMedioComCustos: Math.round(p.precoMedioComCustos * 100) / 100,
    custoDaPosicao: Math.round(p.custoDaPosicao),
    realizadoBruto: Math.round(p.realizadoBruto),
    realizadoLiquido: Math.round(p.realizadoLiquido),
  }));
}

// Resultado em aberto de uma posição a um preço de mercado (centavos): comprada ganha
// se o preço sobe acima do médio com custos; vendida ganha se cai abaixo do prêmio líquido.
export function resultadoEmAberto(p: Pick<PosicaoConsolidada, 'quantidade' | 'precoMedioComCustos' | 'multiplicador'>, preco: number): { valor: number; fracao: number | null } {
  const valor = Math.round(p.quantidade * (preco - p.precoMedioComCustos) * p.multiplicador);
  const base = Math.abs(p.quantidade) * p.precoMedioComCustos * p.multiplicador;
  return { valor, fracao: base > 0 ? valor / base : null };
}

// Lotes ainda em carteira de um ativo comprado, um por compra, para ver quanto custou
// cada parte da posição (além do preço médio). As vendas abatem dos lotes mais antigos
// primeiro (PEPS); uma venda maior que a posição zera os lotes. O preço com custos de
// cada lote soma os custos daquela compra.
export type LoteAberto = {
  codigo: string;
  instante: string;
  quantidadeOriginal: number;
  quantidade: number; // ainda em carteira
  preco: number; // centavos
  precoComCustos: number; // centavos (com os custos da compra)
};

export function lotesAbertos(execucoes: readonly Execucao[]): Map<string, LoteAberto[]> {
  const porCodigo = new Map<string, LoteAberto[]>();
  const ordenadas = [...execucoes].filter((e) => e.tipo === 'ativo').sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante));
  for (const e of ordenadas) {
    const lotes = porCodigo.get(e.codigo) ?? [];
    porCodigo.set(e.codigo, lotes);
    if (e.lado === 'compra') {
      lotes.push({
        codigo: e.codigo, instante: e.instante, quantidadeOriginal: e.quantidade, quantidade: e.quantidade,
        preco: e.preco, precoComCustos: Math.round((e.preco + (e.custos ?? 0) / e.quantidade) * 100) / 100,
      });
      continue;
    }
    let resta = e.quantidade;
    for (const l of lotes) {
      if (resta === 0) break;
      const sai = Math.min(l.quantidade, resta);
      l.quantidade -= sai;
      resta -= sai;
    }
  }
  for (const [codigo, lotes] of porCodigo) porCodigo.set(codigo, lotes.filter((l) => l.quantidade > 0));
  return porCodigo;
}

// Strike sugerido para cobrir um lote com venda de call: o menor strike que não fica
// abaixo do preço com custos do lote (assim, se for exercido, o lote não dá prejuízo).
export function strikeParaOLote<T extends { strike: number }>(precoComCustos: number, series: readonly T[]): T | null {
  let melhor: T | null = null;
  for (const s of series) if (s.strike >= precoComCustos && (!melhor || s.strike < melhor.strike)) melhor = s;
  return melhor;
}
