// Cadeia de opções na tela: calls e puts lado a lado por strike, faixa de strikes em
// torno do preço, linha "no dinheiro" e textos dos cálculos (sempre como cálculo).

export type Calculo =
  | { volImplicita: number; precoTeorico: number; delta: number; gamma: number; theta: number; vega: number; rho: number; premio: number; origemPremio: 'meio_do_livro' | 'ultimo_negocio'; diasUteis: number; selic: number }
  | { motivo: string };

export type Serie = {
  codigo: string; tipo: 'call' | 'put'; strike: number; ultimo: number | null; bid: number | null; ask: number | null;
  negocios: number; quantidade: number | null; calculo: Calculo;
};

export type Cadeia = {
  ativo: { codigo: string; ultimo: number | null; dia: string };
  vencimentos: string[];
  vencimento: string | null;
  series: Serie[];
  premissas: string[];
};

export type LinhaDaCadeia = { strike: number; call: Serie | null; put: Serie | null; noDinheiro: boolean };

export type Faixa = 10 | 20 | 'todas';

export function temCalculo(c: Calculo): c is Extract<Calculo, { volImplicita: number }> {
  return 'volImplicita' in c;
}

export function montarLinhas(series: readonly Serie[], spot: number | null, faixa: Faixa, soNegociadas: boolean): LinhaDaCadeia[] {
  const porStrike = new Map<number, LinhaDaCadeia>();
  for (const s of series) {
    if (soNegociadas && s.negocios === 0) continue;
    if (spot !== null && faixa !== 'todas' && Math.abs(s.strike - spot) / spot > faixa / 100) continue;
    const l = porStrike.get(s.strike) ?? { strike: s.strike, call: null, put: null, noDinheiro: false };
    // Mais de uma série no mesmo strike e tipo (ex.: ajuste de dividendos): fica a mais negociada.
    const atual = s.tipo === 'call' ? l.call : l.put;
    if (!atual || s.negocios > atual.negocios) {
      if (s.tipo === 'call') l.call = s; else l.put = s;
    }
    porStrike.set(s.strike, l);
  }
  const linhas = [...porStrike.values()].sort((a, b) => a.strike - b.strike);
  if (spot !== null && linhas.length) {
    let melhor = linhas[0] as LinhaDaCadeia;
    for (const l of linhas) if (Math.abs(l.strike - spot) < Math.abs(melhor.strike - spot)) melhor = l;
    melhor.noDinheiro = true;
  }
  return linhas;
}

// Dentro do dinheiro: call com strike abaixo do preço; put com strike acima.
export function dentroDoDinheiro(tipo: 'call' | 'put', strike: number, spot: number | null): boolean {
  if (spot === null) return false;
  return tipo === 'call' ? strike < spot : strike > spot;
}

export const MOTIVOS: Record<string, string> = {
  sem_premio: 'Sem negócio nem oferta no fechamento: não há prêmio para calcular.',
  sem_ativo_objeto: 'Sem preço do ativo-objeto no mesmo pregão.',
  sem_selic: 'Sem a taxa Selic do dia.',
  abaixo_do_valor_intrinseco: 'O prêmio ficou abaixo do valor intrínseco: a volatilidade não tem solução.',
  acima_do_limite: 'Prêmio alto demais para o modelo (volatilidade acima de 500% ao ano).',
  nao_convergiu: 'O cálculo não convergiu.',
  vence_no_dia: 'Vence hoje: o modelo não serve para as últimas horas.',
  vencida: 'Série vencida.',
  ainda_nao_calculado: 'Ainda não calculado.',
};

export const vol = (v: number) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const grega = (v: number, casas = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const preco = (centavos: number | null) => (centavos === null ? '—' : (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const inteiro = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'));

// Pontos do "sorriso" da volatilidade (strike × vol. implícita) por tipo, só séries calculadas.
export function pontosDoSorriso(linhas: readonly LinhaDaCadeia[], tipo: 'call' | 'put'): { strike: number; vol: number }[] {
  return linhas.flatMap((l) => {
    const s = tipo === 'call' ? l.call : l.put;
    return s && temCalculo(s.calculo) ? [{ strike: l.strike, vol: s.calculo.volImplicita }] : [];
  });
}
