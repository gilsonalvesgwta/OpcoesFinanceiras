// Candidatos de rolagem de uma perna: séries do mesmo tipo nos próximos vencimentos,
// cada uma simulada (sair da perna inteira, entrar na série nova) e avaliada pelos
// critérios do usuário. Usado pela rota de sugestões (com a ponte MT5 do usuário) e pelo
// worker (só com o fechamento da B3). Ordem: vencimento e strike, nunca por crédito.

import {
  avaliarCandidato, precoParaAbrir, precoParaEncerrar, resumoDaAvaliacao, simularRolagem,
  type AnaliseDePayoff, type Carteira, type CriteriosDeRolagem,
} from '@wta/domain';
import { ErroHttp } from '../app.ts';
import type { Cliente } from '../banco.ts';
import { paraCotacao, type CotacaoDeSaida } from '../cotacoes.ts';

export type ArgumentosDosCandidatos = {
  est: { id: string; nome: string; ativo_objeto: string };
  carteira: Carteira;
  codigo: string;
  criterios: CriteriosDeRolagem;
  hoje: string;
  agora: Date;
  mesmoVencimento?: boolean;
  cotacoes: (codigos: string[]) => Promise<CotacaoDeSaida[]>;
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

function resumoDoPayoff(a: AnaliseDePayoff | null) {
  return a ? { pontosDeEquilibrio: a.pontosDeEquilibrio, lucroMaximo: a.lucroMaximo, perdaMaxima: a.perdaMaxima } : null;
}

export async function candidatosDeRolagem(c: Cliente, a: ArgumentosDosCandidatos) {
  const { est, carteira, codigo, criterios, hoje, agora } = a;
  const perna = carteira.get(codigo);
  if (!perna || perna.quantidade === 0) throw new ErroHttp(404, 'perna_nao_aberta');
  if (perna.tipo === 'ativo' || perna.strike === undefined || !perna.vencimento) throw new ErroHttp(400, 'so_opcao_rola');
  const dia = (await c.query(
    "select to_char(max(dia), 'YYYY-MM-DD') as dia from fechamentos where codigo = $1 and tipo_mercado = 10", [est.ativo_objeto],
  )).rows[0]?.dia as string | null;
  if (!dia) throw new ErroHttp(404, 'sem_fechamento');
  // Próximos três vencimentos depois do atual (e o atual, se pedido), mesmo tipo, strikes até ±30% do ativo.
  const vencimentos = (await c.query(
    `select distinct to_char(vencimento, 'YYYY-MM-DD') as vencimento from series_opcoes
     where ativo_objeto = $1 and tipo = $2 and visto_ultimo >= $3 and vencimento >= $3
       and (vencimento > $4::date or ($5 and vencimento = $4::date))
     order by 1 limit 4`, [est.ativo_objeto, perna.tipo, dia, perna.vencimento, a.mesmoVencimento === true],
  )).rows.map((l) => l.vencimento);
  const linhas = vencimentos.length ? (await c.query(
    `select s.codigo, s.strike, to_char(s.vencimento, 'YYYY-MM-DD') as vencimento, f.negocios, k.delta
     from series_opcoes s
     join fechamentos f on f.codigo = s.codigo and f.dia = $2
     left join calculos_opcoes k on k.codigo = s.codigo and k.dia = $2 and k.motivo is null
     join fechamentos a on a.codigo = $1 and a.dia = $2
     where s.ativo_objeto = $1 and s.tipo = $3 and s.vencimento = any($4::date[]) and s.codigo <> $5
       and s.strike between a.ultimo * 0.7 and a.ultimo * 1.3
     order by s.vencimento, s.strike limit 80`, [est.ativo_objeto, dia, perna.tipo, vencimentos, codigo],
  )).rows : [];
  const lista = await a.cotacoes([codigo, est.ativo_objeto, ...linhas.map((l) => l.codigo as string)]);
  const cotacoes = new Map(lista.map((x) => [x.codigo, x]));
  const ativo = cotacoes.get(est.ativo_objeto) ?? null;
  const quantidade = Math.abs(perna.quantidade);
  const lado = perna.quantidade > 0 ? 'compra' as const : 'venda' as const;
  const qPerna = cotacoes.get(codigo) ?? null;
  const saida = qPerna ? precoParaEncerrar(paraCotacao(qPerna), perna.quantidade > 0 ? 'comprada' : 'vendida', 'executavel_ou_ultimo') : null;

  const candidatos = [];
  for (const l of linhas) {
    const cq = cotacoes.get(l.codigo) ?? null;
    const entrada = cq ? precoParaAbrir(paraCotacao(cq), lado, 'executavel_ou_ultimo') : null;
    let liquido: number | null = null;
    let perdaPiorou: boolean | null = null;
    let depois = null;
    let avisos: string[] = [];
    if (saida?.ok && entrada?.ok) {
      try {
        const r = simularRolagem(carteira, {
          instante: agora.toISOString(),
          encerrar: [{ codigo, quantidade, preco: Math.round(saida.valor), estimativa: saida.estimativa }],
          abrir: [{ codigo: l.codigo, tipo: perna.tipo, strike: Number(l.strike), vencimento: l.vencimento, lado, quantidade, preco: Math.round(entrada.valor), multiplicador: perna.multiplicador, estimativa: entrada.estimativa }],
        });
        liquido = r.fluxo.liquido;
        avisos = r.avisos;
        depois = resumoDoPayoff(r.payoff.depois);
        if (r.payoff.antes && r.payoff.depois) {
          const a = r.payoff.antes.perdaMaxima;
          const d = r.payoff.depois.perdaMaxima;
          perdaPiorou = d.tipo === 'ilimitado' ? a.tipo !== 'ilimitado' : a.tipo === 'limitado' && d.valor < a.valor;
        }
      } catch {
        // candidato inválido para esta carteira: fica sem números
      }
    }
    const dias = Math.round((Date.parse(`${l.vencimento}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);
    const avaliacao = avaliarCandidato({
      codigo: l.codigo, strike: Number(l.strike), strikeAtual: perna.strike, dias, delta: l.delta === null ? null : Number(l.delta),
      negocios: l.negocios === null ? null : Number(l.negocios), bid: cq?.bid ?? null, ask: cq?.ask ?? null, liquido, perdaMaximaPiorou: perdaPiorou,
    }, criterios);
    candidatos.push({
      codigo: l.codigo, strike: Number(l.strike), vencimento: l.vencimento, dias,
      delta: l.delta === null ? null : Number(l.delta), negocios: Number(l.negocios), bid: cq?.bid ?? null, ask: cq?.ask ?? null, qualidade: cq?.qualidade ?? null,
      precoDeEntrada: entrada?.ok ? { valor: Math.round(entrada.valor), origem: entrada.origem, estimativa: entrada.estimativa } : null,
      liquido, payoffDepois: depois, avisos, criterios: avaliacao, resumo: resumoDaAvaliacao(avaliacao),
    });
  }
  return {
    agora: agora.toISOString(), dia,
    estrategia: { id: est.id, nome: est.nome, ativoObjeto: est.ativo_objeto },
    ativo,
    perna: {
      codigo, tipo: perna.tipo, strike: perna.strike, vencimento: perna.vencimento, quantidade: perna.quantidade, lado,
      precoDeSaida: saida?.ok ? { valor: Math.round(saida.valor), origem: saida.origem, estimativa: saida.estimativa } : null,
      qualidade: qPerna?.qualidade ?? null, instanteDaFonte: iso(qPerna?.instanteDaFonte ?? null),
    },
    criterios,
    candidatos,
    premissas: [
      `Séries do fechamento oficial da B3 de ${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}, mesmo tipo da perna, próximos vencimentos, strikes até 30% do preço do ativo.`,
      'Cada candidato simula sair da perna inteira pelo preço executável e entrar na série nova, na mesma quantidade e no mesmo lado, sem custos.',
      'Delta é calculado pelo sistema (Black-Scholes com a Selic) a partir do fechamento; sem cálculo, o critério fica "sem dado".',
      'A lista segue a ordem de vencimento e strike. Nenhum candidato é recomendado e nada vira ordem.',
    ],
  };
}
