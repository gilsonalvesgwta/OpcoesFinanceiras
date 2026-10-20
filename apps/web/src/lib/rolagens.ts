// Rolagens na tela: critérios do formulário → consulta da api, textos do fluxo de caixa,
// nomes das alternativas e o formulário de confirmação (preços em reais → centavos).

import { lerNumero } from './alertas.ts';
import { formatarReais } from './formatos.ts';
import type { Extremo } from './posicoes.ts';

export type PernaAEncerrar = { codigo: string; quantidade: number; preco?: number; custos?: number };
export type PernaAAbrir = { codigo: string; lado: 'compra' | 'venda'; quantidade: number; tipo?: 'call' | 'put' | 'ativo'; strike?: number; vencimento?: string; preco?: number; custos?: number };
export type Alternativa = { nome: string; encerrar: PernaAEncerrar[]; abrir: PernaAAbrir[] };

export type ResumoDoPayoff = { pontosDeEquilibrio: number[]; lucroMaximo: Extremo; perdaMaxima: Extremo } | null;
export type Fluxo = { encerramento: number; abertura: number; custos: number; liquido: number; natureza: 'credito' | 'debito' | 'zero' };
export type PrecoUsado = { codigo: string; acao: 'encerrar' | 'abrir'; lado: 'compra' | 'venda'; quantidade: number; preco: number; origem: string; estimativa: boolean; qualidade: string | null };
export type Simulada =
  | {
      nome: string; ok: true; precos: PrecoUsado[]; fluxo: Fluxo; realizadoNoEncerramento: number; realizadoAcumulado: { antes: number; depois: number };
      payoff: { antes: ResumoDoPayoff; depois: ResumoDoPayoff }; ultimoVencimento: { antes: string | null; depois: string | null };
      avisos: { codigo: string; texto: string }[];
      curvas: { referencia: number; antes: { s: number; resultado: number }[] | null; depois: { s: number; resultado: number }[] | null } | null;
      execucoes: { codigo: string; tipo: 'call' | 'put' | 'ativo'; strike: number | null; vencimento: string | null; lado: 'compra' | 'venda'; quantidade: number; preco: number; custos: number }[];
    }
  | { nome: string; ok: false; erro: string; codigo?: string };

export type Criterio = { criterio: string; texto: string; situacao: 'atendido' | 'nao_atendido' | 'sem_dado' };
export type Candidato = {
  codigo: string; strike: number; vencimento: string; dias: number; delta: number | null; negocios: number; bid: number | null; ask: number | null; qualidade: string | null;
  precoDeEntrada: { valor: number; origem: string; estimativa: boolean } | null; liquido: number | null; payoffDepois: ResumoDoPayoff; avisos: string[];
  criterios: Criterio[]; resumo: { atendidos: number; naoAtendidos: number; semDado: number; todos: boolean };
};

// ---------- Critérios ----------

export type FormularioDeCriterios = {
  diasMin: string; diasMax: string; deltaMin: string; deltaMax: string; creditoMinimo: string; debitoMaximo: string;
  negociosMin: string; spreadMaximoPct: string; strike: 'qualquer' | 'manter' | 'acima' | 'abaixo'; perdaMaximaNaoAumenta: boolean; mesmoVencimento: boolean;
};

export const CRITERIOS_PADRAO: FormularioDeCriterios = {
  diasMin: '20', diasMax: '70', deltaMin: '', deltaMax: '', creditoMinimo: '', debitoMaximo: '', negociosMin: '1', spreadMaximoPct: '',
  strike: 'qualquer', perdaMaximaNaoAumenta: false, mesmoVencimento: false,
};

// Monta a consulta das sugestões. Campo vazio = critério desligado. Delta em 0,30 ou 30 (%).
export function consultaDasSugestoes(estrategiaId: string, codigo: string, f: FormularioDeCriterios): { ok: true; consulta: string } | { ok: false; erro: string } {
  const p = new URLSearchParams({ estrategiaId, codigo });
  const inteiro = (t: string, nome: string, campo: string): string | null => {
    if (!t.trim()) return null;
    const n = lerNumero(t);
    if (n === null || !Number.isInteger(n) || n < 0) throw new Error(`${nome}: use um número inteiro.`);
    p.set(campo, String(n));
    return null;
  };
  try {
    inteiro(f.diasMin, 'Dias mínimos', 'diasMin');
    inteiro(f.diasMax, 'Dias máximos', 'diasMax');
    inteiro(f.negociosMin, 'Negócios mínimos', 'negociosMin');
    for (const [t, campo, nome] of [[f.deltaMin, 'deltaMin', 'Delta mínimo'], [f.deltaMax, 'deltaMax', 'Delta máximo']] as const) {
      if (!t.trim()) continue;
      let n = lerNumero(t);
      if (n !== null && n > 1 && n <= 100) n /= 100;
      if (n === null || n < 0 || n > 1) throw new Error(`${nome}: use um valor entre 0 e 1 (ex.: 0,30).`);
      p.set(campo, String(n));
    }
    for (const [t, campo, nome] of [[f.creditoMinimo, 'creditoMinimo', 'Crédito mínimo'], [f.debitoMaximo, 'debitoMaximo', 'Débito máximo']] as const) {
      if (!t.trim()) continue;
      const n = lerNumero(t);
      if (n === null || n < 0) throw new Error(`${nome}: use um valor em reais (ex.: 50,00).`);
      p.set(campo, String(Math.round(n * 100)));
    }
    if (f.spreadMaximoPct.trim()) {
      const n = lerNumero(f.spreadMaximoPct);
      if (n === null || n < 0) throw new Error('Diferença máxima entre compra e venda: use um percentual (ex.: 20).');
      p.set('spreadMaximoPct', String(n));
    }
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
  if (p.has('diasMin') && p.has('diasMax') && Number(p.get('diasMin')) > Number(p.get('diasMax'))) return { ok: false, erro: 'Os dias mínimos passam dos máximos.' };
  if (f.strike !== 'qualquer') p.set('strike', f.strike);
  if (f.perdaMaximaNaoAumenta) p.set('perdaMaximaNaoAumenta', 'true');
  if (f.mesmoVencimento) p.set('mesmoVencimento', 'true');
  return { ok: true, consulta: p.toString() };
}

// ---------- Textos ----------

export function textoDoFluxo(f: Pick<Fluxo, 'liquido'>): string {
  if (f.liquido > 0) return `Crédito de ${formatarReais(f.liquido)}`;
  if (f.liquido < 0) return `Débito de ${formatarReais(-f.liquido)}`;
  return 'Sem crédito nem débito';
}

export function textoDoLiquido(liquido: number | null): string {
  if (liquido === null) return 'Sem preço';
  return textoDoFluxo({ liquido });
}

export const ERROS_DA_ALTERNATIVA: Record<string, string> = {
  nada_aberto: 'não há posição aberta neste código',
  quantidade_a_encerrar_invalida: 'a quantidade para sair passa do que está aberto',
  sem_preco: 'sem preço para este código (nem oferta nem negócio)',
  serie_desconhecida: 'série não encontrada no cadastro da B3',
  rolagem_vazia: 'nada para encerrar nem abrir',
  vencimentos_diferentes: 'pernas com vencimentos diferentes',
  multiplicador_diferente_do_registrado: 'multiplicador diferente do registrado',
};

export function textoDoErroDaAlternativa(a: { erro: string; codigo?: string }): string {
  const t = ERROS_DA_ALTERNATIVA[a.erro] ?? 'não foi possível simular';
  return a.codigo ? `${a.codigo}: ${t}` : t[0]?.toUpperCase() + t.slice(1);
}

const mesCurto = (d: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)).replace('.', '');
const reais2 = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function nomeDaAlternativa(c: { codigo: string; strike: number; vencimento: string }): string {
  return `${c.codigo} (${reais2(c.strike)}, ${mesCurto(c.vencimento)})`;
}

export function alternativaDoCandidato(perna: { codigo: string; quantidade: number }, c: { codigo: string; strike: number; vencimento: string }): Alternativa {
  const q = Math.abs(perna.quantidade);
  return {
    nome: nomeDaAlternativa(c),
    encerrar: [{ codigo: perna.codigo, quantidade: q }],
    abrir: [{ codigo: c.codigo, lado: perna.quantidade > 0 ? 'compra' : 'venda', quantidade: q }],
  };
}

// ---------- Confirmação ----------

export type LinhaDaConfirmacao = { acao: 'encerrar' | 'abrir'; codigo: string; lado: 'compra' | 'venda'; quantidade: string; preco: string; custos: string;
  tipo: 'call' | 'put' | 'ativo'; strike: number | null; vencimento: string | null };

export function linhasDaConfirmacao(s: Extract<Simulada, { ok: true }>): LinhaDaConfirmacao[] {
  return s.execucoes.map((e, i) => ({
    acao: s.precos[i]?.acao ?? 'abrir', codigo: e.codigo, lado: e.lado, quantidade: String(e.quantidade), preco: reais2(e.preco), custos: '',
    tipo: e.tipo, strike: e.strike, vencimento: e.vencimento,
  }));
}

export function corpoDaConfirmacao(estrategiaId: string, linhas: readonly LinhaDaConfirmacao[], data: string, hora: string, observacao: string, agora: Date):
  { ok: true; corpo: { estrategiaId: string; instante: string; observacao?: string; encerrar: PernaAEncerrar[]; abrir: PernaAAbrir[] } } | { ok: false; erro: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return { ok: false, erro: 'Informe a data e a hora em que a rolagem foi feita.' };
  const instante = new Date(`${data}T${hora}:00-03:00`);
  if (Number.isNaN(instante.getTime())) return { ok: false, erro: 'Informe a data e a hora em que a rolagem foi feita.' };
  if (instante.getTime() > agora.getTime() + 5 * 60_000) return { ok: false, erro: 'A data da rolagem não pode estar no futuro.' };
  const encerrar: PernaAEncerrar[] = [];
  const abrir: PernaAAbrir[] = [];
  for (const l of linhas) {
    const quantidade = Number(l.quantidade.replace(/\./g, ''));
    if (!Number.isInteger(quantidade) || quantidade <= 0) return { ok: false, erro: `${l.codigo}: a quantidade precisa ser um inteiro maior que zero.` };
    const p = lerNumero(l.preco);
    if (p === null || p < 0) return { ok: false, erro: `${l.codigo}: informe o preço feito na corretora, em reais.` };
    const c = l.custos.trim() ? lerNumero(l.custos) : 0;
    if (c === null || c < 0) return { ok: false, erro: `${l.codigo}: custos em reais (ex.: 4,90), ou em branco.` };
    const preco = Math.round(p * 100);
    const custos = Math.round(c * 100);
    if (l.acao === 'encerrar') encerrar.push({ codigo: l.codigo, quantidade, preco, custos });
    else abrir.push({
      codigo: l.codigo, lado: l.lado, quantidade, preco, custos, tipo: l.tipo,
      ...(l.strike !== null ? { strike: l.strike } : {}), ...(l.vencimento !== null ? { vencimento: l.vencimento } : {}),
    });
  }
  const obs = observacao.trim();
  return { ok: true, corpo: { estrategiaId, instante: instante.toISOString(), ...(obs ? { observacao: obs } : {}), encerrar, abrir } };
}

// ---------- Gráfico comparado (antes e cada alternativa, mesma escala) ----------

export type Curva = readonly { s: number; resultado: number }[];

export function graficoComparado(curvas: readonly (Curva | null)[], largura = 640, altura = 260, margem = { e: 92, d: 12, t: 14, b: 28 }) {
  const validas = curvas.filter((c): c is Curva => !!c && c.length >= 2);
  if (validas.length === 0) return null;
  const de = Math.min(...validas.map((c) => c[0]?.s as number));
  const ate = Math.max(...validas.map((c) => c[c.length - 1]?.s as number));
  if (ate <= de) return null;
  const valores = validas.flatMap((c) => c.map((p) => p.resultado));
  let min = Math.min(0, ...valores);
  let max = Math.max(0, ...valores);
  if (max === min) { max += 100; min -= 100; }
  const folga = (max - min) * 0.08;
  min -= folga; max += folga;
  const x = (s: number) => margem.e + ((s - de) / (ate - de)) * (largura - margem.e - margem.d);
  const y = (v: number) => margem.t + ((max - v) / (max - min)) * (altura - margem.t - margem.b);
  const caminho = (c: Curva | null) => (c && c.length >= 2 ? `M${c.map((p) => `${x(p.s).toFixed(1)},${y(p.resultado).toFixed(1)}`).join(' L')}` : null);
  return { largura, altura, de, ate, min, max, x, y, caminhos: curvas.map(caminho) };
}
