// Ponte com o MetaTrader 5: tipos das respostas da api e regras de exibição.
// Valor ausente nunca vira zero: sem oferta, sem resultado estimado.

import type { NomeDoIcone } from '../componentes/Icone.tsx';

export type Qualidade = 'tempo_real' | 'periodica' | 'atrasada' | 'desconectado' | 'indisponivel' | 'historico' | 'simulado';

export type CotacaoDaApi = {
  codigo: string;
  provedor: string;
  ultimo: number | null;
  bid: number | null;
  ask: number | null;
  fechamentoAnterior: number | null;
  volume: number | null;
  instanteDaFonte: string | null;
  instanteDeRecebimento: string | null;
  sinalDaPonteEm: string | null;
  qualidade: Qualidade;
};

export type PosicaoDaCorretora = {
  codigo: string;
  lado: 'compra' | 'venda';
  quantidade: number;
  precoMedio: number; // centavos, pode ter fração
  recebidoEm: string | null;
  ponte: string;
  corretora: string | null;
};

export type EstadoDaPonte = Qualidade | 'revogada';

export type Ponte = {
  id: string;
  nome: string;
  criadaEm: string | null;
  revogadaEm: string | null;
  ultimoContatoEm: string | null;
  versao: string | null;
  conta: { login: string | null; servidor: string | null; corretora: string | null };
  estado: EstadoDaPonte;
};

export const MAXIMO_DE_PONTES = 3;

export const SELO_DA_QUALIDADE: Record<Qualidade, { texto: string; classe: string; icone: NomeDoIcone; preenchido?: boolean }> = {
  tempo_real: { texto: 'Tempo real', classe: 'selo-vivo', icone: 'ponto', preenchido: true },
  atrasada: { texto: 'Atrasado', classe: 'selo-atencao', icone: 'aviso' },
  desconectado: { texto: 'Desconectado', classe: 'selo-baixa', icone: 'fechar' },
  historico: { texto: 'Histórico', classe: 'selo-historico', icone: 'calendario' },
  periodica: { texto: 'Atualização periódica', classe: 'selo-periodica', icone: 'relogio' },
  indisponivel: { texto: 'Sem cotação ainda', classe: 'selo-neutro', icone: 'indisponivel' },
  simulado: { texto: 'Simulado', classe: 'selo-neutro', icone: 'indisponivel' },
};

const horaComSegundos = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const horaCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const diaCurto = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

export function horaExata(iso: string): string {
  return horaComSegundos.format(new Date(iso));
}

function segundosDesde(iso: string, agora: Date): number {
  return Math.max(0, Math.round((agora.getTime() - Date.parse(iso)) / 1000));
}

// "há 2 segundos", "há 3 minutos": para o sinal da ponte.
export function haQuanto(iso: string | null, agora: Date): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'nunca';
  const s = segundosDesde(iso, agora);
  if (s < 60) return `há ${s} ${s === 1 ? 'segundo' : 'segundos'}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

// Linha de apoio da coluna "Dado", conforme a prévia dos estados.
export function detalheDaCotacao(c: CotacaoDaApi, agora: Date): string {
  if (!c.instanteDaFonte) return '';
  const mudou = c.instanteDaFonte;
  switch (c.qualidade) {
    case 'tempo_real':
      return `mudou às ${horaExata(mudou)}`;
    case 'atrasada':
      return c.sinalDaPonteEm ? `sem sinal ${haQuanto(c.sinalDaPonteEm, agora)}` : `mudou às ${horaExata(mudou)}`;
    case 'desconectado':
      return c.sinalDaPonteEm
        ? `último sinal em ${diaCurto.format(new Date(c.sinalDaPonteEm))} às ${horaCurta.format(new Date(c.sinalDaPonteEm))}`
        : 'a ponte nunca respondeu';
    case 'historico':
      return `preço de ${diaCurto.format(new Date(mudou))} às ${horaCurta.format(new Date(mudou))}`;
    default:
      return `preço de ${horaCurta.format(new Date(mudou))}`;
  }
}

// Variação do dia em fração (0,0124 = +1,24%). null sem último ou sem fechamento anterior.
export function variacaoDoDia(c: Pick<CotacaoDaApi, 'ultimo' | 'fechamentoAnterior'>): number | null {
  if (c.ultimo === null || c.fechamentoAnterior === null || c.fechamentoAnterior <= 0) return null;
  return (c.ultimo - c.fechamentoAnterior) / c.fechamentoAnterior;
}

// Quanto daria encerrar agora: comprado vende pela melhor oferta de compra (bid);
// vendido recompra pela melhor oferta de venda (ask). Sem custos e impostos.
export type Encerramento =
  | { ok: true; preco: number; origem: 'melhor compra' | 'melhor venda'; resultado: number }
  | { ok: false; motivo: 'sem oferta de compra' | 'sem oferta de venda' | 'sem cotação' };

export function encerrarAgora(p: Pick<PosicaoDaCorretora, 'lado' | 'quantidade' | 'precoMedio'>, c: Pick<CotacaoDaApi, 'bid' | 'ask'> | undefined): Encerramento {
  if (!c) return { ok: false, motivo: 'sem cotação' };
  if (p.lado === 'compra') {
    if (c.bid === null || c.bid <= 0) return { ok: false, motivo: 'sem oferta de compra' };
    return { ok: true, preco: c.bid, origem: 'melhor compra', resultado: Math.round((c.bid - p.precoMedio) * p.quantidade) };
  }
  if (c.ask === null || c.ask <= 0) return { ok: false, motivo: 'sem oferta de venda' };
  return { ok: true, preco: c.ask, origem: 'melhor venda', resultado: Math.round((p.precoMedio - c.ask) * p.quantidade) };
}

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// Resultado com sinal explícito e o sinal de menos tipográfico, como na prévia: +R$ 570,00 / −R$ 69,00.
export function formatarResultado(centavos: number): string {
  const t = reais.format(Math.abs(centavos) / 100);
  if (centavos > 0) return `+${t}`;
  if (centavos < 0) return `−${t}`;
  return t;
}

// Preço em reais sem o "R$", para colunas de compra e venda.
export function formatarPreco(centavos: number | null): string {
  if (centavos === null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Preço médio pode ter fração de centavo: mostra até 4 casas, no mínimo 2.
export function formatarPrecoMedio(centavos: number): string {
  return `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export const TEXTO_DO_ESTADO: Record<EstadoDaPonte, { texto: string; classe: string }> = {
  tempo_real: { texto: 'Conectada', classe: 'selo-vivo' },
  historico: { texto: 'Conectada (pregão fechado)', classe: 'selo-vivo' },
  atrasada: { texto: 'Sinal atrasado', classe: 'selo-atencao' },
  desconectado: { texto: 'Desconectada', classe: 'selo-baixa' },
  revogada: { texto: 'Revogada', classe: 'selo-neutro' },
  periodica: { texto: 'Conectada', classe: 'selo-vivo' },
  indisponivel: { texto: 'Desconectada', classe: 'selo-baixa' },
  simulado: { texto: 'Simulada', classe: 'selo-neutro' },
};

// Estado mostrado na lista de pontes: antes do primeiro sinal não é "desconectada", é "aguardando".
export function estadoDaPonte(p: Ponte): { texto: string; classe: string } {
  if (!p.revogadaEm && !p.ultimoContatoEm) return { texto: 'Aguardando o primeiro sinal', classe: 'selo-neutro' };
  return TEXTO_DO_ESTADO[p.estado];
}

export function contaDaPonte(p: Ponte): string {
  const partes = [p.conta.login && `Conta ${p.conta.login}`, p.conta.servidor, p.conta.corretora].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : 'Conta ainda não informada';
}
