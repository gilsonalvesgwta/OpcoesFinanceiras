// Coleta da brapi (worker): preço das AÇÕES durante o pregão, com cerca de 30 minutos de
// atraso, para quando a ponte MT5 não estiver ligada.
//
// - Só roda com a chave (BRAPI_API_KEY no worker) e só em dia de pregão, da abertura até
//   40 minutos depois do fechamento (o atraso da brapi).
// - Divide a cota do mês (BRAPI_LIMITE_MENSAL, padrão 14 000 de 15 000) pelos pregões
//   que faltam, para nunca estourar o plano gratuito.
// - A chave vai no cabeçalho Authorization e nunca aparece em registro nem na tela.

import {
  ATRASO_DA_BRAPI_MIN, consultasPorCiclo, diasDePregaoEntre, lerRespostaDaBrapi, partesEmBrasilia, sessaoDoDia, URL_DA_BRAPI,
  type ConfiguracaoDoCalendario,
} from '@wta/domain';
import { emTransacao, type Pool } from '../banco.ts';
import { lerCalendario } from '../calendario.ts';
import type { Buscar } from './coleta.ts';

export type ConfiguracaoDaBrapi = { chave: string; limiteMensal: number; maximoPorCiclo: number; intervaloMin: number };

export function configuracaoDaBrapi(env: Record<string, string | undefined> = process.env): ConfiguracaoDaBrapi | null {
  const chave = env.BRAPI_API_KEY?.trim();
  if (!chave) return null;
  const n = (v: string | undefined, padrao: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : padrao);
  return {
    chave,
    limiteMensal: n(env.BRAPI_LIMITE_MENSAL, 14_000),
    maximoPorCiclo: n(env.BRAPI_MAXIMO_POR_CICLO, 20),
    intervaloMin: n(env.COLETA_INTERVALO_MIN, 10),
  };
}

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Janela da coleta: da abertura até o fechamento + o atraso da brapi + 10 minutos.
export function dentroDaJanela(agora: Date, cfg: ConfiguracaoDoCalendario): boolean {
  const { dia, hora } = partesEmBrasilia(agora);
  const s = sessaoDoDia(dia, cfg);
  if (!s) return false;
  const m = minutos(hora);
  return m >= minutos(s.abertura) && m <= minutos(s.fechamento) + ATRASO_DA_BRAPI_MIN + 10;
}

function ultimoDiaDoMes(dia: string): string {
  const [a, m] = dia.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export type ResumoDaBrapi = { situacao: 'sem_chave' | 'fora_da_janela' | 'sem_codigos' | 'sem_cota' | 'ok' | 'chave_recusada' | 'erro'; consultas: number; gravadas: number; falhas: number };

export async function cicloDaBrapi(pool: Pool, buscar: Buscar, agora: Date, conf: ConfiguracaoDaBrapi | null, log: (m: string) => void = () => undefined): Promise<ResumoDaBrapi> {
  const vazio = { consultas: 0, gravadas: 0, falhas: 0 };
  if (!conf) return { situacao: 'sem_chave', ...vazio };
  const cfg = await emTransacao(pool, null, lerCalendario);
  if (!dentroDaJanela(agora, cfg)) return { situacao: 'fora_da_janela', ...vazio };
  const { dia } = partesEmBrasilia(agora);
  const mes = dia.slice(0, 7);

  const { codigos, usadas } = await emTransacao(pool, null, async (c) => ({
    codigos: (await c.query<{ codigo: string }>('select codigo from app.codigos_para_brapi()')).rows.map((l) => l.codigo),
    usadas: Number((await c.query('select consultas from uso_brapi where mes = $1', [mes])).rows[0]?.consultas ?? 0),
  }));
  if (!codigos.length) return { situacao: 'sem_codigos', ...vazio };

  // Pregões que faltam no mês (contando hoje) × ciclos por pregão (pregão + atraso).
  const s = sessaoDoDia(dia, cfg);
  const ciclos = Math.ceil(((s ? minutos(s.fechamento) - minutos(s.abertura) : 420) + ATRASO_DA_BRAPI_MIN + 10) / conf.intervaloMin);
  const pregoes = 1 + diasDePregaoEntre(dia, ultimoDiaDoMes(dia), cfg);
  const cota = consultasPorCiclo({ restanteNoMes: conf.limiteMensal - usadas, pregoesRestantes: pregoes, ciclosPorPregao: ciclos, maximo: conf.maximoPorCiclo });
  if (cota === 0) return { situacao: 'sem_cota', ...vazio };

  // Revezamento: começa de um ponto diferente a cada ciclo para todos os códigos serem
  // atualizados quando a cota do ciclo não cobre a lista inteira (a lista vem por prioridade).
  const fatia = codigos.length <= cota ? codigos : (() => {
    const inicio = Math.floor(agora.getTime() / (conf.intervaloMin * 60_000)) * cota % codigos.length;
    return [...codigos, ...codigos].slice(inicio, inicio + cota);
  })();

  const r = { consultas: 0, gravadas: 0, falhas: 0 };
  let situacao: ResumoDaBrapi['situacao'] = 'ok';
  let ultimaFalha: string | null = null;
  for (const codigo of fatia) {
    r.consultas += 1;
    try {
      const resp = await buscar(`${URL_DA_BRAPI}?symbols=${encodeURIComponent(codigo)}`, {
        headers: { authorization: `Bearer ${conf.chave}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
      });
      if (resp.status === 401 || resp.status === 403) { situacao = 'chave_recusada'; ultimaFalha = `chave recusada pela brapi (${resp.status})`; break; }
      if (resp.status === 429) { situacao = 'erro'; ultimaFalha = 'limite da brapi atingido (429)'; break; }
      if (!resp.ok) { r.falhas += 1; ultimaFalha = `${codigo}: resposta ${resp.status}`; continue; }
      const lido = lerRespostaDaBrapi(await resp.json(), codigo);
      if (!lido.ok) { r.falhas += 1; ultimaFalha = `${codigo}: ${lido.motivo}`; continue; }
      const q = lido.cotacao;
      // Hora no futuro (relógio errado) ou velha demais (mais de 3 dias): não grava.
      const idade = agora.getTime() - Date.parse(q.instante);
      if (idade < -5 * 60_000 || idade > 3 * 86_400_000) { r.falhas += 1; ultimaFalha = `${codigo}: horário fora do esperado`; continue; }
      await emTransacao(pool, null, (c) => c.query(
        `insert into cotacoes_brapi (codigo, ultimo, fechamento_anterior, volume, instante_fonte, recebido_em) values ($1, $2, $3, $4, $5, $6)
         on conflict (codigo) do update set ultimo = excluded.ultimo, fechamento_anterior = excluded.fechamento_anterior, volume = excluded.volume,
           instante_fonte = excluded.instante_fonte, recebido_em = excluded.recebido_em
         where cotacoes_brapi.instante_fonte <= excluded.instante_fonte`,
        [codigo, q.ultimo, q.fechamentoAnterior, q.volume, q.instante, agora],
      ));
      r.gravadas += 1;
    } catch (e) {
      r.falhas += 1;
      ultimaFalha = `${codigo}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
    }
  }
  await emTransacao(pool, null, async (c) => {
    await c.query(
      `insert into uso_brapi (mes, consultas, ultima_falha, atualizado_em) values ($1, $2, $3, now())
       on conflict (mes) do update set consultas = uso_brapi.consultas + excluded.consultas, ultima_falha = coalesce(excluded.ultima_falha, uso_brapi.ultima_falha), atualizado_em = now()`,
      [mes, r.consultas, ultimaFalha],
    );
    // No diagnóstico: um registro por hora quando tudo vai bem, e todos os que têm falha.
    const primeiroDaHora = Number(partesEmBrasilia(agora).hora.slice(3, 5)) < conf.intervaloMin;
    if (situacao === 'ok' && r.falhas === 0 && !primeiroDaHora) return;
    await c.query(
      'insert into importacoes (fonte, referencia, situacao, registros, recusados, detalhe, iniciada_em, terminada_em) values ($1, $2, $3, $4, $5, $6, $7, now())',
      ['brapi', dia, situacao === 'ok' ? 'ok' : 'erro', r.gravadas, r.falhas,
        `${r.consultas} consultas (${usadas + r.consultas} no mês)${ultimaFalha ? `; ${ultimaFalha}` : ''}`.slice(0, 500), agora],
    );
  });
  if (situacao !== 'ok' || r.falhas) log(`brapi: ${situacao}, ${r.gravadas} gravadas, ${r.falhas} falhas${ultimaFalha ? ` (${ultimaFalha})` : ''}`);
  return { situacao, ...r };
}
