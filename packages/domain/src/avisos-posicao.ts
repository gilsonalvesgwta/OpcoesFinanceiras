// Avisos automáticos sobre as posições: vencimento chegando, opção vendida perto do
// strike (ou já dentro do dinheiro) e calls vendidas sem cobertura. Funções puras: quem
// chama decide quando rodar e grava os eventos. A chave de cada evento evita repetição.

import type { Carteira } from './posicoes.ts';
import { instrumentosAbertos } from './posicoes.ts';

export type PreferenciasDeAvisos = {
  vencimento: boolean;
  diasAntes: number[]; // pregões antes do vencimento (ex.: [5, 1])
  risco: boolean;
  distanciaStrikePct: number; // avisar quando o ativo estiver a até X% do strike de opção vendida
  descoberta: boolean;
  sugestoes: boolean; // sugestões de rolagem (consentimento explícito)
  telegram: boolean; // mandar também pelo Telegram (senão, só na tela)
};

export const PREFERENCIAS_PADRAO: PreferenciasDeAvisos = Object.freeze({
  vencimento: true, diasAntes: [5, 1], risco: true, distanciaStrikePct: 2, descoberta: true, sugestoes: false, telegram: true,
}) as PreferenciasDeAvisos;

export type EstrategiaParaAvisos = { id: string; nome: string; ativoObjeto: string; carteira: Carteira };

export type ContextoDosAvisos = {
  hoje: string; // AAAA-MM-DD (Brasília)
  diasDePregaoAte: (vencimento: string) => number;
  spot: (ativo: string) => { valor: number; dia: string } | null; // fechamento oficial
};

export type TipoDeEvento = 'vencimento' | 'risco_strike' | 'descoberta';
export type EventoDePosicao = {
  tipo: TipoDeEvento; chave: string; estrategiaId: string; codigo: string;
  titulo: string; texto: string; valores: Record<string, unknown>;
  pregoes?: number; // para vencimento: em quantos pregões vence
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const qtd = (n: number) => Math.abs(n).toLocaleString('pt-BR');

export function lerPreferencias(x: unknown): PreferenciasDeAvisos {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  const bool = (k: keyof PreferenciasDeAvisos) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : PREFERENCIAS_PADRAO[k] as boolean);
  const dias = Array.isArray(o.diasAntes)
    ? [...new Set(o.diasAntes.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 30))].sort((a, b) => b - a).slice(0, 4)
    : PREFERENCIAS_PADRAO.diasAntes;
  const dist = typeof o.distanciaStrikePct === 'number' && o.distanciaStrikePct >= 0 && o.distanciaStrikePct <= 20 ? o.distanciaStrikePct : PREFERENCIAS_PADRAO.distanciaStrikePct;
  return {
    vencimento: bool('vencimento'), diasAntes: dias, risco: bool('risco'), distanciaStrikePct: dist,
    descoberta: bool('descoberta'), sugestoes: bool('sugestoes'), telegram: bool('telegram'),
  };
}

export function avisosDasEstrategias(estrategias: readonly EstrategiaParaAvisos[], ctx: ContextoDosAvisos, pref: PreferenciasDeAvisos): EventoDePosicao[] {
  const eventos: EventoDePosicao[] = [];
  for (const e of estrategias) {
    const abertos = instrumentosAbertos(e.carteira);
    const spot = ctx.spot(e.ativoObjeto);
    for (const i of abertos) {
      if (i.tipo === 'ativo' || !i.vencimento || i.strike === undefined) continue;
      const k = i.strike;
      const posicao = `${i.quantidade > 0 ? 'comprado' : 'vendido'} ${qtd(i.quantidade)}`;
      const nome = `${i.tipo === 'call' ? 'Call' : 'Put'} ${i.codigo} (strike ${reais(k)})`;
      const dentro = spot ? (i.tipo === 'call' ? spot.valor > k : spot.valor < k) : null;

      // Vencimento: um aviso por limite cruzado (o mais próximo), nunca para o que já venceu.
      if (pref.vencimento && i.vencimento >= ctx.hoje) {
        const d = ctx.diasDePregaoAte(i.vencimento);
        const limites = pref.diasAntes.filter((n) => d <= n);
        if (limites.length) {
          const n = Math.min(...limites);
          const quando = d <= 0 ? 'vence hoje' : d === 1 ? 'vence no próximo pregão' : `vence em ${d} pregões`;
          const situacao = dentro === null
            ? 'Sem fechamento do ativo para dizer se está dentro ou fora do dinheiro.'
            : dentro
              ? `${e.ativoObjeto} fechou a ${reais(spot!.valor)} em ${diaMes(spot!.dia)}: a opção está dentro do dinheiro${i.quantidade < 0 ? ' e pode ser exercida contra você' : ''}.`
              : `${e.ativoObjeto} fechou a ${reais(spot!.valor)} em ${diaMes(spot!.dia)}: a opção está fora do dinheiro.`;
          eventos.push({
            tipo: 'vencimento', chave: `venc:${e.id}:${i.codigo}:${i.vencimento}:${n}`, estrategiaId: e.id, codigo: i.codigo, pregoes: d,
            titulo: `${i.codigo} ${quando} (${diaMes(i.vencimento)})`,
            texto: `${nome}, ${posicao}, em "${e.nome}" ${quando} (${diaMes(i.vencimento)}). ${situacao}`,
            valores: { pregoes: d, vencimento: i.vencimento, quantidade: i.quantidade, spot: spot?.valor ?? null, dentroDoDinheiro: dentro },
          });
        }
      }

      // Risco: opção vendida perto do strike ou já dentro do dinheiro (pelo fechamento oficial).
      if (pref.risco && i.quantidade < 0 && spot && i.vencimento >= ctx.hoje) {
        const distancia = i.tipo === 'call' ? (k - spot.valor) / k : (spot.valor - k) / k; // > 0 = ainda fora
        if (distancia * 100 <= pref.distanciaStrikePct) {
          const pct = Math.abs(distancia * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
          const onde = distancia <= 0 ? `já está dentro do dinheiro (${pct}% além do strike)` : `está a ${pct}% do strike`;
          eventos.push({
            tipo: 'risco_strike', chave: `risco:${e.id}:${i.codigo}:${spot.dia}`, estrategiaId: e.id, codigo: i.codigo,
            titulo: `${i.codigo} vendida ${distancia <= 0 ? 'dentro do dinheiro' : 'perto do strike'}`,
            texto: `${nome}, ${posicao}, em "${e.nome}": ${e.ativoObjeto} fechou a ${reais(spot.valor)} em ${diaMes(spot.dia)} e ${onde}.`,
            valores: { spot: spot.valor, strike: k, distanciaPct: Math.round(distancia * 10_000) / 100, quantidade: i.quantidade },
          });
        }
      }
    }

    // Calls vendidas sem cobertura (ações e calls compradas da estratégia contam como cobertura).
    if (pref.descoberta) {
      const calls = abertos.filter((i) => i.tipo === 'call').reduce((t, i) => t + i.quantidade * i.multiplicador, 0);
      const acoes = abertos.filter((i) => i.tipo === 'ativo').reduce((t, i) => t + i.quantidade * i.multiplicador, 0);
      const descobertas = Math.max(0, -calls - Math.max(0, acoes));
      if (descobertas > 0) {
        eventos.push({
          tipo: 'descoberta', chave: `descoberta:${e.id}:${descobertas}`, estrategiaId: e.id, codigo: e.ativoObjeto,
          titulo: `Calls sem cobertura em "${e.nome}"`,
          texto: `"${e.nome}" tem ${qtd(descobertas)} calls de ${e.ativoObjeto} vendidas sem cobertura: o prejuízo não tem limite se ${e.ativoObjeto} subir.`,
          valores: { descobertas },
        });
      }
    }
  }
  return eventos;
}
