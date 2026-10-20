// Posições na tela: formulário de execução (valores como a pessoa digita) → api
// (centavos), textos das pernas, conferência com a corretora e escala do gráfico de
// lucro e prejuízo no vencimento.

import { lerNumero } from './alertas.ts';
import { formatarReais } from './formatos.ts';

export type Tipo = 'call' | 'put' | 'ativo';
export type Lado = 'compra' | 'venda';

export type CotacaoDaApi = {
  codigo: string; provedor: string; ultimo: number | null; bid: number | null; ask: number | null;
  instanteDaFonte: string | null; qualidade: string;
};

export type ExecucaoDaApi = {
  id: string; codigo: string; tipo: Tipo; strike: number | null; vencimento: string | null; multiplicador: number;
  lado: Lado; quantidade: number; preco: number; custos: number; instante: string; origem: 'manual' | 'importada_mt5'; observacao: string | null;
};

export type InstrumentoDaApi = {
  codigo: string; tipo: Tipo; strike: number | null; vencimento: string | null; multiplicador: number;
  quantidade: number; precoMedio: number; realizadoBruto: number; custosPagos: number;
  cotacao: CotacaoDaApi | null; diasCorridos: number | null; diasDePregao: number | null; vencido: boolean;
};

export type Extremo = { tipo: 'limitado'; valor: number; emPreco: number } | { tipo: 'ilimitado' };
export type Payoff =
  | { motivo: 'sem_pernas_abertas' | 'vencimentos_diferentes' }
  | {
      analise: { pontosDeEquilibrio: number[]; lucroMaximo: Extremo; perdaMaxima: Extremo; fluxo: { bruto: number; custos: number; liquido: number }; ajuste: number };
      curva: { s: number; resultado: number }[] | null; referencia: number | null; vencimento: string | null;
    };

export type Resultado = {
  realizadoBruto: number; custosPagos: number; realizadoLiquido: number; naoRealizadoEstimado: number | null;
  instrumentosSemPreco: string[]; marcacoes: { codigo: string; preco: number; origem: string; estimativa: boolean }[]; usaEstimativa: boolean;
};

export type Estrategia = {
  id: string; nome: string; ativoObjeto: string; observacao: string | null; situacao: 'aberta' | 'encerrada';
  criadaEm: string; encerradaEm: string | null; execucoes: ExecucaoDaApi[]; instrumentos: InstrumentoDaApi[];
  resultado: Resultado | null; ativo: CotacaoDaApi | null; payoff: Payoff | null; erro?: string;
};

export type Exposicao = {
  ativoObjeto: string; vencimento: string | null; quantidadeLiquidaCalls: number; quantidadeLiquidaPuts: number;
  quantidadeLiquidaAcoes: number; callsVendidasDescobertas: number; nocionalStrikes: number;
};

export type RespostaDePosicoes = {
  agora: string; hoje: string; estrategias: Estrategia[]; exposicoes: Exposicao[]; liquidoPorCodigo: Record<string, number>; premissas: string[];
};

// ---------- Formulário de uma execução ----------

export type FormularioDaPerna = {
  codigo: string; tipo: Tipo; strike: string; vencimento: string; lado: Lado; quantidade: string; preco: string; custos: string; data: string; hora: string;
};

export function pernaVazia(agora: Date): FormularioDaPerna {
  const { data, hora } = dataEHoraEmBrasilia(agora);
  return { codigo: '', tipo: 'call', strike: '', vencimento: '', lado: 'venda', quantidade: '100', preco: '', custos: '', data, hora };
}

export function dataEHoraEmBrasilia(d: Date): { data: string; hora: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

export type ExecucaoParaApi = {
  codigo: string; tipo: Tipo; strike?: number; vencimento?: string; lado: Lado; quantidade: number; preco: number; custos: number; instante: string;
};

const reaisParaCentavos = (t: string): number | null => {
  const n = lerNumero(t);
  return n === null || n < 0 ? null : Math.round(n * 100);
};

export function execucaoDoFormulario(f: FormularioDaPerna, agora: Date): { ok: true; execucao: ExecucaoParaApi } | { ok: false; erro: string } {
  const codigo = f.codigo.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(codigo)) return { ok: false, erro: 'Confira o código do ativo ou da opção.' };
  const quantidade = Number(f.quantidade.replace(/\./g, ''));
  if (!Number.isInteger(quantidade) || quantidade <= 0) return { ok: false, erro: 'A quantidade precisa ser um número inteiro maior que zero.' };
  const preco = reaisParaCentavos(f.preco);
  if (preco === null) return { ok: false, erro: 'Informe o preço de cada unidade, em reais (ex.: 1,25).' };
  const custos = f.custos.trim() ? reaisParaCentavos(f.custos) : 0;
  if (custos === null) return { ok: false, erro: 'Os custos precisam ser um valor em reais (ex.: 4,90), ou fique em branco.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.data) || !/^\d{2}:\d{2}$/.test(f.hora)) return { ok: false, erro: 'Informe a data e a hora da operação.' };
  const instante = new Date(`${f.data}T${f.hora}:00-03:00`);
  if (Number.isNaN(instante.getTime())) return { ok: false, erro: 'Informe a data e a hora da operação.' };
  if (instante.getTime() > agora.getTime() + 5 * 60_000) return { ok: false, erro: 'A data da operação não pode estar no futuro.' };
  const base = { codigo, tipo: f.tipo, lado: f.lado, quantidade, preco, custos, instante: instante.toISOString() };
  if (f.tipo === 'ativo') return { ok: true, execucao: base };
  const strike = reaisParaCentavos(f.strike);
  if (strike === null || strike <= 0) return { ok: false, erro: 'Informe o strike da opção, em reais (ex.: 38,00).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vencimento)) return { ok: false, erro: 'Informe o vencimento da opção.' };
  return { ok: true, execucao: { ...base, strike, vencimento: f.vencimento } };
}

// ---------- Textos ----------

const reais2 = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const inteiro = (n: number) => n.toLocaleString('pt-BR');

export const NOME_DO_TIPO: Record<Tipo, string> = { call: 'Call', put: 'Put', ativo: 'Ação' };

export function descreverInstrumento(i: Pick<InstrumentoDaApi, 'tipo' | 'strike' | 'vencimento'>): string {
  if (i.tipo === 'ativo') return 'Ação';
  return `${NOME_DO_TIPO[i.tipo]} ${i.strike === null ? '—' : reais2(i.strike)} · vence ${i.vencimento ? diaMes(i.vencimento) : '—'}`;
}

export function descreverPosicao(quantidade: number): string {
  if (quantidade === 0) return 'Encerrada';
  return `${quantidade > 0 ? 'Comprado' : 'Vendido'} ${inteiro(Math.abs(quantidade))}`;
}

export function descreverExecucao(e: Pick<ExecucaoDaApi, 'lado' | 'quantidade' | 'codigo' | 'preco'>): string {
  return `${e.lado === 'compra' ? 'Compra' : 'Venda'} de ${inteiro(e.quantidade)} ${e.codigo} a R$ ${reais2(e.preco)}`;
}

// Os dois extremos só ficam sem limite com o ativo subindo (o preço não tem teto; o piso é zero).
export function textoDoExtremo(e: Extremo): string {
  if (e.tipo === 'ilimitado') return 'Sem limite (se o ativo subir)';
  return formatarReais(e.valor);
}

export const MOTIVO_DO_PAYOFF: Record<string, string> = {
  sem_pernas_abertas: 'Nada aberto: o resultado já está todo realizado.',
  vencimentos_diferentes: 'As pernas têm vencimentos diferentes. O gráfico no vencimento só vale para um vencimento só (a simulação de rolagem e de calendário chega na Fase 7).',
};

export const ORIGEM_DO_PRECO: Record<string, string> = {
  bid: 'melhor comprador', ask: 'melhor vendedor', ultimo: 'último negócio (estimativa)', medio: 'ponto médio (estimativa)', referencia: 'referência',
};

export const QUALIDADE: Record<string, { texto: string; classe: string }> = {
  tempo_real: { texto: 'Tempo real', classe: 'selo-vivo' },
  periodica: { texto: 'Atualização periódica', classe: 'selo-periodica' },
  atrasada: { texto: 'Atrasado', classe: 'selo-atencao' },
  desconectado: { texto: 'Ponte desconectada', classe: 'selo-atencao' },
  historico: { texto: 'Fechamento B3', classe: 'selo-historico' },
};

// ---------- Conferência com a corretora (MetaTrader 5) ----------

export type PosicaoDaCorretora = { codigo: string; lado: Lado; quantidade: number; precoMedio: number };
export type Conferencia = { codigo: string; corretora: number; registrado: number; situacao: 'confere' | 'diferente' | 'nao_registrada' | 'so_no_sistema' };

export function conferirComCorretora(corretora: readonly PosicaoDaCorretora[], liquido: Readonly<Record<string, number>>): Conferencia[] {
  const linhas = new Map<string, Conferencia>();
  for (const p of corretora) {
    const q = p.lado === 'compra' ? p.quantidade : -p.quantidade;
    const r = liquido[p.codigo] ?? 0;
    linhas.set(p.codigo, { codigo: p.codigo, corretora: q, registrado: r, situacao: r === 0 ? 'nao_registrada' : r === q ? 'confere' : 'diferente' });
  }
  for (const [codigo, r] of Object.entries(liquido)) {
    if (r !== 0 && !linhas.has(codigo)) linhas.set(codigo, { codigo, corretora: 0, registrado: r, situacao: 'so_no_sistema' });
  }
  return [...linhas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

// ---------- Gráfico ----------

export type Grafico = {
  largura: number; altura: number; caminhoLucro: string; caminhoPrejuizo: string; linha: string;
  yZero: number | null; x: (s: number) => number; y: (v: number) => number;
  min: number; max: number; de: number; ate: number;
};

// Escala a curva (preço em centavos × resultado em centavos) num retângulo. As áreas de
// lucro e de prejuízo são recortadas no zero para colorir cada lado.
export function montarGrafico(curva: readonly { s: number; resultado: number }[], largura = 640, altura = 240, margem = { e: 92, d: 12, t: 14, b: 28 }): Grafico | null {
  if (curva.length < 2) return null;
  const de = curva[0]?.s as number;
  const ate = curva[curva.length - 1]?.s as number;
  if (ate <= de) return null;
  const valores = curva.map((p) => p.resultado);
  let min = Math.min(0, ...valores);
  let max = Math.max(0, ...valores);
  if (max === min) { max += 100; min -= 100; }
  const folga = (max - min) * 0.08;
  min -= folga; max += folga;
  const x = (s: number) => margem.e + ((s - de) / (ate - de)) * (largura - margem.e - margem.d);
  const y = (v: number) => margem.t + ((max - v) / (max - min)) * (altura - margem.t - margem.b);
  const pts = curva.map((p) => `${x(p.s).toFixed(1)},${y(p.resultado).toFixed(1)}`);
  const linha = `M${pts.join(' L')}`;
  const y0 = y(0);
  const area = (sinal: 1 | -1) => {
    const ps = curva.map((p) => `${x(p.s).toFixed(1)},${y(sinal > 0 ? Math.max(0, p.resultado) : Math.min(0, p.resultado)).toFixed(1)}`);
    return `M${x(de).toFixed(1)},${y0.toFixed(1)} L${ps.join(' L')} L${x(ate).toFixed(1)},${y0.toFixed(1)} Z`;
  };
  return { largura, altura, caminhoLucro: area(1), caminhoPrejuizo: area(-1), linha, yZero: y0, x, y, min, max, de, ate };
}
