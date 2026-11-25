// Opções de um ativo (ex.: BBAS3, PETR4): tudo o que foi operado em opções dele, vindo das
// notas, do extrato da B3 e de Posições. Prêmio líquido (vendas − compras − custos) por
// mês, operações com o saldo acumulado e o rendimento sobre as ações que você tem.

import type { Execucao } from './posicoes.ts';

export type OperacaoDeOpcao = {
  instante: string; data: string; codigo: string; tipo: 'call' | 'put'; strike: number; vencimento: string; lado: 'compra' | 'venda';
  quantidade: number; preco: number; custos: number; total: number; saldo: number; observacao: string | null;
};
export type MesDeOpcoes = { mes: string; vendas: number; compras: number; custos: number; liquido: number; operacoes: number };

const diaSp = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export function fluxoDasOpcoes(execucoes: readonly (Execucao & { observacao?: string | null })[]): { operacoes: OperacaoDeOpcao[]; meses: MesDeOpcoes[] } {
  const ops = [...execucoes].filter((e) => e.tipo !== 'ativo' && e.vencimento && e.strike !== undefined).sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante));
  let saldo = 0;
  const meses = new Map<string, MesDeOpcoes>();
  const operacoes = ops.map((e) => {
    const bruto = Math.round(e.quantidade * e.preco * (e.multiplicador ?? 1));
    const custos = e.custos ?? 0;
    const total = (e.lado === 'venda' ? bruto : -bruto) - custos;
    saldo += total;
    const data = diaSp(e.instante);
    const mes = data.slice(0, 7);
    const m = meses.get(mes) ?? { mes, vendas: 0, compras: 0, custos: 0, liquido: 0, operacoes: 0 };
    if (e.lado === 'venda') m.vendas += bruto; else m.compras += bruto;
    m.custos += custos;
    m.liquido += total;
    m.operacoes += 1;
    meses.set(mes, m);
    return {
      instante: e.instante, data, codigo: e.codigo, tipo: e.tipo as 'call' | 'put', strike: e.strike as number, vencimento: e.vencimento as string,
      lado: e.lado, quantidade: e.quantidade, preco: e.preco, custos, total, saldo, observacao: e.observacao ?? null,
    };
  });
  return { operacoes, meses: [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)) };
}

// Meses entre o primeiro e o último (inclusive), para a média mensal não ignorar meses parados.
export function mesesNoPeriodo(primeiro: string, ultimo: string): number {
  const [a1, m1] = primeiro.split('-').map(Number) as [number, number];
  const [a2, m2] = ultimo.split('-').map(Number) as [number, number];
  return Math.max(1, (a2 - a1) * 12 + (m2 - m1) + 1);
}
