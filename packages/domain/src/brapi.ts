// brapi (plano gratuito): cotação de AÇÕES com cerca de 30 minutos de atraso, uma ação
// por consulta e 15 mil consultas por mês. Aqui ficam as partes puras: ler a resposta
// (sem inventar dado) e dividir a cota do mês pelos ciclos do worker.

export const URL_DA_BRAPI = 'https://brapi.dev/api/v2/stocks/quote';
export const ATRASO_DA_BRAPI_MIN = 30;

export type CotacaoDaBrapi = {
  codigo: string;
  ultimo: number; // centavos
  fechamentoAnterior: number | null;
  volume: number | null;
  instante: string; // ISO, hora do último negócio informada pela brapi
};

const centavos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);

// Aceita o formato v2 (results[].data) e o antigo (campos direto em results[]).
export function lerRespostaDaBrapi(json: unknown, codigo: string): { ok: true; cotacao: CotacaoDaBrapi } | { ok: false; motivo: string } {
  const r = (json as { results?: unknown })?.results;
  if (!Array.isArray(r) || r.length === 0) return { ok: false, motivo: 'sem_resultado' };
  const item = r.find((x) => (x as { symbol?: string; requestedSymbol?: string })?.symbol === codigo || (x as { requestedSymbol?: string })?.requestedSymbol === codigo) ?? r[0];
  const d = ((item as { data?: unknown }).data ?? item) as Record<string, unknown>;
  const ultimo = centavos(d.regularMarketPrice);
  if (ultimo === null) return { ok: false, motivo: 'sem_preco' };
  const t = d.regularMarketTime;
  const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : typeof t === 'string' ? Date.parse(t) : NaN;
  if (!Number.isFinite(ms)) return { ok: false, motivo: 'sem_horario' };
  let anterior = centavos(d.regularMarketPreviousClose);
  if (anterior === null && typeof d.regularMarketChange === 'number' && Number.isFinite(d.regularMarketChange)) {
    anterior = centavos((d.regularMarketPrice as number) - d.regularMarketChange);
  }
  const vol = d.regularMarketVolume;
  return {
    ok: true,
    cotacao: {
      codigo, ultimo, fechamentoAnterior: anterior,
      volume: typeof vol === 'number' && Number.isFinite(vol) && vol >= 0 ? Math.round(vol) : null,
      instante: new Date(ms).toISOString(),
    },
  };
}

// Quantas consultas cabem neste ciclo para a cota do mês durar até o último pregão.
export function consultasPorCiclo(a: { restanteNoMes: number; pregoesRestantes: number; ciclosPorPregao: number; maximo: number }): number {
  if (a.restanteNoMes <= 0) return 0;
  const porCiclo = Math.floor(a.restanteNoMes / Math.max(1, a.pregoesRestantes * a.ciclosPorPregao));
  return Math.max(1, Math.min(a.maximo, porCiclo));
}
