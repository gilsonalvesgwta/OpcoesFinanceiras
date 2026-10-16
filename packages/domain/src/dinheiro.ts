// Valores monetários em centavos inteiros (R$ 1,00 = 100).
// Prêmios, strikes e custos da B3 têm duas casas decimais; guardar em centavos
// evita erro de arredondamento de ponto flutuante nas somas de fluxo de caixa.
// Valores derivados que não caem em centavo exato (ponto de equilíbrio, por
// exemplo) são devolvidos em reais, como número, e sempre identificados assim.

export type Centavos = number;

export class ErroDeValor extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeValor';
  }
}

export function centavos(valor: number): Centavos {
  if (!Number.isSafeInteger(valor)) throw new ErroDeValor(`valor_em_centavos_invalido: ${valor}`);
  return valor;
}

// "38,50", "38.50", "1.234,56" ou número em reais → centavos.
export function reaisParaCentavos(valor: string | number): Centavos {
  let texto = typeof valor === 'number' ? String(valor) : valor.trim();
  if (typeof valor === 'string') {
    texto = texto.replace(/^R\$\s*/i, '');
    if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(texto)) throw new ErroDeValor(`valor_em_reais_invalido: ${valor}`);
  const negativo = texto.startsWith('-');
  const [inteiro = '0', fracao = ''] = texto.replace('-', '').split('.');
  if (fracao.length > 2 && /[1-9]/.test(fracao.slice(2))) {
    throw new ErroDeValor(`mais_de_duas_casas: ${valor}`);
  }
  const total = Number(inteiro) * 100 + Number((fracao + '00').slice(0, 2));
  return centavos(negativo ? -total : total);
}

export function centavosParaReais(valor: Centavos): number {
  return valor / 100;
}

const formatoBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatarReais(valor: Centavos): string {
  return formatoBRL.format(valor / 100);
}

// Soma que recusa estouro do inteiro seguro em vez de perder precisão calada.
export function somar(...valores: Centavos[]): Centavos {
  let total = 0;
  for (const v of valores) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new ErroDeValor('estouro_na_soma');
  }
  return total;
}

export function multiplicar(valor: Centavos, fator: number): Centavos {
  if (!Number.isInteger(fator)) throw new ErroDeValor(`fator_nao_inteiro: ${fator}`);
  return centavos(valor * fator);
}
