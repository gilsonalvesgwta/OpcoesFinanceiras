'use client';

// Cadeia de opções: fechamento oficial da B3 com volatilidade implícita e gregas
// calculadas pelo sistema (premissas na própria tela).

import { useEffect, useMemo, useState } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { chamar, ErroDaApi, type Favorito } from '../../../lib/api.ts';
import { dataBr, diaMes } from '../../../lib/mercado.ts';
import { diasAte } from '../../../lib/formatos.ts';
import {
  dentroDoDinheiro, grega, inteiro, montarLinhas, MOTIVOS, pontosDoSorriso, preco, temCalculo, vol,
  type Cadeia, type Faixa, type LinhaDaCadeia, type Serie,
} from '../../../lib/cadeia.ts';

type Objeto = { codigo: string; series: number; negocios: number };

function Celulas({ s, lado, spot, todas }: { s: Serie | null; lado: 'call' | 'put'; spot: number | null; todas: boolean }) {
  const n = todas ? 10 : 7;
  if (!s) return <>{Array.from({ length: n }, (_, i) => <td key={i} className="vazia" aria-label="sem série">·</td>)}</>;
  const c = s.calculo;
  const ok = temCalculo(c);
  const semCalculo = ok ? null : <span title={MOTIVOS[(c as { motivo: string }).motivo] ?? 'Sem cálculo'} aria-label={MOTIVOS[(c as { motivo: string }).motivo] ?? 'Sem cálculo'}>—</span>;
  const classe = dentroDoDinheiro(lado, s.strike, spot) ? 'dentro' : undefined;
  const celulas = [
    <td key="cod" className={classe}><span className="codigo-serie">{s.codigo}</span></td>,
    <td key="neg" className={`numero ${classe ?? ''}`}>{inteiro(s.negocios)}</td>,
    <td key="ult" className={`numero ${classe ?? ''}`}>{preco(s.ultimo)}</td>,
    <td key="bid" className={`numero ${classe ?? ''}`}>{preco(s.bid)}</td>,
    <td key="ask" className={`numero ${classe ?? ''}`}>{preco(s.ask)}</td>,
    <td key="vol" className={`numero ${classe ?? ''}`}>{ok ? vol(c.volImplicita) : semCalculo}</td>,
    <td key="delta" className={`numero ${classe ?? ''}`}>{ok ? grega(c.delta) : semCalculo}</td>,
  ];
  if (todas) {
    celulas.push(
      <td key="gama" className={`numero ${classe ?? ''}`}>{ok ? grega(c.gamma, 3) : semCalculo}</td>,
      <td key="theta" className={`numero ${classe ?? ''}`}>{ok ? grega(c.theta, 3) : semCalculo}</td>,
      <td key="vega" className={`numero ${classe ?? ''}`}>{ok ? grega(c.vega, 3) : semCalculo}</td>,
    );
  }
  // Puts espelhadas: do strike para fora.
  return <>{lado === 'call' ? celulas : [...celulas].reverse()}</>;
}

function Sorriso({ linhas, spot }: { linhas: LinhaDaCadeia[]; spot: number | null }) {
  const calls = pontosDoSorriso(linhas, 'call');
  const puts = pontosDoSorriso(linhas, 'put');
  const todos = [...calls, ...puts];
  if (todos.length < 2) return <p className="secao-vazia" style={{ fontSize: 14 }}>Séries calculadas insuficientes para o gráfico.</p>;
  const L = 320, A = 150, m = { e: 40, d: 10, t: 10, b: 24 };
  const xs = todos.map((p) => p.strike), ys = todos.map((p) => p.vol);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) * 0.95, Math.max(...ys) * 1.05];
  const px = (x: number) => m.e + ((x - x0) / Math.max(1, x1 - x0)) * (L - m.e - m.d);
  const py = (y: number) => A - m.b - ((y - y0) / Math.max(1e-9, y1 - y0)) * (A - m.t - m.b);
  const linha = (p: { strike: number; vol: number }[]) => p.map((q) => `${px(q.strike).toFixed(1)},${py(q.vol).toFixed(1)}`).join(' ');
  const descricao = `Volatilidade implícita por strike: calls de ${vol(Math.min(...(calls.length ? calls : todos).map((p) => p.vol)))} a ${vol(Math.max(...(calls.length ? calls : todos).map((p) => p.vol)))}.`;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${L} ${A}`} width="100%" style={{ maxWidth: 420 }} role="img" aria-label={descricao}>
        <line x1={m.e} y1={A - m.b} x2={L - m.d} y2={A - m.b} stroke="var(--linha)" />
        <text x={m.e - 6} y={py(y1) + 4} textAnchor="end" fontSize="10" fill="var(--apoio)">{vol(y1)}</text>
        <text x={m.e - 6} y={py(y0)} textAnchor="end" fontSize="10" fill="var(--apoio)">{vol(y0)}</text>
        <text x={m.e} y={A - 6} fontSize="10" fill="var(--apoio)">{preco(x0)}</text>
        <text x={L - m.d} y={A - 6} textAnchor="end" fontSize="10" fill="var(--apoio)">{preco(x1)}</text>
        {spot !== null && spot >= x0 && spot <= x1 && <line x1={px(spot)} y1={m.t} x2={px(spot)} y2={A - m.b} stroke="var(--latao)" strokeDasharray="3 3" />}
        {calls.length > 1 && <polyline points={linha(calls)} fill="none" stroke="var(--vivo)" strokeWidth="2" />}
        {puts.length > 1 && <polyline points={linha(puts)} fill="none" stroke="var(--historico)" strokeWidth="2" strokeDasharray="5 3" />}
        {calls.map((p) => <circle key={`c${p.strike}`} cx={px(p.strike)} cy={py(p.vol)} r="2.5" fill="var(--vivo)" />)}
        {puts.map((p) => <circle key={`p${p.strike}`} cx={px(p.strike)} cy={py(p.vol)} r="2.5" fill="var(--historico)" />)}
      </svg>
      <figcaption className="linha-lista-apoio" style={{ fontSize: 13 }}>
        <span style={{ color: 'var(--vivo)' }}>━</span> calls · <span style={{ color: 'var(--historico)' }}>╍</span> puts · linha tracejada dourada: preço do ativo
      </figcaption>
    </figure>
  );
}

export default function PaginaCadeia() {
  const [objetos, setObjetos] = useState<Objeto[] | null>(null);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [ativo, setAtivo] = useState('');
  const [vencimento, setVencimento] = useState<string | null>(null);
  const [cadeia, setCadeia] = useState<Cadeia | null>(null);
  const [faixa, setFaixa] = useState<Faixa>(10);
  const [soNegociadas, setSoNegociadas] = useState(false);
  const [todas, setTodas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    Promise.all([
      chamar<{ dia: string | null; objetos: Objeto[] }>('GET', '/api/mercado/objetos'),
      chamar<{ favoritos: Favorito[] }>('GET', '/api/favoritos'),
    ]).then(([o, f]) => {
      setObjetos(o.objetos);
      const favs = f.favoritos.map((x) => x.codigo);
      setFavoritos(favs);
      const comOpcoes = new Set(o.objetos.map((x) => x.codigo));
      setAtivo(favs.find((c) => comOpcoes.has(c)) ?? o.objetos[0]?.codigo ?? '');
    }).catch((e: Error) => setErro(e.message));
  }, []);

  useEffect(() => {
    if (!ativo) return;
    setCarregando(true);
    setErro(null);
    const q = new URLSearchParams({ ativo, ...(vencimento ? { vencimento } : {}) });
    chamar<Cadeia>('GET', `/api/mercado/cadeia?${q}`)
      .then((c) => { setCadeia(c); if (!vencimento && c.vencimento) setVencimento(c.vencimento); })
      .catch((e) => { setCadeia(null); setErro(e instanceof ErroDaApi && e.codigo === 'sem_fechamento' ? `Ainda não há fechamento de ${ativo} no sistema.` : (e as Error).message); })
      .finally(() => setCarregando(false));
  }, [ativo, vencimento]);

  const spot = cadeia?.ativo.ultimo ?? null;
  const linhas = useMemo(() => (cadeia ? montarLinhas(cadeia.series, spot, faixa, soNegociadas) : []), [cadeia, spot, faixa, soNegociadas]);
  const exemplo = cadeia?.series.map((s) => s.calculo).find(temCalculo);
  const ordemDosObjetos = [...new Set([...favoritos.filter((f) => objetos?.some((o) => o.codigo === f)), ...(objetos ?? []).map((o) => o.codigo)])];
  const n = todas ? 10 : 7;

  return (
    <>
      <Cabecalho titulo="Cadeia de opções" apoio="Fechamento oficial da B3 com volatilidade implícita e gregas calculadas pelo sistema. Não é preço do momento." />
      <MensagemDeErro texto={erro} />
      {objetos?.length === 0 && (
        <section className="secao"><p className="secao-vazia">Ainda não há arquivo da B3 com opções no sistema. A coleta busca o fechamento depois das 20h de cada pregão.</p></section>
      )}

      {objetos && objetos.length > 0 && (
        <section className="secao" aria-label="Escolha da cadeia" style={{ gap: 14 }}>
          <div className="form-em-linha">
            <div className="campo" style={{ flex: '0 1 200px' }}>
              <label htmlFor="cadeia-ativo">Ativo</label>
              <select id="cadeia-ativo" value={ativo} onChange={(e) => { setVencimento(null); setAtivo(e.target.value); }}>
                {ordemDosObjetos.map((c) => <option key={c} value={c}>{c}{favoritos.includes(c) ? ' (favorito)' : ''}</option>)}
              </select>
            </div>
            <div className="campo" style={{ flex: '0 1 240px' }}>
              <label htmlFor="cadeia-venc">Vencimento</label>
              <select id="cadeia-venc" value={vencimento ?? ''} onChange={(e) => setVencimento(e.target.value)} disabled={!cadeia?.vencimentos.length}>
                {cadeia?.vencimentos.map((v) => <option key={v} value={v}>{dataBr(v)} ({diasAte(cadeia.ativo.dia, v)} dias)</option>)}
              </select>
            </div>
            <div className="campo" style={{ flex: '0 1 180px' }}>
              <label htmlFor="cadeia-faixa">Strikes</label>
              <select id="cadeia-faixa" value={String(faixa)} onChange={(e) => setFaixa(e.target.value === 'todas' ? 'todas' : (Number(e.target.value) as 10 | 20))}>
                <option value="10">Até 10% do preço</option>
                <option value="20">Até 20% do preço</option>
                <option value="todas">Todos</option>
              </select>
            </div>
          </div>
          <div className="form-em-linha" style={{ gap: '4px 24px' }}>
            <label className="caixa-de-marcar"><input type="checkbox" checked={soNegociadas} onChange={(e) => setSoNegociadas(e.target.checked)} /><span>Só séries com negócio no dia</span></label>
            <label className="caixa-de-marcar"><input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /><span>Mostrar gama, theta e vega</span></label>
          </div>
        </section>
      )}

      {cadeia && (
        <div className="grade-2">
          <section className="secao" aria-labelledby="resumo-titulo">
            <h2 id="resumo-titulo">{cadeia.ativo.codigo}: fechamento de {diaMes(cadeia.ativo.dia)}</h2>
            <div className="linha-lista"><span>Preço do ativo</span><strong>R$ {preco(spot)}</strong></div>
            <div className="linha-lista"><span>Vencimento</span><strong>{cadeia.vencimento ? dataBr(cadeia.vencimento) : '—'}</strong></div>
            <div className="linha-lista"><span>Pregões até o vencimento</span><strong>{exemplo ? exemplo.diasUteis : '—'}</strong></div>
            <div className="linha-lista"><span>Selic usada no cálculo</span><strong>{exemplo ? `${grega(exemplo.selic)}% ao ano` : '—'}</strong></div>
            <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Dado histórico (fechamento). Volatilidade e gregas são cálculo do sistema; veja as premissas abaixo.</span>
          </section>
          <section className="secao" aria-labelledby="sorriso-titulo">
            <h2 id="sorriso-titulo">Volatilidade implícita por strike</h2>
            <Sorriso linhas={linhas} spot={spot} />
          </section>
        </div>
      )}

      {cadeia && (
        <section className="secao secao-tabela" aria-labelledby="tabela-titulo">
          <div className="secao-topo">
            <h2 id="tabela-titulo">Séries {carregando ? '(carregando…)' : `(${linhas.length} strikes)`}</h2>
            <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Fundo destacado: dentro do dinheiro. Borda dourada: strike mais perto do preço.</span>
          </div>
          {linhas.length === 0 ? (
            <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhuma série com esses filtros.</p>
          ) : (
            <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Tabela da cadeia de opções">
              <table className="tabela tabela-cadeia">
                <thead>
                  <tr>
                    <th scope="colgroup" colSpan={n} className="lado">Calls</th>
                    <th scope="col" rowSpan={2} className="coluna-strike">Strike</th>
                    <th scope="colgroup" colSpan={n} className="lado">Puts</th>
                  </tr>
                  <tr>
                    {['Código', 'Neg.', 'Último', 'Compra', 'Venda', 'Vol. impl.', 'Delta', ...(todas ? ['Gama', 'Theta', 'Vega'] : [])].map((t) => <th key={`c${t}`} scope="col" className="numero">{t}</th>)}
                    {['Código', 'Neg.', 'Último', 'Compra', 'Venda', 'Vol. impl.', 'Delta', ...(todas ? ['Gama', 'Theta', 'Vega'] : [])].reverse().map((t) => <th key={`p${t}`} scope="col" className="numero">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.strike} className={l.noDinheiro ? 'no-dinheiro' : undefined}>
                      <Celulas s={l.call} lado="call" spot={spot} todas={todas} />
                      <th scope="row" className="coluna-strike">{preco(l.strike)}</th>
                      <Celulas s={l.put} lado="put" spot={spot} todas={todas} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {cadeia && (
        <section className="secao" aria-labelledby="premissas-titulo">
          <details>
            <summary><h2 id="premissas-titulo" style={{ display: 'inline' }}>Premissas do cálculo</h2></summary>
            <ul style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cadeia.premissas.map((p) => <li key={p} className="linha-lista-apoio">{p}</li>)}
              <li className="linha-lista-apoio">Theta: variação do preço teórico por pregão que passa. Vega e rho: variação para 1 ponto percentual de volatilidade ou de juros. Valores por opção, em reais.</li>
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
