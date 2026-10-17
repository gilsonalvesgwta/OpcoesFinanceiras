// Calendário da B3 lido do banco (feriados e sessões especiais, editáveis pelo
// superadministrador), com cache curto para não consultar a cada pedido.

import type { ConfiguracaoDoCalendario, Sessao } from '@wta/domain';
import { emTransacao, type Cliente, type Pool } from './banco.ts';

export const SESSAO_PADRAO: Sessao = { abertura: '10:00', fechamento: '17:00' };

const hhmm = (t: string) => t.slice(0, 5);

export async function lerCalendario(c: Cliente): Promise<ConfiguracaoDoCalendario> {
  const f = await c.query<{ dia: string }>("select to_char(dia, 'YYYY-MM-DD') as dia from feriados");
  const s = await c.query<{ dia: string; abertura: string; fechamento: string }>(
    "select to_char(dia, 'YYYY-MM-DD') as dia, abertura::text, fechamento::text from sessoes_especiais",
  );
  return {
    feriados: new Set(f.rows.map((l) => l.dia)),
    sessaoPadrao: SESSAO_PADRAO,
    sessoesEspeciais: new Map(s.rows.map((l) => [l.dia, { abertura: hhmm(l.abertura), fechamento: hhmm(l.fechamento) }])),
  };
}

export class CacheDoCalendario {
  private valor: ConfiguracaoDoCalendario | null = null;
  private lidoEm = 0;
  private readonly pool: Pool;
  private readonly validadeMs: number;
  constructor(pool: Pool, validadeMs = 5 * 60_000) {
    this.pool = pool;
    this.validadeMs = validadeMs;
  }
  async obter(): Promise<ConfiguracaoDoCalendario> {
    if (this.valor && Date.now() - this.lidoEm < this.validadeMs) return this.valor;
    this.valor = await emTransacao(this.pool, null, lerCalendario);
    this.lidoEm = Date.now();
    return this.valor;
  }
  // Depois de o superadministrador mudar o calendário.
  esquecer(): void {
    this.valor = null;
  }
}
