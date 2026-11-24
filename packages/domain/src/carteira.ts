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
