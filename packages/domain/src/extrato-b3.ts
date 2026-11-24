// Extrato de negociação da B3 (Área do Investidor → Extratos → Negociação → Excel): todos
// os negócios de todas as corretoras, com data, compra/venda, mercado, vencimento das
// opções, código, quantidade e preço. Não traz custos nem strike (o strike vem do cadastro
// de séries da B3). Aqui só se lê a planilha: cada linha vira um negócio ou um "ignorado"
// com o motivo (futuros, renda fixa que não é ETF negociado em bolsa etc.).

export type CelulaDoExtrato = { linha: number; coluna: number; texto: string };

export type MercadoDoExtrato = 'vista' | 'fracionario' | 'opcao_compra' | 'opcao_venda' | 'exercicio_compra' | 'exercicio_venda';

export type NegocioDoExtrato = {
  linha: number; // linha da planilha (1 = cabeçalho)
  data: string; // AAAA-MM-DD
  lado: 'compra' | 'venda';
  mercado: MercadoDoExtrato;
  // Ação/ETF (fracionário sem o F) ou opção. No exercício: o código da opção (sem o E);
  // o negócio em si é a ação ao preço de exercício, e a opção é encerrada.
  codigo: string;
  vencimento: string | null;
  quantidade: number;
  preco: number; // centavos
  valor: number; // centavos
  instituicao: string;
};
export type IgnoradoDoExtrato = { linha: number; data: string | null; codigo: string; mercado: string; motivo: 'futuro' | 'renda_fixa' | 'mercado_desconhecido' | 'linha_ilegivel' };
export type ExtratoLido = { negocios: NegocioDoExtrato[]; ignorados: IgnoradoDoExtrato[]; de: string | null; ate: string | null };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function dataIso(t: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t.trim()) ? t.trim().slice(0, 10) : null;
}

// Número da planilha: "14.12" (célula numérica), "1.412,00" ou "R$ 1.412,00" (texto).
export function numeroDoExtrato(t: string): number | null {
  const s = t.replace(/R\$\s*/i, '').trim();
  if (!s) return null;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, '')) : Number(s);
  return Number.isFinite(n) ? n : null;
}

export function mercadoDoExtrato(t: string): MercadoDoExtrato | 'futuro' | 'renda_fixa' | null {
  const m = norm(t);
  if (/^EXERCICIO DE OPCAO DE COMPRA/.test(m)) return 'exercicio_compra';
  if (/^EXERCICIO DE OPCAO DE VENDA/.test(m)) return 'exercicio_venda';
  if (/^OPCAO DE COMPRA/.test(m)) return 'opcao_compra';
  if (/^OPCAO DE VENDA/.test(m)) return 'opcao_venda';
  if (/FRACIONARIO/.test(m)) return 'fracionario';
  if (/A VISTA|^VISTA/.test(m)) return 'vista';
  if (/FUTURO/.test(m)) return 'futuro';
  if (/RENDA FIXA/.test(m)) return 'renda_fixa';
  return null;
}

const COLUNAS: [string, RegExp][] = [
  ['data', /^DATA DO NEGOCIO$/], ['lado', /^TIPO DE MOVIMENTACAO$|^COMPRA\/VENDA$/], ['mercado', /^MERCADO$/], ['vencimento', /^PRAZO\/VENCIMENTO$|^VENCIMENTO$/],
  ['instituicao', /^INSTITUICAO$/], ['codigo', /^CODIGO DE NEGOCIACAO$/], ['quantidade', /^QUANTIDADE$/], ['preco', /^PRECO$/], ['valor', /^VALOR$/],
];

export function lerExtratoDaB3(celulas: readonly CelulaDoExtrato[]): ExtratoLido | { erro: string } {
  const linhas = new Map<number, Map<number, string>>();
  for (const c of celulas) {
    if (!linhas.has(c.linha)) linhas.set(c.linha, new Map());
    (linhas.get(c.linha) as Map<number, string>).set(c.coluna, c.texto.trim());
  }
  const ordenadas = [...linhas.entries()].sort((a, b) => a[0] - b[0]);
  const cab = ordenadas.find(([, l]) => [...l.values()].some((t) => /^DATA DO NEGOCIO$/.test(norm(t))) && [...l.values()].some((t) => /^CODIGO DE NEGOCIACAO$/.test(norm(t))));
  if (!cab) return { erro: 'nao_e_extrato_da_b3' };
  const col: Record<string, number> = {};
  for (const [c, t] of cab[1]) for (const [k, re] of COLUNAS) if (re.test(norm(t)) && col[k] === undefined) col[k] = c;
  if (['data', 'lado', 'mercado', 'codigo', 'quantidade', 'preco'].some((k) => col[k] === undefined)) return { erro: 'nao_e_extrato_da_b3' };

  const negocios: NegocioDoExtrato[] = [];
  const ignorados: IgnoradoDoExtrato[] = [];
  for (const [n, l] of ordenadas) {
    if (n <= cab[0]) continue;
    const v = (k: string) => (col[k] === undefined ? '' : l.get(col[k] as number) ?? '');
    const codigoT = v('codigo').toUpperCase().replace(/\s+/g, '');
    if (!codigoT && !v('data')) continue;
    const data = dataIso(v('data'));
    const mercadoT = v('mercado');
    const mercado = mercadoDoExtrato(mercadoT);
    const ladoT = norm(v('lado'));
    const quantidade = numeroDoExtrato(v('quantidade'));
    const preco = numeroDoExtrato(v('preco'));
    const valor = numeroDoExtrato(v('valor'));
    const linha = n + 1;
    if (mercado === 'futuro' || mercado === null) { ignorados.push({ linha, data, codigo: codigoT, mercado: mercadoT, motivo: mercado === 'futuro' ? 'futuro' : 'mercado_desconhecido' }); continue; }
    // "Renda Fixa" na B3 inclui ETFs de títulos públicos negociados em bolsa (ex.: LFTS11).
    if (mercado === 'renda_fixa' && !/^[A-Z]{4}11$/.test(codigoT)) { ignorados.push({ linha, data, codigo: codigoT, mercado: mercadoT, motivo: 'renda_fixa' }); continue; }
    if (!data || !/^(COMPRA|VENDA|C|V)$/.test(ladoT) || quantidade === null || !Number.isInteger(quantidade) || quantidade <= 0 || preco === null || preco < 0) {
      ignorados.push({ linha, data, codigo: codigoT, mercado: mercadoT, motivo: 'linha_ilegivel' });
      continue;
    }
    let codigo = codigoT;
    let m: MercadoDoExtrato = mercado === 'renda_fixa' ? 'vista' : mercado;
    if (m === 'fracionario') codigo = codigo.replace(/^([A-Z]{4}\d{1,2})F$/, '$1');
    if (m === 'exercicio_compra' || m === 'exercicio_venda') codigo = codigo.replace(/E$/, '');
    if (!/^[A-Z0-9]{4,12}$/.test(codigo)) { ignorados.push({ linha, data, codigo: codigoT, mercado: mercadoT, motivo: 'linha_ilegivel' }); continue; }
    const venc = dataIso(v('vencimento'));
    negocios.push({
      linha, data, lado: ladoT.startsWith('C') ? 'compra' : 'venda', mercado: m, codigo,
      vencimento: m === 'vista' || m === 'fracionario' ? null : venc,
      quantidade, preco: Math.round(preco * 100), valor: valor === null ? Math.round(preco * 100 * quantidade) : Math.round(valor * 100),
      instituicao: v('instituicao'),
    });
  }
  const datas = negocios.map((x) => x.data).sort();
  return { negocios, ignorados, de: datas[0] ?? null, ate: datas[datas.length - 1] ?? null };
}
