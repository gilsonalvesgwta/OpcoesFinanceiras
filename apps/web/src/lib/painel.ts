// Painel do dia do ativo (como o do Google, com o preço do MT5): variação contra o
// fechamento anterior, gráfico do período e os números do dia.

export type Periodo = '1D' | '5D' | '1M' | '6M' | '1A';
export const PERIODOS: Periodo[] = ['1D', '5D', '1M', '6M', '1A'];

export type PainelDoAtivo = {
  ativo: string; agora: string; hoje: string; mercadoAberto: boolean; periodo: Periodo;
  sessao: { abertura: string; fechamento: string } | null;
  cotacao: { ultimo: number | null; bid: number | null; ask: number | null; qualidade: string; provedor: string; instanteDaFonte: string | null; volume: number | null };
  fechamentoAnterior: number | null; abertura: number | null; maxima: number | null; minima: number | null;
  origemDoDia: 'mt5' | 'minutos' | 'b3' | null;
  max52: number | null; min52: number | null;
  pontos: { t: string; p: number }[];
};

// Variação em centavos e em fração (0,0146 = 1,46%). Sem referência: null.
export function variacao(preco: number | null, referencia: number | null): { valor: number; fracao: number } | null {
  if (preco === null || referencia === null || referencia <= 0) return null;
  return { valor: preco - referencia, fracao: (preco - referencia) / referencia };
}

// Máxima e mínima do dia incluindo o preço de agora (a do painel chega a cada 30 s).
export function extremosComAgora(maxima: number | null, minima: number | null, preco: number | null): { maxima: number | null; minima: number | null } {
  if (preco === null) return { maxima, minima };
  return { maxima: maxima === null ? preco : Math.max(maxima, preco), minima: minima === null ? preco : Math.min(minima, preco) };
}

// Escala do gráfico: no 1D o eixo de tempo é o pregão inteiro (o desenho vai enchendo);
// nos outros, do primeiro ao último ponto. O fechamento anterior entra na escala do 1D.
export function escalaDoPainel(
  pontos: readonly { t: string; p: number }[], periodo: Periodo, hoje: string,
  sessao: { abertura: string; fechamento: string } | null, referencia: number | null,
  largura = 760, altura = 260, m = { e: 8, d: 64, t: 12, b: 26 },
) {
  if (!pontos.length) return null;
  const ts = pontos.map((x) => Date.parse(x.t));
  let t0 = Math.min(...ts);
  let t1 = Math.max(...ts);
  if (periodo === '1D') {
    const s = sessao ?? { abertura: '10:00', fechamento: '17:00' };
    t0 = Math.min(t0, Date.parse(`${hoje}T${s.abertura}:00-03:00`));
    t1 = Math.max(t1, Date.parse(`${hoje}T${s.fechamento}:00-03:00`));
  }
  if (t1 <= t0) t1 = t0 + 60_000;
  const valores = pontos.map((x) => x.p);
  if (periodo === '1D' && referencia !== null) valores.push(referencia);
  // Eixo em valores redondos (ex.: 162,00 · 162,50 · 163,00), com folga só até a marca seguinte.
  const marcas = marcasDeValor(Math.min(...valores), Math.max(...valores));
  const v0 = marcas[0] as number;
  const v1 = marcas[marcas.length - 1] as number;
  const x = (t: number) => m.e + ((t - t0) / (t1 - t0)) * (largura - m.e - m.d);
  const y = (v: number) => m.t + ((v1 - v) / (v1 - v0)) * (altura - m.t - m.b);
  const caminho = pontos.map((q, i) => `${i ? 'L' : 'M'}${x(Date.parse(q.t)).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
  const ultimo = pontos[pontos.length - 1] as { t: string; p: number };
  const area = `${caminho} L${x(Date.parse(ultimo.t)).toFixed(1)},${(altura - m.b).toFixed(1)} L${x(ts[0] as number).toFixed(1)},${(altura - m.b).toFixed(1)} Z`;
  // Ponto mais perto de uma posição x (para o mouse).
  const pontoEm = (px: number) => {
    let melhor = pontos[0] as { t: string; p: number };
    let d = Infinity;
    for (const q of pontos) { const dx = Math.abs(x(Date.parse(q.t)) - px); if (dx < d) { d = dx; melhor = q; } }
    return melhor;
  };
  return { largura, altura, m, t0, t1, v0, v1, x, y, caminho, area, ultimo, marcas, pontoEm };
}

// Marcas do eixo de tempo: horas cheias pares no 1D; senão, começo, meio e fim.
export function marcasDeTempo(t0: number, t1: number, periodo: Periodo): { t: number; rotulo: string }[] {
  const hora = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const data = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  if (periodo === '1D') {
    const r: { t: number; rotulo: string }[] = [];
    // Horas pares no horário de Brasília (UTC−3, sem horário de verão).
    const BR = 3 * 3_600_000;
    const inicio = Math.ceil((t0 - BR) / 7_200_000) * 7_200_000 + BR;
    for (let t = inicio; t <= t1; t += 7_200_000) r.push({ t, rotulo: hora(t) });
    return r;
  }
  return [t0, (t0 + t1) / 2, t1].map((t) => ({ t, rotulo: data(t) }));
}

// Marcas "redondas" do eixo de preço (em centavos): passos de 1, 2, 2,5 ou 5 × 10^n,
// de 4 a 7 marcas cobrindo o intervalo.
export function marcasDeValor(min: number, max: number): number[] {
  if (!(max > min)) { min -= 50; max += 50; }
  const bruto = (max - min) / 5;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = ([1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= bruto) ?? 10 * pot);
  const ini = Math.floor(min / passo) * passo;
  const fim = Math.ceil(max / passo) * passo;
  const r: number[] = [];
  for (let v = ini; v <= fim + passo / 1000; v += passo) r.push(Math.round(v * 100) / 100);
  return r;
}
