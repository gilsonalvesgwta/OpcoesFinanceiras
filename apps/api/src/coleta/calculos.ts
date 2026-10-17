// Volatilidade implícita e gregas de todas as opções de um pregão, a partir do
// fechamento da B3 e da Selic. Roda no worker (papel wtaopt_coleta) depois de
// cada importação e refaz dias que ficaram sem cálculo (ex.: Selic chegou depois).

import { calcularDoFechamento, type ConfiguracaoDoCalendario } from '@wta/domain';
import type { Cliente } from '../banco.ts';

const LOTE = 2000;

export type ResultadoDoCalculo = { calculadas: number; semCalculo: number };

export async function calcularDia(c: Cliente, dia: string, cfg: ConfiguracaoDoCalendario): Promise<ResultadoDoCalculo> {
  const selic = (await c.query<{ valor: string }>(
    "select valor from taxas_juros where serie = 'selic' and dia <= $1 order by dia desc limit 1", [dia],
  )).rows[0];
  const spots = new Map((await c.query<{ codigo: string; ultimo: string | null }>(
    'select codigo, ultimo from fechamentos where dia = $1 and tipo_mercado = 10', [dia],
  )).rows.map((l) => [l.codigo, l.ultimo === null ? null : Number(l.ultimo)]));
  // A série do código naquele pregão: vista no arquivo do dia e ainda não vencida.
  const opcoes = (await c.query<{
    codigo: string; vencimento: string; ativo_objeto: string | null; tipo: 'call' | 'put'; strike: string;
    ultimo: string | null; melhor_compra: string | null; melhor_venda: string | null;
  }>(
    `select s.codigo, to_char(s.vencimento, 'YYYY-MM-DD') as vencimento, s.ativo_objeto, s.tipo, s.strike,
            f.ultimo, f.melhor_compra, f.melhor_venda
     from fechamentos f join series_opcoes s on s.codigo = f.codigo
       and s.visto_primeiro <= f.dia and s.visto_ultimo >= f.dia and s.vencimento >= f.dia
     where f.dia = $1 and f.tipo_mercado in (70, 80)`, [dia],
  )).rows;

  const n = (v: string | null) => (v === null ? null : Number(v));
  const linhas = opcoes.map((o) => {
    const spot = o.ativo_objeto ? spots.get(o.ativo_objeto) ?? null : null;
    const r = calcularDoFechamento({
      dia, tipo: o.tipo, strike: Number(o.strike), vencimento: o.vencimento,
      ultimo: n(o.ultimo), bid: n(o.melhor_compra), ask: n(o.melhor_venda), ativoObjeto: spot, selic: selic ? Number(selic.valor) : null,
    }, cfg);
    return { o, spot, r };
  });

  await c.query('delete from calculos_opcoes where dia = $1', [dia]);
  for (let i = 0; i < linhas.length; i += LOTE) {
    const parte = linhas.slice(i, i + LOTE);
    const col = <T>(f: (x: (typeof linhas)[number]) => T) => parte.map(f);
    await c.query(
      `insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, spot, premio, origem_premio, dias_uteis, selic,
                                    vol_implicita, preco_teorico, delta, gamma, theta, vega, rho, motivo)
       select $1::date, * from unnest($2::text[], $3::date[], $4::text[], $5::bigint[], $6::numeric[], $7::text[], $8::int[], $9::numeric[],
                                      $10::float8[], $11::float8[], $12::float8[], $13::float8[], $14::float8[], $15::float8[], $16::float8[], $17::text[])`,
      [
        dia, col((x) => x.o.codigo), col((x) => x.o.vencimento), col((x) => x.o.ativo_objeto), col((x) => x.spot),
        col((x) => (x.r.ok ? x.r.premio : null)), col((x) => (x.r.ok ? x.r.origem : null)), col((x) => x.r.diasUteis),
        col((x) => (x.r.ok && selic ? Number(selic.valor) : null)), col((x) => (x.r.ok ? x.r.volImplicita : null)),
        col((x) => (x.r.ok ? x.r.gregas.preco : null)), col((x) => (x.r.ok ? x.r.gregas.delta : null)), col((x) => (x.r.ok ? x.r.gregas.gamma : null)),
        col((x) => (x.r.ok ? x.r.gregas.theta : null)), col((x) => (x.r.ok ? x.r.gregas.vega : null)), col((x) => (x.r.ok ? x.r.gregas.rho : null)),
        col((x) => (x.r.ok ? null : x.r.motivo)),
      ],
    );
  }
  const calculadas = linhas.filter((x) => x.r.ok).length;
  return { calculadas, semCalculo: linhas.length - calculadas };
}

// Pregões importados (últimos 20 dias) sem nenhum cálculo, ou calculados sem Selic
// quando agora já existe Selic para eles.
export async function diasParaRecalcular(c: Cliente, agora: Date, limite = 5): Promise<string[]> {
  const r = await c.query<{ dia: string }>(
    `select to_char(i.referencia, 'YYYY-MM-DD') as dia from importacoes i
     where i.fonte = 'b3-cotahist' and i.situacao = 'ok' and i.referencia >= ($1::timestamptz - interval '20 days')::date
       and (not exists (select 1 from calculos_opcoes k where k.dia = i.referencia)
            or (exists (select 1 from calculos_opcoes k where k.dia = i.referencia and k.motivo = 'sem_selic')
                and exists (select 1 from taxas_juros t where t.serie = 'selic' and t.dia <= i.referencia)))
       and exists (select 1 from fechamentos f where f.dia = i.referencia and f.tipo_mercado in (70, 80))
     group by i.referencia order by i.referencia desc limit $2`, [agora, limite],
  );
  return r.rows.map((l) => l.dia);
}
