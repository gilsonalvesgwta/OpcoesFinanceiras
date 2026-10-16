// Identificação de instrumentos da B3.
// O código de uma opção sobre ação segue {RAIZ}{LETRA}{SÉRIE}: a letra diz o tipo
// e o mês de vencimento (A–L calls de janeiro a dezembro; M–X puts na mesma
// ordem). O número final identifica a série, NÃO é o strike em reais: o strike,
// o vencimento exato, o estilo e o lote só vêm do cadastro do provedor.

export type TipoOpcao = 'call' | 'put';
export type EstiloExercicio = 'americana' | 'europeia';

export type LeituraDoCodigo = {
  raiz: string;
  tipo: TipoOpcao;
  mes: number; // 1 a 12
  serie: string;
};

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWX';

export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase();
}

// Lê só o que o código revela. Devolve null se não tiver formato de opção.
export function lerCodigoDeOpcao(codigo: string): LeituraDoCodigo | null {
  const c = normalizarCodigo(codigo);
  // Sufixos aceitos: letra de série ajustada (E) e semanais (W1 a W5).
  const m = /^([A-Z]{4})([A-X])(\d{1,4}(?:[A-Z]\d?)?)$/.exec(c);
  if (!m) return null;
  const [, raiz, letra, serie] = m as unknown as [string, string, string, string];
  const posicao = LETRAS.indexOf(letra);
  return {
    raiz,
    tipo: posicao < 12 ? 'call' : 'put',
    mes: (posicao % 12) + 1,
    serie,
  };
}

// Ação, unit ou ETF: 4 letras + dígito(s). Ex.: PETR4, TAEE11, BOVA11.
export function pareceAtivoObjeto(codigo: string): boolean {
  return /^[A-Z]{4}\d{1,2}$/.test(normalizarCodigo(codigo));
}

// Especificação do contrato como veio do provedor. Nada aqui é presumido:
// estilo, lote e multiplicador variam por série e mudam com eventos corporativos.
export type ContratoDeOpcao = {
  codigo: string;
  ativoObjeto: string;
  tipo: TipoOpcao;
  estilo: EstiloExercicio;
  strike: number; // centavos
  vencimento: string; // AAAA-MM-DD
  multiplicador: number; // ativos-objeto por unidade de quantidade (B3 ações: 1)
  loteDeNegociacao: number | null; // lote padrão informado pelo provedor
};

export function validarContrato(c: ContratoDeOpcao): string[] {
  const erros: string[] = [];
  if (!lerCodigoDeOpcao(c.codigo)) erros.push('codigo_fora_do_padrao');
  if (!Number.isSafeInteger(c.strike) || c.strike <= 0) erros.push('strike_invalido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.vencimento) || Number.isNaN(Date.parse(`${c.vencimento}T00:00:00Z`))) {
    erros.push('vencimento_invalido');
  }
  if (!Number.isInteger(c.multiplicador) || c.multiplicador <= 0) erros.push('multiplicador_invalido');
  if (c.loteDeNegociacao !== null && (!Number.isInteger(c.loteDeNegociacao) || c.loteDeNegociacao <= 0)) {
    erros.push('lote_invalido');
  }
  const lido = lerCodigoDeOpcao(c.codigo);
  if (lido && lido.tipo !== c.tipo) erros.push('tipo_diferente_do_codigo');
  return erros;
}
