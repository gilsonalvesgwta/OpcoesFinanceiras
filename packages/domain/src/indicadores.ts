// Indicadores a partir do histórico diário (fechamento oficial da B3) mais o preço
// do momento. Todos os valores aqui são CÁLCULO do sistema.
//
// Convenções:
// - o histórico entra em ordem de data, só pregões ANTERIORES a hoje;
// - médias, máximas, mínimas, ATR e volume médio usam só o histórico (o dia de hoje
//   ainda não fechou); o RSI usa o histórico e o preço de agora como último fechamento;
// - sem histórico suficiente, o indicador fica null (nunca zero).
// VWAP precisa dos negócios do dia, que as fontes gratuitas não dão: não existe aqui.

export type Barra = { dia: string; maxima: number | null; minima: number | null; fechamento: number | null; quantidade: number | null };

export function mediaSimples(valores: readonly number[], n: number): number | null {
  if (n < 1 || valores.length < n) return null;
  let s = 0;
  for (let i = valores.length - n; i < valores.length; i += 1) s += valores[i] as number;
  return s / n;
}

// RSI de Wilder com n períodos; `fechamentos` em ordem, o último pode ser o preço de agora.
export function rsi(fechamentos: readonly number[], n = 14): number | null {
  if (fechamentos.length < n + 1) return null;
  let ganho = 0;
  let perda = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = (fechamentos[i] as number) - (fechamentos[i - 1] as number);
    if (d > 0) ganho += d; else perda -= d;
  }
  ganho /= n;
  perda /= n;
  for (let i = n + 1; i < fechamentos.length; i += 1) {
    const d = (fechamentos[i] as number) - (fechamentos[i - 1] as number);
    ganho = (ganho * (n - 1) + Math.max(d, 0)) / n;
    perda = (perda * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (perda === 0) return ganho === 0 ? 50 : 100;
  return 100 - 100 / (1 + ganho / perda);
}

// ATR de Wilder com n períodos (amplitude verdadeira: máxima - mínima, ou distância ao fechamento anterior).
export function atr(barras: readonly Barra[], n = 14): number | null {
  const tr: number[] = [];
  for (let i = 1; i < barras.length; i += 1) {
    const b = barras[i] as Barra;
    const ant = (barras[i - 1] as Barra).fechamento;
    if (b.maxima === null || b.minima === null || ant === null) return null;
    tr.push(Math.max(b.maxima - b.minima, Math.abs(b.maxima - ant), Math.abs(b.minima - ant)));
  }
  if (tr.length < n) return null;
  let a = (tr.slice(0, n).reduce((x, y) => x + y, 0)) / n;
  for (let i = n; i < tr.length; i += 1) a = (a * (n - 1) + (tr[i] as number)) / n;
  return a;
}

export type ValoresDeIndicadores = {
  dist_media_20_pct: number | null;
  dist_media_50_pct: number | null;
  dist_media_200_pct: number | null;
  rsi_14: number | null;
  dist_maxima_20_pct: number | null; // > 0: acima da máxima dos últimos 20 pregões (rompimento)
  dist_minima_20_pct: number | null; // < 0: abaixo da mínima dos últimos 20 pregões
  variacao_em_atr: number | null; // (preço - fechamento anterior) / ATR(14)
  volume_relativo_20: number | null; // volume de hoje / média de 20 pregões
};

const pct = (preco: number, base: number | null) => (base === null || base <= 0 ? null : Math.round(((preco - base) / base) * 10_000) / 100);
const arred = (v: number | null, casas = 2) => (v === null ? null : Math.round(v * 10 ** casas) / 10 ** casas);

export function indicadoresDoMomento(historico: readonly Barra[], preco: number | null, volumeDoDia: number | null): ValoresDeIndicadores {
  const vazio: ValoresDeIndicadores = {
    dist_media_20_pct: null, dist_media_50_pct: null, dist_media_200_pct: null, rsi_14: null,
    dist_maxima_20_pct: null, dist_minima_20_pct: null, variacao_em_atr: null, volume_relativo_20: null,
  };
  if (preco === null || preco <= 0) return vazio;
  // Barras completas e consecutivas do fim para trás (uma barra sem fechamento corta a série).
  const completas: Barra[] = [];
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const b = historico[i] as Barra;
    if (b.fechamento === null) break;
    completas.unshift(b);
  }
  const fech = completas.map((b) => b.fechamento as number);
  const ultimas20 = completas.slice(-20);
  const maximas = ultimas20.map((b) => b.maxima).filter((x): x is number => x !== null);
  const minimas = ultimas20.map((b) => b.minima).filter((x): x is number => x !== null);
  const volumes = ultimas20.map((b) => b.quantidade).filter((x): x is number => x !== null);
  const a = atr(completas.slice(-60), 14);
  const anterior = fech.length ? (fech[fech.length - 1] as number) : null;
  const volMedio = volumes.length === 20 ? volumes.reduce((x, y) => x + y, 0) / 20 : null;
  return {
    dist_media_20_pct: pct(preco, mediaSimples(fech, 20)),
    dist_media_50_pct: pct(preco, mediaSimples(fech, 50)),
    dist_media_200_pct: pct(preco, mediaSimples(fech, 200)),
    rsi_14: arred(rsi([...fech.slice(-200), preco], 14)),
    dist_maxima_20_pct: ultimas20.length === 20 && maximas.length === 20 ? pct(preco, Math.max(...maximas)) : null,
    dist_minima_20_pct: ultimas20.length === 20 && minimas.length === 20 ? pct(preco, Math.min(...minimas)) : null,
    variacao_em_atr: a && anterior !== null && a > 0 ? arred((preco - anterior) / a) : null,
    volume_relativo_20: volMedio && volMedio > 0 && volumeDoDia !== null ? arred(volumeDoDia / volMedio) : null,
  };
}
