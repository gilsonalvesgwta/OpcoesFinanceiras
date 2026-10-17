// Ponte com o MetaTrader 5 da corretora.
//
// Dois lados:
// - o usuário (logado) cria, lista e revoga as chaves da ponte, e lê as próprias
//   cotações e posições que chegaram por ela;
// - o robô dentro do MT5 (sem sessão, com "Authorization: Bearer <chave>") busca a
//   lista de ativos e envia cotações e posições.
// A chave aparece uma vez só, na criação; o banco guarda apenas o hash.
// Tudo que entra pela ponte é do dono da chave e só ele vê (dado da conta dele na corretora).
// A ponte é só leitura: não existe rota que envie ordem.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { lerLoteDaPonte, qualidadeDaPonte, situacaoDoMercado, type ConfiguracaoDoCalendario } from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, erroDoBanco } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import { hashDoToken, novoToken, tokenComFormatoValido } from '../seguranca.ts';

export const MAXIMO_DE_PONTES_ATIVAS = 3;
const UUID = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } as const;
const LIMITE_DE_CHAVES_ERRADAS_POR_IP = 30;

// Até a tabela de feriados existir (Fase 3), só fim de semana fica sem pregão.
const CALENDARIO: ConfiguracaoDoCalendario = {
  feriados: new Set(), sessaoPadrao: { abertura: '10:00', fechamento: '17:00' }, sessoesEspeciais: new Map(),
};

type LinhaDaPonte = {
  id: string; nome: string; criada_em: Date; revogada_em: Date | null; ultimo_contato_em: Date | null;
  versao: string | null; conta_login: string | null; conta_servidor: string | null; conta_corretora: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function rotasDaPonte(app: FastifyInstance, dep: Dependencias): Promise<void> {
  const { pool } = dep;

  function pontePublica(l: LinhaDaPonte, agora: Date, mercadoAberto: boolean) {
    return {
      id: l.id, nome: l.nome, criadaEm: iso(l.criada_em), revogadaEm: iso(l.revogada_em),
      ultimoContatoEm: iso(l.ultimo_contato_em), versao: l.versao,
      conta: { login: l.conta_login, servidor: l.conta_servidor, corretora: l.conta_corretora },
      estado: l.revogada_em ? 'revogada' : qualidadeDaPonte(iso(l.ultimo_contato_em), agora, mercadoAberto),
    };
  }

  // ---------- Lado do usuário ----------

  app.get('/api/ponte', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = new Date();
    const mercado = situacaoDoMercado(agora, CALENDARIO);
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query<LinhaDaPonte>(
        `select id, nome, criada_em, revogada_em, ultimo_contato_em, versao, conta_login, conta_servidor, conta_corretora
         from pontes_mt5 order by revogada_em is not null, criada_em desc limit 50`,
      );
      return { pontes: r.rows.map((l) => pontePublica(l, agora, mercado.aberto)), mercadoAberto: mercado.aberto };
    });
  });

  app.post('/api/ponte', {
    config: { politica: 'autenticado' },
    schema: { body: { type: 'object', additionalProperties: false, properties: { nome: { type: 'string', minLength: 1, maxLength: 60 } } } },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const nome = ((req.body as { nome?: string } | undefined)?.nome ?? 'MetaTrader 5').trim() || 'MetaTrader 5';
    const chave = novoToken();
    const id = await emTransacao(pool, s.usuarioId, async (c) => {
      // Trava a contagem por usuário para duas criações simultâneas não passarem do limite.
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`ponte:${s.usuarioId}`]);
      const ativas = Number((await c.query('select count(*) as n from pontes_mt5 where revogada_em is null')).rows[0]?.n ?? 0);
      if (ativas >= MAXIMO_DE_PONTES_ATIVAS) throw new ErroHttp(409, 'limite_de_pontes');
      const novo = (await c.query('insert into pontes_mt5 (user_id, nome, token_hash) values ($1, $2, $3) returning id', [s.usuarioId, nome, hashDoToken(chave)])).rows[0]?.id as string;
      await auditar(c, s, 'ponte.criada', { tipo: 'ponte_mt5', id: novo, depois: { nome } }, ipDe(req));
      return novo;
    });
    // A chave só aparece aqui. Perdeu? Revoga e cria outra.
    return reply.status(201).send({ id, nome, chave });
  });

  app.delete('/api/ponte/:id', {
    config: { politica: 'autenticado' },
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { id } = req.params as { id: string };
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query('update pontes_mt5 set revogada_em = now() where id = $1 and revogada_em is null', [id]);
      if (r.rowCount === 0) throw new ErroHttp(404, 'nao_encontrado');
      await auditar(c, s, 'ponte.revogada', { tipo: 'ponte_mt5', id }, ipDe(req));
      return { ok: true };
    });
  });

  // Cotações recebidas pela ponte, com a qualidade calculada agora (pelo pulso da ponte).
  app.get('/api/cotacoes', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    const agora = new Date();
    const mercado = situacaoDoMercado(agora, CALENDARIO);
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        `select q.codigo, q.ultimo, q.bid, q.ask, q.fechamento_anterior, q.volume, q.instante_fonte, q.recebido_em,
                p.ultimo_contato_em, p.revogada_em
         from cotacoes_ponte q join pontes_mt5 p on p.id = q.ponte_id
         order by q.codigo`,
      );
      return {
        agora: agora.toISOString(),
        mercadoAberto: mercado.aberto,
        cotacoes: r.rows.map((l) => ({
          codigo: l.codigo, provedor: 'mt5',
          ultimo: l.ultimo, bid: l.bid, ask: l.ask, fechamentoAnterior: l.fechamento_anterior,
          volume: l.volume === null ? null : Number(l.volume),
          instanteDaFonte: iso(l.instante_fonte), instanteDeRecebimento: iso(l.recebido_em),
          qualidade: l.revogada_em ? 'desconectado' : qualidadeDaPonte(iso(l.ultimo_contato_em), agora, mercado.aberto),
        })),
      };
    });
  });

  // Posições da conta na corretora, como o MT5 mostra (só leitura; não se confundem com as posições do sistema).
  app.get('/api/posicoes-corretora', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const r = await c.query(
        `select x.codigo, x.lado, x.quantidade, x.preco_medio, x.recebido_em, p.nome as ponte, p.conta_corretora
         from posicoes_ponte x join pontes_mt5 p on p.id = x.ponte_id
         order by x.codigo`,
      );
      return {
        posicoes: r.rows.map((l) => ({
          codigo: l.codigo, lado: l.lado, quantidade: Number(l.quantidade),
          precoMedio: Number(l.preco_medio), // centavos, pode ter fração
          recebidoEm: iso(l.recebido_em), ponte: l.ponte, corretora: l.conta_corretora,
        })),
      };
    });
  });

  // ---------- Lado do robô ----------

  async function chaveDoRobo(req: FastifyRequest): Promise<Buffer> {
    const ip = ipDe(req);
    const chaveIp = `ponte:${ip ?? 'desconhecido'}`;
    const bloqueio = (await emTransacao(pool, null, (c) => c.query('select app.tentativa_bloqueada($1) as ate', [chaveIp]))).rows[0]?.ate;
    if (bloqueio) throw new ErroHttp(429, 'muitas_tentativas', { tentarDepois: bloqueio });
    const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '');
    const chave = m?.[1];
    const hash = tokenComFormatoValido(chave) ? hashDoToken(chave) : null;
    const valida = hash
      ? (await emTransacao(pool, null, (c) => c.query('select 1 from app.ponte_por_token($1)', [hash]))).rowCount === 1
      : false;
    if (!valida || !hash) {
      await emTransacao(pool, null, (c) => c.query('select app.registrar_falha($1, $2)', [chaveIp, LIMITE_DE_CHAVES_ERRADAS_POR_IP]));
      throw new ErroHttp(401, 'chave_da_ponte_invalida');
    }
    return hash;
  }

  app.get('/api/ponte/simbolos', { config: { politica: 'publica' } }, async (req) => {
    const hash = await chaveDoRobo(req);
    const r = await emTransacao(pool, null, (c) => c.query('select s from app.simbolos_da_ponte($1) as s', [hash]));
    return { simbolos: r.rows.map((l) => l.s as string) };
  });

  app.post('/api/ponte/dados', { config: { politica: 'publica' }, bodyLimit: 512 * 1024 }, async (req) => {
    const hash = await chaveDoRobo(req);
    const lido = lerLoteDaPonte(req.body, new Date());
    if (!lido.ok) throw new ErroHttp(400, lido.erro);
    const { lote } = lido;
    try {
      const r = await emTransacao(pool, null, (c) => c.query(
        'select * from app.receber_da_ponte($1, $2, $3, $4, $5, $6)',
        [hash, ipDe(req), lote.versao, JSON.stringify(lote.conta), JSON.stringify(lote.cotacoes), lote.posicoes === null ? null : JSON.stringify(lote.posicoes)],
      ));
      const l = r.rows[0];
      return { gravadas: l.gravadas, ignoradas: l.ignoradas, posicoes: l.posicoes, descartadas: lote.avisos.length, avisos: [...new Set(lote.avisos)] };
    } catch (e) {
      // A chave pode ter sido revogada entre a conferência e a gravação.
      if (erroDoBanco(e) === 'ponte_invalida') throw new ErroHttp(401, 'chave_da_ponte_invalida');
      throw e;
    }
  });
}
