// Cotações normalizadas e qualidade dos dados.
// Regras que este módulo garante:
// - dado ausente fica null, nunca zero;
// - último negócio, bid, ask e preço de referência são campos diferentes;
// - preço médio (bid+ask)/2 só aparece marcado como estimativa;
// - cotação velha não passa por atual: a idade decide a qualidade.

import type { Centavos } from './dinheiro.ts';

export type Qualidade =
  | 'tempo_real' // fonte declara tempo real e a cotação chegou dentro da tolerância
  | 'periodica' // fonte atualiza em intervalos (ex.: a cada 5 min) e está em dia com eles
  | 'atrasada' // passou da idade aceitável para a frequência da fonte
  | 'desconectado' // provedor fora do ar ou sem resposta
  | 'indisponivel' // a fonte não tem esse dado
  | 'historico' // fechamento de pregão anterior (ex.: opções de fim de dia)
  | 'simulado'; // provedor de teste: nunca usado em produção

export type Cotacao = {
  codigo: string;
  provedor: string;
  ultimo: Centavos | null;
  bid: Centavos | null;
  ask: Centavos | null;
  referencia: Centavos | null; // ajuste/fechamento oficial, quando houver
  volume: number | null;
  negocios: number | null;
  instanteDaFonte: string | null; // ISO 8601: quando o mercado gerou o dado
  instanteDeRecebimento: string; // ISO 8601: quando o sistema recebeu
  idEvento?: string | null;
};

export type PerfilDoProvedor = {
  nome: string;
  modo: 'tempo_real' | 'periodico' | 'fim_de_dia' | 'simulado';
  intervaloSeg: number; // frequência declarada de atualização (tempo real: tolerância de silêncio)
};

export type ContextoDeQualidade = {
  agora: Date;
  mercadoAberto: boolean;
  provedorConectado: boolean;
  // Fator sobre o intervalo declarado antes de considerar atrasado (padrão 2: perder um ciclo é tolerado).
  folga?: number;
};

export function idadeSeg(c: Cotacao, agora: Date): number | null {
  const base = c.instanteDaFonte ?? null;
  if (!base) return null;
  const t = Date.parse(base);
  return Number.isNaN(t) ? null : Math.max(0, (agora.getTime() - t) / 1000);
}

function semPreco(c: Cotacao): boolean {
  return c.ultimo === null && c.bid === null && c.ask === null && c.referencia === null;
}

export function qualidadeDaCotacao(c: Cotacao | null, perfil: PerfilDoProvedor, ctx: ContextoDeQualidade): Qualidade {
  if (perfil.modo === 'simulado') return 'simulado';
  if (!ctx.provedorConectado) return 'desconectado';
  if (!c || semPreco(c)) return 'indisponivel';
  if (perfil.modo === 'fim_de_dia') return 'historico';
  const idade = idadeSeg(c, ctx.agora);
  if (idade === null) return 'atrasada'; // sem horário da fonte não há como provar que está em dia
  // Fora do pregão a última cotação é, por definição, do pregão que passou.
  if (!ctx.mercadoAberto) return 'historico';
  const limite = perfil.intervaloSeg * (ctx.folga ?? 2);
  if (idade > limite) return 'atrasada';
  return perfil.modo === 'tempo_real' ? 'tempo_real' : 'periodica';
}

// Qualidade boa o bastante para disparar alerta sobre preço do momento.
export function qualidadeAceitaParaAlerta(q: Qualidade, aceitarPeriodica = true): boolean {
  return q === 'tempo_real' || (aceitarPeriodica && q === 'periodica');
}

export type OrigemDoPreco = 'bid' | 'ask' | 'ultimo' | 'medio' | 'referencia';

export type PrecoDeMarcacao =
  | { ok: true; valor: Centavos | number; origem: OrigemDoPreco; estimativa: boolean }
  | { ok: false; motivo: 'sem_bid' | 'sem_ask' | 'sem_preco' };

export type PoliticaDeMarcacao = 'executavel' | 'executavel_ou_ultimo' | 'medio';

// Preço para estimar o encerramento de uma posição.
// Quem está comprado encerra vendendo (bid); quem está vendido encerra comprando (ask).
// 'executavel' recusa estimar quando falta o lado executável;
// 'executavel_ou_ultimo' cai para o último negócio, marcado como estimativa;
// 'medio' usa (bid+ask)/2, sempre estimativa.
export function precoParaEncerrar(c: Cotacao, posicao: 'comprada' | 'vendida', politica: PoliticaDeMarcacao = 'executavel'): PrecoDeMarcacao {
  const lado = posicao === 'comprada' ? c.bid : c.ask;
  const bidValido = c.bid !== null && c.bid > 0;
  const askValido = c.ask !== null && c.ask > 0;
  if (politica === 'medio') {
    if (bidValido && askValido && (c.ask as number) >= (c.bid as number)) {
      return { ok: true, valor: ((c.bid as number) + (c.ask as number)) / 2, origem: 'medio', estimativa: true };
    }
    return { ok: false, motivo: 'sem_preco' };
  }
  const ladoValido = posicao === 'comprada' ? bidValido : askValido;
  if (ladoValido) return { ok: true, valor: lado as number, origem: posicao === 'comprada' ? 'bid' : 'ask', estimativa: false };
  if (politica === 'executavel_ou_ultimo' && c.ultimo !== null && c.ultimo > 0) {
    return { ok: true, valor: c.ultimo, origem: 'ultimo', estimativa: true };
  }
  return { ok: false, motivo: posicao === 'comprada' ? 'sem_bid' : 'sem_ask' };
}

// Spread relativo ao ponto médio, em fração (0,05 = 5%). null quando não dá para calcular.
export function spreadRelativo(c: Cotacao): number | null {
  if (c.bid === null || c.ask === null || c.bid <= 0 || c.ask < c.bid) return null;
  const meio = (c.bid + c.ask) / 2;
  return (c.ask - c.bid) / meio;
}

// Validação de sanidade de uma cotação recebida do provedor.
export function problemasDaCotacao(c: Cotacao): string[] {
  const p: string[] = [];
  for (const [nome, v] of [['ultimo', c.ultimo], ['bid', c.bid], ['ask', c.ask], ['referencia', c.referencia]] as const) {
    if (v !== null && (!Number.isSafeInteger(v) || v < 0)) p.push(`${nome}_invalido`);
  }
  if (c.bid !== null && c.ask !== null && c.bid > 0 && c.ask > 0 && c.ask < c.bid) p.push('book_cruzado');
  if (c.volume !== null && (!Number.isFinite(c.volume) || c.volume < 0)) p.push('volume_invalido');
  if (c.instanteDaFonte !== null && Number.isNaN(Date.parse(c.instanteDaFonte))) p.push('instante_da_fonte_invalido');
  if (Number.isNaN(Date.parse(c.instanteDeRecebimento))) p.push('instante_de_recebimento_invalido');
  if (c.instanteDaFonte && Date.parse(c.instanteDaFonte) - Date.parse(c.instanteDeRecebimento) > 60_000) p.push('instante_no_futuro');
  return p;
}
