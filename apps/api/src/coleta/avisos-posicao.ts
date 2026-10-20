// Avisos das posições (worker): vencimento chegando, opção vendida perto do strike,
// calls sem cobertura e, com consentimento, sugestões de rolagem.
//
// - Roda no papel wtaopt_coleta: as posições chegam por app.posicoes_para_avisos() e os
//   eventos são gravados por app.registrar_evento_posicao() (uma vez por chave).
// - Preços: só o fechamento oficial da B3 (o worker não alcança a ponte de ninguém).
// - Só manda entre 08:00 e 21:00 de Brasília: nada de aviso de madrugada.
// - Nenhuma sugestão vira ordem; a mensagem diz de onde vieram os preços.

import {
  avisosDasEstrategias, diasDePregaoEntre, lerPreferencias, montarCarteira, partesEmBrasilia,
  type CriteriosDeRolagem, type EstrategiaParaAvisos, type Execucao,
} from '@wta/domain';
import { emTransacao, type Pool } from '../banco.ts';
import { lerCalendario } from '../calendario.ts';
import { cotacoesDaB3 } from '../cotacoes.ts';
import { candidatosDeRolagem } from '../rolagem/candidatos.ts';

export const JANELA_DOS_AVISOS = { inicio: '08:00', fim: '21:00' };

type Linha = { user_id: string; preferencias: unknown; criterios: unknown; estrategia_id: string; nome: string; ativo_objeto: string; execucoes: Record<string, unknown>[] };

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function paraExecucao(x: Record<string, unknown>): Execucao {
  return {
    codigo: x.codigo as string, tipo: x.tipo as Execucao['tipo'], lado: x.lado as Execucao['lado'], quantidade: Number(x.quantidade),
    preco: Number(x.preco), custos: Number(x.custos), multiplicador: Number(x.multiplicador), instante: new Date(x.instante as string).toISOString(),
    ...(x.strike !== null && x.strike !== undefined ? { strike: Number(x.strike) } : {}),
    ...(x.vencimento ? { vencimento: x.vencimento as string } : {}),
  };
}

// Critérios guardados pelo usuário (o mesmo formato que a rota de sugestões aceita).
export function lerCriterios(x: unknown): CriteriosDeRolagem {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  const k: CriteriosDeRolagem = {};
  const num = (n: unknown, min: number, max: number) => (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : undefined);
  const set = <K extends keyof CriteriosDeRolagem>(chave: K, v: CriteriosDeRolagem[K] | undefined) => { if (v !== undefined) k[chave] = v; };
  set('diasMin', num(o.diasMin, 0, 1000));
  set('diasMax', num(o.diasMax, 0, 1000));
  set('deltaMin', num(o.deltaMin, 0, 1));
  set('deltaMax', num(o.deltaMax, 0, 1));
  set('creditoMinimo', num(o.creditoMinimo, -100_000_000, 100_000_000));
  set('debitoMaximo', num(o.debitoMaximo, 0, 100_000_000));
  set('negociosMin', num(o.negociosMin, 0, 1_000_000));
  set('spreadMaximoPct', num(o.spreadMaximoPct, 0, 200));
  if (o.strike === 'manter' || o.strike === 'acima' || o.strike === 'abaixo' || o.strike === 'qualquer') k.strike = o.strike;
  if (o.perdaMaximaNaoAumenta === true) k.perdaMaximaNaoAumenta = true;
  return k;
}

export type ResumoDosAvisos = { fora_da_janela?: true; estrategias: number; eventos: number; sugestoes: number };

export async function cicloDeAvisosDePosicao(pool: Pool, agora: Date, log: (m: string) => void = () => undefined): Promise<ResumoDosAvisos> {
  const { dia: hoje, hora } = partesEmBrasilia(agora);
  if (hora < JANELA_DOS_AVISOS.inicio || hora >= JANELA_DOS_AVISOS.fim) return { fora_da_janela: true, estrategias: 0, eventos: 0, sugestoes: 0 };
  return emTransacao(pool, null, async (c) => {
    const cfg = await lerCalendario(c);
    const linhas = (await c.query('select * from app.posicoes_para_avisos()')).rows as Linha[];
    const resumo: ResumoDosAvisos = { estrategias: linhas.length, eventos: 0, sugestoes: 0 };
    if (!linhas.length) return resumo;

    const ativos = [...new Set(linhas.map((l) => l.ativo_objeto))];
    const spots = new Map((await cotacoesDaB3(c, ativos, cfg)).map((q) => [q.codigo, q]));
    const spot = (ativo: string) => {
      const q = spots.get(ativo);
      return q?.ultimo ? { valor: q.ultimo, dia: (q.instanteDaFonte ?? '').slice(0, 10) } : null;
    };
    const diasAte = (v: string) => diasDePregaoEntre(hoje, v, cfg);

    const porUsuario = new Map<string, Linha[]>();
    for (const l of linhas) porUsuario.set(l.user_id, [...(porUsuario.get(l.user_id) ?? []), l]);

    for (const [userId, dele] of porUsuario) {
      const pref = lerPreferencias(dele[0]?.preferencias);
      const criterios = lerCriterios(dele[0]?.criterios);
      const estrategias: EstrategiaParaAvisos[] = [];
      for (const l of dele) {
        try {
          estrategias.push({ id: l.estrategia_id, nome: l.nome, ativoObjeto: l.ativo_objeto, carteira: montarCarteira(l.execucoes.map(paraExecucao)) });
        } catch {
          // execuções que não fecham entre si: a tela de Posições já mostra; aqui só pula
        }
      }
      const eventos = avisosDasEstrategias(estrategias, { hoje, diasDePregaoAte: diasAte, spot }, pref);
      for (const e of eventos) {
        const novo = (await c.query(
          'select app.registrar_evento_posicao($1, $2, $3, $4, $5, $6, $7, $8, $9) as novo',
          [userId, e.estrategiaId, e.tipo, e.codigo, e.chave, e.titulo, e.texto, JSON.stringify(e.valores), pref.telegram],
        )).rows[0]?.novo === true;
        if (novo) resumo.eventos += 1;

        // Sugestão de rolagem: só com consentimento, só para vencimento de opção vendida, uma por limite.
        if (!pref.sugestoes || e.tipo !== 'vencimento' || !novo) continue;
        const est = estrategias.find((x) => x.id === e.estrategiaId);
        const perna = est?.carteira.get(e.codigo);
        if (!est || !perna || perna.quantidade >= 0) continue;
        await c.query('savepoint sugestao');
        try {
          const r = await candidatosDeRolagem(c, {
            est: { id: est.id, nome: est.nome, ativo_objeto: est.ativoObjeto }, carteira: est.carteira, codigo: e.codigo, criterios, hoje, agora,
            cotacoes: (codigos) => cotacoesDaB3(c, codigos, cfg),
          });
          const atendem = r.candidatos.filter((x) => x.resumo.todos && x.liquido !== null);
          const lista = atendem.slice(0, 3).map((x) => `${x.codigo} (strike ${reais(x.strike)}, ${x.vencimento.slice(8, 10)}/${x.vencimento.slice(5, 7)}): ${x.liquido! >= 0 ? `crédito de R$ ${reais(x.liquido!)}` : `débito de R$ ${reais(-x.liquido!)}`}`);
          const semCriterios = Object.keys(criterios).length === 0;
          const texto = atendem.length
            ? `${atendem.length} ${atendem.length === 1 ? 'série atende' : 'séries atendem'} a ${semCriterios ? 'nenhum critério definido (todas entram)' : 'todos os seus critérios'} para rolar ${e.codigo} em "${est.nome}": ${lista.join('; ')}${atendem.length > 3 ? '; e outras' : ''}. Ordem por vencimento e strike, sem recomendação. Preços do fechamento da B3 de ${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)}; crédito não é lucro. Compare em Rolagens antes de decidir; nada foi enviado à corretora.`
            : `Nenhuma série atende a todos os seus critérios para rolar ${e.codigo} em "${est.nome}" (fechamento da B3 de ${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)}). Veja as alternativas em Rolagens.`;
          const ok = (await c.query(
            'select app.registrar_evento_posicao($1, $2, $3, $4, $5, $6, $7, $8, $9) as novo',
            [userId, est.id, 'sugestao_rolagem', e.codigo, `sug:${e.chave}`, `Rolagem de ${e.codigo}: ${atendem.length} ${atendem.length === 1 ? 'opção' : 'opções'} nos seus critérios`, texto,
              JSON.stringify({ candidatos: atendem.slice(0, 10).map((x) => ({ codigo: x.codigo, strike: x.strike, vencimento: x.vencimento, liquido: x.liquido })), dia: r.dia }), pref.telegram],
          )).rows[0]?.novo === true;
          if (ok) resumo.sugestoes += 1;
          await c.query('release savepoint sugestao');
        } catch (erro) {
          await c.query('rollback to savepoint sugestao');
          log(`sugestão de rolagem de ${e.codigo}: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
      }
    }
    return resumo;
  });
}
