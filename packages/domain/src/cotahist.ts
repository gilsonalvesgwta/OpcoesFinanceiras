// Leitura do arquivo oficial e gratuito de cotações da B3 (COTAHIST).
// Layout: "SeriesHistoricas_Layout.pdf" da B3. Registros de 245 posições;
// tipo 00 = cabeçalho, 01 = cotação, 99 = rodapé. Preços com duas casas
// decimais implícitas, ou seja, o número lido JÁ está em centavos.
//
// O que o arquivo traz para opções (TPMERC 070 call, 080 put): abertura, máxima,
// mínima, médio, último, melhor oferta de compra e de venda NO FECHAMENTO,
// negócios, quantidade, volume, strike (PREEXE) e vencimento (DATVEN).
// O que NÃO traz: estilo de exercício, contratos em aberto, gregas e
// volatilidade implícita. Esses ficam null ou são calculados pelo sistema,
// identificados como cálculo.

import type { Cotacao } from './cotacoes.ts';

export type RegistroCotahist = {
  data: string; // AAAA-MM-DD do pregão
  codbdi: string;
  codigo: string;
  tipoMercado: number; // 10 à vista, 70 call, 80 put...
  nome: string;
  especificacao: string; // ON, PN, UNT, CI... (classe do ativo; nas opções, a classe do ativo-objeto)
  abertura: number | null; // centavos
  maxima: number | null;
  minima: number | null;
  media: number | null;
  ultimo: number | null;
  melhorCompra: number | null; // null = sem oferta (zero no arquivo)
  melhorVenda: number | null;
  negocios: number;
  quantidade: number;
  volumeFinanceiro: number; // centavos
  strike: number | null; // centavos; só opções
  vencimento: string | null; // AAAA-MM-DD; só opções e termo
  fatorDeCotacao: number;
  isin: string;
};

export const MERCADO = Object.freeze({ VISTA: 10, CALL: 70, PUT: 80, EXERCICIO_CALL: 12, EXERCICIO_PUT: 13 });

const campo = (linha: string, de: number, ate: number) => linha.slice(de - 1, ate);
const texto = (linha: string, de: number, ate: number) => campo(linha, de, ate).trim();
const inteiro = (linha: string, de: number, ate: number) => {
  const t = campo(linha, de, ate).trim();
  if (!/^\d+$/.test(t)) throw new Error(`campo_numerico_invalido ${de}-${ate}`);
  return Number(t);
};
const data = (linha: string, de: number, ate: number): string | null => {
  const t = campo(linha, de, ate);
  if (!/^\d{8}$/.test(t) || t === '00000000' || t === '99991231') return null;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
};

// Preço ajustado pelo fator de cotação (preço por 1 unidade). Se não der centavo
// exato, o registro é recusado em vez de arredondado em silêncio.
function preco(bruto: number, fator: number): number {
  const v = bruto / fator;
  if (!Number.isInteger(v)) throw new Error('fator_de_cotacao_nao_inteiro');
  return v;
}

export function lerLinhaCotahist(linha: string): RegistroCotahist | null {
  const l = linha.replace(/\r$/, '');
  if (l.length < 245 || l.slice(0, 2) !== '01') return null; // cabeçalho, rodapé ou linha curta
  const fator = inteiro(l, 211, 217) || 1;
  const tipoMercado = inteiro(l, 25, 27);
  const p = (de: number, ate: number) => preco(inteiro(l, de, ate), fator);
  const ouNull = (v: number) => (v > 0 ? v : null);
  const opcao = tipoMercado === MERCADO.CALL || tipoMercado === MERCADO.PUT;
  const dataPregao = data(l, 3, 10);
  if (!dataPregao) throw new Error('data_do_pregao_invalida');
  return {
    data: dataPregao,
    codbdi: texto(l, 11, 12),
    codigo: texto(l, 13, 24),
    tipoMercado,
    nome: texto(l, 28, 39),
    especificacao: texto(l, 40, 49).replace(/\s+/g, ' '),
    abertura: ouNull(p(57, 69)),
    maxima: ouNull(p(70, 82)),
    minima: ouNull(p(83, 95)),
    media: ouNull(p(96, 108)),
    ultimo: ouNull(p(109, 121)),
    melhorCompra: ouNull(p(122, 134)),
    melhorVenda: ouNull(p(135, 147)),
    negocios: inteiro(l, 148, 152),
    quantidade: inteiro(l, 153, 170),
    volumeFinanceiro: inteiro(l, 171, 188),
    strike: opcao ? ouNull(p(189, 201)) : null,
    vencimento: opcao ? data(l, 203, 210) : null,
    fatorDeCotacao: fator,
    isin: texto(l, 231, 242),
  };
}

export type LeituraDoCotahist = {
  registros: RegistroCotahist[];
  recusadas: { linha: number; motivo: string }[];
  dataDoArquivo: string | null; // do cabeçalho
};

export function lerCotahist(conteudo: string): LeituraDoCotahist {
  const registros: RegistroCotahist[] = [];
  const recusadas: LeituraDoCotahist['recusadas'] = [];
  let dataDoArquivo: string | null = null;
  conteudo.split('\n').forEach((linha, i) => {
    if (linha.startsWith('00')) {
      // Cabeçalho: data de geração do arquivo nas posições 24 a 31.
      dataDoArquivo = data(linha, 24, 31);
      return;
    }
    if (!linha.startsWith('01')) return;
    try {
      const r = lerLinhaCotahist(linha);
      if (r) registros.push(r);
      else recusadas.push({ linha: i + 1, motivo: 'linha_curta' });
    } catch (e) {
      recusadas.push({ linha: i + 1, motivo: e instanceof Error ? e.message : String(e) });
    }
  });
  return { registros, recusadas, dataDoArquivo };
}

// Cotação normalizada com qualidade de fechamento. O instante da fonte é o fim do
// pregão (17h de Brasília, UTC−3; Brasil sem horário de verão desde 2019).
export function cotacaoDoFechamento(r: RegistroCotahist, recebidoEm: string): Cotacao {
  return {
    codigo: r.codigo,
    provedor: 'b3-cotahist',
    ultimo: r.ultimo,
    bid: r.melhorCompra,
    ask: r.melhorVenda,
    referencia: null,
    volume: r.quantidade,
    negocios: r.negocios,
    instanteDaFonte: `${r.data}T17:00:00-03:00`,
    instanteDeRecebimento: recebidoEm,
  };
}

export type SerieDoDia = {
  codigo: string;
  ativoObjeto: string | null; // null quando não deu para identificar com segurança
  tipo: 'call' | 'put';
  strike: number;
  vencimento: string;
  estilo: null; // o arquivo não informa; vem do cadastro de instrumentos quando houver
  registro: RegistroCotahist;
};

// Liga cada opção ao seu ativo-objeto: mesma raiz de 4 letras e mesma classe
// (ON, PN, UNT...) entre os papéis do mercado à vista do mesmo arquivo. Se houver
// mais de um candidato ou nenhum, o ativo-objeto fica null (não se adivinha).
export function seriesDeOpcoes(registros: readonly RegistroCotahist[]): SerieDoDia[] {
  const classe = (e: string) => e.split(' ')[0] ?? '';
  const vista = new Map<string, string[]>();
  for (const r of registros) {
    if (r.tipoMercado !== MERCADO.VISTA) continue;
    if (!/^[A-Z]{4}\d{1,2}$/.test(r.codigo)) continue;
    const chave = `${r.codigo.slice(0, 4)}|${classe(r.especificacao)}`;
    vista.set(chave, [...(vista.get(chave) ?? []), r.codigo]);
  }
  const series: SerieDoDia[] = [];
  for (const r of registros) {
    if (r.tipoMercado !== MERCADO.CALL && r.tipoMercado !== MERCADO.PUT) continue;
    if (r.strike === null || r.vencimento === null) continue;
    const candidatos = [...new Set(vista.get(`${r.codigo.slice(0, 4)}|${classe(r.especificacao)}`) ?? [])];
    series.push({
      codigo: r.codigo,
      ativoObjeto: candidatos.length === 1 ? (candidatos[0] as string) : null,
      tipo: r.tipoMercado === MERCADO.CALL ? 'call' : 'put',
      strike: r.strike,
      vencimento: r.vencimento,
      estilo: null,
      registro: r,
    });
  }
  return series;
}
