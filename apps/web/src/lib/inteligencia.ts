// Inteligência operacional na tela: preferências dos avisos, textos dos critérios,
// eventos das posições, filtros do histórico e a grade de cenários.

export type PreferenciasDeAvisos = {
  vencimento: boolean; diasAntes: number[]; risco: boolean; distanciaStrikePct: number; descoberta: boolean; sugestoes: boolean; telegram: boolean;
};

export type EventoDePosicao = {
  id: number; tipo: 'vencimento' | 'risco_strike' | 'descoberta' | 'sugestao_rolagem'; codigo: string; titulo: string; texto: string;
  lido: boolean; criadoEm: string; estrategiaId: string | null; estrategia: string | null; aviso: string | null;
};

export const NOME_DO_EVENTO: Record<EventoDePosicao['tipo'], string> = {
  vencimento: 'Vencimento', risco_strike: 'Risco', descoberta: 'Sem cobertura', sugestao_rolagem: 'Sugestão de rolagem',
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function descreverCriterios(c: Record<string, unknown>): string {
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null);
  const partes: string[] = [];
  const dmin = n('diasMin');
  const dmax = n('diasMax');
  if (dmin !== null || dmax !== null) partes.push(dmax === null ? `vence em ${dmin} dias ou mais` : `vence entre ${dmin ?? 0} e ${dmax} dias`);
  const xmin = n('deltaMin');
  const xmax = n('deltaMax');
  if (xmin !== null || xmax !== null) partes.push(`delta entre ${num(xmin ?? 0)} e ${num(xmax ?? 1)}`);
  if (n('creditoMinimo') !== null) partes.push(`crédito de pelo menos R$ ${reais(n('creditoMinimo') as number)}`);
  if (n('debitoMaximo') !== null) partes.push(`débito de no máximo R$ ${reais(n('debitoMaximo') as number)}`);
  if (n('negociosMin') !== null) partes.push(`pelo menos ${n('negociosMin')} negócio(s) no último pregão`);
  if (n('spreadMaximoPct') !== null) partes.push(`diferença compra/venda de até ${num(n('spreadMaximoPct') as number)}%`);
  if (c.strike === 'manter') partes.push('mesmo strike');
  if (c.strike === 'acima') partes.push('strike acima do atual');
  if (c.strike === 'abaixo') partes.push('strike abaixo do atual');
  if (c.perdaMaximaNaoAumenta === true) partes.push('perda máxima não aumenta');
  return partes.length ? partes.join(', ') : 'nenhum definido (todas as séries entram)';
}

// ---------- Histórico ----------

export type TipoDoHistorico = 'operacao' | 'rolagem' | 'alerta' | 'posicao';
export const TIPOS_DO_HISTORICO: { valor: TipoDoHistorico; nome: string }[] = [
  { valor: 'operacao', nome: 'Operações' }, { valor: 'rolagem', nome: 'Rolagens' }, { valor: 'alerta', nome: 'Alertas' }, { valor: 'posicao', nome: 'Avisos das posições' },
];
export type ItemDoHistorico = {
  tipo: TipoDoHistorico; instante: string; codigo: string | null; estrategia: string | null; titulo: string; detalhe: string | null; valor: number | null; custos: number | null;
};
export type FiltrosDoHistorico = { tipos: TipoDoHistorico[]; codigo: string; de: string; ate: string };

export function consultaDoHistorico(f: FiltrosDoHistorico, formato: 'json' | 'csv' = 'json'): { ok: true; consulta: string } | { ok: false; erro: string } {
  if (f.tipos.length === 0) return { ok: false, erro: 'Escolha pelo menos um tipo.' };
  const p = new URLSearchParams();
  if (f.tipos.length < TIPOS_DO_HISTORICO.length) p.set('tipos', TIPOS_DO_HISTORICO.map((t) => t.valor).filter((t) => f.tipos.includes(t)).join(','));
  const codigo = f.codigo.trim().toUpperCase();
  if (codigo) {
    if (!/^[A-Z0-9]{1,12}$/.test(codigo)) return { ok: false, erro: 'Código: só letras e números (ex.: PETR4 ou PETR).' };
    p.set('codigo', codigo);
  }
  if (f.de) p.set('de', f.de);
  if (f.ate) p.set('ate', f.ate);
  if (f.de && f.ate && f.de > f.ate) return { ok: false, erro: 'A data inicial passa da final.' };
  if (formato === 'csv') p.set('formato', 'csv');
  return { ok: true, consulta: p.toString() };
}

// ---------- Cenários ----------

export type RespostaDeCenarios = {
  ativo: { codigo: string; ultimo: number | null; qualidade: string; instanteDaFonte: string | null } | null;
  grade: { colunas: { rotulo: string; pregoes: number }[]; linhas: { preco: number; variacao: number; resultados: (number | null)[] }[]; semVol: string[] };
  vols: { codigo: string; volPct: number | null; origem: string | null }[];
  selic: { dia: string; valor: number };
  premissas: string[];
};

export function rotuloDaVariacao(v: number): string {
  if (v === 0) return 'Igual';
  const t = Math.abs(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return v > 0 ? `+${t}%` : `−${t}%`;
}

// Volatilidade digitada (ex.: "35" ou "35,5") → número; vazio = usar a implícita.
export function lerVolatilidade(t: string): { ok: true; volPct: number | null } | { ok: false; erro: string } {
  const x = t.trim().replace('%', '').replace(',', '.');
  if (!x) return { ok: true, volPct: null };
  const n = Number(x);
  if (!Number.isFinite(n) || n < 1 || n > 300) return { ok: false, erro: 'Volatilidade: um percentual ao ano entre 1 e 300 (ex.: 35).' };
  return { ok: true, volPct: n };
}
