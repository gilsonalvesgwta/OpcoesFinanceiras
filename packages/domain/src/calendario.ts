// Calendário de negociação da B3.
// Nada de horário fixo no código: feriados e sessões vêm de configuração
// (tabela no banco, editável pelo superadministrador), e este módulo só aplica.
// Horários sempre em Brasília (America/Sao_Paulo).

import { partesEmBrasilia } from './alertas.ts';

export type Sessao = { abertura: string; fechamento: string }; // "10:00", "17:00"

export type ConfiguracaoDoCalendario = {
  feriados: ReadonlySet<string>; // AAAA-MM-DD sem pregão
  sessaoPadrao: Sessao;
  sessoesEspeciais: ReadonlyMap<string, Sessao>; // dias com horário diferente (ex.: quarta de Cinzas)
};

function diaDaSemana(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function ehDiaDePregao(dia: string, cfg: ConfiguracaoDoCalendario): boolean {
  const dds = diaDaSemana(dia);
  return dds !== 0 && dds !== 6 && !cfg.feriados.has(dia);
}

export function sessaoDoDia(dia: string, cfg: ConfiguracaoDoCalendario): Sessao | null {
  if (!ehDiaDePregao(dia, cfg)) return null;
  return cfg.sessoesEspeciais.get(dia) ?? cfg.sessaoPadrao;
}

export type SituacaoDoMercado = { aberto: boolean; dia: string; sessao: Sessao | null; motivo: 'pregao' | 'antes' | 'depois' | 'sem_pregao' };

export function situacaoDoMercado(agora: Date, cfg: ConfiguracaoDoCalendario): SituacaoDoMercado {
  const { dia, hora } = partesEmBrasilia(agora);
  const sessao = sessaoDoDia(dia, cfg);
  if (!sessao) return { aberto: false, dia, sessao: null, motivo: 'sem_pregao' };
  if (hora < sessao.abertura) return { aberto: false, dia, sessao, motivo: 'antes' };
  if (hora >= sessao.fechamento) return { aberto: false, dia, sessao, motivo: 'depois' };
  return { aberto: true, dia, sessao, motivo: 'pregao' };
}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

// Dias úteis de pregão entre `de` (exclusive) e `ate` (inclusive): base do tempo dos modelos.
export function diasDePregaoEntre(de: string, ate: string, cfg: ConfiguracaoDoCalendario): number {
  if (ate <= de) return 0;
  let n = 0;
  for (let dia = somarDias(de, 1); dia <= ate; dia = somarDias(dia, 1)) if (ehDiaDePregao(dia, cfg)) n += 1;
  return n;
}

// Vencimento de opções sobre ações na B3: terceira sexta-feira do mês (regra vigente
// desde 2021). Se não houver pregão nesse dia, o vencimento passa para o dia de
// pregão seguinte. O vencimento oficial de cada série vem do provedor; esta função
// serve para conferir e para preencher a agenda antes de a série existir.
export function terceiraSexta(ano: number, mes: number): string {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const dia = 1 + ((5 - primeiro + 7) % 7) + 14;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function vencimentoMensal(ano: number, mes: number, cfg: ConfiguracaoDoCalendario): string {
  let dia = terceiraSexta(ano, mes);
  while (!ehDiaDePregao(dia, cfg)) dia = somarDias(dia, 1);
  return dia;
}
