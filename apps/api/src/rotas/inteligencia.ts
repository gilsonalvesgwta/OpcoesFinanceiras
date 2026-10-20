// Inteligência operacional: preferências e eventos dos avisos das posições, histórico
// unificado (com exportação em CSV), desempenho das regras de alerta e cenários "e se".
// Tudo do dono (RLS). Nada aqui envia ordem.

import type { FastifyInstance } from 'fastify';
import {
  diasDePregaoEntre, gradeDeCenarios, lerPreferencias, montarCarteira, situacaoDoMercado, taxaContinua,
} from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario } from '../cotacoes.ts';
import { lerCriterios } from '../coleta/avisos-posicao.ts';
import { paraDominio, UUID } from './posicoes.ts';

const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const TIPOS_DO_HISTORICO = ['operacao', 'rolagem', 'alerta', 'posicao'] as const;
type TipoDoHistorico = typeof TIPOS_DO_HISTORICO[number];

export type ItemDoHistorico = {
  tipo: TipoDoHistorico; instante: string; codigo: string | null; estrategia: string | null;
  titulo: string; detalhe: string | null; valor: number | null; custos: number | null;
};

// CSV para planilha em português: separador ";", vírgula decimal, aspas quando preciso.
export function csvDoHistorico(itens: readonly ItemDoHistorico[]): string {
  const NOMES: Record<TipoDoHistorico, string> = { operacao: 'Operação', rolagem: 'Rolagem', alerta: 'Alerta', posicao: 'Aviso de posição' };
  const campo = (v: string | null) => {
    const t = v ?? '';
    return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const linhas = itens.map((i) => [
    data.format(new Date(i.instante)).replace(',', ''), NOMES[i.tipo], i.codigo, i.estrategia, i.titulo, i.detalhe,
    i.valor === null ? null : reais(i.valor).replaceAll('.', ''), i.custos === null ? null : reais(i.custos).replaceAll('.', ''),
  ].map((x) => campo(x)).join(';'));
  // BOM para o Excel abrir com acentos.
  return `﻿Data;Tipo;Código;Estratégia;O que houve;Detalhe;Valor (R$);Custos (R$)\r\n${linhas.join('\r\n')}${linhas.length ? '\r\n' : ''}`;
}

export async function rotasDeInteligencia(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  // ---------- Preferências dos avisos das posições ----------

  app.get('/api/avisos-posicao/preferencias', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const p = (await c.query('select preferencias, criterios, atualizado_em from preferencias_avisos where user_id = $1', [s.usuarioId])).rows[0];
      const telegram = (await c.query('select 1 from vinculos_telegram where user_id = $1', [s.usuarioId])).rows.length > 0;
      return { preferencias: lerPreferencias(p?.preferencias), criterios: lerCriterios(p?.criterios), salvo: !!p, telegramVinculado: telegram };
    });
  });

  app.put('/api/avisos-posicao/preferencias', {
    config: { politica: 'autenticado' },
    schema: {
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          preferencias: {
            type: 'object', additionalProperties: false,
            properties: {
              vencimento: { type: 'boolean' }, diasAntes: { type: 'array', maxItems: 4, items: { type: 'integer', minimum: 0, maximum: 30 } },
              risco: { type: 'boolean' }, distanciaStrikePct: { type: 'number', minimum: 0, maximum: 20 }, descoberta: { type: 'boolean' },
              sugestoes: { type: 'boolean' }, telegram: { type: 'boolean' },
            },
          },
          criterios: { type: 'object', maxProperties: 12 },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const b = req.body as { preferencias?: Record<string, unknown>; criterios?: Record<string, unknown> };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const atual = (await c.query('select preferencias, criterios from preferencias_avisos where user_id = $1 for update', [s.usuarioId])).rows[0];
      const antes = lerPreferencias(atual?.preferencias);
      const preferencias = lerPreferencias({ ...antes, ...(b.preferencias ?? {}) });
      const criterios = b.criterios !== undefined ? lerCriterios(b.criterios) : lerCriterios(atual?.criterios);
      await c.query(
        `insert into preferencias_avisos (user_id, preferencias, criterios) values ($1, $2, $3)
         on conflict (user_id) do update set preferencias = excluded.preferencias, criterios = excluded.criterios, atualizado_em = now()`,
        [s.usuarioId, JSON.stringify(preferencias), JSON.stringify(criterios)],
      );
      // O consentimento para sugestões fica registrado com data na auditoria.
      await auditar(c, s, antes.sugestoes !== preferencias.sugestoes ? (preferencias.sugestoes ? 'avisos_posicao.sugestoes_autorizadas' : 'avisos_posicao.sugestoes_desligadas') : 'avisos_posicao.preferencias',
        { tipo: 'preferencias_avisos', id: s.usuarioId, antes, depois: { ...preferencias, criterios } }, ipDe(req));
      return { preferencias, criterios };
    });
  });

  // ---------- Eventos das posições ----------

  app.get('/api/avisos-posicao', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = (await c.query(
        `select v.id, v.tipo, v.codigo, v.titulo, v.texto, v.valores, v.lido_em, v.criado_em, v.estrategia_id, e.nome as estrategia,
                a.situacao as aviso
         from eventos_posicao v left join estrategias e on e.id = v.estrategia_id
         left join avisos a on a.evento_posicao_id = v.id
         order by v.criado_em desc limit 50`,
      )).rows;
      const naoLidos = Number((await c.query('select count(*) as n from eventos_posicao where lido_em is null')).rows[0]?.n ?? 0);
      return {
        naoLidos,
        eventos: r.map((l) => ({
          id: Number(l.id), tipo: l.tipo, codigo: l.codigo, titulo: l.titulo, texto: l.texto, valores: l.valores,
          lido: l.lido_em !== null, criadoEm: iso(l.criado_em), estrategiaId: l.estrategia_id, estrategia: l.estrategia, aviso: l.aviso,
        })),
      };
    });
  });

  app.post('/api/avisos-posicao/lidos', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, properties: { ids: { type: 'array', maxItems: 200, items: { type: 'integer', minimum: 1 } } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const b = req.body as { ids?: number[] };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = b.ids
        ? await c.query('update eventos_posicao set lido_em = now() where lido_em is null and id = any($1::bigint[])', [b.ids])
        : await c.query('update eventos_posicao set lido_em = now() where lido_em is null');
      return { marcados: r.rowCount ?? 0 };
    });
  });

  // ---------- Histórico unificado ----------

  app.get('/api/historico', {
    config: { politica: 'autenticado' },
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          tipos: { type: 'string', pattern: '^(operacao|rolagem|alerta|posicao)(,(operacao|rolagem|alerta|posicao)){0,3}$' },
          codigo: { type: 'string', pattern: '^[A-Za-z0-9]{1,12}$' },
          de: DIA, ate: DIA,
          formato: { type: 'string', enum: ['json', 'csv'] },
        },
      },
    },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const q = req.query as { tipos?: string; codigo?: string; de?: string; ate?: string; formato?: 'json' | 'csv' };
    const tipos = new Set((q.tipos ?? TIPOS_DO_HISTORICO.join(',')).split(',') as TipoDoHistorico[]);
    if (q.de && q.ate && q.de > q.ate) throw new ErroHttp(400, 'periodo_invalido');
    const de = q.de ? `${q.de}T00:00:00-03:00` : '2000-01-01T00:00:00Z';
    const ate = q.ate ? new Date(Date.parse(`${q.ate}T00:00:00-03:00`) + 86_400_000).toISOString() : '9999-12-31T00:00:00Z';
    const codigo = q.codigo ? `%${q.codigo.toUpperCase()}%` : '%';
    const limite = q.formato === 'csv' ? 5000 : 500;
    const itens = await emTransacao(pool, s.usuarioId, async (c) => {
      const lista: ItemDoHistorico[] = [];
      if (tipos.has('operacao')) {
        const r = await c.query(
          `select x.instante, x.codigo, e.nome, x.tipo, x.strike, x.lado, x.quantidade, x.preco, x.custos, x.multiplicador, x.origem, x.rolagem_id, x.observacao
           from execucoes x join estrategias e on e.id = x.estrategia_id
           where x.instante >= $1 and x.instante < $2 and x.codigo like $3 order by x.instante desc limit $4`, [de, ate, codigo, limite],
        );
        for (const l of r.rows) {
          const q2 = Number(l.quantidade);
          lista.push({
            tipo: 'operacao', instante: iso(l.instante) as string, codigo: l.codigo, estrategia: l.nome,
            titulo: `${l.lado === 'compra' ? 'Compra' : 'Venda'} de ${q2.toLocaleString('pt-BR')} ${l.codigo} a R$ ${reais(Number(l.preco))}`,
            detalhe: [l.rolagem_id ? 'parte de uma rolagem' : null, l.origem === 'importada_mt5' ? 'importada do MetaTrader 5' : null, l.observacao].filter(Boolean).join(' · ') || null,
            valor: (l.lado === 'venda' ? 1 : -1) * q2 * Number(l.multiplicador) * Number(l.preco), custos: Number(l.custos),
          });
        }
      }
      if (tipos.has('rolagem')) {
        const r = await c.query(
          `select r.instante, r.resumo, r.observacao, e.nome from rolagens r join estrategias e on e.id = r.estrategia_id
           where r.instante >= $1 and r.instante < $2 and ($3 = '%' or exists (select 1 from execucoes x where x.rolagem_id = r.id and x.codigo like $3))
           order by r.instante desc limit $4`, [de, ate, codigo, limite],
        );
        for (const l of r.rows) {
          const pernas = (l.resumo?.pernas ?? []) as { codigo: string; lado: string; quantidade: number; preco: number }[];
          const liquido = l.resumo?.fluxo?.liquido;
          lista.push({
            tipo: 'rolagem', instante: iso(l.instante) as string, codigo: pernas.map((p) => p.codigo).join(' → ') || null, estrategia: l.nome,
            titulo: typeof liquido === 'number' ? (liquido > 0 ? `Rolagem com crédito de R$ ${reais(liquido)}` : liquido < 0 ? `Rolagem com débito de R$ ${reais(-liquido)}` : 'Rolagem sem crédito nem débito') : 'Rolagem',
            detalhe: [pernas.map((p) => `${p.lado === 'compra' ? 'compra' : 'venda'} ${p.quantidade} ${p.codigo} a ${reais(p.preco)}`).join(', '), l.observacao].filter(Boolean).join(' · ') || null,
            valor: typeof liquido === 'number' ? liquido : null, custos: typeof l.resumo?.fluxo?.custos === 'number' ? l.resumo.fluxo.custos : null,
          });
        }
      }
      if (tipos.has('alerta')) {
        const r = await c.query(
          `select v.instante, v.codigo, v.descricao, v.valores, v.qualidade, r.nome, a.situacao
           from eventos_alerta v left join regras_alerta r on r.id = v.regra_id left join avisos a on a.evento_id = v.id
           where v.instante >= $1 and v.instante < $2 and v.codigo like $3 order by v.instante desc limit $4`, [de, ate, codigo, limite],
        );
        for (const l of r.rows) {
          lista.push({
            tipo: 'alerta', instante: iso(l.instante) as string, codigo: l.codigo, estrategia: null,
            titulo: `Alerta${l.nome ? ` "${l.nome}"` : ''}: ${l.descricao}`,
            detalhe: [`dado ${l.qualidade}`, l.situacao ? `Telegram: ${l.situacao}` : null].filter(Boolean).join(' · '),
            valor: typeof l.valores?.ultimo === 'number' ? l.valores.ultimo : null, custos: null,
          });
        }
      }
      if (tipos.has('posicao')) {
        const r = await c.query(
          `select v.criado_em, v.codigo, v.titulo, v.texto, e.nome from eventos_posicao v left join estrategias e on e.id = v.estrategia_id
           where v.criado_em >= $1 and v.criado_em < $2 and v.codigo like $3 order by v.criado_em desc limit $4`, [de, ate, codigo, limite],
        );
        for (const l of r.rows) {
          lista.push({ tipo: 'posicao', instante: iso(l.criado_em) as string, codigo: l.codigo, estrategia: l.nome, titulo: l.titulo, detalhe: l.texto, valor: null, custos: null });
        }
      }
      return lista.sort((a, b) => b.instante.localeCompare(a.instante)).slice(0, limite);
    });
    if (q.formato === 'csv') {
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="historico-wta-${situacaoDoMercado(relogio(), await calendario.obter()).dia}.csv"`)
        .send(csvDoHistorico(itens));
    }
    return { itens, limite, cortado: itens.length >= limite };
  });

  // ---------- Desempenho das regras de alerta ----------
  // Quantas vezes cada regra avisou e o que o preço fez até o fechamento oficial do pregão
  // seguinte. É só retrospecto: não mede acerto nem promete nada.

  app.get('/api/alertas/desempenho', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        `with ev as (
           select v.id, v.regra_id, v.codigo, v.instante, (v.valores->>'ultimo')::numeric as preco,
                  (select f.ultimo from fechamentos f where f.codigo = v.codigo and f.dia > (v.instante at time zone 'America/Sao_Paulo')::date order by f.dia limit 1) as depois,
                  a.situacao
           from eventos_alerta v left join avisos a on a.evento_id = v.id
           where v.instante >= now() - interval '90 days'
         )
         select r.id, r.nome, r.codigo, r.ativa,
                count(ev.id)::int as disparos,
                count(*) filter (where ev.situacao = 'enviado')::int as enviados,
                count(*) filter (where ev.situacao in ('falhou', 'sem_destino'))::int as nao_entregues,
                max(ev.instante) as ultimo,
                count(ev.depois) filter (where ev.preco > 0)::int as amostras,
                avg((ev.depois - ev.preco) / ev.preco * 100) filter (where ev.preco > 0 and ev.depois is not null) as media_pct,
                avg(case when ev.depois > ev.preco then 100.0 else 0 end) filter (where ev.preco > 0 and ev.depois is not null) as subiu_pct
         from regras_alerta r left join ev on ev.regra_id = r.id
         group by r.id order by disparos desc, r.nome`,
      );
      return {
        periodoDias: 90,
        regras: r.rows.map((l) => ({
          id: l.id, nome: l.nome, codigo: l.codigo, ativa: l.ativa, disparos: l.disparos, enviados: l.enviados, naoEntregues: l.nao_entregues,
          ultimo: iso(l.ultimo), amostras: l.amostras,
          mediaPct: l.media_pct === null ? null : Math.round(Number(l.media_pct) * 100) / 100,
          subiuPct: l.subiu_pct === null ? null : Math.round(Number(l.subiu_pct)),
        })),
        premissas: [
          'Últimos 90 dias. "Depois" é o fechamento oficial da B3 do pregão seguinte ao aviso, comparado ao preço do momento do aviso.',
          'É retrospecto, não mede acerto da regra nem indica resultado futuro.',
        ],
      };
    });
  });

  // ---------- Cenários "e se" ----------

  app.post('/api/posicoes/:id/cenarios', {
    config: { politica: 'autenticado' },
    schema: {
      params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } },
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          volPct: { type: 'number', minimum: 1, maximum: 300 },
          variacoesPct: { type: 'array', minItems: 1, maxItems: 15, items: { type: 'number', minimum: -90, maximum: 300 } },
        },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { volPct?: number; variacoesPct?: number[] };
    const agora = relogio();
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(agora, cfg).dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const est = (await c.query('select id, nome, ativo_objeto from estrategias where id = $1', [id])).rows[0];
      if (!est) throw new ErroHttp(404, 'nao_encontrado');
      const execs = (await c.query(
        `select codigo, tipo, strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento, multiplicador, lado, quantidade, preco, custos, instante
         from execucoes where estrategia_id = $1`, [id],
      )).rows.map(paraDominio);
      let carteira: ReturnType<typeof montarCarteira>;
      try { carteira = montarCarteira(execs); } catch { throw new ErroHttp(409, 'estrategia_inconsistente'); }
      const abertas = [...carteira.values()].filter((i) => i.quantidade !== 0);
      if (!abertas.length) throw new ErroHttp(409, 'sem_pernas_abertas');
      const [ativo] = await cotacoesDoUsuario(c, [est.ativo_objeto], agora, cfg);
      const spot = ativo?.ultimo ?? null;
      if (!spot) throw new ErroHttp(409, 'sem_preco_do_ativo');
      const selic = (await c.query("select to_char(dia, 'YYYY-MM-DD') as dia, valor::float8 as valor from taxas_juros where serie = 'selic' order by dia desc limit 1")).rows[0];
      if (!selic) throw new ErroHttp(409, 'sem_selic');
      const opcoes = abertas.filter((i) => i.tipo !== 'ativo');
      const vols = new Map<string, { valor: number; origem: string }>();
      if (b.volPct !== undefined) {
        for (const i of opcoes) vols.set(i.codigo, { valor: b.volPct / 100, origem: 'informada por você' });
      } else if (opcoes.length) {
        const r = await c.query(
          `select distinct on (codigo) codigo, vol_implicita, to_char(dia, 'YYYY-MM-DD') as dia from calculos_opcoes
           where codigo = any($1::text[]) and motivo is null order by codigo, dia desc`, [opcoes.map((i) => i.codigo)],
        );
        for (const l of r.rows) vols.set(l.codigo, { valor: Number(l.vol_implicita), origem: `implícita do fechamento de ${l.dia.slice(8, 10)}/${l.dia.slice(5, 7)}` });
      }
      const ate = (v: string) => diasDePregaoEntre(hoje, v, cfg);
      const primeiro = opcoes.map((i) => i.vencimento as string).sort()[0];
      const d = primeiro ? Math.max(0, ate(primeiro)) : 0;
      const colunas = [{ rotulo: 'Hoje', pregoes: 0 }];
      if (d >= 4) colunas.push({ rotulo: `Em ${Math.floor(d / 2)} pregões`, pregoes: Math.floor(d / 2) });
      if (d > 0) colunas.push({ rotulo: `No vencimento (${primeiro!.slice(8, 10)}/${primeiro!.slice(5, 7)})`, pregoes: d });
      const variacoes = (b.variacoesPct ?? [-20, -15, -10, -5, 0, 5, 10, 15, 20]).map((x) => x / 100);
      const grade = gradeDeCenarios(carteira, spot, [...new Set(variacoes)].sort((x, y) => x - y), colunas, {
        taxa: taxaContinua(Number(selic.valor) / 100), vol: (codigo) => vols.get(codigo)?.valor ?? null, diasDePregaoAte: ate,
      });
      return {
        estrategia: { id: est.id, nome: est.nome, ativoObjeto: est.ativo_objeto },
        ativo, grade,
        vols: opcoes.map((i) => ({ codigo: i.codigo, volPct: vols.has(i.codigo) ? Math.round((vols.get(i.codigo) as { valor: number }).valor * 1000) / 10 : null, origem: vols.get(i.codigo)?.origem ?? null })),
        selic: { dia: selic.dia, valor: Number(selic.valor) },
        premissas: [
          'Estimativa do modelo Black-Scholes: cada opção é recalculada com a volatilidade indicada, juros pela Selic e o tempo que sobra até o vencimento; no vencimento vale o valor intrínseco.',
          'O resultado é o da estratégia inteira: pernas abertas contra o preço médio, mais o realizado, menos os custos já pagos. Custos de saída não entram.',
          'Volatilidade constante: na prática ela muda com o preço e com o tempo. Opções americanas podem ser exercidas antes; o modelo não considera isso.',
        ],
      };
    });
  });
}
