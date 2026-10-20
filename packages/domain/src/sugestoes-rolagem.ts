// Sugestões de rolagem: para cada série candidata, quais critérios do usuário ela
// atende, quais não atende e para quais falta dado. O sistema NÃO elege a melhor:
// a lista sai na ordem de vencimento e strike, e cada critério aparece com a situação.
// Nenhuma sugestão vira ordem.

import { precoParaEncerrar, type Cotacao, type PoliticaDeMarcacao, type PrecoDeMarcacao } from './cotacoes.ts';
import type { Lado } from './payoff.ts';

// Preço para ABRIR uma perna: quem vende recebe o melhor comprador (bid); quem compra
// paga o melhor vendedor (ask). É o mesmo lado de quem encerra a posição contrária.
export function precoParaAbrir(c: Cotacao, lado: Lado, politica: PoliticaDeMarcacao = 'executavel'): PrecoDeMarcacao {
  return precoParaEncerrar(c, lado === 'venda' ? 'comprada' : 'vendida', politica);
}

export type CriteriosDeRolagem = {
  diasMin?: number; // dias corridos até o vencimento da série nova
  diasMax?: number;
  deltaMin?: number; // |delta|, de 0 a 1
  deltaMax?: number;
  creditoMinimo?: number; // centavos: fluxo líquido da rolagem precisa ser pelo menos isto
  debitoMaximo?: number; // centavos: débito líquido de no máximo isto
  negociosMin?: number; // negócios no último pregão
  spreadMaximoPct?: number; // (ask − bid) / meio × 100
  strike?: 'manter' | 'acima' | 'abaixo' | 'qualquer';
  perdaMaximaNaoAumenta?: boolean;
};

export type CandidatoDeRolagem = {
  codigo: string;
  strike: number; // centavos
  strikeAtual: number; // da perna que sai
  dias: number;
  delta: number | null;
  negocios: number | null;
  bid: number | null;
  ask: number | null;
  liquido: number | null; // fluxo líquido da rolagem simulada (centavos); null sem preço
  perdaMaximaPiorou: boolean | null; // null quando não deu para comparar o payoff
};

export type SituacaoDoCriterio = 'atendido' | 'nao_atendido' | 'sem_dado';
export type AvaliacaoDoCriterio = { criterio: keyof CriteriosDeRolagem | 'dias' | 'delta'; texto: string; situacao: SituacaoDoCriterio };

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nada = (v: number | undefined): v is undefined => v === undefined || !Number.isFinite(v);

export function spreadPct(bid: number | null, ask: number | null): number | null {
  if (bid === null || ask === null || bid <= 0 || ask < bid) return null;
  const meio = (bid + ask) / 2;
  return Math.round(((ask - bid) / meio) * 10_000) / 100;
}

export function avaliarCandidato(c: CandidatoDeRolagem, k: CriteriosDeRolagem): AvaliacaoDoCriterio[] {
  const r: AvaliacaoDoCriterio[] = [];
  const sit = (ok: boolean | null): SituacaoDoCriterio => (ok === null ? 'sem_dado' : ok ? 'atendido' : 'nao_atendido');

  if (!nada(k.diasMin) || !nada(k.diasMax)) {
    const de = nada(k.diasMin) ? 0 : k.diasMin;
    const ate = nada(k.diasMax) ? Infinity : k.diasMax;
    const texto = nada(k.diasMax) ? `vence em ${de} dias ou mais` : `vence entre ${de} e ${ate} dias`;
    r.push({ criterio: 'dias', texto, situacao: sit(c.dias >= de && c.dias <= ate) });
  }
  if (!nada(k.deltaMin) || !nada(k.deltaMax)) {
    const de = nada(k.deltaMin) ? 0 : k.deltaMin;
    const ate = nada(k.deltaMax) ? 1 : k.deltaMax;
    const d = c.delta === null ? null : Math.abs(c.delta);
    r.push({ criterio: 'delta', texto: `delta entre ${de.toLocaleString('pt-BR')} e ${ate.toLocaleString('pt-BR')}`, situacao: sit(d === null ? null : d >= de && d <= ate) });
  }
  if (!nada(k.creditoMinimo)) {
    r.push({ criterio: 'creditoMinimo', texto: `crédito de pelo menos R$ ${reais(k.creditoMinimo)}`, situacao: sit(c.liquido === null ? null : c.liquido >= k.creditoMinimo) });
  }
  if (!nada(k.debitoMaximo)) {
    r.push({ criterio: 'debitoMaximo', texto: `débito de no máximo R$ ${reais(k.debitoMaximo)}`, situacao: sit(c.liquido === null ? null : -c.liquido <= k.debitoMaximo) });
  }
  if (!nada(k.negociosMin)) {
    r.push({ criterio: 'negociosMin', texto: `pelo menos ${k.negociosMin} negócios no último pregão`, situacao: sit(c.negocios === null ? null : c.negocios >= k.negociosMin) });
  }
  if (!nada(k.spreadMaximoPct)) {
    const s = spreadPct(c.bid, c.ask);
    r.push({ criterio: 'spreadMaximoPct', texto: `diferença entre compra e venda de até ${k.spreadMaximoPct.toLocaleString('pt-BR')}%`, situacao: sit(s === null ? null : s <= k.spreadMaximoPct) });
  }
  if (k.strike && k.strike !== 'qualquer') {
    const texto = k.strike === 'manter' ? 'mesmo strike' : k.strike === 'acima' ? 'strike acima do atual' : 'strike abaixo do atual';
    const ok = k.strike === 'manter' ? c.strike === c.strikeAtual : k.strike === 'acima' ? c.strike > c.strikeAtual : c.strike < c.strikeAtual;
    r.push({ criterio: 'strike', texto, situacao: sit(ok) });
  }
  if (k.perdaMaximaNaoAumenta) {
    r.push({ criterio: 'perdaMaximaNaoAumenta', texto: 'perda máxima não aumenta', situacao: sit(c.perdaMaximaPiorou === null ? null : !c.perdaMaximaPiorou) });
  }
  return r;
}

export function resumoDaAvaliacao(a: readonly AvaliacaoDoCriterio[]): { atendidos: number; naoAtendidos: number; semDado: number; todos: boolean } {
  const atendidos = a.filter((x) => x.situacao === 'atendido').length;
  const naoAtendidos = a.filter((x) => x.situacao === 'nao_atendido').length;
  const semDado = a.filter((x) => x.situacao === 'sem_dado').length;
  return { atendidos, naoAtendidos, semDado, todos: naoAtendidos === 0 && semDado === 0 };
}
