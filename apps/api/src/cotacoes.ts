// Cotações dos códigos pedidos, do jeito que as telas mostram: a da ponte com o
// MetaTrader 5 do usuário (qualidade pelo pulso da ponte) e, para o que a ponte não
// cobre ou quando ela caiu, o último fechamento oficial da B3 (histórico).
// Roda dentro da transação do usuário (RLS): só alcança a ponte dele.

import { qualidadeDaPonte, sessaoDoDia, situacaoDoMercado, type ConfiguracaoDoCalendario, type Cotacao } from '@wta/domain';
import type { Cliente } from './banco.ts';
import { SESSAO_PADRAO } from './calendario.ts';

export type CotacaoDeSaida = {
  codigo: string; provedor: string;
  ultimo: number | null; bid: number | null; ask: number | null; fechamentoAnterior: number | null; volume: number | null;
  instanteDaFonte: string | null; instanteDeRecebimento: string | null; sinalDaPonteEm: string | null; qualidade: string;
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function cotacoesDoUsuario(c: Cliente, codigos: string[], agora: Date, cfg: ConfiguracaoDoCalendario): Promise<CotacaoDeSaida[]> {
  if (codigos.length === 0) return [];
  const mercado = situacaoDoMercado(agora, cfg);
  const r = await c.query(
    `select q.codigo, q.ultimo, q.bid, q.ask, q.fechamento_anterior, q.volume, q.instante_fonte, q.recebido_em,
            p.ultimo_contato_em, p.revogada_em
     from cotacoes_ponte q join pontes_mt5 p on p.id = q.ponte_id
     where q.codigo = any($1::text[])`, [codigos],
  );
  const daPonte = new Map<string, CotacaoDeSaida>(r.rows.map((l) => [l.codigo as string, {
    codigo: l.codigo as string, provedor: 'mt5',
    ultimo: l.ultimo, bid: l.bid, ask: l.ask, fechamentoAnterior: l.fechamento_anterior,
    volume: l.volume === null ? null : Number(l.volume),
    instanteDaFonte: iso(l.instante_fonte), instanteDeRecebimento: iso(l.recebido_em),
    sinalDaPonteEm: iso(l.ultimo_contato_em),
    qualidade: l.revogada_em ? 'desconectado' : qualidadeDaPonte(iso(l.ultimo_contato_em), agora, mercado.aberto),
  }]));
  const daB3 = new Map((await cotacoesDaB3(c, codigos, cfg)).map((q) => [q.codigo, q]));
  return [...new Set(codigos)].sort().flatMap((codigo): CotacaoDeSaida[] => {
    const p = daPonte.get(codigo);
    const doFechamento = daB3.get(codigo);
    if (p && (p.qualidade !== 'desconectado' || !doFechamento || (p.instanteDaFonte ?? '') > (doFechamento.instanteDaFonte ?? ''))) {
      // A ponte não manda o fechamento anterior de séries novas: completa com o da B3.
      if (p.fechamentoAnterior === null && doFechamento && (doFechamento.instanteDaFonte ?? '') < (p.instanteDaFonte ?? '')) {
        return [{ ...p, fechamentoAnterior: doFechamento.ultimo }];
      }
      return [p];
    }
    return doFechamento ? [doFechamento] : [];
  });
}

// Só o fechamento oficial da B3 (último pregão de cada código, qualidade "histórico").
// Serve também ao worker, que não alcança a ponte de ninguém.
export async function cotacoesDaB3(c: Cliente, codigos: string[], cfg: ConfiguracaoDoCalendario): Promise<CotacaoDeSaida[]> {
  if (codigos.length === 0) return [];
  // Últimos dois pregões de cada código: o último é o preço, o anterior serve para a variação.
  const f = await c.query(
    `select codigo, to_char(dia, 'YYYY-MM-DD') as dia, ultimo, melhor_compra, melhor_venda, quantidade, n from (
       select *, row_number() over (partition by codigo order by dia desc) as n from fechamentos where codigo = any($1::text[])
     ) x where n <= 2 order by codigo, n`, [codigos],
  );
  const fechamentos = new Map<string, { atual: Record<string, unknown>; anterior: Record<string, unknown> | null }>();
  for (const l of f.rows) {
    if (Number(l.n) === 1) fechamentos.set(l.codigo, { atual: l, anterior: null });
    else { const x = fechamentos.get(l.codigo); if (x) x.anterior = l; }
  }
  return [...fechamentos.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([codigo, b3]) => {
    const dia = b3.atual.dia as string;
    const fim = (sessaoDoDia(dia, cfg) ?? SESSAO_PADRAO).fechamento;
    return {
      codigo, provedor: 'b3-cotahist',
      ultimo: num(b3.atual.ultimo), bid: num(b3.atual.melhor_compra), ask: num(b3.atual.melhor_venda),
      fechamentoAnterior: b3.anterior ? num(b3.anterior.ultimo) : null,
      volume: num(b3.atual.quantidade),
      instanteDaFonte: new Date(`${dia}T${fim}:00-03:00`).toISOString(), instanteDeRecebimento: null,
      sinalDaPonteEm: null, qualidade: 'historico',
    };
  });
}

// Para os cálculos do domínio (marcação a mercado).
export function paraCotacao(q: CotacaoDeSaida): Cotacao {
  return {
    codigo: q.codigo, provedor: q.provedor, ultimo: q.ultimo, bid: q.bid, ask: q.ask, referencia: null, volume: q.volume, negocios: null,
    instanteDaFonte: q.instanteDaFonte, instanteDeRecebimento: q.instanteDeRecebimento ?? q.instanteDaFonte ?? new Date().toISOString(),
  };
}
