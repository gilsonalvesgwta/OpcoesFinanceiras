'use client';

// Painel do dia do ativo, ao lado da escolha no Simulador: preço de agora (MT5), variação
// em R$ e % contra o fechamento anterior, gráfico do período e os números do dia.

import { useCallback, useEffect, useState, type PointerEvent } from 'react';
import { chamar } from '../lib/api.ts';
import { SeloDoPreco } from './SeloDoPreco.tsx';
import { escalaDoPainel, extremosComAgora, marcasDeTempo, PERIODOS, variacao, type PainelDoAtivo as Dados, type Periodo } from '../lib/painel.ts';
import { precoDoAtivo, type CotacaoResumida } from '../lib/simulador.ts';

const reais = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const inteiro = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'));

export function PainelDoAtivo({ ativo, aoVivo }: { ativo: string; aoVivo: CotacaoResumida }) {
  const [periodo, setPeriodo] = useState<Periodo>('1D');
  const [dados, setDados] = useState<Dados | null>(null);
  const [mira, setMira] = useState<{ t: string; p: number } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await chamar<Dados>('GET', `/api/simulador/painel?ativo=${encodeURIComponent(ativo)}&periodo=${periodo}`);
      if (r.ativo === ativo && r.periodo === periodo) setDados(r);
    } catch {
      // sem dado do painel: a tela continua com a cadeia
    }
  }, [ativo, periodo]);

  useEffect(() => {
    setDados((d) => (d && d.ativo === ativo ? d : null));
    void carregar();
    // Números do dia e gráfico: a cada 30 s (o preço e a variação mudam a cada segundo, pela cadeia).
    const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, 30_000);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  const preco = precoDoAtivo(aoVivo) ?? dados?.cotacao.ultimo ?? null;
  const ref = dados?.fechamentoAnterior ?? null;
  const v = variacao(preco, ref);
  const sobe = v ? v.valor >= 0 : true;
  const { maxima, minima } = extremosComAgora(dados?.maxima ?? null, dados?.minima ?? null, aoVivo?.provedor === 'mt5' ? preco : null);
  // No 1D, o último ponto do gráfico é o preço de agora.
  const pontos = dados ? [...dados.pontos] : [];
  if (dados && periodo === '1D' && dados.mercadoAberto && preco !== null && aoVivo?.provedor === 'mt5') pontos.push({ t: new Date().toISOString(), p: preco });
  const e = dados ? escalaDoPainel(pontos, periodo, dados.hoje, dados.sessao, periodo === '1D' ? ref : null) : null;
  const subiuNoPeriodo = periodo === '1D' ? sobe : pontos.length > 1 ? (pontos[pontos.length - 1]?.p ?? 0) >= (pontos[0]?.p ?? 0) : sobe;
  const cor = subiuNoPeriodo ? 'var(--alta)' : 'var(--baixa)';
  const quando = aoVivo?.instanteDaFonte ?? dados?.cotacao.instanteDaFonte ?? null;

  return (
    <div className="painel-ativo" aria-label={`Painel do dia de ${ativo}`} role="group">
      <div className="painel-ativo-topo">
        <span className="painel-ativo-preco">{reais(preco)} <span className="painel-ativo-moeda">BRL</span></span>
        {v && (
          <span className={`painel-ativo-variacao ${sobe ? 'alta' : 'baixa'}`}>
            {sobe ? '↑' : '↓'} {Math.abs(v.fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
          </span>
        )}
        {v && <span className={sobe ? 'resultado-alta' : 'resultado-baixa'} style={{ fontWeight: 600 }}>{v.valor >= 0 ? '+' : '−'}{reais(Math.abs(v.valor))} hoje</span>}
      </div>
      <div className="linha-lista-apoio" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SeloDoPreco c={aoVivo ?? (dados ? { ...dados.cotacao } : null)} />
        {quando && <span>{new Date(quando).toLocaleString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' })}</span>}
        <span>· variação contra o fechamento anterior{ref !== null ? ` (${reais(ref)})` : ''}</span>
      </div>

      <div className="atalhos" role="group" aria-label="Período do gráfico">
        {PERIODOS.map((p) => (
          <button key={p} type="button" className={`botao-periodo${p === periodo ? ' atual' : ''}`} aria-pressed={p === periodo} onClick={() => setPeriodo(p)}>{p}</button>
        ))}
      </div>

      {e ? (
        <svg viewBox={`0 0 ${e.largura} ${e.altura}`} width="100%" className="painel-ativo-grafico" role="img"
          onPointerMove={(ev: PointerEvent<SVGSVGElement>) => {
            const r = ev.currentTarget.getBoundingClientRect();
            setMira(e.pontoEm(((ev.clientX - r.left) / r.width) * e.largura));
          }}
          onPointerLeave={() => setMira(null)}
          aria-label={`Gráfico ${periodo} de ${ativo}: de ${reais(pontos[0]?.p ?? null)} a ${reais(e.ultimo.p)}${ref !== null && periodo === '1D' ? `; fechamento anterior ${reais(ref)}` : ''}.`}>
          {e.marcas.map((val) => (
            <g key={val}>
              <line x1={e.m.e} x2={e.largura - e.m.d} y1={e.y(val)} y2={e.y(val)} stroke="var(--linha)" strokeWidth="1" />
              <text x={e.largura - e.m.d + 6} y={e.y(val) + 4} fontSize="12" fill="var(--apoio)">{reais(Math.round(val))}</text>
            </g>
          ))}
          {marcasDeTempo(e.t0, e.t1, periodo).map((mk) => (
            <text key={mk.t} x={e.x(mk.t)} y={e.altura - 6} fontSize="11" fill="var(--apoio)" textAnchor="middle">{mk.rotulo}</text>
          ))}
          {periodo === '1D' && ref !== null && (
            <g>
              <line x1={e.m.e} x2={e.largura - e.m.d} y1={e.y(ref)} y2={e.y(ref)} stroke="var(--apoio)" strokeDasharray="2 4" />
              <text x={e.largura - e.m.d - 4} y={e.y(ref) - 6} fontSize="11" fill="var(--apoio)" textAnchor="end">Fech. anterior {reais(ref)}</text>
            </g>
          )}
          <path d={e.area} fill={cor} opacity="0.12" />
          <path d={e.caminho} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round" />
          <circle cx={e.x(Date.parse(e.ultimo.t))} cy={e.y(e.ultimo.p)} r="4" fill={cor} />
          {mira && (() => {
            const mx = e.x(Date.parse(mira.t));
            const my = e.y(mira.p);
            const quando = new Date(mira.t).toLocaleString('pt-BR', periodo === '1D'
              ? { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }
              : { day: '2-digit', month: '2-digit', ...(periodo === '5D' ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'America/Sao_Paulo' });
            const texto = `${quando} · ${reais(mira.p)}`;
            const largura = texto.length * 7 + 16;
            const caixaX = Math.min(Math.max(mx - largura / 2, e.m.e), e.largura - e.m.d - largura);
            return (
              <g pointerEvents="none">
                <line x1={mx} x2={mx} y1={e.m.t} y2={e.altura - e.m.b} stroke="var(--apoio)" strokeWidth="1" />
                <circle cx={mx} cy={my} r="5" fill={cor} stroke="var(--painel)" strokeWidth="2" />
                <rect x={caixaX} y={2} width={largura} height={20} rx={5} fill="var(--painel2)" stroke="var(--linha)" />
                <text x={caixaX + largura / 2} y={16} fontSize="12" fontWeight="600" fill="var(--texto)" textAnchor="middle">{texto}</text>
              </g>
            );
          })()}
        </svg>
      ) : (
        <p className="secao-vazia" style={{ margin: 0, fontSize: 14 }}>
          {periodo === '1D' || periodo === '5D'
            ? 'O gráfico do dia é montado com o MetaTrader 5 ligado (um ponto por minuto). Assim que o robô mandar preços, ele aparece aqui.'
            : 'Sem fechamentos da B3 para este período ainda.'}
        </p>
      )}

      {e && periodo === '1D' && dados?.sessao && pontos[0] && Date.parse(pontos[0].t) - Date.parse(`${dados.hoje}T${dados.sessao.abertura}:00-03:00`) > 10 * 60_000 && (
        <span className="linha-lista-apoio" style={{ fontSize: 12 }}>
          Minutos a partir de {new Date(pontos[0].t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}: com o robô 1.5.0 o gráfico vem desde a abertura.
        </span>
      )}
      <dl className="painel-ativo-numeros">
        <div><dt>Abertura</dt><dd>{reais(dados?.abertura ?? null)}</dd></div>
        <div><dt>Máxima</dt><dd>{reais(maxima)}</dd></div>
        <div><dt>Mínima</dt><dd>{reais(minima)}</dd></div>
        <div><dt>Fech. anterior</dt><dd>{reais(ref)}</dd></div>
        <div><dt>Máx. 52 sem</dt><dd>{reais(dados?.max52 ?? null)}</dd></div>
        <div><dt>Mín. 52 sem</dt><dd>{reais(dados?.min52 ?? null)}</dd></div>
        <div><dt>Volume (qtd.)</dt><dd>{inteiro(dados?.cotacao.volume ?? null)}</dd></div>
      </dl>
      {dados?.origemDoDia === 'b3' && <span className="linha-lista-apoio" style={{ fontSize: 12 }}>Abertura, máxima e mínima: último pregão (fechamento da B3).</span>}
      {dados?.origemDoDia === 'minutos' && <span className="linha-lista-apoio" style={{ fontSize: 12 }}>Abertura, máxima e mínima: pelos minutos recebidos do MT5 (atualize o robô para os números exatos do dia).</span>}
    </div>
  );
}
