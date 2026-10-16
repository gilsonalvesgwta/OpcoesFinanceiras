// Rolagem: encerrar (total ou parcialmente) pernas abertas e abrir outras, numa
// operação só. A rolagem não apaga nada: ela vira um conjunto de execuções novas,
// ligadas entre si, aplicadas sobre a carteira. A posição original continua no
// histórico e o "antes e depois" sai do mesmo cálculo.
//
// O que este módulo deixa explícito na resposta:
// - crédito recebido na rolagem NÃO é lucro: o resultado econômico é o realizado
//   no encerramento mais o que a nova posição vier a dar;
// - quando a rolagem gera crédito mas aumenta a perda máxima, prolonga o prazo ou
//   aumenta a quantidade, isso aparece como aviso, não fica escondido no número.

import { somar, type Centavos } from './dinheiro.ts';
import { analisarPayoff, ErroDePosicao, type AnaliseDePayoff, type Extremo } from './payoff.ts';
import { aplicarExecucao, pernasAbertas, type Carteira, type Execucao } from './posicoes.ts';

export type PernaAEncerrar = { codigo: string; quantidade: number; preco: Centavos; custos?: Centavos; estimativa?: boolean };
export type PernaAAbrir = Omit<Execucao, 'instante'> & { estimativa?: boolean };

export type PedidoDeRolagem = {
  encerrar: PernaAEncerrar[];
  abrir: PernaAAbrir[];
  instante: string;
};

export type Aviso =
  | 'credito_nao_e_lucro'
  | 'perda_maxima_aumentou'
  | 'risco_passou_a_ilimitado'
  | 'prazo_prolongado'
  | 'quantidade_aumentou'
  | 'usa_preco_estimado'
  | 'payoff_indisponivel';

export const TEXTO_DOS_AVISOS: Readonly<Record<Aviso, string>> = Object.freeze({
  credito_nao_e_lucro: 'O crédito recebido na rolagem não é lucro: ele entra no resultado da estratégia junto com o que foi realizado e com o risco que continua aberto.',
  perda_maxima_aumentou: 'A perda máxima teórica no vencimento ficou maior depois da rolagem.',
  risco_passou_a_ilimitado: 'A posição passou a ter perda teórica ilimitada.',
  prazo_prolongado: 'O vencimento ficou mais distante: o risco da posição continua aberto por mais tempo.',
  quantidade_aumentou: 'A quantidade em opções vendidas aumentou.',
  usa_preco_estimado: 'Algum preço usado é estimativa (último negócio ou ponto médio), não preço executável.',
  payoff_indisponivel: 'Não foi possível calcular o payoff no vencimento (pernas com vencimentos diferentes ou posição vazia).',
});

export type ResultadoDaRolagem = {
  execucoes: Execucao[]; // o que deve ser gravado, na ordem
  fluxo: {
    encerramento: Centavos; // + crédito / − débito
    abertura: Centavos;
    custos: Centavos;
    liquido: Centavos;
    natureza: 'credito' | 'debito' | 'zero';
  };
  realizadoNoEncerramento: Centavos; // bruto, pelo preço médio
  realizadoAcumulado: { antes: Centavos; depois: Centavos };
  carteiraDepois: Carteira;
  payoff: { antes: AnaliseDePayoff | null; depois: AnaliseDePayoff | null };
  ultimoVencimento: { antes: string | null; depois: string | null };
  avisos: Aviso[];
};

// Payoff da ESTRATÉGIA: pernas abertas ao preço médio + resultado já realizado − custos já pagos.
// É esse número que diz se a estratégia como um todo ganha ou perde no vencimento.
function analisar(c: Carteira): AnaliseDePayoff | null {
  const pernas = pernasAbertas(c);
  if (pernas.length === 0) return null;
  let custos = 0;
  for (const i of c.values()) custos += i.custosPagos;
  try {
    return analisarPayoff(pernas, Math.round(realizado(c)) - custos);
  } catch (e) {
    if (e instanceof ErroDePosicao) return null;
    throw e;
  }
}

function realizado(c: Carteira): number {
  let t = 0;
  for (const i of c.values()) t += i.realizadoBruto;
  return t;
}

function ultimoVencimento(c: Carteira): string | null {
  const datas = [...c.values()].filter((i) => i.quantidade !== 0 && i.vencimento).map((i) => i.vencimento as string).sort();
  return datas.at(-1) ?? null;
}

function opcoesVendidas(c: Carteira): number {
  let t = 0;
  for (const i of c.values()) if (i.tipo !== 'ativo' && i.quantidade < 0) t += -i.quantidade * i.multiplicador;
  return t;
}

function piorou(antes: Extremo, depois: Extremo): boolean {
  if (depois.tipo === 'ilimitado') return antes.tipo !== 'ilimitado';
  return antes.tipo === 'limitado' && depois.valor < antes.valor;
}

export function simularRolagem(carteira: Carteira, pedido: PedidoDeRolagem): ResultadoDaRolagem {
  if (pedido.encerrar.length === 0 && pedido.abrir.length === 0) throw new ErroDePosicao('rolagem_vazia');
  const execucoes: Execucao[] = [];
  let encerramento = 0;
  let abertura = 0;
  let custos = 0;

  for (const e of pedido.encerrar) {
    const atual = carteira.get(e.codigo);
    if (!atual || atual.quantidade === 0) throw new ErroDePosicao(`nada_aberto_em_${e.codigo}`);
    if (!Number.isInteger(e.quantidade) || e.quantidade <= 0 || e.quantidade > Math.abs(atual.quantidade)) {
      throw new ErroDePosicao(`quantidade_a_encerrar_invalida_em_${e.codigo}`);
    }
    const lado = atual.quantidade > 0 ? 'venda' : 'compra';
    execucoes.push({
      codigo: e.codigo, tipo: atual.tipo, lado, quantidade: e.quantidade, preco: e.preco, multiplicador: atual.multiplicador,
      instante: pedido.instante,
      ...(atual.strike !== undefined ? { strike: atual.strike } : {}),
      ...(atual.vencimento !== undefined ? { vencimento: atual.vencimento } : {}),
      ...(e.custos !== undefined ? { custos: e.custos } : {}),
    });
    encerramento = somar(encerramento, (lado === 'venda' ? 1 : -1) * e.quantidade * atual.multiplicador * e.preco);
    custos = somar(custos, e.custos ?? 0);
  }
  for (const a of pedido.abrir) {
    const { estimativa: _estimativa, ...execucao } = a;
    execucoes.push({ ...execucao, instante: pedido.instante });
    abertura = somar(abertura, (a.lado === 'venda' ? 1 : -1) * a.quantidade * (a.multiplicador ?? 1) * a.preco);
    custos = somar(custos, a.custos ?? 0);
  }

  let depois = carteira;
  for (const e of execucoes) depois = aplicarExecucao(depois, e);

  const liquido = somar(encerramento, abertura, -custos);
  const realizadoAntes = realizado(carteira);
  const realizadoDepois = realizado(depois);
  const payoffAntes = analisar(carteira);
  const payoffDepois = analisar(depois);
  const vencAntes = ultimoVencimento(carteira);
  const vencDepois = ultimoVencimento(depois);

  const avisos: Aviso[] = [];
  if (liquido > 0) avisos.push('credito_nao_e_lucro');
  if (payoffAntes && payoffDepois) {
    if (payoffDepois.perdaMaxima.tipo === 'ilimitado' && payoffAntes.perdaMaxima.tipo !== 'ilimitado') avisos.push('risco_passou_a_ilimitado');
    else if (piorou(payoffAntes.perdaMaxima, payoffDepois.perdaMaxima)) avisos.push('perda_maxima_aumentou');
  } else if (pernasAbertas(depois).length > 0) {
    avisos.push('payoff_indisponivel');
  }
  if (vencAntes && vencDepois && vencDepois > vencAntes) avisos.push('prazo_prolongado');
  if (opcoesVendidas(depois) > opcoesVendidas(carteira)) avisos.push('quantidade_aumentou');
  if ([...pedido.encerrar, ...pedido.abrir].some((p) => p.estimativa)) avisos.push('usa_preco_estimado');

  return {
    execucoes,
    fluxo: { encerramento, abertura, custos, liquido, natureza: liquido > 0 ? 'credito' : liquido < 0 ? 'debito' : 'zero' },
    realizadoNoEncerramento: Math.round(realizadoDepois - realizadoAntes),
    realizadoAcumulado: { antes: Math.round(realizadoAntes), depois: Math.round(realizadoDepois) },
    carteiraDepois: depois,
    payoff: { antes: payoffAntes, depois: payoffDepois },
    ultimoVencimento: { antes: vencAntes, depois: vencDepois },
    avisos,
  };
}

// Compara alternativas lado a lado. A ordem de saída é a de entrada: o sistema
// não elege "a melhor" — crédito maior não quer dizer alternativa melhor.
export function compararRolagens(carteira: Carteira, alternativas: { nome: string; pedido: PedidoDeRolagem }[]) {
  return alternativas.map(({ nome, pedido }) => {
    try {
      return { nome, ok: true as const, resultado: simularRolagem(carteira, pedido) };
    } catch (e) {
      return { nome, ok: false as const, erro: e instanceof Error ? e.message : String(e) };
    }
  });
}
