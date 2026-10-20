// Alertas com as cotações da brapi (ações, ~30 min de atraso). Roda na api a cada minuto:
// pega as cotações novas (app.brapi_para_alertas marca como avaliadas) e avalia as regras
// de quem aceitou dado periódico, dentro da transação de cada dono (RLS).
// Só durante o pregão; dado com mais de 45 minutos chega como "atrasado" e não dispara.

import { situacaoDoMercado, type ConfiguracaoDoCalendario } from '@wta/domain';
import { emTransacao, type Pool } from '../banco.ts';
import { IDADE_MAXIMA_DA_BRAPI_MIN } from '../cotacoes.ts';
import { avaliarCotacoes, type CotacaoParaAlerta } from './motor.ts';

export const FONTE_BRAPI = 'brapi (cerca de 30 min de atraso)';

export async function avaliarAlertasDaBrapi(pool: Pool, agora: Date, cfg: ConfiguracaoDoCalendario): Promise<{ cotacoes: number; disparos: number }> {
  const linhas = (await emTransacao(pool, null, (c) => c.query('select * from app.brapi_para_alertas()'))).rows as {
    codigo: string; ultimo: string; fechamento_anterior: string | null; volume: string | null; instante_fonte: Date; usuarios: string[];
  }[];
  if (!linhas.length || !situacaoDoMercado(agora, cfg).aberto) return { cotacoes: linhas.length, disparos: 0 };
  const porUsuario = new Map<string, CotacaoParaAlerta[]>();
  for (const l of linhas) {
    const instante = new Date(l.instante_fonte).toISOString();
    const idadeMin = (agora.getTime() - Date.parse(instante)) / 60_000;
    const q: CotacaoParaAlerta = {
      codigo: l.codigo, instante, qualidade: idadeMin <= IDADE_MAXIMA_DA_BRAPI_MIN ? 'periodica' : 'atrasada',
      ultimo: Number(l.ultimo), bid: null, ask: null, volume: l.volume === null ? null : Number(l.volume),
      fechamentoAnterior: l.fechamento_anterior === null ? null : Number(l.fechamento_anterior),
    };
    for (const u of l.usuarios ?? []) porUsuario.set(u, [...(porUsuario.get(u) ?? []), q]);
  }
  let disparos = 0;
  for (const [userId, cotacoes] of porUsuario) {
    const r = await emTransacao(pool, userId, (c) => avaliarCotacoes(c, userId, cotacoes, FONTE_BRAPI));
    disparos += r.disparos;
  }
  return { cotacoes: linhas.length, disparos };
}
