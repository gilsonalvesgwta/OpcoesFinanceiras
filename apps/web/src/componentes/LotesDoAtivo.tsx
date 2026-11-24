'use client';

// Lotes de uma ação na Minha carteira: quanto custou cada compra que ainda está em
// carteira (além do preço médio geral), numa régua de preços e em cartões, com a call
// sugerida para cobrir cada lote (menor strike que não fica abaixo do custo do lote).
// Ajuda a montar a venda coberta por partes: 300 num strike perto de 20,15, 100 perto de
// 21,45, em vez de tudo num strike só. É referência, não recomendação, e nada envia ordem.

import Link from 'next/link';
import { formatarData, formatarReais } from '../lib/formatos.ts';
import { pctBr, type ItemDaCarteira, type LoteDaCarteira } from '../lib/carteira.ts';
import { escalaDosLotes, linkParaSimularLote } from '../lib/lotes.ts';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const sinal = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${formatarReais(v)}`);

function Regua({ acao, lotes }: { acao: ItemDaCarteira; lotes: LoteDaCarteira[] }) {
  const largura = 1000;
  const alturaEixo = 70;
  const strikes = [...new Set(lotes.map((l) => l.sugestao?.strike).filter((s): s is number => typeof s === 'number'))];
  const { x, marcas } = escalaDosLotes([...lotes.map((l) => l.precoComCustos), acao.precoMedioComCustos, ...(acao.preco !== null ? [acao.preco] : []), ...strikes], 40, largura - 40);
  const maior = Math.max(...lotes.map((l) => l.quantidade));
  const descricao = `Régua de preços de ${acao.codigo}: ${lotes.map((l) => `${l.quantidade} a ${reais(l.precoComCustos)}`).join('; ')}; preço médio ${reais(acao.precoMedioComCustos)}${acao.preco !== null ? `; agora ${reais(acao.preco)}` : ''}.`;
  return (
    <svg className="lotes-regua" viewBox={`0 0 ${largura} 150`} role="img" aria-label={descricao} preserveAspectRatio="xMidYMid meet">
      <line x1={40} x2={largura - 40} y1={alturaEixo} y2={alturaEixo} style={{ stroke: 'var(--linha)', strokeWidth: 2 }} />
      {marcas.map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={alturaEixo - 4} y2={alturaEixo + 4} style={{ stroke: 'var(--linha)' }} />
          <text x={x(m)} y={alturaEixo + 20} textAnchor="middle" style={{ fill: 'var(--apoio)', fontSize: 15 }}>{reais(m)}</text>
        </g>
      ))}
      {strikes.map((k) => (
        <g key={`k${k}`}>
          <path d={`M ${x(k)} ${alturaEixo + 30} l 7 7 l -7 7 l -7 -7 z`} style={{ fill: 'var(--latao)' }} />
          <text x={x(k)} y={alturaEixo + 62} textAnchor="middle" style={{ fill: 'var(--texto)', fontSize: 14 }}>strike {reais(k)}</text>
        </g>
      ))}
      <line x1={x(acao.precoMedioComCustos)} x2={x(acao.precoMedioComCustos)} y1={10} y2={alturaEixo + 8} style={{ stroke: 'var(--latao)', strokeWidth: 2, strokeDasharray: '6 5' }} />
      <text x={x(acao.precoMedioComCustos)} y={12} textAnchor="middle" style={{ fill: 'var(--latao)', fontSize: 15, fontWeight: 700 }}>PM {reais(acao.precoMedioComCustos)}</text>
      {acao.preco !== null && (
        <>
          <line x1={x(acao.preco)} x2={x(acao.preco)} y1={24} y2={alturaEixo + 8} style={{ stroke: 'var(--vivo)', strokeWidth: 2 }} />
          <text x={x(acao.preco)} y={30} textAnchor={x(acao.preco) > largura - 120 ? 'end' : 'start'} dx={x(acao.preco) > largura - 120 ? -6 : 6} style={{ fill: 'var(--vivo)', fontSize: 15, fontWeight: 700 }}>agora {reais(acao.preco)}</text>
        </>
      )}
      {lotes.map((l, i) => {
        const r = 7 + 11 * Math.sqrt(l.quantidade / maior);
        const ganha = acao.preco !== null && acao.preco >= l.precoComCustos;
        return (
          <g key={l.instante}>
            <circle cx={x(l.precoComCustos)} cy={alturaEixo} r={r} style={{ fill: acao.preco === null ? 'var(--apoio)' : ganha ? 'var(--alta)' : 'var(--baixa)', fillOpacity: 0.85, stroke: 'var(--painel)', strokeWidth: 2 }} />
            <text x={x(l.precoComCustos)} y={alturaEixo - r - 6 - (i % 2) * 16} textAnchor="middle" style={{ fill: 'var(--texto)', fontSize: 14, fontWeight: 600 }}>{l.quantidade.toLocaleString('pt-BR')}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function LotesDoAtivo({ ativo, acao, callsVendidas }: { ativo: string; acao: ItemDaCarteira; callsVendidas: number }) {
  const lotes = [...(acao.lotes ?? [])].sort((a, b) => a.precoComCustos - b.precoComCustos);
  if (!lotes.length) return null;
  const cobertas = Math.min(callsVendidas, acao.quantidade);
  return (
    <section className="lotes" aria-labelledby={`lotes-${ativo}`}>
      <div className="lotes-topo">
        <h3 id={`lotes-${ativo}`}>Seus lotes de {ativo}</h3>
        <div className="lotes-resumo">
          <span><span className="lotes-rotulo">Preço médio geral</span><strong>R$ {reais(acao.precoMedioComCustos)}</strong><span className="lotes-rotulo">sem custos R$ {reais(acao.precoMedio)}</span></span>
          <span><span className="lotes-rotulo">Agora</span><strong>{acao.preco !== null ? `R$ ${reais(acao.preco)}` : '—'}</strong><span className={`lotes-rotulo ${classe(acao.resultadoFracao)}`}>{pctBr(acao.resultadoFracao)} sobre o PM</span></span>
          <span><span className="lotes-rotulo">Em carteira</span><strong>{acao.quantidade.toLocaleString('pt-BR')} ações</strong><span className="lotes-rotulo">em {lotes.length} lote{lotes.length > 1 ? 's' : ''}{cobertas > 0 ? ` · ${cobertas.toLocaleString('pt-BR')} já cobertas por calls` : ''}</span></span>
        </div>
      </div>

      <Regua acao={acao} lotes={lotes} />
      <p className="lotes-legenda">
        <span><i className="lotes-ponto" style={{ background: 'var(--alta)' }} /> lote no lucro</span>
        <span><i className="lotes-ponto" style={{ background: 'var(--baixa)' }} /> lote no prejuízo</span>
        <span><i className="lotes-traco" /> preço médio geral</span>
        <span><i className="lotes-losango" /> strike sugerido</span>
        <span>Tamanho da bolinha = quantidade do lote.</span>
      </p>

      <div className="lotes-cartoes">
        {lotes.map((l) => {
          const s = l.sugestao;
          return (
            <article key={l.instante} className="lote-cartao">
              <header>
                <span className="lotes-rotulo">Comprado em {formatarData(l.data)}</span>
                <span className={`lote-resultado ${classe(l.resultado)}`}>{sinal(l.resultado)} <small>{pctBr(l.resultadoFracao)}</small></span>
              </header>
              <p className="lote-principal"><strong>{l.quantidade.toLocaleString('pt-BR')}</strong> ações a <strong>R$ {reais(l.preco)}</strong></p>
              <p className="lotes-rotulo" style={{ margin: 0 }}>
                com custos R$ {reais(l.precoComCustos)} · custo {formatarReais(l.custo)}
                {l.quantidade < l.quantidadeOriginal ? ` · eram ${l.quantidadeOriginal.toLocaleString('pt-BR')}, ${(l.quantidadeOriginal - l.quantidade).toLocaleString('pt-BR')} já vendidas` : ''}
              </p>
              {s ? (
                <div className="lote-sugestao">
                  <span className="lotes-rotulo">Para cobrir este lote</span>
                  <p style={{ margin: 0 }}>Vender <strong>{l.quantidade.toLocaleString('pt-BR')} × {s.codigo}</strong></p>
                  <p className="lotes-rotulo" style={{ margin: 0 }}>strike R$ {reais(s.strike)} · vence {formatarData(s.vencimento)} ({s.dias} dias)</p>
                  <dl>
                    <div><dt>Prêmio</dt><dd>{s.premio !== null ? <>R$ {reais(s.premio)} <small>{s.origemDoPremio === 'ultimo' ? '(último)' : '(bid)'}</small></> : 'sem oferta'}</dd></div>
                    <div><dt>Você recebe</dt><dd>{s.receita !== null ? <>{formatarReais(s.receita)} <small>{pctBr(s.premioFracao)}</small></> : '—'}</dd></div>
                    <div><dt>Se for exercido</dt><dd className={classe(s.seExercido)}>{sinal(s.seExercido)} <small>{pctBr(s.seExercidoFracao)}</small></dd></div>
                  </dl>
                  <Link className="botao botao-pequeno" href={linkParaSimularLote(ativo, l, s)}>Simular este lote</Link>
                </div>
              ) : (
                <p className="lotes-rotulo lote-sem-sugestao">Sem call mensal com strike acima do custo deste lote no próximo vencimento.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
