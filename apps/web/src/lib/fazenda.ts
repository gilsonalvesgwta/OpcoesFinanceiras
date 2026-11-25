// Vaca (Fazenda): tipos da api e contas da fazenda inteira.

export type LinhaDaVaca = {
  id: string; data: string; lado: 'compra' | 'venda'; tipo: 'call' | 'put' | 'ativo'; prazo: 'CURTA' | 'LONGA' | null;
  quantidade: number; ticker: string; strike: number | null; vencimento: string | null; preco: number; custos: number;
  origem: 'planilha' | 'nota' | 'manual'; execucaoId: string | null; total: number; saldo: number; emCustodia: boolean; atencao: string | null;
};
export type PernaAberta = { chave: string; ticker: string; tipo: 'call' | 'put'; strike: number | null; vencimento: string | null; quantidade: number; dias: number | null; distancia: number | null; atencao: string | null };
export type ResumoDaVaca = {
  ordenhaBruta: number; custos: number; ordenhaLiquida: number; dias: number; rentabilidadeMensal: number | null; ordenhaMediaMensal: number;
  riscoPut: number | null; callsAbertas: number; putsAbertas: number; pernas: PernaAberta[]; serie: { data: string; saldo: number }[];
  operacoes: number; ultimaOperacao: string | null;
};
export type Vaca = {
  id: string; nome: string; ativoObjeto: string; dataInicio: string; margem: number; quantidade: number | null; distancia: number;
  situacao: 'ativa' | 'encerrada'; observacao: string | null; cotacao: { ultimo: number | null; qualidade: string; provedor: string } | null;
  linhas: LinhaDaVaca[]; resumo: ResumoDaVaca;
};
export type ExecucaoParaDistribuir = {
  id: string; dia: string; codigo: string; tipo: 'call' | 'put'; lado: 'compra' | 'venda'; quantidade: number; preco: number; custos: number;
  strike: number | null; vencimento: string | null; ativo: string; sugestao: string[];
};
export type Fazenda = { hoje: string; mercadoAberto: boolean; vacas: Vaca[]; paraDistribuir: ExecucaoParaDistribuir[]; distribuidasAgora: number };

// Totais da fazenda (só as vacas ativas): ordenha, média mensal, margem, risco PUT e a
// rentabilidade média ponderada pela margem. Ordenha líquida estimada: menos 15% de IR.
export function totaisDaFazenda(vacas: readonly Vaca[]) {
  const ativas = vacas.filter((v) => v.situacao === 'ativa');
  const soma = (f: (v: Vaca) => number) => ativas.reduce((t, v) => t + f(v), 0);
  const margem = soma((v) => v.margem);
  const comRent = ativas.filter((v) => v.resumo.rentabilidadeMensal !== null && v.margem > 0);
  const pesos = comRent.reduce((t, v) => t + v.margem, 0);
  const ordenha = soma((v) => v.resumo.ordenhaBruta);
  return {
    vacas: ativas.length, ordenha, ordenhaLiquidaIr: Math.round(ordenha * 0.85), custos: soma((v) => v.resumo.custos),
    mediaMensal: soma((v) => v.resumo.ordenhaMediaMensal), margem, riscoPut: soma((v) => v.resumo.riscoPut ?? 0),
    rentabilidade: pesos > 0 ? comRent.reduce((t, v) => t + (v.resumo.rentabilidadeMensal as number) * v.margem, 0) / pesos : null,
  };
}

export const GLOSSARIO: [string, string][] = [
  ['Vaca', 'Com proteção em call e put.'], ['Vaca Manca', 'Com proteção em somente call ou somente put.'], ['Vaca Louca', 'Sem proteção.'],
  ['Patas', 'Quantidade de um derivativo.'], ['Andar para a grama', 'Vender o valor extrínseco máximo.'], ['Bezerro', 'Straddle criado para falta de liquidez.'],
  ['Matar', 'Redução de patas com straddle.'], ['Churrasco', 'Vender as proteções para comprar as vendidas.'], ['Fazenda', 'Conjunto de vacas.'],
  ['Vaca Recatada', 'Straddle.'], ['Vaca Safada', 'Strangle.'], ['Ordenha', 'Prêmio líquido recebido nas rolagens (vendas − recompras).'],
];
