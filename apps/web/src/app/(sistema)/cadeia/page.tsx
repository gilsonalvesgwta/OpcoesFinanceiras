'use client';

// Cadeia de opções ao vivo: preço da ponte MT5 quando o robô está ligado (senão brapi ou
// o fechamento da B3, sempre dito), atualizada a cada 2 s no pregão; volatilidade e delta
// recalculados na hora com o preço ao vivo; gama, theta e vega do fechamento. C e V levam a
// série para o Simulador.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ConfiguracaoDoCalendario } from '@wta/domain';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { SeloDoPreco } from '../../../componentes/SeloDoPreco.tsx';
import { chamar, ErroDaApi, type Favorito } from '../../../lib/api.ts';
import { dataBr, diaMes } from '../../../lib/mercado.ts';
import { diasAte } from '../../../lib/formatos.ts';
import {
  dentroDoDinheiro, grega, inteiro, montarLinhas, MOTIVOS, pontosDoSorriso, preco, temCalculo, vol,
  type Cadeia, type Faixa, type LinhaDaCadeia, type Serie,
} from '../../../lib/cadeia.ts';
import {
  configDoCalendario, intervaloDeAtualizacao, precoDoAtivo, rotuloDoVencimento, volDaSerie, type CalendarioDaApi,
} from '../../../lib/simulador.ts';

type Objeto = { codigo: string; series: number; negocios: number };
type Contexto = { spot: number | null; spotVivo: CadeiaVivo; cadeia: Cadeia; cfg: ConfiguracaoDoCalendario | null; selic: number | null };
type CadeiaVivo = Cadeia['ativo']['cotacao'];

const aoVivo = (s: Serie) => s.cotacao?.provedor === 'mt5' && s.cotacao.qualidade === 'tempo_real';

function Celulas({ s, lado, todas, ctx }: { s: Serie | null; lado: 'call' | 'put'; todas: boolean; ctx: Contexto }) {
  const n = todas ? 10 : 7;
  if (!s) return <>{Array.from({ length: n }, (_, i) => <td key={i} className="vazia" aria-label="sem série">·</td>)}</>;
  const c = s.calculo;
  const ok = temCalculo(c);
  const semCalculo = ok ? null : <span title={MOTIVOS[(c as { motivo: string }).motivo] ?? 'Sem cálculo'} aria-label={MOTIVOS[(c as { motivo: string }).motivo] ?? 'Sem cálculo'}>—</span>;
  const classe = dentroDoDinheiro(lado, s.strike, ctx.spot) ? 'dentro' : '';
  const vivo = aoVivo(s);
  // Ao vivo: livro e último do MT5. Sem MT5: o fechamento da B3.
  const q = vivo ? s.cotacao : null;
  const ultimo = q ? q.ultimo : s.ultimo;
  const bid = q ? q.bid : s.bid;
  const ask = q ? q.ask : s.ask;
  const vd = ctx.cadeia.vencimento && ctx.spotVivo
    ? volDaSerie({ codigo: s.codigo, tipo: s.tipo, strike: s.strike, negocios: s.negocios, vol: ok ? c.volImplicita : null, delta: ok ? c.delta : null, cotacao: s.cotacao ?? null },
      ctx.spotVivo, ctx.cadeia.vencimento, ctx.cadeia.hoje ?? ctx.cadeia.ativo.dia, ctx.cfg, ctx.selic)
    : null;
  const volVivo = vd?.origem === 'ao_vivo';
  const estiloVivo = vivo ? { color: 'var(--vivo)' } : undefined;
  const destino = (l: 'compra' | 'venda') => `/simulador?${new URLSearchParams({ ativo: ctx.cadeia.ativo.codigo, vencimento: ctx.cadeia.vencimento ?? '', montar: `${s.codigo}:${l}` })}`;
  const celulas = [
    <td key="cod" className={classe}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexDirection: lado === 'call' ? 'row' : 'row-reverse' }}>
        <Link href={destino('compra')} className="botao-cv botao-c" aria-label={`Comprar ${s.codigo} no Simulador`} title={`Comprar ${s.codigo} no Simulador`}>C</Link>
        <Link href={destino('venda')} className="botao-cv botao-v" aria-label={`Vender ${s.codigo} no Simulador`} title={`Vender ${s.codigo} no Simulador`}>V</Link>
        <span className="codigo-serie">{s.codigo}</span>
      </span>
    </td>,
    <td key="neg" className={`numero ${classe}`}>{inteiro(s.negocios)}</td>,
    <td key="ult" className={`numero ${classe}`} style={estiloVivo}>{preco(ultimo)}</td>,
    <td key="bid" className={`numero ${classe}`} style={estiloVivo}>{preco(bid)}</td>,
    <td key="ask" className={`numero ${classe}`} style={estiloVivo}>{preco(ask)}</td>,
    <td key="vol" className={`numero ${classe}`} style={volVivo ? estiloVivo : undefined}>{volVivo && vd?.vol ? vol(vd.vol) : ok ? vol(c.volImplicita) : semCalculo}</td>,
    <td key="delta" className={`numero ${classe}`} style={volVivo ? estiloVivo : undefined}>{volVivo && vd?.delta !== null && vd?.delta !== undefined ? grega(vd.delta) : ok ? grega(c.delta) : semCalculo}</td>,
  ];
  if (todas) {
    celulas.push(
      <td key="gama" className={`numero ${classe}`}>{ok ? grega(c.gamma, 3) : semCalculo}</td>,
      <td key="theta" className={`numero ${classe}`}>{ok ? grega(c.theta, 3) : semCalculo}</td>,
      <td key="vega" className={`numero ${classe}`}>{ok ? grega(c.vega, 3) : semCalculo}</td>,
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
        <span style={{ color: 'var(--vivo)' }}>━</span> calls · <span style={{ color: 'var(--historico)' }}>╍</span> puts · linha tracejada dourada: preço do ativo · volatilidade do fechamento
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
  const [cfg, setCfg] = useState<ConfiguracaoDoCalendario | null>(null);
  const [faixa, setFaixa] = useState<Faixa>(10);
  const [soNegociadas, setSoNegociadas] = useState(false);
  const [todas, setTodas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  // Só a resposta do pedido mais recente vale: uma resposta antiga que chega depois
  // (ex.: o vencimento anterior) não toma o lugar da nova.
  const pedidoAtual = useRef(0);

  useEffect(() => {
    chamar<CalendarioDaApi>('GET', '/api/calendario').then((c) => setCfg(configDoCalendario(c))).catch(() => undefined);
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

  const carregar = useCallback(async (codigo: string, venc: string | null, silencioso: boolean) => {
    const meu = ++pedidoAtual.current;
    if (!silencioso) { setCarregando(true); setErro(null); }
    const q = new URLSearchParams({ ativo: codigo, ...(venc ? { vencimento: venc } : {}) });
    try {
      const c = await chamar<Cadeia>('GET', `/api/mercado/cadeia?${q}`);
      if (meu !== pedidoAtual.current) return; // chegou atrasada: ignora
      setCadeia(c);
      setAtualizadoEm(new Date());
      if (!venc && c.vencimento) setVencimento(c.vencimento);
    } catch (e) {
      if (meu !== pedidoAtual.current || silencioso) return;
      setCadeia(null);
      setErro(e instanceof ErroDaApi && e.codigo === 'sem_fechamento' ? `Ainda não há fechamento de ${codigo} no sistema.` : (e as Error).message);
    } finally {
      if (meu === pedidoAtual.current && !silencioso) setCarregando(false);
    }
  }, []);

  // Pedido "de verdade" só quando o ativo ou o vencimento mudam (o vencimento escolhido
  // pela própria resposta não pede de novo: a cadeia já é dele).
  const ultimoPedido = useRef('');
  useEffect(() => {
    if (!ativo) return;
    const chave = `${ativo}|${vencimento ?? ''}`;
    if (vencimento && cadeia?.ativo.codigo === ativo && cadeia.vencimento === vencimento && ultimoPedido.current.startsWith(`${ativo}|`)) { ultimoPedido.current = chave; return; }
    ultimoPedido.current = chave;
    void carregar(ativo, vencimento, false);
  }, [ativo, vencimento, carregar]);

  // Atualização automática: 2 s no pregão, 60 s fora; só com a aba visível e sem pedido em andamento.
  const aberto = cadeia?.mercadoAberto;
  const cod = cadeia?.ativo.codigo;
  const venc = cadeia?.vencimento ?? null;
  useEffect(() => {
    if (!cod) return undefined;
    let ocupado = false;
    const t = setInterval(() => {
      if (ocupado || document.visibilityState !== 'visible') return;
      ocupado = true;
      void carregar(cod, venc, true).finally(() => { ocupado = false; });
    }, intervaloDeAtualizacao(aberto));
    return () => clearInterval(t);
  }, [cod, venc, aberto, carregar]);

  const spotFechamento = cadeia?.ativo.ultimo ?? null;
  const spotVivo = cadeia?.ativo.cotacao ?? null;
  const spot = precoDoAtivo(spotVivo ?? null) ?? spotFechamento;
  const linhas = useMemo(() => (cadeia ? montarLinhas(cadeia.series, spot, faixa, soNegociadas) : []), [cadeia, spot, faixa, soNegociadas]);
  const exemplo = cadeia?.series.map((s) => s.calculo).find(temCalculo);
  const ordemDosObjetos = [...new Set([...favoritos.filter((f) => objetos?.some((o) => o.codigo === f)), ...(objetos ?? []).map((o) => o.codigo)])];
  const n = todas ? 10 : 7;
  const vivas = cadeia ? cadeia.series.filter(aoVivo).length : 0;
  const ctx: Contexto | null = cadeia ? { spot, spotVivo, cadeia, cfg, selic: exemplo?.selic ?? null } : null;
  const rotuloAtual = rotuloDoVencimento(cadeia?.vencimento ? cadeia.tipos?.[cadeia.vencimento] : undefined);

  return (
    <>
      <Cabecalho titulo="Cadeia de opções" apoio="Preços ao vivo do MetaTrader 5 quando o robô está ligado (senão, o fechamento da B3, sempre indicado). C e V levam a opção para o Simulador." />
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
            <div className="campo" style={{ flex: '0 1 300px' }}>
              <label htmlFor="cadeia-venc">Vencimento</label>
              <select id="cadeia-venc" value={vencimento ?? ''} onChange={(e) => setVencimento(e.target.value)} disabled={!cadeia?.vencimentos.length}>
                {cadeia?.vencimentos.map((v) => {
                  const r = rotuloDoVencimento(cadeia.tipos?.[v]);
                  return <option key={v} value={v}>{dataBr(v)} · {r.mensal ? 'MENSAL' : r.texto} ({diasAte(cadeia.hoje ?? cadeia.ativo.dia, v)} dias)</option>;
                })}
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
          {cadeia && cadeia.vencimentos.length > 0 && (
            <div className="atalhos" role="group" aria-label="Vencimentos (mensais destacados)">
              {cadeia.vencimentos.map((v) => {
                const r = rotuloDoVencimento(cadeia.tipos?.[v]);
                return (
                  <button key={v} type="button" aria-pressed={v === cadeia.vencimento}
                    className={`botao botao-pequeno ${v === cadeia.vencimento ? 'botao-principal' : r.mensal ? 'botao-contorno' : ''}`}
                    onClick={() => setVencimento(v)} title={r.texto}>
                    {r.mensal ? <strong>{dataBr(v).slice(0, 5)} · Mensal</strong> : <>{dataBr(v).slice(0, 5)} · {r.texto.replace('Semanal ', '')}</>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="form-em-linha" style={{ gap: '4px 24px' }}>
            <label className="caixa-de-marcar"><input type="checkbox" checked={soNegociadas} onChange={(e) => setSoNegociadas(e.target.checked)} /><span>Só séries com negócio no fechamento</span></label>
            <label className="caixa-de-marcar"><input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /><span>Mostrar gama, theta e vega</span></label>
          </div>
        </section>
      )}

      {cadeia && (
        <div className="grade-2">
          <section className="secao" aria-labelledby="resumo-titulo">
            <h2 id="resumo-titulo">{cadeia.ativo.codigo} agora</h2>
            <div className="linha-lista"><span>Preço do ativo</span><strong style={{ fontSize: 22 }}>R$ {preco(spot)} <SeloDoPreco c={spotVivo ?? null} /></strong></div>
            <div className="linha-lista"><span>Fechamento de {diaMes(cadeia.ativo.dia)}</span><strong>R$ {preco(spotFechamento)}</strong></div>
            <div className="linha-lista"><span>Vencimento</span><strong>{cadeia.vencimento ? `${dataBr(cadeia.vencimento)} · ${rotuloAtual.texto}` : '—'}</strong></div>
            <div className="linha-lista"><span>Pregões até o vencimento</span><strong>{exemplo ? exemplo.diasUteis : '—'}</strong></div>
            <div className="linha-lista"><span>Selic usada no cálculo</span><strong>{exemplo ? `${grega(exemplo.selic)}% ao ano` : '—'}</strong></div>
            <span className="linha-lista-apoio" style={{ fontSize: 13 }}>
              {vivas
                ? <><span style={{ color: 'var(--vivo)', fontWeight: 600 }}>Em destaque: tempo real pelo MetaTrader 5</span> ({vivas} de {cadeia.series.length} séries; Vol e Delta recalculados na hora). </>
                : <>Preços do fechamento da B3 de {diaMes(cadeia.ativo.dia)}.{cadeia.mercadoAberto ? ' Com o MetaTrader 5 aberto e o robô ligado, as séries passam a tempo real em até 1 minuto.' : ''} </>}
              {atualizadoEm && <>Atualiza sozinho a cada {cadeia.mercadoAberto ? '2 segundos' : 'minuto'} (última às {atualizadoEm.toLocaleTimeString('pt-BR')}).</>}
            </span>
          </section>
          <section className="secao" aria-labelledby="sorriso-titulo">
            <h2 id="sorriso-titulo">Volatilidade implícita por strike</h2>
            <Sorriso linhas={linhas} spot={spot} />
          </section>
        </div>
      )}

      {cadeia && ctx && (
        <section className="secao secao-tabela" aria-labelledby="tabela-titulo">
          <div className="secao-topo">
            <h2 id="tabela-titulo">Séries {carregando ? '(carregando…)' : `(${linhas.length} strikes)`}</h2>
            <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Fundo destacado: dentro do dinheiro. Borda dourada: strike mais perto do preço de agora. C compra e V vende no Simulador.</span>
          </div>
          {linhas.length === 0 ? (
            <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhuma série com esses filtros.</p>
          ) : (
            <div className="tabela-caixa tabela-cadeia-caixa" tabIndex={0} role="region" aria-label="Tabela da cadeia de opções">
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
                      <Celulas s={l.call} lado="call" todas={todas} ctx={ctx} />
                      <th scope="row" className="coluna-strike">{preco(l.strike)}</th>
                      <Celulas s={l.put} lado="put" todas={todas} ctx={ctx} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="linha-lista-apoio" style={{ margin: '0 24px', fontSize: 13 }}>
            Neg.: negócios no fechamento da B3. Último, Compra e Venda em destaque: MetaTrader 5 agora; sem destaque: fechamento. Gama, theta e vega: do fechamento.
          </p>
        </section>
      )}

      {cadeia && (
        <section className="secao" aria-labelledby="premissas-titulo">
          <details>
            <summary><h2 id="premissas-titulo" style={{ display: 'inline' }}>Premissas do cálculo</h2></summary>
            <ul style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cadeia.premissas.map((p) => <li key={p} className="linha-lista-apoio">{p}</li>)}
              <li className="linha-lista-apoio">Ao vivo: com preço do MetaTrader 5 em tempo real no ativo e na série, a volatilidade implícita e o delta são recalculados pelo mesmo modelo, com o meio do livro (spread até 50%) ou o último negócio.</li>
              <li className="linha-lista-apoio">Theta: variação do preço teórico por pregão que passa. Vega e rho: variação para 1 ponto percentual de volatilidade ou de juros. Valores por opção, em reais.</li>
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
