// Simulador na tela: cadeia → pernas, calendário da B3 para contar pregões, avaliação em
// datas (hoje, data escolhida, primeiro vencimento) e escala do gráfico com várias curvas.

import {
  blackScholes, diasDePregaoEntre, premioDoFechamento, taxaContinua, volatilidadeImplicita,
  type AvaliacaoDaSimulacao, type ConfiguracaoDoCalendario, type PernaSimulada, type PontoDaCurva,
} from '@wta/domain';

export type CotacaoResumida = { ultimo: number | null; bid: number | null; ask: number | null; qualidade: string; provedor: string; instanteDaFonte: string | null } | null;
export type SerieDaCadeia = { codigo: string; tipo: 'call' | 'put'; strike: number; negocios: number | null; vol: number | null; delta: number | null; cotacao: CotacaoResumida };
export type CadeiaDoSimulador = {
  agora: string; hoje: string; dia: string; mercadoAberto?: boolean;
  ativo: { codigo: string; cotacao: CotacaoResumida };
  vencimentos: string[]; vencimento: string | null; series: SerieDaCadeia[];
  selic: { dia: string; valor: number } | null;
};
export type CalendarioDaApi = {
  feriados: { dia: string }[]; sessoesEspeciais: { dia: string; abertura: string; fechamento: string }[]; sessaoPadrao: { abertura: string; fechamento: string };
};

export type PernaNaTela = PernaSimulada & { id: string; base?: boolean }; // base = posição atual da carteira simulada

export function configDoCalendario(c: CalendarioDaApi): ConfiguracaoDoCalendario {
  return {
    feriados: new Set(c.feriados.map((f) => f.dia)),
    sessaoPadrao: c.sessaoPadrao,
    sessoesEspeciais: new Map(c.sessoesEspeciais.map((s) => [s.dia, { abertura: s.abertura, fechamento: s.fechamento }])),
  };
}

// Preço de mercado para montar: quem compra paga o ask; quem vende recebe o bid; sem
// oferta, o último negócio. Sem nada: null (a pessoa digita o preço).
export function precoDeMercado(c: CotacaoResumida, lado: 'compra' | 'venda'): { preco: number; origem: 'bid' | 'ask' | 'ultimo' } | null {
  if (!c) return null;
  const lado1 = lado === 'compra' ? c.ask : c.bid;
  if (lado1 !== null && lado1 > 0) return { preco: lado1, origem: lado === 'compra' ? 'ask' : 'bid' };
  if (c.ultimo !== null && c.ultimo > 0) return { preco: c.ultimo, origem: 'ultimo' };
  return null;
}

let sequencia = 0;
export const novoId = () => `p${Date.now().toString(36)}${(sequencia += 1)}`;

export function pernaDaSerie(s: SerieDaCadeia, vencimento: string, lado: 'compra' | 'venda', quantidade = 100): PernaNaTela {
  return {
    id: novoId(), codigo: s.codigo, tipo: s.tipo, strike: s.strike, vencimento, lado, quantidade,
    preco: precoDeMercado(s.cotacao, lado)?.preco ?? 0, vol: s.vol,
  };
}

export function pernaDoAtivo(codigo: string, c: CotacaoResumida, lado: 'compra' | 'venda', quantidade = 100): PernaNaTela {
  return { id: novoId(), codigo, tipo: 'ativo', lado, quantidade, preco: precoDeMercado(c, lado)?.preco ?? 0, vol: null };
}

// Perna que zera outra (para rolar ou desmontar): lado contrário, mesma quantidade.
export function pernaQueEncerra(p: PernaNaTela, preco: number): PernaNaTela {
  const { base: _base, ...resto } = p;
  return { ...resto, id: novoId(), lado: p.lado === 'compra' ? 'venda' : 'compra', preco };
}

// Soma uma perna nova a uma igual que já existe (mesmo código e lado, que não seja da base).
export function adicionarPerna(lista: readonly PernaNaTela[], nova: PernaNaTela): PernaNaTela[] {
  const i = lista.findIndex((p) => !p.base && p.codigo === nova.codigo && p.lado === nova.lado);
  if (i < 0) return [...lista, nova];
  const atual = lista[i] as PernaNaTela;
  const q = atual.quantidade + nova.quantidade;
  const preco = Math.round((atual.preco * atual.quantidade + nova.preco * nova.quantidade) / q);
  return lista.map((p, j) => (j === i ? { ...atual, quantidade: q, preco } : p));
}

// Data (AAAA-MM-DD) somando dias corridos.
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

// Avaliação numa data: pregões que faltam de `data` até cada vencimento.
export function avaliacaoNaData(data: string, cfg: ConfiguracaoDoCalendario, selicPct: number, deslocamentoDeVolPts = 0): AvaliacaoDaSimulacao {
  return {
    taxa: taxaContinua(selicPct / 100),
    restam: (v: string) => (v <= data ? 0 : diasDePregaoEntre(data, v, cfg)),
    deslocamentoDeVol: deslocamentoDeVolPts / 100,
  };
}

// ---------- Gráfico ----------

export type CurvaDoGrafico = { nome: string; pontos: readonly PontoDaCurva[] };

export function escalaDoGrafico(curvas: readonly CurvaDoGrafico[], largura = 720, altura = 300, margem = { e: 92, d: 14, t: 16, b: 30 }) {
  const pts = curvas.flatMap((c) => c.pontos);
  const validos = pts.filter((p) => p.resultado !== null) as { s: number; resultado: number }[];
  if (pts.length < 2 || validos.length < 2) return null;
  const de = Math.min(...pts.map((p) => p.s));
  const ate = Math.max(...pts.map((p) => p.s));
  if (!(ate > de)) return null;
  let min = Math.min(0, ...validos.map((p) => p.resultado));
  let max = Math.max(0, ...validos.map((p) => p.resultado));
  if (max === min) { max += 100; min -= 100; }
  const folga = (max - min) * 0.08;
  min -= folga; max += folga;
  const x = (s: number) => margem.e + ((s - de) / (ate - de)) * (largura - margem.e - margem.d);
  const y = (v: number) => margem.t + ((max - v) / (max - min)) * (altura - margem.t - margem.b);
  // Ponto sem resultado (sem volatilidade) interrompe a linha em vez de cair para zero.
  const caminho = (c: CurvaDoGrafico) => {
    let d = '';
    let novo = true;
    for (const p of c.pontos) {
      if (p.resultado === null) { novo = true; continue; }
      d += `${novo ? 'M' : 'L'}${x(p.s).toFixed(1)},${y(p.resultado).toFixed(1)} `;
      novo = false;
    }
    return d.trim() || null;
  };
  return { largura, altura, de, ate, min, max, x, y, caminhos: curvas.map(caminho) };
}

// Resultado de uma curva num preço (interpolando entre os pontos vizinhos).
export function resultadoEmPreco(pontos: readonly PontoDaCurva[], s: number): number | null {
  for (let i = 1; i < pontos.length; i += 1) {
    const a = pontos[i - 1] as PontoDaCurva;
    const b = pontos[i] as PontoDaCurva;
    if (s >= a.s && s <= b.s) {
      if (a.resultado === null || b.resultado === null) return null;
      if (b.s === a.s) return a.resultado;
      return Math.round(a.resultado + ((b.resultado - a.resultado) * (s - a.s)) / (b.s - a.s));
    }
  }
  return null;
}

// Corpo para guardar/registrar na carteira simulada.
export function execucoesParaApi(pernas: readonly PernaNaTela[]) {
  return pernas.filter((p) => !p.base).map((p) => ({
    codigo: p.codigo, tipo: p.tipo, lado: p.lado, quantidade: p.quantidade, preco: Math.round(p.preco),
    ...(p.tipo !== 'ativo' ? { strike: p.strike as number, vencimento: p.vencimento as string } : {}),
    ...(p.vol !== null && p.vol > 0 && p.vol < 5 ? { vol: p.vol } : {}),
  }));
}

// ---------- Volatilidade e delta ao vivo ----------
// Com preço em tempo real da ponte MT5 (série e ativo), recalcula a volatilidade implícita
// e o delta na hora, pelo meio do livro (spread até 50%) ou pelo último negócio. Sem isso,
// fica a do fechamento da B3, e a tela diz qual é qual.
export type VolDaSerie = { vol: number | null; delta: number | null; origem: 'ao_vivo' | 'fechamento' };

export function volDaSerie(s: SerieDaCadeia, spot: CotacaoResumida, vencimento: string, hoje: string, cfg: ConfiguracaoDoCalendario | null, selicPct: number | null): VolDaSerie {
  const doFechamento: VolDaSerie = { vol: s.vol, delta: s.delta, origem: 'fechamento' };
  const c = s.cotacao;
  const s0 = spot?.provedor === 'mt5' && spot.qualidade === 'tempo_real' ? (spot.ultimo ?? (spot.bid && spot.ask ? (spot.bid + spot.ask) / 2 : null)) : null;
  if (!cfg || selicPct === null || !c || c.provedor !== 'mt5' || c.qualidade !== 'tempo_real' || !s0) return doFechamento;
  const dias = diasDePregaoEntre(hoje, vencimento, cfg);
  if (dias <= 0) return doFechamento;
  const premio = premioDoFechamento(c.bid, c.ask, c.ultimo);
  if (!premio) return doFechamento;
  const base = { tipo: s.tipo, s: s0 / 100, k: s.strike / 100, t: dias / 252, r: taxaContinua(selicPct / 100) };
  const iv = volatilidadeImplicita(premio.valor / 100, base);
  if (!iv.ok) return doFechamento;
  return { vol: iv.sigma, delta: blackScholes({ ...base, sigma: iv.sigma }).delta, origem: 'ao_vivo' };
}

// Quanto tempo esperar até a próxima consulta: pregão = 2 s; fora dele, 60 s.
export function intervaloDeAtualizacao(mercadoAberto: boolean | undefined): number {
  return mercadoAberto ? 2_000 : 60_000;
}
