// Black-Scholes-Merton: preço teórico, gregas e volatilidade implícita.
// Premissas, que a interface precisa mostrar junto de qualquer valor calculado aqui:
// - exercício europeu (só no vencimento);
// - volatilidade e taxa de juros constantes até o vencimento;
// - dividendos representados só por um rendimento contínuo q (padrão 0);
// - tempo em anos de 252 dias úteis (convenção brasileira) e taxa contínua.
// Para opções americanas o valor é uma aproximação: uma put americana vale pelo
// menos o mesmo que a europeia, e uma call americana com dividendo pode ser
// exercida antes. O modelo NÃO afirma ausência de risco de exercício antecipado.

export type EntradaDoModelo = {
  tipo: 'call' | 'put';
  s: number; // preço do ativo-objeto, em reais
  k: number; // strike, em reais
  t: number; // anos até o vencimento (> 0)
  r: number; // taxa livre de risco contínua ao ano (0,10 = 10%)
  sigma: number; // volatilidade anual (0,30 = 30%)
  q?: number; // rendimento contínuo de dividendos ao ano
};

export type Gregas = {
  preco: number;
  delta: number;
  gamma: number;
  vega: number; // variação do preço para +1 ponto percentual de volatilidade
  theta: number; // variação do preço por dia útil que passa
  rho: number; // variação do preço para +1 ponto percentual de juros
};

export const PREMISSAS_DO_MODELO = Object.freeze([
  'Modelo Black-Scholes-Merton (exercício europeu).',
  'Volatilidade e juros constantes até o vencimento.',
  'Tempo em dias úteis sobre 252; juros em taxa contínua.',
  'Dividendos só como rendimento contínuo; dividendos discretos não são modelados.',
  'Para opções americanas é uma aproximação; não descarta exercício antecipado.',
]);

// Função de distribuição normal acumulada (erro absoluto < 1e-7, Abramowitz-Stegun 26.2.17).
export function normalAcumulada(x: number): number {
  if (x < 0) return 1 - normalAcumulada(-x);
  const t = 1 / (1 + 0.2316419 * x);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - densidadeNormal(x) * poly;
}

export function densidadeNormal(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export class ErroDeModelo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeModelo';
  }
}

function validar(e: EntradaDoModelo): void {
  for (const [nome, v] of [['s', e.s], ['k', e.k], ['t', e.t], ['sigma', e.sigma]] as const) {
    if (!Number.isFinite(v) || v <= 0) throw new ErroDeModelo(`${nome}_invalido`);
  }
  if (!Number.isFinite(e.r)) throw new ErroDeModelo('r_invalido');
  if (e.q !== undefined && !Number.isFinite(e.q)) throw new ErroDeModelo('q_invalido');
}

export function blackScholes(e: EntradaDoModelo): Gregas {
  validar(e);
  const q = e.q ?? 0;
  const raizT = Math.sqrt(e.t);
  const d1 = (Math.log(e.s / e.k) + (e.r - q + (e.sigma * e.sigma) / 2) * e.t) / (e.sigma * raizT);
  const d2 = d1 - e.sigma * raizT;
  const descQ = Math.exp(-q * e.t);
  const descR = Math.exp(-e.r * e.t);
  const pdf = densidadeNormal(d1);
  const gamma = (descQ * pdf) / (e.s * e.sigma * raizT);
  const vegaAno = e.s * descQ * pdf * raizT;
  if (e.tipo === 'call') {
    const preco = e.s * descQ * normalAcumulada(d1) - e.k * descR * normalAcumulada(d2);
    const thetaAno = (-e.s * descQ * pdf * e.sigma) / (2 * raizT) - e.r * e.k * descR * normalAcumulada(d2) + q * e.s * descQ * normalAcumulada(d1);
    return { preco, delta: descQ * normalAcumulada(d1), gamma, vega: vegaAno / 100, theta: thetaAno / 252, rho: (e.k * e.t * descR * normalAcumulada(d2)) / 100 };
  }
  const preco = e.k * descR * normalAcumulada(-d2) - e.s * descQ * normalAcumulada(-d1);
  const thetaAno = (-e.s * descQ * pdf * e.sigma) / (2 * raizT) + e.r * e.k * descR * normalAcumulada(-d2) - q * e.s * descQ * normalAcumulada(-d1);
  return { preco, delta: -descQ * normalAcumulada(-d1), gamma, vega: vegaAno / 100, theta: thetaAno / 252, rho: (-e.k * e.t * descR * normalAcumulada(-d2)) / 100 };
}

export type ResultadoDaVolImplicita =
  | { ok: true; sigma: number; iteracoes: number }
  | { ok: false; motivo: 'abaixo_do_valor_intrinseco' | 'acima_do_limite' | 'nao_convergiu' };

// Volatilidade implícita por bissecção (robusta; não depende de vega, que some longe do dinheiro).
export function volatilidadeImplicita(
  premio: number,
  base: Omit<EntradaDoModelo, 'sigma'>,
  tolerancia = 1e-6,
): ResultadoDaVolImplicita {
  if (!Number.isFinite(premio) || premio <= 0) return { ok: false, motivo: 'abaixo_do_valor_intrinseco' };
  const preco = (sigma: number) => blackScholes({ ...base, sigma }).preco;
  let baixo = 1e-4;
  let alto = 5; // 500% ao ano
  if (premio < preco(baixo) - tolerancia) return { ok: false, motivo: 'abaixo_do_valor_intrinseco' };
  if (premio > preco(alto)) return { ok: false, motivo: 'acima_do_limite' };
  for (let i = 1; i <= 200; i += 1) {
    const meio = (baixo + alto) / 2;
    const diff = preco(meio) - premio;
    if (Math.abs(diff) < tolerancia || alto - baixo < 1e-9) return { ok: true, sigma: meio, iteracoes: i };
    if (diff > 0) alto = meio;
    else baixo = meio;
  }
  return { ok: false, motivo: 'nao_convergiu' };
}

// Taxa efetiva anual (ex.: Selic 0,15) → taxa contínua equivalente.
export function taxaContinua(efetivaAnual: number): number {
  if (!Number.isFinite(efetivaAnual) || efetivaAnual <= -1) throw new ErroDeModelo('taxa_invalida');
  return Math.log(1 + efetivaAnual);
}

export function anosUteis(diasUteis: number): number {
  if (!Number.isFinite(diasUteis) || diasUteis <= 0) throw new ErroDeModelo('dias_uteis_invalidos');
  return diasUteis / 252;
}
