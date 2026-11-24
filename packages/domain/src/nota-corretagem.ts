// Leitura de nota de corretagem no padrão Sinacor (BTG, XP, Genial, Clear e a maioria
// das corretoras), a partir do texto posicionado do PDF (x, y de cada trecho).
//
// Devolve os negócios (compra/venda, mercado, código, quantidade, preço, valor) e os
// custos cobrados (liquidação, registro, emolumentos, transferência, corretagem, ISS...).
// O IRRF ("dedo-duro") NÃO é custo: é antecipação de imposto, fica à parte.
// A conferência refaz o líquido da nota com os números lidos: se não bater, a nota volta
// com aviso e quem importa decide.

import type { Centavos } from './dinheiro.ts';
import { ehDiaDePregao, type ConfiguracaoDoCalendario } from './calendario.ts';

export type TrechoDaNota = { x: number; y: number; texto: string; pagina: number };

export type MercadoDaNota = 'vista' | 'fracionario' | 'opcao_compra' | 'opcao_venda' | 'exercicio_compra' | 'exercicio_venda' | 'termo' | 'outro';

export type NegocioDaNota = {
  lado: 'compra' | 'venda';
  mercado: MercadoDaNota;
  mercadoTexto: string;
  prazo: string | null; // "11/26" nas opções
  especificacao: string;
  codigo: string | null; // ticker achado na especificação (fracionário vira o código normal)
  strike: Centavos | null; // quando a especificação traz o preço de exercício (ex.: "BOVAJ149 CI 149,00")
  observacao: string; // coluna Obs. (D = day trade etc.)
  quantidade: number;
  preco: number; // centavos por unidade (pode ter fração quando a nota traz mais casas)
  valor: Centavos;
  custos: Centavos; // parte dos custos da nota, proporcional ao valor
};

export type CustosDaNota = {
  liquidacao: Centavos; registro: Centavos; termoOpcoes: Centavos; ana: Centavos; emolumentos: Centavos;
  transferencia: Centavos; corretagem: Centavos; execucao: Centavos; execucaoCasa: Centavos; iss: Centavos; outras: Centavos;
};

export type NotaLida = {
  corretora: string;
  numero: string;
  dataPregao: string; // AAAA-MM-DD
  negocios: NegocioDaNota[];
  custos: CustosDaNota;
  custoTotal: Centavos;
  irrf: Centavos;
  liquido: Centavos | null; // com sinal: + crédito, − débito
  conferida: boolean; // o líquido refeito com os números lidos bate com o da nota
  avisos: string[];
};

const MOEDA = /^-?\d{1,3}(\.\d{3})*,\d{2,8}$|^-?\d+,\d{2,8}$/;
const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function lerValorBr(t: string): number | null {
  const s = t.trim();
  if (!MOEDA.test(s)) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}
const centavos = (v: number) => Math.round(v * 100);

type Linha = { y: number; pagina: number; trechos: TrechoDaNota[] };

function linhasDaPagina(trechos: readonly TrechoDaNota[]): Linha[] {
  const linhas: Linha[] = [];
  for (const t of [...trechos].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x)) {
    const l = linhas.find((x) => x.pagina === t.pagina && Math.abs(x.y - t.y) <= 1.2);
    if (l) l.trechos.push(t); else linhas.push({ y: t.y, pagina: t.pagina, trechos: [t] });
  }
  for (const l of linhas) l.trechos.sort((a, b) => a.x - b.x);
  return linhas;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export function mercadoDe(texto: string): MercadoDaNota {
  const t = norm(texto);
  if (/^EXERC.*(COMPRA|CALL)/.test(t)) return 'exercicio_compra';
  if (/^EXERC.*(VENDA|PUT)/.test(t)) return 'exercicio_venda';
  if (/OPCAO DE COMPRA|OPC.*COMPRA/.test(t)) return 'opcao_compra';
  if (/OPCAO DE VENDA|OPC.*VENDA/.test(t)) return 'opcao_venda';
  if (/^OPC\b|^OPCAO$/.test(t)) return 'outro'; // "OPC" sem dizer qual: decide pelo código (ver opcaoPeloCodigo)
  if (/FRACION/.test(t)) return 'fracionario';
  if (/VISTA|^VIS$/.test(t)) return 'vista';
  if (/TERMO/.test(t)) return 'termo';
  return 'outro';
}

// Letra do mês no código da opção: A–L = call (compra), M–X = put (venda).
export function opcaoPeloCodigo(codigo: string): 'opcao_compra' | 'opcao_venda' | null {
  const m = /^[A-Z]{4}([A-X])\d/.exec(codigo);
  if (!m) return null;
  return (m[1] as string) <= 'L' ? 'opcao_compra' : 'opcao_venda';
}

// Ticker dentro da especificação ("BBASK196 ON", "BBAS3 ON", "BBAS3F ON NM").
export function codigoDaEspecificacao(esp: string, mercado: MercadoDaNota): string | null {
  for (const tok of esp.toUpperCase().split(/\s+/)) {
    if ((mercado === 'opcao_compra' || mercado === 'opcao_venda') && /^[A-Z]{4}[A-X]\d{1,4}[A-Z0-9]{0,3}$/.test(tok)) return tok;
    const acao = /^([A-Z]{4}\d{1,2})F?$/.exec(tok);
    if (acao && mercado !== 'opcao_compra' && mercado !== 'opcao_venda') return acao[1] as string;
  }
  return null;
}

// Valor numérico à direita de um rótulo, na mesma linha (ou na de baixo, até 3 pontos).
function valorDoRotulo(linhas: readonly Linha[], rotulo: RegExp): { valor: Centavos; dc: 'D' | 'C' | null } | null {
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    const l = linhas[i] as Linha;
    const r = l.trechos.find((t) => rotulo.test(norm(t.texto)));
    if (!r) continue;
    const candidatas = linhas.filter((o) => o.pagina === l.pagina && Math.abs(o.y - l.y) <= 3);
    const numeros = candidatas.flatMap((o) => o.trechos).filter((t) => t.x > r.x + 20 && lerValorBr(t.texto) !== null).sort((a, b) => b.x - a.x);
    const n = numeros[0];
    if (!n) return null;
    const dcT = candidatas.flatMap((o) => o.trechos).find((t) => t.x > n.x && /^[DC]$/.test(t.texto.trim()));
    // Valor sem sinal; o lado (débito/crédito) vem da coluna D/C ou do sinal de menos.
    const bruto = lerValorBr(n.texto) as number;
    return { valor: Math.abs(centavos(bruto)), dc: (dcT?.texto.trim() as 'D' | 'C' | undefined) ?? (bruto < 0 ? 'D' : null) };
  }
  return null;
}

// Valor logo abaixo de um título de cabeçalho (Nr. nota, Data pregão).
function abaixoDe(linhas: readonly Linha[], titulo: RegExp, filtro: (s: string) => boolean): string | null {
  for (const l of linhas) {
    const t = l.trechos.find((x) => titulo.test(norm(x.texto)));
    if (!t) continue;
    const abaixo = linhas.filter((o) => o.pagina === l.pagina && o.y < l.y && l.y - o.y <= 20).sort((a, b) => b.y - a.y);
    for (const o of abaixo) {
      const v = o.trechos.filter((x) => Math.abs(x.x - t.x) <= 30 && filtro(x.texto.trim())).sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
      if (v) return v.texto.trim();
    }
  }
  return null;
}

const COLUNAS: [keyof Colunas, RegExp][] = [
  ['cv', /^C\/V$/], ['mercado', /^TIPO MERCADO$/], ['prazo', /^PRAZO$/], ['esp', /^ESPECIFICACAO DO TITULO$/], ['obs', /^OBS/],
  ['qtd', /^QUANTIDADE$/], ['preco', /^PRECO/], ['valor', /^VALOR OPERACAO|^COMPRA\/VENDA/], ['dc', /^D\/C$/],
];
type Colunas = { cv: number; mercado: number; prazo: number; esp: number; obs: number; qtd: number; preco: number; valor: number; dc: number };

function negociosDaPagina(linhas: readonly Linha[], avisos: string[]): Omit<NegocioDaNota, 'custos'>[] {
  const r: Omit<NegocioDaNota, 'custos'>[] = [];
  for (const cab of linhas.filter((l) => l.trechos.some((t) => norm(t.texto) === 'C/V') && l.trechos.some((t) => /^QUANTIDADE$/.test(norm(t.texto))))) {
    const col: Partial<Colunas> = {};
    for (const t of cab.trechos) for (const [k, re] of COLUNAS) if (re.test(norm(t.texto)) && col[k] === undefined) col[k] = t.x;
    if (COLUNAS.some(([k]) => col[k] === undefined && k !== 'prazo' && k !== 'obs' && k !== 'dc')) continue;
    const c = col as Colunas;
    const ordem = (Object.entries(c) as [keyof Colunas, number][]).filter(([, x]) => x !== undefined).sort((a, b) => a[1] - b[1]);
    const colunaDe = (x: number): keyof Colunas | null => {
      let melhor: keyof Colunas | null = null;
      for (const [k, cx] of ordem) if (x >= cx - 10) melhor = k; // o dado pode começar um pouco antes do título
      return melhor;
    };
    // Linhas do quadro: abaixo do cabeçalho, até o "Resumo dos Negócios" (ou fim da página).
    const fim = linhas.find((l) => l.pagina === cab.pagina && l.y < cab.y && l.trechos.some((t) => /^RESUMO DOS NEGOCIOS/.test(norm(t.texto))));
    for (const l of linhas.filter((o) => o.pagina === cab.pagina && o.y < cab.y - 2 && (!fim || o.y > fim.y + 2))) {
      const campos: Record<string, string[]> = {};
      for (const t of l.trechos) { const k = colunaDe(t.x); if (k) (campos[k] ??= []).push(t.texto.trim()); }
      const cv = (campos.cv ?? []).join(' ').trim().toUpperCase();
      const qtdT = (campos.qtd ?? [])[0];
      const precoT = (campos.preco ?? [])[0];
      const valorT = (campos.valor ?? [])[0];
      if (!/^[CV]$/.test(cv) || !qtdT || !precoT || !valorT) continue;
      const quantidade = Number(qtdT.replace(/\./g, ''));
      const preco = lerValorBr(precoT);
      const valor = lerValorBr(valorT);
      if (!Number.isInteger(quantidade) || quantidade <= 0 || preco === null || valor === null) { avisos.push(`linha_ilegivel:${l.trechos.map((t) => t.texto).join(' ')}`); continue; }
      const mercadoTexto = (campos.mercado ?? []).join(' ');
      let mercado = mercadoDe(mercadoTexto);
      const especificacao = (campos.esp ?? []).join(' ');
      if (mercado === 'outro' && /^OPC/.test(norm(mercadoTexto))) {
        const tok = especificacao.toUpperCase().split(/\s+/).find((x) => /^[A-Z]{4}[A-X]\d{1,4}[A-Z0-9]{0,3}$/.test(x));
        mercado = (tok && opcaoPeloCodigo(tok)) || 'outro';
      }
      const codigo = codigoDaEspecificacao(especificacao, mercado);
      const strikeT = mercado.startsWith('opcao') ? especificacao.split(/\s+/).reverse().find((x) => lerValorBr(x) !== null) : undefined;
      if (!codigo) avisos.push(`sem_codigo:${especificacao}`);
      if (mercado === 'termo' || mercado === 'outro') avisos.push(`mercado_nao_tratado:${mercadoTexto}`);
      r.push({
        lado: cv === 'C' ? 'compra' : 'venda', mercado, mercadoTexto, prazo: (campos.prazo ?? [])[0] ?? null, especificacao, codigo,
        strike: strikeT ? centavos(lerValorBr(strikeT) as number) : null,
        observacao: (campos.obs ?? []).join(' '), quantidade, preco: Math.round(preco * 100 * 1e6) / 1e6, valor: centavos(valor),
      });
    }
  }
  return r;
}

// Divide o custo total entre os negócios, na proporção do valor (sobra dos centavos vai
// para o maior negócio). Soma exata = custo total.
export function ratearCustos(valores: readonly Centavos[], total: Centavos): Centavos[] {
  const soma = valores.reduce((s, v) => s + v, 0);
  if (!valores.length) return [];
  if (soma <= 0) return valores.map((_, i) => (i === 0 ? total : 0));
  const partes = valores.map((v) => Math.floor((total * v) / soma));
  let sobra = total - partes.reduce((s, v) => s + v, 0);
  const ordem = valores.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; sobra > 0; k = (k + 1) % ordem.length, sobra -= 1) partes[(ordem[k] as readonly [number, number])[1]] += 1;
  return partes;
}

export function lerNotaDeCorretagem(trechos: readonly TrechoDaNota[]): NotaLida | { erro: string } {
  const linhas = linhasDaPagina(trechos);
  const tudo = norm(trechos.map((t) => t.texto).join(' '));
  if (!/NOTA DE CORRETAGEM|NOTA DE NEGOCIACAO/.test(tudo) && !(/C\/V/.test(tudo) && /RESUMO (DOS NEGOCIOS|FINANCEIRO)/.test(tudo) && /LIQUIDO PARA/.test(tudo))) return { erro: 'nao_e_nota_de_corretagem' };
  if (/NOTA DE NEGOCIACAO/.test(tudo) && /BM&F|MERCADORIA|AJUSTE DE POSICAO/.test(tudo) && !/C\/V/.test(tudo)) return { erro: 'nota_de_futuros_nao_tratada' };
  const avisos: string[] = [];
  // Cabeçalho: valor embaixo do título (Sinacor clássico) ou na mesma caixa ("Data pregão: 13/10/2026").
  const textos = linhas.flatMap((l) => l.trechos).map((t) => norm(t.texto));
  const numero = abaixoDe(linhas, /^NR\.? NOTA$/, (s) => /^\d{1,12}$/.test(s))
    ?? textos.map((t) => /N\S{0,2}\.?\s*NOTA:?\s*(\d{1,12})\b/.exec(t)?.[1]).find(Boolean) ?? null;
  const dataT = abaixoDe(linhas, /^DATA PREGAO$/, (s) => DATA.test(s))
    ?? textos.map((t) => /DATA PREGAO:?\s*(\d{2}\/\d{2}\/\d{4})/.exec(t)?.[1]).find(Boolean) ?? null;
  if (!numero || !dataT) return { erro: 'cabecalho_ilegivel' };
  const [, dd, mm, aaaa] = DATA.exec(dataT) as RegExpExecArray;
  const corretora = (linhas.flatMap((l) => l.trechos).find((t) => /(CTVM|DTVM|CORRETORA|S\.A\.|LTDA)/i.test(t.texto) && !/CNPJ|C\.N\.P\.J/i.test(t.texto))?.texto ?? 'Corretora').trim();

  const brutos = negociosDaPagina(linhas, avisos);
  if (!brutos.length) return { erro: 'sem_negocios' };

  const v = (re: RegExp) => valorDoRotulo(linhas, re)?.valor ?? 0;
  const custos: CustosDaNota = {
    liquidacao: v(/^TAXA DE LIQUIDACAO/), registro: v(/^TAXA DE REGISTRO/), termoOpcoes: v(/^TAXA DE TERMO\/OPCOES|^TAXA DE OPCOES/),
    ana: v(/^TAXA A\.N\.A/), emolumentos: v(/^EMOLUMENTOS/), transferencia: v(/^TAXA DE TRANSFERENCIA/),
    corretagem: v(/^CLEARING$|^CORRETAGEM$|^TAXA OPERACIONAL/), execucao: v(/^EXECUCAO$/), execucaoCasa: v(/^EXECUCAO CASA/),
    iss: v(/^ISS/), outras: v(/^OUTRAS( BOVESPA)?$/),
  };
  const custoTotal = Object.values(custos).reduce((s, x) => s + x, 0);
  const irrfL = linhas.flatMap((l) => l.trechos).find((t) => /^I\.?R\.?R\.?F/.test(norm(t.texto)));
  let irrf = 0;
  if (irrfL) {
    const mesma = linhas.find((l) => l.trechos.includes(irrfL)) as Linha;
    const nums = mesma.trechos.filter((t) => t.x > irrfL.x && lerValorBr(t.texto) !== null).sort((a, b) => b.x - a.x);
    irrf = nums[0] ? centavos(lerValorBr(nums[0].texto) as number) : 0;
  }
  const liq = valorDoRotulo(linhas, /^LIQUIDO PARA/);
  const liquido = liq ? (liq.dc === 'D' ? -liq.valor : liq.valor) : null;
  const vendas = brutos.filter((n) => n.lado === 'venda').reduce((s, n) => s + n.valor, 0);
  const compras = brutos.filter((n) => n.lado === 'compra').reduce((s, n) => s + n.valor, 0);
  const refeito = vendas - compras - custoTotal;
  const conferida = liquido !== null && (Math.abs(refeito - liquido) <= 1 || Math.abs(refeito - irrf - liquido) <= 1);
  if (!conferida) avisos.push('liquido_nao_confere');

  const partes = ratearCustos(brutos.map((n) => n.valor), custoTotal);
  return {
    corretora, numero, dataPregao: `${aaaa}-${mm}-${dd}`,
    negocios: brutos.map((n, i) => ({ ...n, custos: partes[i] as number })),
    custos, custoTotal, irrf, liquido, conferida, avisos,
  };
}

// ---------- Vencimento estimado pelo código ----------
// Para opções que não estão no cadastro da B3 do sistema (ex.: séries antigas, já
// vencidas): mês pela letra do código (A–L calls, M–X puts), ano pelo "Prazo" da nota
// (MM/AA) ou o primeiro mês com esse número a partir da data do pregão, e dia pela regra
// da B3 (mensal: 3ª sexta-feira; semanal Wn: n-ésima sexta), antecipado para o pregão
// anterior quando a data não tem pregão. É estimativa: a tela pede para conferir.

function sextaDoMes(ano: number, mes: number, n: number): string | null {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const dia = 1 + ((5 - primeiro + 7) % 7) + 7 * (n - 1);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return d.toISOString().slice(0, 10);
}

export function vencimentoEstimado(codigo: string, dataPregao: string, prazo: string | null, cfg: ConfiguracaoDoCalendario): string | null {
  const m = /^[A-Z]{4}([A-X])\d{1,4}[A-Z]?(W([1-5]))?$/.exec(codigo);
  if (!m) return null;
  const letra = (m[1] as string).charCodeAt(0) - 65;
  const mes = (letra % 12) + 1;
  const semana = m[3] ? Number(m[3]) : 3;
  const [anoP, mesP] = dataPregao.split('-').map(Number) as [number, number];
  let ano = anoP;
  const pz = prazo ? /^(\d{2})\/(\d{2})$/.exec(prazo) : null;
  if (pz && Number(pz[1]) === mes) ano = 2000 + Number(pz[2]);
  else if (mes < mesP) ano += 1;
  let dia = sextaDoMes(ano, mes, semana);
  if (!dia) return null;
  for (let k = 0; k < 7 && !ehDiaDePregao(dia, cfg); k += 1) {
    dia = new Date(Date.parse(`${dia}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }
  return dia;
}
