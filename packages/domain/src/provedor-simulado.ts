// Provedor simulado e determinístico, só para testes e desenvolvimento.
// Toda cotação sai com qualidade "simulado" (modo 'simulado' nas capacidades), e
// o servidor recusa ativar este provedor em produção.
// O teste controla o relógio, os preços e as falhas.

import type { Cotacao } from './cotacoes.ts';
import { ErroDoProvedor, type Candle, type Capacidades, type EstadoDoProvedor, type GregasDoProvedor, type MarketDataProvider, type SerieNaCadeia } from './provedor.ts';

export type CenarioSimulado = {
  agora: () => Date;
  precos: Map<string, { ultimo: number; bid: number | null; ask: number | null }>;
  cadeias: Map<string, SerieNaCadeia[]>; // chave: "PETR4|2026-11-20"
  falhar?: ErroDoProvedor | null;
  atrasoDaFonteSeg?: number; // idade das cotações em relação ao relógio
};

export class ProvedorSimulado implements MarketDataProvider {
  readonly nome = 'simulado';
  readonly capacidades: Capacidades = {
    acoes: { nome: 'simulado', modo: 'simulado', intervaloSeg: 1 },
    opcoes: { nome: 'simulado', modo: 'simulado', intervaloSeg: 1 },
    cadeiaDeOpcoes: true, bidAskEmOpcoes: true, gregas: false, volatilidadeImplicita: false, contratosEmAberto: true,
    historicoDiario: false, historicoIntradiario: false, streaming: false,
    ativosPorRequisicao: 50, requisicoesSimultaneas: 4, cotaMensal: null,
  };
  private ultimoErro: EstadoDoProvedor['ultimoErro'] = null;
  private ultimaResposta: string | null = null;
  private readonly cenario: CenarioSimulado;

  constructor(cenario: CenarioSimulado) {
    this.cenario = cenario;
  }

  private verificar(): void {
    if (this.cenario.falhar) {
      this.ultimoErro = { quando: this.cenario.agora().toISOString(), mensagem: this.cenario.falhar.message };
      throw this.cenario.falhar;
    }
    this.ultimaResposta = this.cenario.agora().toISOString();
  }

  async buscarInstrumentos(texto: string) {
    this.verificar();
    const t = texto.trim().toUpperCase();
    return [...this.cenario.precos.keys()].filter((c) => c.includes(t)).map((codigo) => ({ codigo, nome: codigo, tipo: 'acao' as const }));
  }

  async cotacoes(codigos: readonly string[]): Promise<Cotacao[]> {
    this.verificar();
    const agora = this.cenario.agora();
    const fonte = new Date(agora.getTime() - (this.cenario.atrasoDaFonteSeg ?? 0) * 1000).toISOString();
    return codigos.flatMap((codigo) => {
      const p = this.cenario.precos.get(codigo);
      if (!p) return [];
      return [{ codigo, provedor: this.nome, ultimo: p.ultimo, bid: p.bid, ask: p.ask, referencia: null, volume: null, negocios: null, instanteDaFonte: fonte, instanteDeRecebimento: agora.toISOString() }];
    });
  }

  async vencimentos(ativoObjeto: string): Promise<string[]> {
    this.verificar();
    return [...this.cenario.cadeias.keys()].filter((k) => k.startsWith(`${ativoObjeto}|`)).map((k) => k.split('|')[1] as string).sort();
  }

  async cadeia(ativoObjeto: string, vencimento: string): Promise<SerieNaCadeia[]> {
    this.verificar();
    const c = this.cenario.cadeias.get(`${ativoObjeto}|${vencimento}`);
    if (!c) throw new ErroDoProvedor('nao_encontrado', `sem cadeia para ${ativoObjeto} ${vencimento}`);
    return c;
  }

  async gregas(): Promise<GregasDoProvedor[]> {
    throw new ErroDoProvedor('nao_suportado', 'o provedor simulado não fornece gregas');
  }

  async historico(): Promise<Candle[]> {
    throw new ErroDoProvedor('nao_suportado', 'o provedor simulado não fornece histórico');
  }

  estado(): EstadoDoProvedor {
    return { conectado: !this.cenario.falhar, ultimaResposta: this.ultimaResposta, ultimoErro: this.ultimoErro, cotaRestante: null };
  }
}
