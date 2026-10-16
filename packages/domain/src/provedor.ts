// Contrato normalizado dos provedores de dados de mercado.
// O motor financeiro só conhece esta interface: trocar brapi por Cedro (ou outro)
// é escrever um adaptador novo, sem mexer em cálculo, alerta ou tela.
// Cada adaptador declara o que sabe fazer (`capacidades`); o sistema consulta isso
// antes de prometer algo na interface, e nunca chama de "tempo real" o que não é.

import type { Cotacao, PerfilDoProvedor } from './cotacoes.ts';
import type { ContratoDeOpcao } from './instrumentos.ts';

export type Capacidades = {
  acoes: PerfilDoProvedor; // modo e frequência das cotações de ações
  opcoes: PerfilDoProvedor | null; // null = não fornece cotação de opções
  cadeiaDeOpcoes: boolean;
  bidAskEmOpcoes: boolean;
  gregas: boolean;
  volatilidadeImplicita: boolean;
  contratosEmAberto: boolean;
  historicoDiario: boolean;
  historicoIntradiario: boolean;
  streaming: boolean;
  ativosPorRequisicao: number;
  requisicoesSimultaneas: number;
  cotaMensal: number | null;
};

export type Candle = { instante: string; abertura: number; maxima: number; minima: number; fechamento: number; volume: number | null };

export type SerieNaCadeia = ContratoDeOpcao & {
  cotacao: Cotacao;
  contratosEmAberto: number | null;
  dataDoPregao: string; // AAAA-MM-DD a que os números se referem
};

export type GregasDoProvedor = {
  codigo: string;
  dataDoPregao: string;
  volatilidadeImplicita: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  fonte: 'provedor'; // gregas calculadas internamente usam outro tipo, com premissas
};

export type EstadoDoProvedor = {
  conectado: boolean;
  ultimaResposta: string | null;
  ultimoErro: { quando: string; mensagem: string } | null;
  cotaRestante: number | null;
};

export class ErroDoProvedor extends Error {
  readonly codigo: 'sem_permissao' | 'limite' | 'indisponivel' | 'nao_encontrado' | 'resposta_invalida' | 'nao_suportado';
  readonly tentarDepoisSeg: number | null;
  constructor(codigo: ErroDoProvedor['codigo'], mensagem: string, tentarDepoisSeg: number | null = null) {
    super(mensagem);
    this.name = 'ErroDoProvedor';
    this.codigo = codigo;
    this.tentarDepoisSeg = tentarDepoisSeg;
  }
}

export interface MarketDataProvider {
  readonly nome: string;
  readonly capacidades: Capacidades;
  buscarInstrumentos(texto: string): Promise<{ codigo: string; nome: string; tipo: 'acao' | 'etf' | 'indice' | 'opcao' }[]>;
  cotacoes(codigos: readonly string[]): Promise<Cotacao[]>;
  vencimentos(ativoObjeto: string): Promise<string[]>;
  cadeia(ativoObjeto: string, vencimento: string, data?: string): Promise<SerieNaCadeia[]>;
  gregas(ativoObjeto: string, vencimento: string, data?: string): Promise<GregasDoProvedor[]>;
  historico(codigo: string, intervalo: '1d' | '5m' | '15m' | '60m', de: string, ate: string): Promise<Candle[]>;
  estado(): EstadoDoProvedor;
}
