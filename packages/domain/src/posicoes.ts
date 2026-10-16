// Posições a partir das execuções informadas pelo usuário.
// A posição nunca é editada direto: ela é a consequência das execuções (abertura,
// encerramento parcial, rolagem). Assim o histórico fica preservado e qualquer
// número da tela pode ser refeito a partir dos registros.
//
// Método de custo: preço médio por instrumento (o usado na apuração brasileira).
// O resultado realizado é bruto (diferença de preço); custos ficam em campo próprio.

import { ErroDeValor, type Centavos } from './dinheiro.ts';
import { precoParaEncerrar, type Cotacao, type OrigemDoPreco, type PoliticaDeMarcacao } from './cotacoes.ts';
import type { Lado, Perna, TipoDePerna } from './payoff.ts';

export type Execucao = {
  codigo: string;
  tipo: TipoDePerna;
  strike?: Centavos;
  vencimento?: string;
  multiplicador?: number;
  lado: Lado;
  quantidade: number;
  preco: Centavos;
  custos?: Centavos;
  instante: string; // ISO 8601
};

export type Instrumento = {
  codigo: string;
  tipo: TipoDePerna;
  strike?: Centavos;
  vencimento?: string;
  multiplicador: number;
  quantidade: number; // com sinal: + comprada, − vendida
  precoMedio: number; // centavos, pode ter fração
  realizadoBruto: number; // centavos, pode ter fração
  custosPagos: Centavos;
};

export type Carteira = Map<string, Instrumento>;

function validarExecucao(e: Execucao): void {
  if (!e.codigo.trim()) throw new ErroDeValor('codigo_ausente');
  if (!Number.isInteger(e.quantidade) || e.quantidade <= 0) throw new ErroDeValor('quantidade_invalida');
  if (!Number.isSafeInteger(e.preco) || e.preco < 0) throw new ErroDeValor('preco_invalido');
  if (e.custos !== undefined && (!Number.isSafeInteger(e.custos) || e.custos < 0)) throw new ErroDeValor('custos_invalidos');
  if (Number.isNaN(Date.parse(e.instante))) throw new ErroDeValor('instante_invalido');
  if (e.tipo !== 'ativo' && (e.strike === undefined || !e.vencimento)) throw new ErroDeValor('opcao_sem_strike_ou_vencimento');
}

// Aplica uma execução à carteira (devolve uma carteira nova; a original não muda).
export function aplicarExecucao(carteira: Carteira, e: Execucao): Carteira {
  validarExecucao(e);
  const nova: Carteira = new Map(carteira);
  const atual = carteira.get(e.codigo);
  const mult = e.multiplicador ?? atual?.multiplicador ?? 1;
  if (atual && atual.multiplicador !== mult) throw new ErroDeValor('multiplicador_diferente_do_registrado');
  const base: Instrumento = atual
    ? { ...atual }
    : {
        codigo: e.codigo, tipo: e.tipo, multiplicador: mult, quantidade: 0, precoMedio: 0, realizadoBruto: 0, custosPagos: 0,
        ...(e.strike !== undefined ? { strike: e.strike } : {}),
        ...(e.vencimento !== undefined ? { vencimento: e.vencimento } : {}),
      };
  const delta = e.lado === 'compra' ? e.quantidade : -e.quantidade;
  base.custosPagos += e.custos ?? 0;

  if (base.quantidade === 0 || Math.sign(base.quantidade) === Math.sign(delta)) {
    const q = Math.abs(base.quantidade);
    base.precoMedio = (q * base.precoMedio + e.quantidade * e.preco) / (q + e.quantidade);
    base.quantidade += delta;
  } else {
    const encerrada = Math.min(Math.abs(base.quantidade), e.quantidade);
    // Comprada encerrando com venda: ganha (venda − médio). Vendida encerrando com compra: ganha (médio − compra).
    base.realizadoBruto += encerrada * (e.preco - base.precoMedio) * Math.sign(base.quantidade) * mult;
    const resto = e.quantidade - encerrada;
    base.quantidade += Math.sign(delta) * encerrada;
    if (resto > 0) {
      base.quantidade = Math.sign(delta) * resto; // virou de lado
      base.precoMedio = e.preco;
    } else if (base.quantidade === 0) {
      base.precoMedio = 0;
    }
  }
  nova.set(e.codigo, base);
  return nova;
}

export function montarCarteira(execucoes: readonly Execucao[]): Carteira {
  const ordenadas = [...execucoes].sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante));
  return ordenadas.reduce<Carteira>((c, e) => aplicarExecucao(c, e), new Map());
}

export function instrumentosAbertos(c: Carteira): Instrumento[] {
  return [...c.values()].filter((i) => i.quantidade !== 0);
}

// Pernas para o payoff a partir do que está aberto, ao preço médio de entrada.
export function pernasAbertas(c: Carteira): Perna[] {
  return instrumentosAbertos(c).map((i) => ({
    tipo: i.tipo,
    lado: i.quantidade > 0 ? 'compra' : 'venda',
    quantidade: Math.abs(i.quantidade),
    multiplicador: i.multiplicador,
    preco: Math.round(i.precoMedio),
    ...(i.strike !== undefined ? { strike: i.strike } : {}),
    ...(i.vencimento !== undefined ? { vencimento: i.vencimento } : {}),
  }));
}

export type ResumoDeResultado = {
  realizadoBruto: Centavos;
  custosPagos: Centavos;
  realizadoLiquido: Centavos; // realizado bruto − todos os custos pagos até aqui (critério conservador)
  naoRealizadoEstimado: Centavos | null; // null quando falta preço para algum instrumento aberto
  instrumentosSemPreco: string[];
  marcacoes: { codigo: string; preco: number; origem: OrigemDoPreco; estimativa: boolean }[];
  usaEstimativa: boolean; // algum preço veio de último negócio ou ponto médio
};

export function resumoDeResultado(
  c: Carteira,
  cotacoes: ReadonlyMap<string, Cotacao>,
  politica: PoliticaDeMarcacao = 'executavel',
): ResumoDeResultado {
  let realizado = 0;
  let custos = 0;
  let naoRealizado = 0;
  const semPreco: string[] = [];
  const marcacoes: ResumoDeResultado['marcacoes'] = [];
  for (const i of c.values()) {
    realizado += i.realizadoBruto;
    custos += i.custosPagos;
    if (i.quantidade === 0) continue;
    const cot = cotacoes.get(i.codigo);
    const preco = cot ? precoParaEncerrar(cot, i.quantidade > 0 ? 'comprada' : 'vendida', politica) : null;
    if (!preco || !preco.ok) {
      semPreco.push(i.codigo);
      continue;
    }
    marcacoes.push({ codigo: i.codigo, preco: preco.valor, origem: preco.origem, estimativa: preco.estimativa });
    naoRealizado += i.quantidade * (preco.valor - i.precoMedio) * i.multiplicador;
  }
  const realizadoBruto = Math.round(realizado);
  return {
    realizadoBruto,
    custosPagos: custos,
    realizadoLiquido: realizadoBruto - custos,
    naoRealizadoEstimado: semPreco.length > 0 ? null : Math.round(naoRealizado),
    instrumentosSemPreco: semPreco,
    marcacoes,
    usaEstimativa: marcacoes.some((m) => m.estimativa),
  };
}

export type Exposicao = {
  ativoObjeto: string;
  vencimento: string | null; // null = ações
  quantidadeLiquidaCalls: number; // em ativos-objeto, com sinal
  quantidadeLiquidaPuts: number;
  quantidadeLiquidaAcoes: number;
  callsVendidasDescobertas: number; // calls vendidas sem ação/call comprada que as cubra
  nocionalStrikes: Centavos; // soma |quantidade| × strike das opções
};

// Exposição agregada por ativo-objeto e vencimento. `ativoDe` diz a qual
// ativo-objeto cada código pertence (vem do cadastro do provedor).
export function exposicoes(c: Carteira, ativoDe: (codigo: string) => string): Exposicao[] {
  const grupos = new Map<string, Exposicao>();
  const acoesPorAtivo = new Map<string, number>();
  for (const i of instrumentosAbertos(c)) {
    const ativo = ativoDe(i.codigo);
    const q = i.quantidade * i.multiplicador;
    if (i.tipo === 'ativo') acoesPorAtivo.set(ativo, (acoesPorAtivo.get(ativo) ?? 0) + q);
    const chave = `${ativo}|${i.tipo === 'ativo' ? '' : i.vencimento}`;
    const g = grupos.get(chave) ?? {
      ativoObjeto: ativo, vencimento: i.tipo === 'ativo' ? null : (i.vencimento ?? null),
      quantidadeLiquidaCalls: 0, quantidadeLiquidaPuts: 0, quantidadeLiquidaAcoes: 0, callsVendidasDescobertas: 0, nocionalStrikes: 0,
    };
    if (i.tipo === 'call') g.quantidadeLiquidaCalls += q;
    if (i.tipo === 'put') g.quantidadeLiquidaPuts += q;
    if (i.tipo === 'ativo') g.quantidadeLiquidaAcoes += q;
    if (i.tipo !== 'ativo') g.nocionalStrikes += Math.abs(q) * (i.strike ?? 0);
    grupos.set(chave, g);
  }
  for (const g of grupos.values()) {
    if (g.vencimento === null) continue;
    const acoes = Math.max(acoesPorAtivo.get(g.ativoObjeto) ?? 0, 0);
    // Calls compradas do mesmo vencimento cobrem calls vendidas; ações cobrem o restante.
    // Critério simples e declarado: não considera strikes nem vencimentos diferentes.
    g.callsVendidasDescobertas = Math.max(0, -g.quantidadeLiquidaCalls - acoes);
  }
  return [...grupos.values()];
}
