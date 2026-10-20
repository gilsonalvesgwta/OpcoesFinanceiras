// Alertas em português: descrição da condição (para a tela e para a mensagem) e o
// texto do aviso. Preços das regras ficam em centavos, como as cotações.

import type { Comparacao, Condicao, Observacao, PoliticaDeRearme } from './alertas.ts';
import type { Qualidade } from './cotacoes.ts';

export const CAMPOS_DE_ALERTA = Object.freeze({
  ultimo: { nome: 'último preço', unidade: 'reais' },
  bid: { nome: 'melhor oferta de compra', unidade: 'reais' },
  ask: { nome: 'melhor oferta de venda', unidade: 'reais' },
  variacao_dia_pct: { nome: 'variação do dia', unidade: 'percentual' },
  volume: { nome: 'volume do dia', unidade: 'quantidade' },
} as const);

export type CampoDeAlerta = keyof typeof CAMPOS_DE_ALERTA;

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const OPERADORES: Record<Comparacao['operador'], string> = {
  '>': 'acima de', '>=': 'igual ou acima de', '<': 'abaixo de', '<=': 'igual ou abaixo de', igual: 'igual a',
  cruza_acima: 'cruzar para cima de', cruza_abaixo: 'cruzar para baixo de', dentro: 'entre', fora: 'fora da faixa de',
};

export function formatarValorDoCampo(campo: string, v: number): string {
  const u = (CAMPOS_DE_ALERTA as Record<string, { unidade: string }>)[campo]?.unidade;
  if (u === 'reais') return reais.format(v / 100).replace(/\s/g, ' ');
  if (u === 'percentual') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  return v.toLocaleString('pt-BR');
}

export function descreverCondicao(c: Condicao): string {
  if (c.tipo !== 'comparacao') {
    const partes = c.filhos.map((f) => (f.tipo === 'comparacao' ? descreverCondicao(f) : `(${descreverCondicao(f)})`));
    return partes.join(c.tipo === 'e' ? ' e ' : ' ou ');
  }
  const nome = (CAMPOS_DE_ALERTA as Record<string, { nome: string }>)[c.campo]?.nome ?? c.campo;
  const v = formatarValorDoCampo(c.campo, c.valor);
  if (c.operador === 'dentro' || c.operador === 'fora') {
    return `${nome} ${OPERADORES[c.operador]} ${v} e ${formatarValorDoCampo(c.campo, c.valor2 ?? c.valor)}`;
  }
  return `${nome} ${OPERADORES[c.operador]} ${v}`;
}

export function descreverRearme(r: PoliticaDeRearme): string {
  if (r.tipo === 'uma_vez') return 'avisa uma vez e desliga a regra';
  if (r.tipo === 'intervalo') return `avisa de novo depois de ${r.minutos} minutos, se ainda valer`;
  return 'avisa de novo só depois que a condição deixar de valer';
}

const QUALIDADE: Partial<Record<Qualidade, string>> = {
  tempo_real: 'tempo real', periodica: 'atualização periódica', historico: 'fechamento', atrasada: 'atrasado',
};
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function escaparHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mensagem do Telegram (parse_mode HTML). Tudo o que veio do usuário passa por escape.
export function textoDoAviso(a: { codigo: string; nomeDaRegra: string; condicao: Condicao; obs: Pick<Observacao, 'instante' | 'qualidade' | 'valores'>; fonte: string }): string {
  const v = a.obs.valores;
  const linhas = [
    `<b>${escaparHtml(a.codigo)}</b>: ${escaparHtml(descreverCondicao(a.condicao))}`,
    v.ultimo !== null && v.ultimo !== undefined ? `Último: ${formatarValorDoCampo('ultimo', v.ultimo)}` : null,
    v.bid != null || v.ask != null
      ? `Compra ${v.bid != null ? formatarValorDoCampo('bid', v.bid) : '—'} · Venda ${v.ask != null ? formatarValorDoCampo('ask', v.ask) : '—'}`
      : null,
    `Às ${hora.format(new Date(a.obs.instante))} (${QUALIDADE[a.obs.qualidade] ?? a.obs.qualidade}, ${escaparHtml(a.fonte)})`,
    `Regra: ${escaparHtml(a.nomeDaRegra)}`,
  ];
  return linhas.filter(Boolean).join('\n');
}

// Valores que uma cotação oferece às regras. Sem dado fica null (nunca zero).
export function valoresDaCotacao(c: { ultimo: number | null; bid: number | null; ask: number | null; volume: number | null; fechamentoAnterior: number | null }): Observacao['valores'] {
  const variacao = c.ultimo !== null && c.fechamentoAnterior !== null && c.fechamentoAnterior > 0
    ? Math.round(((c.ultimo - c.fechamentoAnterior) / c.fechamentoAnterior) * 10_000) / 100
    : null;
  return { ultimo: c.ultimo, bid: c.bid, ask: c.ask, volume: c.volume, variacao_dia_pct: variacao };
}
