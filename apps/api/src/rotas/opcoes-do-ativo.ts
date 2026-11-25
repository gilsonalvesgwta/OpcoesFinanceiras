// Opções por ativo: o espaço exclusivo das opções de um ativo (BBAS3, PETR4...), com os
// números que importam: prêmio recebido e pago, resultado realizado e em aberto, prêmio
// líquido por mês, taxa de acerto, rendimento sobre as ações, pernas abertas (cobertas ou
// não) e o histórico por série e por operação. Tudo vem das execuções (notas, extrato da
// B3, Posições), então atualiza sozinho ao importar notas.

import type { FastifyInstance } from 'fastify';
import { consolidarCarteira, fluxoDasOpcoes, mesesNoPeriodo, resultadoEmAberto, resumoDasOpcoes, situacaoDoMercado } from '@wta/domain';
import { ErroHttp, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao } from '../banco.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { cotacoesDoUsuario } from '../cotacoes.ts';
import { paraDominio } from './posicoes.ts';

export async function rotasDasOpcoesDoAtivo(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  app.get('/api/opcoes-do-ativo/ativos', { config: { politica: 'autenticado' } }, async (req) => {
    const s = req.sessao as Sessao;
    return emTransacao(pool, s.usuarioId, async (c) => ({
      ativos: (await c.query(
        `select e.ativo_objeto as ativo, count(*)::int as operacoes from execucoes x join estrategias e on e.id = x.estrategia_id
         where x.tipo in ('call', 'put') group by 1 order by 2 desc, 1`,
      )).rows,
    }));
  });

  app.get('/api/opcoes-do-ativo', {
    config: { politica: 'autenticado' },
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['ativo'], properties: { ativo: { type: 'string', pattern: '^[A-Z0-9]{4,12}$' } } } },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { ativo } = req.query as { ativo: string };
    const agora = relogio();
    const cfg = await calendario.obter();
    const mercado = situacaoDoMercado(agora, cfg);
    const hoje = mercado.dia;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const linhas = (await c.query(
        `select x.codigo, x.tipo, x.strike, to_char(x.vencimento, 'YYYY-MM-DD') as vencimento, x.multiplicador, x.lado, x.quantidade, x.preco, x.custos,
                x.instante, x.observacao, e.situacao
         from execucoes x join estrategias e on e.id = x.estrategia_id where e.ativo_objeto = $1 order by x.instante, x.criada_em`, [ativo],
      )).rows;
      const opcoes = linhas.filter((l) => l.tipo !== 'ativo').map((l) => ({ ...paraDominio(l), observacao: l.observacao as string | null }));
      // Ações: só das estratégias abertas (a mesma conta da Minha carteira).
      const acoesExec = linhas.filter((l) => l.tipo === 'ativo' && l.situacao === 'aberta').map(paraDominio);
      let acao = null;
      try { acao = consolidarCarteira(acoesExec).find((p) => p.codigo === ativo) ?? null; } catch { acao = null; }

      const series = resumoDasOpcoes(opcoes);
      const abertas = series.filter((x) => x.quantidadeAberta !== 0 && x.vencimento >= hoje);
      const cot = new Map((await cotacoesDoUsuario(c, [ativo, ...new Set(abertas.map((x) => x.codigo))], agora, cfg)).map((q) => [q.codigo, q]));
      const spot = cot.get(ativo)?.ultimo ?? null;
      const callsVendidas = abertas.filter((x) => x.tipo === 'call' && x.quantidadeAberta < 0).reduce((t, x) => t - x.quantidadeAberta, 0);
      const acoes = acao && acao.quantidade > 0 ? acao.quantidade : 0;

      const seriesSaida = series.map((x) => {
        const q = cot.get(x.codigo) ?? null;
        const vencida = x.vencimento < hoje;
        const preco = x.quantidadeAberta === 0 || vencida || !q ? null : (x.quantidadeAberta > 0 ? q.bid : q.ask) ?? q.ultimo ?? null;
        const emAberto = preco === null ? null : resultadoEmAberto({ quantidade: x.quantidadeAberta, precoMedioComCustos: x.precoMedioComCustos, multiplicador: x.multiplicador }, preco).valor;
        const resultado = x.realizadoLiquido + (emAberto ?? 0);
        const dentro = spot === null ? null : x.tipo === 'call' ? spot > x.strike : spot < x.strike;
        return {
          ...x, vencida, encerrada: x.quantidadeAberta === 0, precoAgora: preco, emAberto, resultado, fracao: x.base > 0 ? resultado / x.base : null,
          diasAteVencimento: vencida ? null : Math.round((Date.parse(`${x.vencimento}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000),
          distancia: spot ? x.strike / spot - 1 : null, dentroDoDinheiro: dentro,
        };
      });
      const { operacoes, meses } = fluxoDasOpcoes(opcoes);
      const realizado = seriesSaida.reduce((t, x) => t + x.realizadoLiquido, 0);
      const emAberto = seriesSaida.reduce((t, x) => t + (x.emAberto ?? 0), 0);
      const encerradas = seriesSaida.filter((x) => x.encerrada);
      const vendas = meses.reduce((t, m) => t + m.vendas, 0);
      const compras = meses.reduce((t, m) => t + m.compras, 0);
      const custos = meses.reduce((t, m) => t + m.custos, 0);
      const liquido = meses.reduce((t, m) => t + m.liquido, 0);
      const nMeses = meses.length ? mesesNoPeriodo((meses[0] as { mes: string }).mes, hoje.slice(0, 7)) : 0;
      const custoAcoes = acao && acao.quantidade > 0 ? acao.custoDaPosicao : null;
      if (!opcoes.length && !acao) throw new ErroHttp(404, 'sem_operacoes_do_ativo');
      return {
        ativo, hoje, mercadoAberto: mercado.aberto,
        cotacao: (() => {
          const q = cot.get(ativo);
          if (!q) return null;
          return { ultimo: q.ultimo, variacao: q.ultimo !== null && q.fechamentoAnterior ? q.ultimo / q.fechamentoAnterior - 1 : null, qualidade: q.qualidade, provedor: q.provedor };
        })(),
        acao: acao && acao.quantidade !== 0 ? { quantidade: acao.quantidade, precoMedio: acao.precoMedio, precoMedioComCustos: acao.precoMedioComCustos, custo: acao.custoDaPosicao } : null,
        totais: {
          vendas, compras, custos, liquido, realizado, emAberto, resultado: realizado + emAberto,
          series: seriesSaida.length, encerradas: encerradas.length, comLucro: encerradas.filter((x) => x.resultado > 0).length,
          acerto: encerradas.length ? encerradas.filter((x) => x.resultado > 0).length / encerradas.length : null,
          meses: nMeses, mediaMensal: nMeses ? Math.round(liquido / nMeses) : null,
          rendimentoSobreAcoes: custoAcoes ? (realizado + emAberto) / custoAcoes : null,
          rendimentoMensal: custoAcoes && nMeses ? liquido / nMeses / custoAcoes : null,
          cobertura: { acoes, callsVendidas, descobertas: Math.max(0, callsVendidas - acoes) },
        },
        meses, series: seriesSaida, operacoes: operacoes.reverse().slice(0, 500),
      };
    });
  });
}
