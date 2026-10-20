// Avaliação das regras de alerta quando chega cotação nova. Roda DENTRO de uma
// transação com o dono identificado (RLS): só alcança as regras dele.
// Estado, evento e aviso são gravados na mesma transação; a chave do disparo
// (regra + versão + número) impede evento e aviso em dobro se a mesma cotação
// for processada de novo.

import {
  avaliar, CAMPOS_DE_INDICADOR, descreverCondicao, ESTADO_INICIAL, indicadoresDoMomento, partesEmBrasilia, textoDoAviso, valoresDaCotacao,
  type Barra, type Condicao, type EstadoDaRegra, type PoliticaDeRearme, type Qualidade, type Regra,
} from '@wta/domain';
import type { Cliente } from '../banco.ts';

export type CotacaoParaAlerta = {
  codigo: string;
  instante: string; // ISO, da fonte
  qualidade: Qualidade;
  ultimo: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  fechamentoAnterior: number | null;
};

type LinhaDaRegra = {
  id: string; nome: string; codigo: string; condicao: Condicao; rearme: PoliticaDeRearme; limite_por_dia: number;
  aceitar_periodica: boolean; janela_inicio: string | null; janela_fim: string | null; versao: number;
  estado: EstadoDaRegra | null; estado_versao: number | null;
};

export function regraDaLinha(l: Pick<LinhaDaRegra, 'id' | 'versao' | 'condicao' | 'rearme' | 'limite_por_dia' | 'aceitar_periodica' | 'janela_inicio' | 'janela_fim'>): Regra {
  return {
    id: l.id, versao: l.versao, condicao: l.condicao, rearme: l.rearme, limitePorDia: l.limite_por_dia,
    aceitarAtualizacaoPeriodica: l.aceitar_periodica,
    ...(l.janela_inicio && l.janela_fim ? { janela: { inicio: l.janela_inicio, fim: l.janela_fim } } : {}),
  };
}

const INDICADORES = new Set<string>(CAMPOS_DE_INDICADOR);
function usaIndicador(c: Condicao): boolean {
  return c.tipo === 'comparacao' ? INDICADORES.has(c.campo) : c.filhos.some(usaIndicador);
}

// Histórico diário (pregões anteriores ao dia da cotação) para os indicadores.
async function historico(c: Cliente, codigo: string, antesDe: string): Promise<Barra[]> {
  const r = await c.query<{ dia: string; maxima: string | null; minima: string | null; ultimo: string | null; quantidade: string | null }>(
    `select to_char(dia, 'YYYY-MM-DD') as dia, maxima, minima, ultimo, quantidade from fechamentos
     where codigo = $1 and tipo_mercado = 10 and dia < $2 order by dia desc limit 220`, [codigo, antesDe],
  );
  const n = (v: string | null) => (v === null ? null : Number(v));
  return r.rows.reverse().map((l) => ({ dia: l.dia, maxima: n(l.maxima), minima: n(l.minima), fechamento: n(l.ultimo), quantidade: n(l.quantidade) }));
}

export async function avaliarCotacoes(c: Cliente, userId: string, cotacoes: CotacaoParaAlerta[], fonte: string): Promise<{ avaliadas: number; disparos: number }> {
  if (cotacoes.length === 0) return { avaliadas: 0, disparos: 0 };
  const codigos = [...new Set(cotacoes.map((q) => q.codigo))];
  const regras = (await c.query<LinhaDaRegra>(
    `select r.id, r.nome, r.codigo, r.condicao, r.rearme, r.limite_por_dia, r.aceitar_periodica, r.janela_inicio, r.janela_fim, r.versao,
            e.estado, e.versao as estado_versao
     from regras_alerta r left join estados_alerta e on e.regra_id = r.id
     where r.ativa and r.codigo = any($1::text[])
     order by r.id
     for update of r`, [codigos],
  )).rows;
  let avaliadas = 0;
  let disparos = 0;
  const historicos = new Map<string, Barra[]>();
  for (const linha of regras) {
    const regra = regraDaLinha(linha);
    // Regra editada (versão nova) recomeça do estado inicial.
    let estado: EstadoDaRegra = linha.estado && linha.estado_versao === linha.versao ? linha.estado : ESTADO_INICIAL;
    const doCodigo = cotacoes.filter((q) => q.codigo === linha.codigo).sort((a, b) => a.instante.localeCompare(b.instante));
    let mudou = false;
    for (const q of doCodigo) {
      let valores = valoresDaCotacao(q);
      if (usaIndicador(linha.condicao)) {
        const dia = partesEmBrasilia(new Date(q.instante)).dia;
        const chave = `${q.codigo}:${dia}`;
        if (!historicos.has(chave)) historicos.set(chave, await historico(c, q.codigo, dia));
        valores = { ...valores, ...indicadoresDoMomento(historicos.get(chave) as Barra[], q.ultimo, q.volume) };
      }
      const a = avaliar(regra, estado, { instante: q.instante, qualidade: q.qualidade, valores });
      avaliadas += 1;
      if (a.estado !== estado) mudou = true;
      estado = a.estado;
      if (!a.disparo) continue;
      const evento = (await c.query<{ id: string }>(
        `insert into eventos_alerta (regra_id, user_id, chave, codigo, descricao, instante, qualidade, fonte, valores)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (chave) do nothing returning id`,
        [linha.id, userId, a.disparo.chave, linha.codigo, descreverCondicao(linha.condicao), a.disparo.instante, a.disparo.qualidade, fonte, JSON.stringify(a.disparo.valores)],
      )).rows[0];
      if (!evento) continue; // já processado antes
      disparos += 1;
      await c.query(
        `insert into avisos (user_id, evento_id, canal, chave, texto) values ($1, $2, 'telegram', $3, $4) on conflict (chave) do nothing`,
        [userId, evento.id, `telegram:${a.disparo.chave}`, textoDoAviso({ codigo: linha.codigo, nomeDaRegra: linha.nome, condicao: linha.condicao, obs: a.disparo, fonte })],
      );
      if (a.estado.encerrada) await c.query('update regras_alerta set ativa = false, atualizada_em = now() where id = $1', [linha.id]);
    }
    if (mudou || linha.estado_versao !== linha.versao) {
      await c.query(
        `insert into estados_alerta (regra_id, user_id, versao, estado, atualizado_em) values ($1, $2, $3, $4, now())
         on conflict (regra_id) do update set versao = excluded.versao, estado = excluded.estado, atualizado_em = now()`,
        [linha.id, userId, linha.versao, JSON.stringify(estado)],
      );
    }
  }
  return { avaliadas, disparos };
}
