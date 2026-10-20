// Coleta das fontes gratuitas: o que buscar e quando, e a leitura da Selic.
// Nada aqui acessa rede ou banco; o worker usa estas regras.
//
// B3: arquivo diário COTAHIST_DddmmAAAA.ZIP, publicado depois do fim do pregão.
// Banco Central (SGS): série 1178, Selic anualizada base 252, em % ao ano.

import { partesEmBrasilia } from './alertas.ts';
import { ehDiaDePregao, type ConfiguracaoDoCalendario } from './calendario.ts';

export const SERIE_SELIC = 1178;

export function urlDoCotahistDiario(dia: string): string {
  const [a, m, d] = dia.split('-') as [string, string, string];
  return `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${d}${m}${a}.ZIP`;
}

// Arquivo mensal: COTAHIST_MmmAAAA.ZIP (mês com dois dígitos). Usado na carga do histórico.
export function urlDoCotahistMensal(mes: string): string {
  const [a, m] = mes.split('-') as [string, string];
  return `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M${m}${a}.ZIP`;
}

// Meses completos (anteriores ao atual) ainda sem histórico, do mais recente ao mais
// antigo. Mês tentado sem sucesso só volta depois de `esperaHoras`.
export function mesesParaCarregar(
  agora: Date, importados: ReadonlySet<string>, ultimaTentativa: ReadonlyMap<string, string>, meses = 12, esperaHoras = 6,
): string[] {
  const [a, m] = partesEmBrasilia(agora).dia.split('-').map(Number) as [number, number];
  const lista: string[] = [];
  for (let i = 1; i <= meses; i += 1) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const mes = d.toISOString().slice(0, 7);
    if (importados.has(mes)) continue;
    const t = ultimaTentativa.get(mes);
    if (t && agora.getTime() - Date.parse(t) < esperaHoras * 3_600_000) continue;
    lista.push(mes);
  }
  return lista;
}

export function urlDaSerieSgs(codigo: number, ultimos = 10): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/${ultimos}?formato=json`;
}

export type PontoDaSerie = { dia: string; valor: number };

// Resposta do SGS: [{"data":"16/10/2026","valor":"14.90"}]. Ponto ilegível é descartado,
// nunca vira zero. Devolve em ordem de data.
export function lerSerieSgs(json: unknown): PontoDaSerie[] {
  if (!Array.isArray(json)) throw new Error('resposta_sgs_invalida');
  const pontos: PontoDaSerie[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const { data, valor } = item as { data?: unknown; valor?: unknown };
    if (typeof data !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(data)) continue;
    const texto = typeof valor === 'number' ? String(valor) : typeof valor === 'string' ? valor.trim().replace(',', '.') : '';
    if (!/^-?\d+(\.\d+)?$/.test(texto)) continue;
    const [d, m, a] = data.split('/') as [string, string, string];
    pontos.push({ dia: `${a}-${m}-${d}`, valor: Number(texto) });
  }
  return pontos.sort((x, y) => (x.dia < y.dia ? -1 : x.dia > y.dia ? 1 : 0));
}

// A Selic vem em % ao ano; o modelo usa fração: taxaContinua(valor / 100), em modelo.ts.

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export type AgendaDaColeta = {
  diasParaTras: number; // quantos dias corridos conferir (recupera o que faltou)
  liberacao: string; // "HH:MM" em Brasília: antes disso o arquivo do dia ainda não saiu
  esperaEntreTentativasMin: number;
};

export const AGENDA_PADRAO: AgendaDaColeta = { diasParaTras: 10, liberacao: '20:00', esperaEntreTentativasMin: 60 };

// Pregões cujo arquivo ainda falta, do mais antigo ao mais novo. Dia sem pregão
// (fim de semana ou feriado cadastrado) não é buscado. Não insiste antes da espera.
export function diasParaColetar(
  agora: Date,
  cfg: ConfiguracaoDoCalendario,
  importados: ReadonlySet<string>,
  ultimaTentativa: ReadonlyMap<string, string>,
  agenda: AgendaDaColeta = AGENDA_PADRAO,
): string[] {
  const { dia: hoje, hora } = partesEmBrasilia(agora);
  const dias: string[] = [];
  for (let i = agenda.diasParaTras; i >= 0; i -= 1) {
    const d = somarDias(hoje, -i);
    if (!ehDiaDePregao(d, cfg) || importados.has(d)) continue;
    if (d === hoje && hora < agenda.liberacao) continue;
    const t = ultimaTentativa.get(d);
    if (t && agora.getTime() - Date.parse(t) < agenda.esperaEntreTentativasMin * 60_000) continue;
    dias.push(d);
  }
  return dias;
}

// Último pregão já encerrado (para dizer de quando é o fechamento esperado).
export function ultimoPregaoEncerrado(agora: Date, cfg: ConfiguracaoDoCalendario, fechamento = '17:00'): string {
  const { dia, hora } = partesEmBrasilia(agora);
  let d = hora >= fechamento ? dia : somarDias(dia, -1);
  for (let i = 0; i < 15 && !ehDiaDePregao(d, cfg); i += 1) d = somarDias(d, -1);
  return d;
}
