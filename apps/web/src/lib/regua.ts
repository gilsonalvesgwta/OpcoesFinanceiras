// "Régua do pregão": posição, em %, de cada instante dentro da sessão do dia
// (horário de Brasília). Fora da sessão, a posição fica presa nas pontas.

export type Sessao = { abertura: string; fechamento: string }; // "10:00", "17:00"

const partes = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function emBrasilia(d: Date): { dia: string; minutos: number; hora: string } {
  const p: Record<string, string> = {};
  for (const x of partes.formatToParts(d)) p[x.type] = x.value;
  const h = Number(p.hour);
  const m = Number(p.minute);
  return { dia: `${p.year}-${p.month}-${p.day}`, minutos: h * 60 + m, hora: `${p.hour}:${p.minute}` };
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function posicaoNaSessao(d: Date, s: Sessao): number {
  const ini = minutos(s.abertura);
  const fim = minutos(s.fechamento);
  const t = emBrasilia(d).minutos;
  const pos = ((t - ini) / (fim - ini)) * 100;
  return Math.min(100, Math.max(0, Math.round(pos * 100) / 100));
}

export type EstadoDaSessao = 'antes' | 'aberta' | 'depois' | 'sem_pregao';

export function estadoDaSessao(d: Date, s: Sessao, diaDePregao: boolean): EstadoDaSessao {
  if (!diaDePregao) return 'sem_pregao';
  const t = emBrasilia(d).minutos;
  if (t < minutos(s.abertura)) return 'antes';
  if (t >= minutos(s.fechamento)) return 'depois';
  return 'aberta';
}

// Marcas das horas cheias, para dar escala à régua.
export function marcasDeHora(s: Sessao): { pos: number; rotulo: string }[] {
  const ini = minutos(s.abertura);
  const fim = minutos(s.fechamento);
  const r: { pos: number; rotulo: string }[] = [];
  for (let t = Math.ceil(ini / 60) * 60; t <= fim; t += 60) {
    r.push({ pos: Math.round(((t - ini) / (fim - ini)) * 10000) / 100, rotulo: `${String(t / 60).padStart(2, '0')}:00` });
  }
  return r;
}
