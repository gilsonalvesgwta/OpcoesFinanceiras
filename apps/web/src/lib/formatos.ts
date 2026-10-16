// Formatos brasileiros para dinheiro, percentuais, datas e horas.
// Valor ausente vira um traço com texto acessível, nunca "0".

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataLonga = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dataCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const AUSENTE = '—';

export function formatarReais(centavos: number | null | undefined): string {
  return centavos === null || centavos === undefined || !Number.isFinite(centavos) ? AUSENTE : reais.format(centavos / 100);
}

// Percentual com sinal explícito e o sinal de menos tipográfico (−), como na prévia.
export function formatarVariacao(fracao: number | null | undefined, casas = 2): string {
  if (fracao === null || fracao === undefined || !Number.isFinite(fracao)) return AUSENTE;
  const texto = Math.abs(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  if (fracao > 0) return `+${texto}%`;
  if (fracao < 0) return `−${texto}%`;
  return `${texto}%`;
}

function primeiraMaiuscula(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function formatarDataLonga(d: Date): string {
  return primeiraMaiuscula(dataLonga.format(d));
}

export function formatarData(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00-03:00` : d) : d;
  return Number.isNaN(x.getTime()) ? AUSENTE : dataCurta.format(x);
}

export function formatarHora(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? AUSENTE : hora.format(x);
}

export function formatarDataHora(d: Date | string | null | undefined): string {
  if (!d) return AUSENTE;
  const x = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? AUSENTE : `${dataCurta.format(x)} às ${hora.format(x)}`;
}

// "há 31 minutos", "há 2 horas", "agora".
export function tempoDesde(d: Date | string, agora: Date): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  const min = Math.floor((agora.getTime() - x.getTime()) / 60_000);
  if (!Number.isFinite(min)) return AUSENTE;
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const dias = Math.floor(h / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

// Dias corridos entre duas datas AAAA-MM-DD (para "em 63 dias").
export function diasAte(de: string, ate: string): number {
  const [a1, m1, d1] = de.split('-').map(Number) as [number, number, number];
  const [a2, m2, d2] = ate.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

export const PAPEIS: Record<string, string> = {
  superadmin: 'Superadministrador',
  admin: 'Administrador',
  usuario: 'Usuário',
};
