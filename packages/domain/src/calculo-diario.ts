// Volatilidade implícita e gregas calculadas a partir do FECHAMENTO oficial da B3
// (fonte gratuita). Tudo aqui é cálculo do sistema, nunca dado observado: a
// interface mostra junto o preço usado, a origem dele e as premissas.
//
// Regras:
// - prêmio: ponto médio da melhor oferta de compra e de venda no fechamento, quando
//   as duas existem e o spread não passa de 50% do meio (o livro fecha junto com o
//   ativo-objeto); senão, o último negócio do dia; senão, não calcula;
// - ativo-objeto: último preço do mesmo pregão; sem ele, não calcula;
// - juros: Selic do dia (ou a mais recente antes dele) em taxa contínua; sem ela, não calcula;
// - tempo: dias de pregão do fechamento até o vencimento, sobre 252; no dia do
//   vencimento não calcula (o modelo não serve para as últimas horas);
// - dividendos: q = 0 (premissa declarada).

import { diasDePregaoEntre, type ConfiguracaoDoCalendario } from './calendario.ts';
import { anosUteis, blackScholes, taxaContinua, volatilidadeImplicita, type Gregas } from './modelo.ts';

export const SPREAD_MAXIMO_PARA_MEIO = 0.5;

export type EntradaDoCalculoDiario = {
  dia: string; // pregão do fechamento, AAAA-MM-DD
  tipo: 'call' | 'put';
  strike: number; // centavos
  vencimento: string; // AAAA-MM-DD
  ultimo: number | null; // centavos, prêmio
  bid: number | null;
  ask: number | null;
  ativoObjeto: number | null; // centavos, último do ativo-objeto no mesmo pregão
  selic: number | null; // % ao ano (14,90 = 14,90%)
};

export type OrigemDoPremio = 'meio_do_livro' | 'ultimo_negocio';

export type MotivoSemCalculo =
  | 'vencida' | 'vence_no_dia' | 'sem_premio' | 'sem_ativo_objeto' | 'sem_selic'
  | 'abaixo_do_valor_intrinseco' | 'acima_do_limite' | 'nao_convergiu';

export type CalculoDiario =
  | {
      ok: true;
      volImplicita: number; // anual (0,30 = 30%)
      gregas: Gregas; // preço teórico em reais; theta por dia útil; vega e rho por 1 ponto percentual
      premio: number; // centavos (pode ter meio centavo no meio do livro)
      origem: OrigemDoPremio;
      diasUteis: number;
      taxaContinua: number;
    }
  | { ok: false; motivo: MotivoSemCalculo; diasUteis: number | null };

export function premioDoFechamento(bid: number | null, ask: number | null, ultimo: number | null): { valor: number; origem: OrigemDoPremio } | null {
  if (bid !== null && ask !== null && bid > 0 && ask >= bid) {
    const meio = (bid + ask) / 2;
    if ((ask - bid) / meio <= SPREAD_MAXIMO_PARA_MEIO) return { valor: meio, origem: 'meio_do_livro' };
  }
  if (ultimo !== null && ultimo > 0) return { valor: ultimo, origem: 'ultimo_negocio' };
  return null;
}

export function calcularDoFechamento(e: EntradaDoCalculoDiario, cfg: ConfiguracaoDoCalendario): CalculoDiario {
  if (e.vencimento < e.dia) return { ok: false, motivo: 'vencida', diasUteis: null };
  const diasUteis = diasDePregaoEntre(e.dia, e.vencimento, cfg);
  if (diasUteis <= 0) return { ok: false, motivo: 'vence_no_dia', diasUteis: 0 };
  const premio = premioDoFechamento(e.bid, e.ask, e.ultimo);
  if (!premio) return { ok: false, motivo: 'sem_premio', diasUteis };
  if (e.ativoObjeto === null || e.ativoObjeto <= 0) return { ok: false, motivo: 'sem_ativo_objeto', diasUteis };
  if (e.selic === null || !Number.isFinite(e.selic)) return { ok: false, motivo: 'sem_selic', diasUteis };
  const r = taxaContinua(e.selic / 100);
  const base = { tipo: e.tipo, s: e.ativoObjeto / 100, k: e.strike / 100, t: anosUteis(diasUteis), r };
  const iv = volatilidadeImplicita(premio.valor / 100, base);
  if (!iv.ok) return { ok: false, motivo: iv.motivo, diasUteis };
  return { ok: true, volImplicita: iv.sigma, gregas: blackScholes({ ...base, sigma: iv.sigma }), premio: premio.valor, origem: premio.origem, diasUteis, taxaContinua: r };
}
