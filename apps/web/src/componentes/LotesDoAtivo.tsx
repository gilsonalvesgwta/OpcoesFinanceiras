'use client';

// Lotes de uma ação na Minha carteira, por faixa de preço: quanto você tem em cada faixa
// de custo, onde estão o preço médio e o preço de agora, e a call sugerida para cobrir a
// faixa inteira (strike que não fica abaixo do lote mais caro da faixa). Ajuda a montar a
// venda coberta por partes. A lista completa dos lotes fica recolhida. É referência, não
// recomendação, e nada envia ordem.

import Link from 'next/link';
import { useState } from 'react';
import { formatarData, formatarReais } from '../lib/formatos.ts';
import { pctBr, type ItemDaCarteira } from '../lib/carteira.ts';
import { faixasDosLotes, linkParaSimularLote } from '../lib/lotes.ts';

const reais = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const sinal = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${formatarReais(v)}`);

export function LotesDoAtivo({ ativo, acao, callsVendidas }: { ativo: string; acao: ItemDaCarteira; callsVendidas: number }) {
  const [todos, setTodos] = useState(false);
  const lotes = [...(acao.lotes ?? [])].sort((a, b) => a.precoComCustos - b.precoComCustos);
  if (!lotes.length) return null;
  const faixas = faixasDosLotes(lotes, acao.preco, acao.precoMedioComCustos);
  const maior = Math.max(...faixas.map((f) => f.quantidade));
  const cobertas = Math.min(callsVendidas, acao.quantidade);
  const livres = acao.quantidade - cobertas;

  return (
    <section className="lotes" aria-labelledby={`lotes-${ativo}`}>
      <div className="lotes-topo">
        <h3 id={`lotes-${ativo}`}>Seus lotes de {ativo} por faixa de preço</h3>
        <span className="lotes-rotulo">
          {lotes.length} lote{lotes.length > 1 ? 's' : ''} · {acao.quantidade.toLocaleString('pt-BR')} ações
          {cobertas > 0 ? ` · ${cobertas.toLocaleString('pt-BR')} já cobertas por calls, ${livres.toLocaleString('pt-BR')} livres` : ''}
        </span>
        <span className="faixa-marcas">
          <span className="faixa-selo pm">seu preço médio R$ {reais(acao.precoMedioComCustos)}</span>
          {acao.preco !== null && <span className="faixa-selo agora">preço agora R$ {reais(acao.preco)}</span>}
        </span>
      </div>

      <ol className="faixas" aria-label={`Faixas de preço dos lotes de ${ativo}`}>
        {faixas.map((f) => {
          const lucro = acao.preco !== null && acao.preco >= f.custoMedio;
          const s = f.sugestao;
          return (
            <li key={f.de} className="faixa">
              <div className="faixa-cabeca">
                <span className="faixa-preco">
                  <strong>R$ {reais(f.de)} a {reais(f.ate)}</strong>
                  <span className="lotes-rotulo">custo médio R$ {reais(f.custoMedio)}</span>
                </span>
                <span className="faixa-barra" aria-hidden="true">
                  <span style={{ width: `${Math.max(4, (f.quantidade / maior) * 100)}%`, background: acao.preco === null ? 'var(--apoio)' : lucro ? 'var(--alta)' : 'var(--baixa)' }} />
                </span>
                <span className="faixa-qtd">
                  <strong>{f.quantidade.toLocaleString('pt-BR')}</strong>
                  <span className="lotes-rotulo">{f.lotes.length} lote{f.lotes.length > 1 ? 's' : ''}</span>
                </span>
                <span className={`faixa-resultado ${classe(f.resultado)}`}>
                  {sinal(f.resultado)}<small>{pctBr(f.resultadoFracao)}</small>
                </span>
              </div>
              {(f.temPm || f.temAgora) && (
                <div className="faixa-marcas">
                  {f.temAgora && <span className="faixa-selo agora">o preço de agora está nesta faixa</span>}
                  {f.temPm && <span className="faixa-selo pm">seu preço médio está nesta faixa</span>}
                </div>
              )}
              {s ? (
                <div className="faixa-sugestao">
                  <span className="faixa-sugestao-texto">
                    <span className="lotes-rotulo">Para cobrir esta faixa</span>
                    <span>Vender <strong>{f.quantidade.toLocaleString('pt-BR')} × {s.codigo}</strong> · strike R$ {reais(s.strike)} · vence {formatarData(s.vencimento)} ({s.dias} d)</span>
                  </span>
                  <span className="faixa-numeros">
                    <span><span className="lotes-rotulo">Prêmio</span>{s.premio !== null ? `R$ ${reais(s.premio)}` : 'sem oferta'}</span>
                    <span><span className="lotes-rotulo">Você recebe</span>{formatarReais(s.receitaDaFaixa)}</span>
                    <span className={classe(s.seExercidoDaFaixa)}><span className="lotes-rotulo">Se exercido</span>{sinal(s.seExercidoDaFaixa)} <small>{pctBr(s.fracaoSeExercido)}</small></span>
                  </span>
                  <Link className="botao botao-pequeno" href={linkParaSimularLote(ativo, { quantidade: f.quantidade, precoComCustos: f.custoMedio }, s)}>Simular</Link>
                </div>
              ) : (
                <p className="lotes-rotulo faixa-sem">Sem call mensal com strike acima do custo desta faixa no próximo vencimento.</p>
              )}
            </li>
          );
        })}
      </ol>

      <button type="button" className="botao-texto" aria-expanded={todos} onClick={() => setTodos((x) => !x)}>
        {todos ? 'Esconder os lotes' : `Ver os ${lotes.length} lotes, um por um`}
      </button>
      {todos && (
        <div className="tabela-caixa" tabIndex={0} role="region" aria-label={`Lotes de ${ativo}`}>
          <table className="tabela">
            <thead><tr><th scope="col">Comprado em</th><th scope="col" className="numero">Ações</th><th scope="col" className="numero">Preço</th><th scope="col" className="numero">Com custos</th><th scope="col" className="numero">Custo</th><th scope="col" className="numero">Resultado</th><th scope="col" className="numero">%</th></tr></thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.instante}>
                  <td>{formatarData(l.data)}</td>
                  <td className="numero">{l.quantidade.toLocaleString('pt-BR')}{l.quantidade < l.quantidadeOriginal ? <span className="sub">de {l.quantidadeOriginal.toLocaleString('pt-BR')}</span> : null}</td>
                  <td className="numero">{reais(l.preco)}</td>
                  <td className="numero">{reais(l.precoComCustos)}</td>
                  <td className="numero">{formatarReais(l.custo)}</td>
                  <td className={`numero ${classe(l.resultado)}`}>{sinal(l.resultado)}</td>
                  <td className={`numero ${classe(l.resultadoFracao)}`}>{pctBr(l.resultadoFracao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
