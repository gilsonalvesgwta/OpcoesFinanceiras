// Coleta das fontes gratuitas, rodada pelo worker com o papel wtaopt_coleta
// (escreve só dados de mercado; não alcança tabelas de usuários).
//
// A cada ciclo:
//  1. registra o pulso (o diagnóstico mostra se o worker está vivo);
//  2. busca os arquivos COTAHIST dos pregões que faltam (até 10 dias para trás);
//  3. busca a Selic uma vez por dia.
// Toda tentativa fica registrada em `importacoes`, com sucesso ou motivo da falha.

import {
  diasParaColetar, lerCotahist, lerSerieSgs, MERCADO, partesEmBrasilia, SERIE_SELIC, seriesDeOpcoes, urlDaSerieSgs, urlDoCotahistDiario,
  type RegistroCotahist,
} from '@wta/domain';
import { emTransacao, type Cliente, type Pool } from '../banco.ts';
import { lerCalendario } from '../calendario.ts';
import { ehZip, extrairPrimeiroArquivo } from './zip.ts';
import { calcularDia, diasParaRecalcular } from './calculos.ts';

export const VERSAO_DA_COLETA = '0.1.0';
const LOTE = 2000;
const MAXIMO_POR_CICLO = 3;
const TAMANHO_MAXIMO = 150 * 1024 * 1024;
const CODIGO = /^[A-Z0-9]{4,12}$/;

export type Buscar = (url: string, init?: { signal?: AbortSignal; method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;

export type DependenciasDaColeta = {
  pool: Pool;
  buscar: Buscar;
  agora?: () => Date;
  log?: (msg: string) => void;
  nome?: string;
};

export type ResultadoDaImportacao = { registros: number; recusados: number; series: number };

// ---------- COTAHIST ----------

export async function importarCotahist(c: Cliente, dia: string, texto: string): Promise<ResultadoDaImportacao> {
  const leitura = lerCotahist(texto);
  const uteis = new Map<string, RegistroCotahist>();
  let foraDoDia = 0;
  for (const r of leitura.registros) {
    if (r.data !== dia) { foraDoDia += 1; continue; }
    if (r.tipoMercado !== MERCADO.VISTA && r.tipoMercado !== MERCADO.CALL && r.tipoMercado !== MERCADO.PUT) continue;
    if (!CODIGO.test(r.codigo)) continue;
    uteis.set(r.codigo, r);
  }
  if (uteis.size === 0) throw new Error(foraDoDia > 0 ? 'arquivo_de_outro_dia' : 'arquivo_sem_registros');

  const lista = [...uteis.values()];
  for (let i = 0; i < lista.length; i += LOTE) {
    const parte = lista.slice(i, i + LOTE);
    const col = <K extends keyof RegistroCotahist>(k: K) => parte.map((r) => r[k]);
    await c.query(
      `insert into fechamentos (dia, codigo, tipo_mercado, especificacao, abertura, maxima, minima, media, ultimo,
                                melhor_compra, melhor_venda, negocios, quantidade, volume)
       select $1::date, * from unnest($2::text[], $3::smallint[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[],
                                      $9::bigint[], $10::bigint[], $11::bigint[], $12::int[], $13::bigint[], $14::bigint[])
       on conflict (dia, codigo) do update set
         tipo_mercado = excluded.tipo_mercado, especificacao = excluded.especificacao, abertura = excluded.abertura,
         maxima = excluded.maxima, minima = excluded.minima, media = excluded.media, ultimo = excluded.ultimo,
         melhor_compra = excluded.melhor_compra, melhor_venda = excluded.melhor_venda, negocios = excluded.negocios,
         quantidade = excluded.quantidade, volume = excluded.volume`,
      [dia, col('codigo'), col('tipoMercado'), col('especificacao'), col('abertura'), col('maxima'), col('minima'), col('media'),
        col('ultimo'), col('melhorCompra'), col('melhorVenda'), col('negocios'), col('quantidade'), col('volumeFinanceiro')],
    );
  }

  const series = seriesDeOpcoes(lista);
  for (let i = 0; i < series.length; i += LOTE) {
    const parte = series.slice(i, i + LOTE);
    await c.query(
      `insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, isin, visto_primeiro, visto_ultimo)
       select codigo, vencimento, ativo_objeto, tipo, strike, nullif(isin, ''), $1::date, $1::date
       from unnest($2::text[], $3::date[], $4::text[], $5::text[], $6::bigint[], $7::text[])
         as s(codigo, vencimento, ativo_objeto, tipo, strike, isin)
       on conflict (codigo, vencimento) do update set
         ativo_objeto = coalesce(excluded.ativo_objeto, series_opcoes.ativo_objeto),
         strike = excluded.strike, isin = coalesce(excluded.isin, series_opcoes.isin),
         visto_primeiro = least(series_opcoes.visto_primeiro, excluded.visto_primeiro),
         visto_ultimo = greatest(series_opcoes.visto_ultimo, excluded.visto_ultimo)`,
      [dia, parte.map((s) => s.codigo), parte.map((s) => s.vencimento), parte.map((s) => s.ativoObjeto), parte.map((s) => s.tipo),
        parte.map((s) => s.strike), parte.map((s) => s.registro.isin)],
    );
  }
  return { registros: lista.length, recusados: leitura.recusadas.length, series: series.length };
}

type Download = { situacao: 'ok'; bytes: Buffer } | { situacao: 'sem_arquivo'; detalhe: string };

async function baixar(buscar: Buscar, url: string, tempoMs: number): Promise<Download> {
  const r = await buscar(url, { signal: AbortSignal.timeout(tempoMs) });
  if (r.status === 404) return { situacao: 'sem_arquivo', detalhe: 'http_404' };
  if (!r.ok) throw new Error(`http_${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > TAMANHO_MAXIMO) throw new Error('arquivo_grande_demais');
  // A B3 responde com uma página comum quando o arquivo do dia ainda não existe.
  if (!ehZip(bytes)) return { situacao: 'sem_arquivo', detalhe: 'resposta_nao_e_zip' };
  return { situacao: 'ok', bytes };
}

// O relógio vem das dependências (nos testes, um relógio fixo): início e fim saem dele.
async function registrar(dep: DependenciasDaColeta, fonte: string, referencia: string | null, situacao: string, iniciada: Date, extra: { registros?: number; recusados?: number; detalhe?: string } = {}) {
  await emTransacao(dep.pool, null, (c) => c.query(
    'insert into importacoes (fonte, referencia, situacao, registros, recusados, detalhe, iniciada_em, terminada_em) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [fonte, referencia, situacao, extra.registros ?? null, extra.recusados ?? null, extra.detalhe?.slice(0, 500) ?? null, iniciada, relogio(dep)()],
  ));
}

function relogio(dep: DependenciasDaColeta): () => Date {
  return dep.agora ?? (() => new Date());
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function coletarCotahist(dep: DependenciasDaColeta, dia: string): Promise<'ok' | 'sem_arquivo' | 'erro'> {
  const inicio = relogio(dep)();
  try {
    const d = await baixar(dep.buscar, urlDoCotahistDiario(dia), 120_000);
    if (d.situacao === 'sem_arquivo') {
      await registrar(dep, 'b3-cotahist', dia, 'sem_arquivo', inicio, { detalhe: d.detalhe });
      return 'sem_arquivo';
    }
    const texto = extrairPrimeiroArquivo(d.bytes).conteudo.toString('latin1');
    // Dados e registro de sucesso na mesma transação: ou entra tudo, ou nada.
    const r = await emTransacao(dep.pool, null, async (c) => {
      const res = await importarCotahist(c, dia, texto);
      await c.query(
        'insert into importacoes (fonte, referencia, situacao, registros, recusados, detalhe, iniciada_em, terminada_em) values ($1, $2, $3, $4, $5, $6, $7, $8)',
        ['b3-cotahist', dia, 'ok', res.registros, res.recusados, `${res.series.toLocaleString('pt-BR')} séries de opções`, inicio, relogio(dep)()],
      );
      return res;
    });
    dep.log?.(`COTAHIST ${dia}: ${r.registros} registros, ${r.series} séries, ${r.recusados} linhas recusadas`);
    return 'ok';
  } catch (e) {
    await registrar(dep, 'b3-cotahist', dia, 'erro', inicio, { detalhe: mensagem(e) });
    dep.log?.(`COTAHIST ${dia}: erro ${mensagem(e)}`);
    return 'erro';
  }
}

// ---------- Selic ----------

export async function coletarSelic(dep: DependenciasDaColeta): Promise<'ok' | 'erro'> {
  const inicio = relogio(dep)();
  try {
    const r = await dep.buscar(urlDaSerieSgs(SERIE_SELIC, 10), { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`http_${r.status}`);
    const pontos = lerSerieSgs(await r.json());
    if (pontos.length === 0) throw new Error('serie_vazia');
    await emTransacao(dep.pool, null, async (c) => {
      await c.query(
        `insert into taxas_juros (serie, dia, valor, fonte)
         select 'selic', dia, valor, 'bcb-sgs-${SERIE_SELIC}' from unnest($1::date[], $2::numeric[]) as t(dia, valor)
         on conflict (serie, dia) do update set valor = excluded.valor, fonte = excluded.fonte`,
        [pontos.map((p) => p.dia), pontos.map((p) => p.valor)],
      );
      await c.query(
        'insert into importacoes (fonte, referencia, situacao, registros, iniciada_em, terminada_em) values ($1, $2, $3, $4, $5, $6)',
        ['bcb-selic', pontos[pontos.length - 1]?.dia ?? null, 'ok', pontos.length, inicio, relogio(dep)()],
      );
    });
    return 'ok';
  } catch (e) {
    await registrar(dep, 'bcb-selic', null, 'erro', inicio, { detalhe: mensagem(e) });
    dep.log?.(`Selic: erro ${mensagem(e)}`);
    return 'erro';
  }
}

// ---------- Ciclo ----------

export type ResumoDoCiclo = {
  cotahist: Record<string, 'ok' | 'sem_arquivo' | 'erro'>;
  selic: 'ok' | 'erro' | 'em_dia';
  calculos: Record<string, { calculadas: number; semCalculo: number }>;
};

export async function cicloDeColeta(dep: DependenciasDaColeta): Promise<ResumoDoCiclo> {
  const agora = relogio(dep)();
  const nome = dep.nome ?? 'coleta';
  const estado = await emTransacao(dep.pool, null, async (c) => {
    await c.query(
      `insert into pulso_coleta (nome, versao, visto_em) values ($1, $2, $3)
       on conflict (nome) do update set versao = excluded.versao, visto_em = excluded.visto_em`,
      [nome, VERSAO_DA_COLETA, agora],
    );
    const cfg = await lerCalendario(c);
    const ok = await c.query<{ dia: string }>(
      `select distinct to_char(referencia, 'YYYY-MM-DD') as dia from importacoes
       where fonte = 'b3-cotahist' and situacao = 'ok' and referencia >= ($1::timestamptz - interval '20 days')::date`, [agora],
    );
    const tentativas = await c.query<{ dia: string; quando: Date }>(
      `select to_char(referencia, 'YYYY-MM-DD') as dia, max(terminada_em) as quando from importacoes
       where fonte = 'b3-cotahist' and situacao <> 'ok' and referencia >= ($1::timestamptz - interval '20 days')::date
       group by referencia`, [agora],
    );
    const selicHoje = await c.query(
      `select 1 from importacoes where fonte = 'bcb-selic' and (
         (situacao = 'ok' and (terminada_em at time zone 'America/Sao_Paulo')::date = ($1::timestamptz at time zone 'America/Sao_Paulo')::date)
         or (situacao <> 'ok' and terminada_em > $1::timestamptz - interval '1 hour')) limit 1`, [agora],
    );
    return {
      cfg,
      importados: new Set(ok.rows.map((l) => l.dia)),
      ultima: new Map(tentativas.rows.map((l) => [l.dia, new Date(l.quando).toISOString()])),
      selicEmDia: (selicHoje.rowCount ?? 0) > 0,
    };
  });

  const resumo: ResumoDoCiclo = { cotahist: {}, selic: 'em_dia', calculos: {} };
  // Selic primeiro: o cálculo das gregas do arquivo novo já sai com ela.
  // A do dia sai de manhã; antes das 9h buscar não traz nada novo.
  if (!estado.selicEmDia && partesEmBrasilia(agora).hora >= '09:00') resumo.selic = await coletarSelic(dep);
  for (const dia of diasParaColetar(agora, estado.cfg, estado.importados, estado.ultima).slice(-MAXIMO_POR_CICLO)) {
    resumo.cotahist[dia] = await coletarCotahist(dep, dia);
  }
  // Volatilidade implícita e gregas dos pregões que ainda não têm (ou ficaram sem Selic).
  const pendentes = await emTransacao(dep.pool, null, (c) => diasParaRecalcular(c, agora));
  for (const dia of pendentes) {
    try {
      const r = await emTransacao(dep.pool, null, (c) => calcularDia(c, dia, estado.cfg));
      resumo.calculos[dia] = r;
      dep.log?.(`Gregas ${dia}: ${r.calculadas} opções calculadas, ${r.semCalculo} sem cálculo`);
    } catch (e) {
      dep.log?.(`Gregas ${dia}: erro ${mensagem(e)}`);
    }
  }
  return resumo;
}
