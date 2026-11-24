// Extrato de negociação da B3 (Área do Investidor, exportado em Excel): todos os negócios
// de todas as corretoras. Dois passos, como as notas: /ler devolve a prévia (com o que já
// está no sistema e o que falta) e /importar grava. O arquivo não é guardado.
//
// - Strike: do cadastro de séries (inclui o histórico do arquivo anual da B3, que o worker
//   carrega uma vez por ano). Enquanto um ano ainda não foi carregado, a prévia avisa.
// - Exercício: entra a ação ao preço de exercício e a opção é encerrada a preço zero.
// - Opção vencida que ficou com quantidade (não aparece no extrato): virou pó; é encerrada
//   a preço zero no vencimento.
// - Sem custos: o extrato não traz. Ao importar depois a nota do mesmo negócio, ela
//   completa os custos desse negócio (não duplica).
// - Já no sistema: o mesmo dia, código, lado, quantidade e preço (contando repetições) não
//   entra de novo; importar o mesmo extrato duas vezes não duplica.

import type { FastifyInstance } from 'fastify';
import { lerExtratoDaB3, situacaoDoMercado, type NegocioDoExtrato } from '@wta/domain';
import { ErroHttp, ipDe, type Dependencias, type Sessao } from '../app.ts';
import { emTransacao, type Cliente } from '../banco.ts';
import { auditar } from '../auditoria.ts';
import type { CacheDoCalendario } from '../calendario.ts';
import { celulasDoXls, ehXls } from '../xls-celulas.ts';
import { celulasDoXlsx, ehXlsx } from '../xlsx-celulas.ts';
import { ativoPelaRaiz, estrategiaDaCarteira } from './carteira.ts';
import { conferirEstrategia, inserirExecucao } from './posicoes.ts';

export type NegocioPreparado = {
  linha: number; data: string; lado: 'compra' | 'venda'; mercado: NegocioDoExtrato['mercado'];
  codigo: string; tipo: 'ativo' | 'call' | 'put'; strike: number | null; vencimento: string | null; ativoObjeto: string | null;
  acao: string | null; // no exercício: a ação entregue/recebida
  quantidade: number; preco: number; valor: number; instituicao: string; falta: string[]; ja: boolean;
};

const chave = (data: string, codigo: string, lado: string, quantidade: number, preco: number) => `${data}|${codigo}|${lado}|${quantidade}|${preco}`;

// Quantas vezes cada negócio (dia, código, lado, quantidade, preço) já está nas execuções.
async function contagemNoSistema(c: Cliente): Promise<Map<string, number>> {
  const r = await c.query(
    `select to_char(instante at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, codigo, lado, quantidade, preco, count(*)::int as n
     from execucoes group by 1, 2, 3, 4, 5`,
  );
  return new Map(r.rows.map((l) => [chave(l.dia as string, l.codigo as string, l.lado as string, Number(l.quantidade), Number(l.preco)), Number(l.n)]));
}

async function preparar(c: Cliente, negocios: readonly NegocioDoExtrato[]): Promise<NegocioPreparado[]> {
  const opcoes = negocios.filter((n) => n.mercado !== 'vista' && n.mercado !== 'fracionario');
  const series = new Map<string, { strike: number; ativoObjeto: string | null; tipo: 'call' | 'put' }>();
  if (opcoes.length) {
    const r = await c.query(
      `select s.codigo, to_char(s.vencimento, 'YYYY-MM-DD') as vencimento, s.strike, s.ativo_objeto, s.tipo
       from series_opcoes s join unnest($1::text[], $2::date[]) as q(codigo, vencimento) on q.codigo = s.codigo and q.vencimento = s.vencimento`,
      [opcoes.map((n) => n.codigo), opcoes.map((n) => n.vencimento)],
    );
    for (const l of r.rows) series.set(`${l.codigo}|${l.vencimento}`, { strike: Number(l.strike), ativoObjeto: l.ativo_objeto as string | null, tipo: l.tipo as 'call' | 'put' });
  }
  const raizes = new Map<string, string | null>();
  const raiz = async (codigo: string) => {
    const k = codigo.slice(0, 4);
    if (!raizes.has(k)) raizes.set(k, await ativoPelaRaiz(c, k));
    return raizes.get(k) ?? null;
  };
  const noSistema = await contagemNoSistema(c);
  const r: NegocioPreparado[] = [];
  for (const n of negocios) {
    const falta: string[] = [];
    let tipo: NegocioPreparado['tipo'] = 'ativo';
    let strike: number | null = null;
    let ativoObjeto: string | null = null;
    let acao: string | null = null;
    if (n.mercado === 'vista' || n.mercado === 'fracionario') ativoObjeto = n.codigo;
    else {
      tipo = n.mercado === 'opcao_compra' || n.mercado === 'exercicio_compra' ? 'call' : 'put';
      const s = n.vencimento ? series.get(`${n.codigo}|${n.vencimento}`) : undefined;
      strike = s?.strike ?? (n.mercado.startsWith('exercicio') ? n.preco : null); // no exercício, o preço é o strike
      ativoObjeto = s?.ativoObjeto ?? await raiz(n.codigo);
      if (n.mercado.startsWith('exercicio')) acao = ativoObjeto;
      if (!n.vencimento) falta.push('vencimento');
      if (strike === null) falta.push('strike');
      if (!ativoObjeto) falta.push('ativo_objeto');
    }
    // O que conta como "já no sistema": no exercício, a ação ao preço de exercício.
    const k = chave(n.data, acao ?? n.codigo, n.lado, n.quantidade, n.preco);
    const disponivel = noSistema.get(k) ?? 0;
    if (disponivel > 0) noSistema.set(k, disponivel - 1);
    r.push({
      linha: n.linha, data: n.data, lado: n.lado, mercado: n.mercado, codigo: n.codigo, tipo, strike, vencimento: n.vencimento, ativoObjeto, acao,
      quantidade: n.quantidade, preco: n.preco, valor: n.valor, instituicao: n.instituicao, falta, ja: disponivel > 0,
    });
  }
  return r;
}

// Anos de negócios com opção sem strike cujo cadastro histórico ainda não foi carregado.
async function anosPendentes(c: Cliente, negocios: readonly NegocioPreparado[]): Promise<number[]> {
  const anos = [...new Set(negocios.filter((n) => n.falta.includes('strike')).map((n) => Number((n.vencimento ?? n.data).slice(0, 4))))];
  if (!anos.length) return [];
  const ok = new Set((await c.query(
    "select distinct extract(year from referencia)::int as ano from importacoes where fonte = 'b3-series-anual' and situacao = 'ok'",
  )).rows.map((l) => Number(l.ano)));
  return anos.filter((a) => !ok.has(a)).sort();
}

export async function rotasDoExtratoB3(app: FastifyInstance, dep: Dependencias, calendario: CacheDoCalendario): Promise<void> {
  const { pool } = dep;
  const relogio = dep.relogio ?? (() => new Date());

  app.post('/api/extrato-b3/ler', {
    config: { politica: 'autenticado' },
    bodyLimit: 15 * 1024 * 1024,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['arquivo'],
        properties: { arquivo: { type: 'object', additionalProperties: false, required: ['nome', 'conteudo'], properties: { nome: { type: 'string', maxLength: 200 }, conteudo: { type: 'string', maxLength: 14_000_000 } } } },
      },
    },
  }, async (req) => {
    const s = req.sessao as Sessao;
    const { arquivo } = req.body as { arquivo: { nome: string; conteudo: string } };
    const bytes = Buffer.from(arquivo.conteudo, 'base64');
    let lido;
    try {
      const celulas = ehXlsx(bytes) ? celulasDoXlsx(bytes) : ehXls(bytes) ? celulasDoXls(bytes) : null;
      if (!celulas) throw new ErroHttp(400, 'extrato_nao_e_planilha');
      lido = lerExtratoDaB3(celulas);
    } catch (e) {
      if (e instanceof ErroHttp) throw e;
      throw new ErroHttp(400, 'extrato_ilegivel');
    }
    if ('erro' in lido) throw new ErroHttp(400, lido.erro);
    const ext = lido;
    return emTransacao(pool, s.usuarioId, async (c) => {
      const negocios = await preparar(c, ext.negocios);
      return { de: ext.de, ate: ext.ate, negocios, ignorados: ext.ignorados, anosPendentes: await anosPendentes(c, negocios) };
    });
  });

  const NEGOCIO = {
    type: 'object', additionalProperties: true,
    required: ['data', 'lado', 'mercado', 'codigo', 'tipo', 'quantidade', 'preco', 'ativoObjeto'],
    properties: {
      data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, lado: { enum: ['compra', 'venda'] },
      mercado: { enum: ['vista', 'fracionario', 'opcao_compra', 'opcao_venda', 'exercicio_compra', 'exercicio_venda'] },
      codigo: { type: 'string', pattern: '^[A-Z0-9]{4,12}$' }, tipo: { enum: ['ativo', 'call', 'put'] },
      strike: { type: ['integer', 'null'], minimum: 1 }, vencimento: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      ativoObjeto: { type: 'string', pattern: '^[A-Z0-9]{4,12}$' }, acao: { type: ['string', 'null'] },
      quantidade: { type: 'integer', minimum: 1, maximum: 100_000_000 }, preco: { type: 'integer', minimum: 0, maximum: 1e11 },
    },
  } as const;

  app.post('/api/extrato-b3/importar', {
    config: { politica: 'autenticado' },
    bodyLimit: 4 * 1024 * 1024,
    schema: { body: { type: 'object', additionalProperties: false, required: ['negocios'], properties: { negocios: { type: 'array', minItems: 1, maxItems: 5000, items: NEGOCIO } } } },
  }, async (req, reply) => {
    const s = req.sessao as Sessao;
    const cfg = await calendario.obter();
    const hoje = situacaoDoMercado(relogio(), cfg).dia;
    const lista = [...(req.body as { negocios: NegocioPreparado[] }).negocios]
      .sort((a, b) => a.data.localeCompare(b.data) || b.linha - a.linha); // o extrato vem do mais novo para o mais antigo
    for (const n of lista) {
      if (n.tipo !== 'ativo' && (!n.strike || !n.vencimento)) throw new ErroHttp(400, 'opcao_sem_strike_ou_vencimento', { codigo: n.codigo });
      if (n.data > hoje) throw new ErroHttp(400, 'data_no_futuro', { codigo: n.codigo });
    }
    const resultado = await emTransacao(pool, s.usuarioId, async (c) => {
      const noSistema = await contagemNoSistema(c);
      const estrategias = new Set<string>();
      const opcoesTocadas = new Map<string, { estrategia: string; codigo: string; tipo: 'call' | 'put'; strike: number; vencimento: string }>();
      let inseridos = 0; let jaExistiam = 0; let exercicios = 0;
      const porDia = new Map<string, number>();
      const instante = (data: string, base: string) => {
        const k = (porDia.get(data) ?? 0) + 1;
        porDia.set(data, k);
        return new Date(Date.parse(`${data}T${base}-03:00`) + k * 1000).toISOString();
      };
      for (const n of lista) {
        const k = chave(n.data, n.acao ?? n.codigo, n.lado, n.quantidade, n.preco);
        const disp = noSistema.get(k) ?? 0;
        if (disp > 0) { noSistema.set(k, disp - 1); jaExistiam += 1; continue; }
        const est = await estrategiaDaCarteira(c, s.usuarioId, n.ativoObjeto as string);
        estrategias.add(est);
        const obs = `Extrato B3${n.instituicao ? ` · ${n.instituicao.slice(0, 60)}` : ''}`;
        if (n.mercado === 'exercicio_compra' || n.mercado === 'exercicio_venda') {
          // A ação ao preço de exercício e a opção encerrada a zero (call: quem vende a ação
          // estava vendido na call; put: quem compra a ação estava vendido na put).
          const acao = n.acao ?? n.ativoObjeto as string;
          const t = instante(n.data, '17:30:00');
          await inserirExecucao(c, s.usuarioId, est, { codigo: acao, tipo: 'ativo', lado: n.lado, quantidade: n.quantidade, preco: n.preco, custos: 0, instante: t, observacao: `${obs} · exercício de ${n.codigo}` }, 'extrato_b3');
          const ladoOpcao = n.tipo === 'call' ? (n.lado === 'venda' ? 'compra' : 'venda') : (n.lado === 'compra' ? 'compra' : 'venda');
          await inserirExecucao(c, s.usuarioId, est, {
            codigo: n.codigo, tipo: n.tipo, strike: n.strike as number, vencimento: n.vencimento as string, lado: ladoOpcao, quantidade: n.quantidade, preco: 0, custos: 0,
            instante: new Date(Date.parse(t) + 500).toISOString(), observacao: `${obs} · exercida`,
          }, 'extrato_b3');
          exercicios += 1;
        } else {
          await inserirExecucao(c, s.usuarioId, est, {
            codigo: n.codigo, tipo: n.tipo, lado: n.lado, quantidade: n.quantidade, preco: n.preco, custos: 0, instante: instante(n.data, '10:00:00'), observacao: obs,
            ...(n.tipo !== 'ativo' ? { strike: n.strike as number, vencimento: n.vencimento as string } : {}),
          }, 'extrato_b3');
        }
        if (n.tipo !== 'ativo') opcoesTocadas.set(`${est}|${n.codigo}|${n.vencimento}`, { estrategia: est, codigo: n.codigo, tipo: n.tipo, strike: n.strike as number, vencimento: n.vencimento as string });
        inseridos += 1;
      }
      // Vencidas com quantidade: viraram pó (o extrato não mostra o vencimento sem exercício).
      let viraramPo = 0;
      for (const o of opcoesTocadas.values()) {
        if (o.vencimento >= hoje) continue;
        const q = Number((await c.query(
          `select coalesce(sum(case when lado = 'compra' then quantidade else -quantidade end), 0)::int as q from execucoes where estrategia_id = $1 and codigo = $2 and vencimento = $3`,
          [o.estrategia, o.codigo, o.vencimento],
        )).rows[0]?.q ?? 0);
        if (q === 0) continue;
        await inserirExecucao(c, s.usuarioId, o.estrategia, {
          codigo: o.codigo, tipo: o.tipo, strike: o.strike, vencimento: o.vencimento, lado: q > 0 ? 'venda' : 'compra', quantidade: Math.abs(q), preco: 0, custos: 0,
          instante: new Date(`${o.vencimento}T18:00:00-03:00`).toISOString(), observacao: 'Venceu sem exercício (virou pó)',
        }, 'extrato_b3');
        viraramPo += 1;
      }
      for (const e of estrategias) {
        try {
          await conferirEstrategia(c, e);
        } catch (x) {
          if (!(x instanceof ErroHttp)) throw x;
          const codigo = typeof x.extra?.codigo === 'string' ? x.extra.codigo : null;
          const versoes = codigo ? (await c.query(
            `select distinct strike, to_char(vencimento, 'YYYY-MM-DD') as vencimento from execucoes where estrategia_id = $1 and codigo = $2`, [e, codigo],
          )).rows.map((v) => ({ strike: v.strike === null ? null : Number(v.strike), vencimento: v.vencimento as string | null })) : [];
          throw new ErroHttp(x.status, x.codigo, { ...x.extra, versoes });
        }
      }
      const r = { inseridos, jaExistiam, exercicios, viraramPo };
      await auditar(c, s, 'extrato_b3.importado', { tipo: 'execucoes', depois: r }, ipDe(req));
      return r;
    });
    return reply.status(201).send(resultado);
  });
}
