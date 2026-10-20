// Cenários "e se": quanto a estratégia valeria se o ativo-objeto fosse para outro preço,
// hoje ou depois de alguns pregões, antes do vencimento. É ESTIMATIVA do modelo:
// cada opção é reprecificada por Black-Scholes com a volatilidade informada (a implícita
// do último fechamento, ou a que o usuário escolher), juros constantes e o tempo que
// sobra até o vencimento. No vencimento (ou depois) vale o valor intrínseco.
//
// O resultado é o da estratégia inteira: (valor estimado − preço médio) das pernas
// abertas + realizado − custos já pagos. Sem volatilidade para alguma opção que ainda
// não venceu, o cenário fica null e diz qual faltou (nunca usa zero).

import { blackScholes } from './modelo.ts';
import { instrumentosAbertos, type Carteira } from './posicoes.ts';

export type PremissasDoCenario = {
  taxa: number; // contínua ao ano
  vol: (codigo: string) => number | null; // volatilidade anual por código
  diasDePregaoAte: (vencimento: string) => number; // a partir de hoje
};

export type ResultadoDoCenario = { resultado: number | null; semVol: string[] };

function realizadoMenosCustos(c: Carteira): number {
  let t = 0;
  for (const i of c.values()) t += i.realizadoBruto - i.custosPagos;
  return t;
}

// `spot` em centavos; `pregoesAdiante` = quantos pregões se passaram a partir de hoje.
export function resultadoNoCenario(c: Carteira, spot: number, pregoesAdiante: number, p: PremissasDoCenario): ResultadoDoCenario {
  if (!Number.isFinite(spot) || spot <= 0) return { resultado: null, semVol: [] };
  let total = realizadoMenosCustos(c);
  const semVol: string[] = [];
  for (const i of instrumentosAbertos(c)) {
    let valor: number;
    if (i.tipo === 'ativo') {
      valor = spot;
    } else {
      const k = i.strike as number;
      const intrinseco = i.tipo === 'call' ? Math.max(spot - k, 0) : Math.max(k - spot, 0);
      const restam = p.diasDePregaoAte(i.vencimento as string) - pregoesAdiante;
      if (restam <= 0) {
        valor = intrinseco;
      } else {
        const sigma = p.vol(i.codigo);
        if (sigma === null || !(sigma > 0)) { semVol.push(i.codigo); continue; }
        valor = blackScholes({ tipo: i.tipo, s: spot / 100, k: k / 100, t: restam / 252, r: p.taxa, sigma }).preco * 100;
      }
    }
    total += i.quantidade * i.multiplicador * (valor - i.precoMedio);
  }
  return semVol.length ? { resultado: null, semVol } : { resultado: Math.round(total), semVol };
}

export type Grade = {
  precos: number[]; // centavos
  variacoes: number[]; // frações (−0,1 = −10%)
  colunas: { rotulo: string; pregoes: number }[];
  linhas: { preco: number; variacao: number; resultados: (number | null)[] }[];
  semVol: string[];
};

// Grade de preços (variações em torno do preço atual) × momentos (hoje, alguns pregões, vencimento).
export function gradeDeCenarios(
  c: Carteira, spotAtual: number, variacoes: readonly number[], colunas: readonly { rotulo: string; pregoes: number }[], p: PremissasDoCenario,
): Grade {
  const semVol = new Set<string>();
  const linhas = variacoes.map((v) => {
    const preco = Math.round(spotAtual * (1 + v));
    return {
      preco, variacao: v,
      resultados: colunas.map((col) => {
        const r = resultadoNoCenario(c, preco, col.pregoes, p);
        r.semVol.forEach((x) => semVol.add(x));
        return r.resultado;
      }),
    };
  });
  return { precos: linhas.map((l) => l.preco), variacoes: [...variacoes], colunas: [...colunas], linhas, semVol: [...semVol] };
}
