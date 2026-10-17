// Ponte com o MetaTrader 5 da corretora: validação do que o robô envia e
// qualidade do "tempo real".
//
// O robô manda preços em reais (como o MT5 mostra) e horários em milissegundos
// UTC. Aqui tudo vira centavos e ISO 8601. Regras:
// - zero vindo do MT5 significa "sem dado" (bid/ask 0 = livro vazio): vira null, nunca 0;
// - preço que não cabe em centavos inteiros é recusado (não arredondamos dado da fonte);
// - horário no futuro (mais de 60 s) ou com mais de 7 dias é recusado: quase sempre é fuso errado;
// - um item ruim não derruba o lote: ele é descartado e contado em `avisos`.
//
// Qualidade: o que prova que a cotação é atual é o PULSO da ponte (o robô fala a
// cada poucos segundos mesmo sem mudança de preço), não a hora do último negócio,
// porque um ativo pouco negociado fica minutos sem negócio e continua atual.

import type { Centavos } from './dinheiro.ts';
import type { Qualidade } from './cotacoes.ts';

export const LIMITES_DA_PONTE = {
  cotacoes: 500,
  posicoes: 200,
  futuroMs: 60_000,
  passadoMs: 7 * 24 * 3600_000,
  silencioAtrasadaSeg: 15,
  silencioDesconectadaSeg: 60,
} as const;

export type CotacaoDaPonte = {
  codigo: string;
  ultimo: Centavos | null;
  bid: Centavos | null;
  ask: Centavos | null;
  fechamento_anterior: Centavos | null;
  volume: number | null;
  instante: string; // ISO 8601 UTC: última mudança no servidor da corretora
};

export type PosicaoDaPonte = {
  codigo: string;
  lado: 'compra' | 'venda';
  quantidade: number;
  preco_medio: number; // centavos, com até 4 casas (preço médio pode ter fração de centavo)
};

export type LoteDaPonte = {
  versao: string;
  conta: { login: string | null; servidor: string | null; corretora: string | null };
  cotacoes: CotacaoDaPonte[];
  posicoes: PosicaoDaPonte[] | null; // null = o lote não trata de posições
  avisos: string[];
};

export type ResultadoDoLote = { ok: true; lote: LoteDaPonte } | { ok: false; erro: string };

const CODIGO = /^[A-Z0-9]{4,16}$/;

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function texto(v: unknown, max: number): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

// Preço em reais -> centavos inteiros. undefined = valor inválido (recusa o item); null = sem dado.
export function precoDaPonte(v: unknown): Centavos | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  if (v === 0) return null;
  const c = Math.round(v * 100);
  if (Math.abs(v * 100 - c) > 1e-6 * Math.max(1, c)) return undefined;
  return Number.isSafeInteger(c) && c > 0 ? c : undefined;
}

function instanteDaPonte(v: unknown, agora: Date): string | undefined {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return undefined;
  const d = agora.getTime() - v;
  if (d < -LIMITES_DA_PONTE.futuroMs || d > LIMITES_DA_PONTE.passadoMs) return undefined;
  return new Date(v).toISOString();
}

function lerCotacao(v: unknown, agora: Date): CotacaoDaPonte | string {
  if (!objeto(v)) return 'cotacao_invalida';
  const codigo = typeof v.codigo === 'string' ? v.codigo.trim().toUpperCase() : '';
  if (!CODIGO.test(codigo)) return 'codigo_invalido';
  const instante = instanteDaPonte(v.instante, agora);
  if (instante === undefined) return 'horario_fora_do_intervalo';
  const ultimo = precoDaPonte(v.ultimo);
  const bid = precoDaPonte(v.bid);
  const ask = precoDaPonte(v.ask);
  const fechamento = precoDaPonte(v.fechamento_anterior);
  if (ultimo === undefined || bid === undefined || ask === undefined || fechamento === undefined) return 'preco_invalido';
  if (bid !== null && ask !== null && ask < bid) return 'livro_cruzado';
  let volume: number | null = null;
  if (v.volume !== undefined && v.volume !== null) {
    if (typeof v.volume !== 'number' || !Number.isSafeInteger(v.volume) || v.volume < 0) return 'volume_invalido';
    volume = v.volume;
  }
  return { codigo, ultimo, bid, ask, fechamento_anterior: fechamento, volume, instante };
}

function lerPosicao(v: unknown): PosicaoDaPonte | string {
  if (!objeto(v)) return 'posicao_invalida';
  const codigo = typeof v.codigo === 'string' ? v.codigo.trim().toUpperCase() : '';
  if (!CODIGO.test(codigo)) return 'codigo_invalido';
  if (v.lado !== 'compra' && v.lado !== 'venda') return 'lado_invalido';
  const q = v.quantidade;
  if (typeof q !== 'number' || !Number.isSafeInteger(q) || q <= 0) return 'quantidade_invalida';
  const p = v.preco_medio;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1e9) return 'preco_invalido';
  return { codigo, lado: v.lado, quantidade: q, preco_medio: Math.round(p * 1_000_000) / 10_000 };
}

export function lerLoteDaPonte(corpo: unknown, agora: Date): ResultadoDoLote {
  if (!objeto(corpo)) return { ok: false, erro: 'corpo_invalido' };
  const versao = texto(corpo.versao, 40) ?? 'desconhecida';
  const c = objeto(corpo.conta) ? corpo.conta : {};
  const conta = { login: texto(c.login, 40), servidor: texto(c.servidor, 80), corretora: texto(c.corretora, 120) };

  const brutas = corpo.cotacoes ?? [];
  if (!Array.isArray(brutas)) return { ok: false, erro: 'cotacoes_invalidas' };
  if (brutas.length > LIMITES_DA_PONTE.cotacoes) return { ok: false, erro: 'lote_grande_demais' };
  const avisos: string[] = [];
  const porCodigo = new Map<string, CotacaoDaPonte>();
  for (const b of brutas) {
    const r = lerCotacao(b, agora);
    if (typeof r === 'string') { avisos.push(r); continue; }
    const atual = porCodigo.get(r.codigo);
    if (!atual || atual.instante <= r.instante) porCodigo.set(r.codigo, r); // repetido no lote: fica o mais recente
  }

  let posicoes: PosicaoDaPonte[] | null = null;
  if (corpo.posicoes !== undefined && corpo.posicoes !== null) {
    if (!Array.isArray(corpo.posicoes)) return { ok: false, erro: 'posicoes_invalidas' };
    if (corpo.posicoes.length > LIMITES_DA_PONTE.posicoes) return { ok: false, erro: 'lote_grande_demais' };
    const lidas: PosicaoDaPonte[] = [];
    let ruim = false;
    for (const b of corpo.posicoes) {
      const r = lerPosicao(b);
      if (typeof r === 'string') { avisos.push(r); ruim = true; } else lidas.push(r);
    }
    // Conta "netting" (a da B3) tem uma posição por ativo. Se vier mais de uma, somamos as do
    // mesmo lado; lados opostos no mesmo ativo (conta "hedging") não sabemos representar.
    const juntas = new Map<string, PosicaoDaPonte>();
    for (const p of lidas) {
      const j = juntas.get(p.codigo);
      if (!j) { juntas.set(p.codigo, { ...p }); continue; }
      if (j.lado !== p.lado) { avisos.push('posicao_hedge_nao_suportada'); ruim = true; break; }
      const q = j.quantidade + p.quantidade;
      j.preco_medio = Math.round(((j.preco_medio * j.quantidade + p.preco_medio * p.quantidade) / q) * 10_000) / 10_000;
      j.quantidade = q;
    }
    // A lista de posições substitui a guardada: se alguma veio ruim, não mexemos em nada
    // (apagar uma posição real por causa de um item ilegível seria pior que esperar o próximo envio).
    if (!ruim) posicoes = [...juntas.values()];
  }

  return { ok: true, lote: { versao, conta, cotacoes: [...porCodigo.values()], posicoes, avisos } };
}

// Qualidade da cotação que veio pela ponte, a partir do último contato do robô.
export function qualidadeDaPonte(ultimoContato: string | null, agora: Date, mercadoAberto: boolean): Qualidade {
  if (!ultimoContato) return 'desconectado';
  const t = Date.parse(ultimoContato);
  if (Number.isNaN(t)) return 'desconectado';
  const silencio = (agora.getTime() - t) / 1000;
  if (silencio > LIMITES_DA_PONTE.silencioDesconectadaSeg) return 'desconectado';
  if (!mercadoAberto) return 'historico';
  if (silencio > LIMITES_DA_PONTE.silencioAtrasadaSeg) return 'atrasada';
  return 'tempo_real';
}
