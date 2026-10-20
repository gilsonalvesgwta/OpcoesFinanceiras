// Payoff no vencimento de posições com várias pernas.
// Um único modelo genérico serve para todas as estruturas (travas, straddle,
// collar, condor, venda coberta...): cada perna é uma call, uma put ou o próprio
// ativo-objeto, comprada ou vendida. O resultado no vencimento é uma função
// linear por partes do preço do ativo, com "quebras" nos strikes; daí saem os
// pontos de equilíbrio, o lucro máximo e a perda máxima sem aproximação numérica.
//
// Limites deste módulo, explícitos:
// - Só vale para o instante do vencimento e para pernas com o MESMO vencimento.
//   Estruturas com vencimentos diferentes (calendário, diagonal) precisam de um
//   modelo de preço para as pernas que continuam vivas: ver cenarios.ts.
// - Não modela exercício antecipado. Opção americana vendida pode ser exercida
//   antes; o payoff no vencimento não diz nada sobre esse risco (ver riscos.ts).

import { ErroDeValor, somar, type Centavos } from './dinheiro.ts';

export type Lado = 'compra' | 'venda';
export type TipoDePerna = 'call' | 'put' | 'ativo';

export type Perna = {
  tipo: TipoDePerna;
  lado: Lado;
  quantidade: number; // unidades (opções ou ações), sempre positiva
  multiplicador?: number; // ativos-objeto por unidade; padrão 1
  strike?: Centavos; // obrigatório para call e put
  preco: Centavos; // prêmio pago/recebido por unidade, ou preço da ação
  custos?: Centavos; // corretagem, emolumentos e taxas desta perna, no total
  vencimento?: string; // AAAA-MM-DD, obrigatório para call e put
};

export class ErroDePosicao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDePosicao';
  }
}

function sinal(p: Perna): 1 | -1 {
  return p.lado === 'compra' ? 1 : -1;
}

function exposicaoDaPerna(p: Perna): number {
  return sinal(p) * p.quantidade * (p.multiplicador ?? 1);
}

export function validarPerna(p: Perna): void {
  if (!Number.isInteger(p.quantidade) || p.quantidade <= 0) throw new ErroDePosicao('quantidade_invalida');
  if (p.multiplicador !== undefined && (!Number.isInteger(p.multiplicador) || p.multiplicador <= 0)) {
    throw new ErroDePosicao('multiplicador_invalido');
  }
  if (!Number.isSafeInteger(p.preco) || p.preco < 0) throw new ErroDePosicao('preco_invalido');
  if (p.custos !== undefined && (!Number.isSafeInteger(p.custos) || p.custos < 0)) throw new ErroDePosicao('custos_invalidos');
  if (p.tipo !== 'ativo') {
    if (p.strike === undefined || !Number.isSafeInteger(p.strike) || p.strike <= 0) throw new ErroDePosicao('strike_invalido');
    if (!p.vencimento) throw new ErroDePosicao('vencimento_ausente');
  }
}

// Fluxo de caixa na montagem: positivo = crédito recebido, negativo = débito pago.
export function fluxoDeMontagem(pernas: readonly Perna[]): { bruto: Centavos; custos: Centavos; liquido: Centavos } {
  let bruto = 0;
  let custos = 0;
  for (const p of pernas) {
    validarPerna(p);
    bruto = somar(bruto, -exposicaoDaPerna(p) * p.preco);
    custos = somar(custos, p.custos ?? 0);
  }
  return { bruto, custos, liquido: somar(bruto, -custos) };
}

function valorNoVencimento(p: Perna, s: Centavos): number {
  const k = p.strike ?? 0;
  const intrinseco = p.tipo === 'ativo' ? s : p.tipo === 'call' ? Math.max(s - k, 0) : Math.max(k - s, 0);
  return exposicaoDaPerna(p) * intrinseco;
}

// Resultado total (em centavos) se o ativo fechar a `s` centavos no vencimento,
// já descontados os custos de montagem. Não inclui custo de exercício/liquidação.
// `ajuste` soma um valor de caixa fora das pernas (ex.: resultado já realizado da
// estratégia antes de uma rolagem), para o payoff mostrar o resultado acumulado.
export function resultadoNoVencimento(pernas: readonly Perna[], s: Centavos, ajuste: Centavos = 0): Centavos {
  if (s < 0) throw new ErroDeValor('preco_negativo');
  const { liquido } = fluxoDeMontagem(pernas);
  let total = somar(liquido, ajuste);
  for (const p of pernas) total = somar(total, valorNoVencimento(p, s));
  return total;
}

export type Extremo =
  | { tipo: 'limitado'; valor: Centavos; emPreco: Centavos } // primeiro preço em que o extremo é alcançado
  | { tipo: 'ilimitado' };

export type AnaliseDePayoff = {
  fluxo: { bruto: Centavos; custos: Centavos; liquido: Centavos };
  ajuste: Centavos; // caixa fora das pernas incluído no resultado
  quebras: Centavos[]; // strikes ordenados
  // Pontos de equilíbrio em REAIS (podem não cair em centavo exato).
  pontosDeEquilibrio: number[];
  // Faixas de preço em que o resultado é exatamente zero (segmentos planos sobre o zero).
  faixasNoZero: { de: number; ate: number | null }[];
  lucroMaximo: Extremo;
  perdaMaxima: Extremo;
  inclinacaoAcimaDoUltimoStrike: number; // ativos-objeto líquidos quando o preço sobe sem limite
  inclinacaoAbaixoDoPrimeiroStrike: number;
};

function vencimentoUnico(pernas: readonly Perna[]): string | null {
  const datas = new Set(pernas.filter((p) => p.tipo !== 'ativo').map((p) => p.vencimento));
  if (datas.size > 1) throw new ErroDePosicao('vencimentos_diferentes');
  return datas.values().next().value ?? null;
}

export function analisarPayoff(pernas: readonly Perna[], ajuste: Centavos = 0): AnaliseDePayoff {
  if (!Number.isSafeInteger(ajuste)) throw new ErroDeValor('ajuste_invalido');
  if (pernas.length === 0) throw new ErroDePosicao('posicao_vazia');
  const fluxo = fluxoDeMontagem(pernas);
  vencimentoUnico(pernas);

  const quebras = [...new Set(pernas.filter((p) => p.tipo !== 'ativo').map((p) => p.strike as number))].sort((a, b) => a - b);
  const pontos = [0, ...quebras.filter((k) => k > 0)];
  const valores = pontos.map((s) => resultadoNoVencimento(pernas, s, ajuste));

  // Inclinação depois do último ponto: calls e ações contam; puts já zeraram.
  const acima = pernas.reduce((t, p) => t + (p.tipo === 'put' ? 0 : exposicaoDaPerna(p)), 0);
  // Inclinação entre 0 e o primeiro strike: ações contam; puts com sinal trocado; calls zeradas.
  const abaixo = pernas.reduce(
    (t, p) => t + (p.tipo === 'ativo' ? exposicaoDaPerna(p) : p.tipo === 'put' ? -exposicaoDaPerna(p) : 0),
    0,
  );

  // Pontos de equilíbrio: raízes de cada segmento linear.
  const raizes = new Set<number>();
  const faixasNoZero: { de: number; ate: number | null }[] = [];
  for (let i = 0; i < pontos.length - 1; i += 1) {
    const s0 = pontos[i] as number;
    const s1 = pontos[i + 1] as number;
    const v0 = valores[i] as number;
    const v1 = valores[i + 1] as number;
    if (v0 === 0 && v1 === 0) {
      faixasNoZero.push({ de: s0 / 100, ate: s1 / 100 });
      continue;
    }
    if (v0 === 0) raizes.add(s0);
    if ((v0 < 0 && v1 > 0) || (v0 > 0 && v1 < 0)) raizes.add(s0 + ((-v0) * (s1 - s0)) / (v1 - v0));
  }
  const ultimo = pontos[pontos.length - 1] as number;
  const vUltimo = valores[valores.length - 1] as number;
  if (vUltimo === 0) {
    if (acima === 0) faixasNoZero.push({ de: ultimo / 100, ate: null });
    else raizes.add(ultimo);
  } else if (acima !== 0 && Math.sign(acima) !== Math.sign(vUltimo)) {
    raizes.add(ultimo + -vUltimo / acima);
  }
  // Uma raiz exatamente em zero só conta se o resultado em zero é zero (já tratado acima).
  const pontosDeEquilibrio = [...raizes]
    .filter((s) => !faixasNoZero.some((f) => s / 100 >= f.de && (f.ate === null || s / 100 <= f.ate)))
    .sort((a, b) => a - b)
    .map((s) => Math.round(s * 100) / 10000); // centavos → reais, 4 casas

  const maiorIndice = valores.reduce((m, v, i) => (v > (valores[m] as number) ? i : m), 0);
  const menorIndice = valores.reduce((m, v, i) => (v < (valores[m] as number) ? i : m), 0);
  const maior = valores[maiorIndice] as number;
  const menor = valores[menorIndice] as number;

  // Entre os pontos a função é linear, então os extremos ficam nos pontos de quebra,
  // em zero ou no infinito (quando a inclinação final não é zero).
  // "Ilimitado" na perda é teórico: o preço de uma ação não tem teto.
  const lucroMaximo: Extremo = acima > 0 ? { tipo: 'ilimitado' } : { tipo: 'limitado', valor: maior, emPreco: pontos[maiorIndice] as number };
  const perdaMaxima: Extremo = acima < 0 ? { tipo: 'ilimitado' } : { tipo: 'limitado', valor: menor, emPreco: pontos[menorIndice] as number };

  return {
    fluxo,
    ajuste,
    quebras,
    pontosDeEquilibrio,
    faixasNoZero,
    lucroMaximo,
    perdaMaxima,
    inclinacaoAcimaDoUltimoStrike: acima,
    inclinacaoAbaixoDoPrimeiroStrike: abaixo,
  };
}

// Curva para o gráfico: pontos (preço em centavos, resultado em centavos) num intervalo.
// Inclui todos os strikes dentro do intervalo, para o desenho não "cortar" as quinas.
// `ajuste`: o mesmo de analisarPayoff (resultado já realizado), para a curva bater com a análise.
export function curvaDePayoff(pernas: readonly Perna[], de: Centavos, ate: Centavos, passos = 60, ajuste: Centavos = 0): { s: Centavos; resultado: Centavos }[] {
  if (de < 0 || ate <= de || !Number.isInteger(passos) || passos < 2) throw new ErroDeValor('intervalo_invalido');
  const precos = new Set<number>();
  for (let i = 0; i <= passos; i += 1) precos.add(Math.round(de + ((ate - de) * i) / passos));
  for (const p of pernas) if (p.strike !== undefined && p.strike >= de && p.strike <= ate) precos.add(p.strike);
  return [...precos].sort((a, b) => a - b).map((s) => ({ s, resultado: resultadoNoVencimento(pernas, s, ajuste) }));
}
