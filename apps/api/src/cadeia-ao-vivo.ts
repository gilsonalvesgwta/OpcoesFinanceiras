// Peças da cadeia "ao vivo", usadas pela tela da Cadeia de opções e pelo Simulador:
// - pedir ao robô do MT5 as séries perto do preço (lista "observada" por 15 minutos);
// - dizer se cada vencimento é o mensal ou um semanal (W1 a W5, pelo código da B3);
// - resumir a cotação mesclada (MT5 > brapi > fechamento) para a tela.

import type { Cliente } from './banco.ts';
import type { CotacaoDeSaida } from './cotacoes.ts';

export type CotacaoResumida = { ultimo: number | null; bid: number | null; ask: number | null; qualidade: string; provedor: string; instanteDaFonte: string | null } | null;

export const resumoDaCotacao = (x: CotacaoDeSaida | undefined): CotacaoResumida =>
  (x ? { ultimo: x.ultimo, bid: x.bid, ask: x.ask, qualidade: x.qualidade, provedor: x.provedor, instanteDaFonte: x.instanteDaFonte } : null);

// Pede ao robô do MT5 (se houver) o ativo e as séries dos 3 vencimentos mais próximos e as
// do vencimento escolhido (estas primeiro), perto do preço, por 15 minutos. Renova no
// máximo uma vez por minuto por ativo e vencimento: a tela consulta a cada 2 s, e trocar
// de ativo ou de vencimento pede as séries novas na hora.
export async function observarCadeia(
  c: Cliente, userId: string, ativo: string, base: string, vencimento: string | null, vencimentos: readonly string[],
): Promise<void> {
  if (!vencimentos.length) return;
  const renovar = (await c.query(
    `select coalesce((select ate from observados_ponte where codigo = $1), '-infinity') < now() + interval '14 minutes'
         or ($2::date is not null and not exists (
              select 1 from observados_ponte o join series_opcoes s on s.codigo = o.codigo
              where s.ativo_objeto = $1 and s.vencimento = $2::date and o.ate >= now() + interval '14 minutes')) as r`,
    [ativo, vencimento],
  )).rows[0]?.r;
  if (!renovar) return;
  await c.query(
    `insert into observados_ponte (user_id, codigo, ate)
     select $1, codigo, now() + interval '15 minutes' from (
       select $2::text as codigo
       union
       (select s.codigo from series_opcoes s join fechamentos a on a.codigo = $2 and a.dia = $3
        where s.ativo_objeto = $2 and s.vencimento = any($4::date[]) and s.visto_ultimo >= $3
          and s.strike between a.ultimo * 0.75 and a.ultimo * 1.25
        order by s.vencimento <> $5::date, s.vencimento, abs(s.strike - a.ultimo) limit 300)
     ) x
     on conflict (user_id, codigo) do update set ate = excluded.ate`,
    [userId, ativo, base, [...new Set([vencimento, ...vencimentos.slice(0, 3)].filter(Boolean))], vencimento],
  );
  await c.query('delete from observados_ponte where ate < now()');
}

// "mensal" ou "W1".."W5". A B3 põe o sufixo W<n> no código das opções semanais
// (ex.: BOVAJ154W5 vence na 5ª semana de outubro); a mensal não tem sufixo.
export function tipoDoVencimento(codigos: readonly string[]): string {
  const semanas = new Set(codigos.map((c) => /W([1-5])$/.exec(c)?.[1] ?? 'M'));
  if (semanas.has('M') || semanas.size === 0) return 'mensal';
  return `W${[...semanas].sort()[0]}`;
}

export async function tiposDosVencimentos(c: Cliente, ativo: string, base: string, vencimentos: readonly string[]): Promise<Record<string, string>> {
  if (!vencimentos.length) return {};
  const r = await c.query(
    `select to_char(vencimento, 'YYYY-MM-DD') as v, array_agg(codigo) as codigos from series_opcoes
     where ativo_objeto = $1 and visto_ultimo >= $2 and vencimento = any($3::date[]) group by vencimento`,
    [ativo, base, vencimentos],
  );
  return Object.fromEntries(r.rows.map((l) => [l.v as string, tipoDoVencimento(l.codigos as string[])]));
}
