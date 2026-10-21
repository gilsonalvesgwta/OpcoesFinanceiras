'use client';

// Simulador de opções: monta pela cadeia (C = comprar, V = vender), aceita vencimentos
// diferentes, mostra o resultado hoje, numa data escolhida e no primeiro vencimento, com
// gregas e equilíbrios, e guarda a montagem como carteira simulada para acompanhar com o
// preço real e fazer ajustes e rolagens simulados. Tudo é estimativa do modelo; nada
// envia ordem e nada se mistura com as posições reais.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  caixaDaMontagem, curvaDaSimulacao, equilibriosDaCurva, extremosDaCurva, faixaDaSimulacao, gregasDaSimulacao, resultadoDaSimulacao,
  vencimentosDaSimulacao, type ConfiguracaoDoCalendario, type PontoDaCurva,
} from '@wta/domain';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi, type Favorito } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { quandoCurto } from '../../../lib/mercado.ts';
import { QUALIDADE } from '../../../lib/posicoes.ts';
import {
  adicionarPerna, avaliacaoNaData, configDoCalendario, diasEntre, escalaDoGrafico, execucoesParaApi, novoId, pernaDaSerie, pernaDoAtivo,
  pernaQueEncerra, precoDeMercado, resultadoEmPreco, somarDias,
  type CadeiaDoSimulador, type CalendarioDaApi, type CotacaoResumida, type PernaNaTela, type SerieDaCadeia,
} from '../../../lib/simulador.ts';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const classeDoValor = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const CORES = { hoje: 'var(--vivo)', alvo: 'var(--latao)', venc: 'var(--texto)' };

type ResumoDaCarteira = {
  id: string; nome: string; ativoObjeto: string; situacao: 'aberta' | 'encerrada'; atualizadaEm: string; operacoes: number; abertos: number;
  resultado: { realizadoLiquido: number; naoRealizadoEstimado: number | null } | null;
};
type DetalheDaCarteira = ResumoDaCarteira & {
  abertos: { codigo: string; tipo: 'call' | 'put' | 'ativo'; strike: number | null; vencimento: string | null; quantidade: number; precoMedio: number; vol: number | null; cotacao: CotacaoResumida }[];
};

function SeloDoPreco({ c }: { c: CotacaoResumida }) {
  if (!c) return <span className="selo selo-neutro" style={{ fontSize: 12 }}>sem preço</span>;
  const s = c.provedor === 'brapi' ? { texto: 'brapi (~30 min)', classe: 'selo-periodica' } : QUALIDADE[c.qualidade] ?? { texto: c.qualidade, classe: 'selo-neutro' };
  return <span className={`selo ${s.classe}`} style={{ fontSize: 12 }} title={c.instanteDaFonte ? `Preço de ${quandoCurto(c.instanteDaFonte)}` : undefined}>{s.texto}</span>;
}

// ---------- Cadeia com botões C e V ----------

function Cadeia({ cadeia, spot, faixa, aoMontar }: { cadeia: CadeiaDoSimulador; spot: number | null; faixa: 'perto' | 'todas'; aoMontar: (s: SerieDaCadeia, lado: 'compra' | 'venda') => void }) {
  const porStrike = new Map<number, { call?: SerieDaCadeia; put?: SerieDaCadeia }>();
  for (const s of cadeia.series) {
    if (faixa === 'perto' && spot && Math.abs(s.strike - spot) / spot > 0.2) continue;
    const l = porStrike.get(s.strike) ?? {};
    const atual = s.tipo === 'call' ? l.call : l.put;
    if (!atual || (s.negocios ?? 0) > (atual.negocios ?? 0)) l[s.tipo] = s;
    porStrike.set(s.strike, l);
  }
  const strikes = [...porStrike.keys()].sort((a, b) => a - b);
  const atm = spot ? strikes.reduce((m, k) => (Math.abs(k - spot) < Math.abs(m - spot) ? k : m), strikes[0] ?? 0) : null;
  const botoes = (s: SerieDaCadeia | undefined) => s && (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button type="button" className="botao-cv botao-c" onClick={() => aoMontar(s, 'compra')} aria-label={`Comprar ${s.codigo}`} title={`Comprar ${s.codigo}`}>C</button>
      <button type="button" className="botao-cv botao-v" onClick={() => aoMontar(s, 'venda')} aria-label={`Vender ${s.codigo}`} title={`Vender ${s.codigo}`}>V</button>
    </span>
  );
  const celulas = (s: SerieDaCadeia | undefined, lado: 'call' | 'put') => {
    const c = s?.cotacao;
    const v = [
      <td key="bid" className="numero">{c?.bid ? reais(c.bid) : '—'}</td>,
      <td key="ask" className="numero">{c?.ask ? reais(c.ask) : '—'}</td>,
      <td key="ult" className="numero">{c?.ultimo ? reais(c.ultimo) : '—'}</td>,
      <td key="vol" className="numero">{s ? pct(s.vol) : ''}</td>,
      <td key="delta" className="numero">{s?.delta === null || s?.delta === undefined ? (s ? '—' : '') : s.delta.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>,
    ];
    return lado === 'call' ? [<td key="cv">{botoes(s)}</td>, ...v] : [...[...v].reverse(), <td key="cv">{botoes(s)}</td>];
  };
  if (!strikes.length) return <p className="secao-vazia">Nenhuma série neste vencimento{faixa === 'perto' ? ' perto do preço do ativo' : ''}.</p>;
  return (
    <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Cadeia de opções para montar" style={{ maxHeight: 520, overflowY: 'auto' }}>
      <table className="tabela tabela-cadeia">
        <thead>
          <tr><th scope="col" colSpan={6} className="lado">Calls</th><th scope="col" className="coluna-strike">Strike</th><th scope="col" colSpan={6} className="lado">Puts</th></tr>
          <tr>
            <th scope="col"><span className="so-leitor">Montar call</span></th>
            <th scope="col" className="numero">Compra</th><th scope="col" className="numero">Venda</th><th scope="col" className="numero">Último</th><th scope="col" className="numero">Vol</th><th scope="col" className="numero">Δ</th>
            <th scope="col" className="coluna-strike"><span className="so-leitor">Strike</span></th>
            <th scope="col" className="numero">Δ</th><th scope="col" className="numero">Vol</th><th scope="col" className="numero">Último</th><th scope="col" className="numero">Venda</th><th scope="col" className="numero">Compra</th>
            <th scope="col"><span className="so-leitor">Montar put</span></th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((k) => {
            const l = porStrike.get(k) ?? {};
            return (
              <tr key={k} className={k === atm ? 'no-dinheiro' : undefined}>
                {celulas(l.call, 'call')}
                <th scope="row" className="coluna-strike">{reais(k)}</th>
                {celulas(l.put, 'put')}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Gráfico ----------

function Grafico({ curvas, spot, strikes, rotulos }: { curvas: { nome: string; pontos: PontoDaCurva[]; cor: string; tracejado?: boolean }[]; spot: number | null; strikes: number[]; rotulos: string }) {
  const g = escalaDoGrafico(curvas);
  if (!g) return <p className="aviso-tracejado">Monte ao menos uma perna para ver o gráfico.</p>;
  const y0 = g.y(0);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${g.largura} ${g.altura}`} width="100%" role="img" aria-label={rotulos} style={{ display: 'block' }}>
        <line x1={g.x(g.de)} x2={g.x(g.ate)} y1={y0} y2={y0} stroke="var(--apoio)" />
        {strikes.filter((k) => k >= g.de && k <= g.ate).map((k) => (
          <g key={k}>
            <line x1={g.x(k)} x2={g.x(k)} y1={16} y2={g.altura - 30} stroke="var(--linha)" strokeDasharray="2 4" />
            <text x={g.x(k)} y={g.altura - 16} textAnchor="middle" fontSize="11" fill="var(--apoio)">{reais(k)}</text>
          </g>
        ))}
        {spot !== null && spot >= g.de && spot <= g.ate && (
          <g>
            <line x1={g.x(spot)} x2={g.x(spot)} y1={16} y2={g.altura - 30} stroke="var(--vivo)" strokeWidth="1" opacity="0.6" />
            <text x={g.x(spot) + 4} y={26} fontSize="11" fill="var(--vivo)">hoje {reais(spot)}</text>
          </g>
        )}
        {g.caminhos.map((d, i) => d && <path key={curvas[i]?.nome} d={d} fill="none" stroke={curvas[i]?.cor} strokeWidth="2.25" strokeDasharray={curvas[i]?.tracejado ? '6 4' : undefined} />)}
        <text x={g.x(g.de) - 6} y={g.y(g.max) + 10} textAnchor="end" fontSize="11" fill="var(--apoio)">{formatarReais(Math.round(g.max))}</text>
        <text x={g.x(g.de) - 6} y={y0 + 4} textAnchor="end" fontSize="11" fill="var(--apoio)">R$ 0</text>
        <text x={g.x(g.de) - 6} y={g.y(g.min)} textAnchor="end" fontSize="11" fill="var(--apoio)">{formatarReais(Math.round(g.min))}</text>
        <text x={g.x(g.de)} y={g.altura - 2} fontSize="11" fill="var(--apoio)">{reais(g.de)}</text>
        <text x={g.x(g.ate)} y={g.altura - 2} textAnchor="end" fontSize="11" fill="var(--apoio)">{reais(g.ate)}</text>
      </svg>
      <figcaption className="linha-lista-apoio" style={{ fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        {curvas.map((c) => <span key={c.nome}><span style={{ color: c.cor }}>{c.tracejado ? '╍' : '━'}</span> {c.nome}</span>)}
        <span>Resultado da montagem (estimativa do modelo) conforme o preço do ativo.</span>
      </figcaption>
    </figure>
  );
}

// ---------- Página ----------

export default function PaginaSimulador() {
  const [cfg, setCfg] = useState<ConfiguracaoDoCalendario | null>(null);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [ativo, setAtivo] = useState('');
  const [entradaAtivo, setEntradaAtivo] = useState('');
  const [cadeia, setCadeia] = useState<CadeiaDoSimulador | null>(null);
  const [faixa, setFaixa] = useState<'perto' | 'todas'>('perto');
  const [pernas, setPernas] = useState<PernaNaTela[]>([]);
  const [quantidadePadrao, setQuantidadePadrao] = useState('100');
  const [diasAdiante, setDiasAdiante] = useState<number | null>(null);
  const [volPts, setVolPts] = useState(0);
  const [precoConsulta, setPrecoConsulta] = useState('');
  const [carteiras, setCarteiras] = useState<ResumoDaCarteira[]>([]);
  const [carteira, setCarteira] = useState<DetalheDaCarteira | null>(null);
  const [nomeParaGuardar, setNomeParaGuardar] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregarCarteiras = useCallback(async () => {
    const r = await chamar<{ simulacoes: ResumoDaCarteira[] }>('GET', '/api/simulacoes');
    setCarteiras(r.simulacoes);
  }, []);

  const carregarCadeia = useCallback(async (codigo: string, vencimento?: string) => {
    setErro(null);
    try {
      const r = await chamar<CadeiaDoSimulador>('GET', `/api/simulador/cadeia?ativo=${encodeURIComponent(codigo)}${vencimento ? `&vencimento=${vencimento}` : ''}`);
      setCadeia(r);
      setAtivo(r.ativo.codigo);
      setEntradaAtivo(r.ativo.codigo);
    } catch (x) {
      setErro(x instanceof ErroDaApi && x.codigo === 'sem_fechamento' ? `Sem dados da B3 para ${codigo}. Confira o código da ação (ex.: PETR4).` : x instanceof Error ? x.message : 'Não foi possível carregar a cadeia.');
    }
  }, []);

  useEffect(() => {
    chamar<CalendarioDaApi>('GET', '/api/calendario').then((c) => setCfg(configDoCalendario(c))).catch((e: Error) => setErro(e.message));
    carregarCarteiras().catch(() => undefined);
    chamar<{ favoritos: Favorito[] }>('GET', '/api/favoritos').then((r) => {
      const lista = r.favoritos.map((f) => f.codigo).filter((c) => /^[A-Z]{4}\d{1,2}$/.test(c));
      setFavoritos(lista);
      const pedido = new URLSearchParams(window.location.search).get('ativo')?.toUpperCase();
      void carregarCadeia(pedido || lista[0] || 'PETR4');
    }).catch(() => void carregarCadeia('PETR4'));
  }, [carregarCadeia, carregarCarteiras]);

  const spot = cadeia?.ativo.cotacao ? (cadeia.ativo.cotacao.ultimo ?? cadeia.ativo.cotacao.bid) : null;
  const selic = cadeia?.selic?.valor ?? null;
  const hoje = cadeia?.hoje ?? null;
  const vencs = useMemo(() => vencimentosDaSimulacao(pernas), [pernas]);
  const primeiro = vencs[0] ?? null;
  const ultimo = vencs[vencs.length - 1] ?? null;
  const totalDias = hoje && ultimo ? Math.max(0, diasEntre(hoje, ultimo)) : 0;
  const dias = diasAdiante === null ? Math.floor((hoje && primeiro ? Math.max(0, diasEntre(hoje, primeiro)) : 0) / 2) : Math.min(diasAdiante, totalDias);
  const dataAlvo = hoje ? somarDias(hoje, dias) : null;

  const calculo = useMemo(() => {
    if (!cfg || !hoje || !spot || pernas.length === 0) return null;
    const juros = selic ?? 0;
    const aHoje = avaliacaoNaData(hoje, cfg, juros, volPts);
    const aAlvo = avaliacaoNaData(dataAlvo ?? hoje, cfg, juros, volPts);
    const aVenc = avaliacaoNaData(primeiro ?? hoje, cfg, juros, volPts);
    const { de, ate } = faixaDaSimulacao(pernas, spot);
    const curvaHoje = curvaDaSimulacao(pernas, de, ate, aHoje);
    const curvaAlvo = curvaDaSimulacao(pernas, de, ate, aAlvo);
    const curvaVenc = curvaDaSimulacao(pernas, de, ate, aVenc);
    return {
      curvaHoje, curvaAlvo, curvaVenc,
      agora: resultadoDaSimulacao(pernas, spot, aHoje),
      gregas: gregasDaSimulacao(pernas, spot, aHoje),
      equilibriosVenc: equilibriosDaCurva(curvaVenc), equilibriosAlvo: equilibriosDaCurva(curvaAlvo),
      extremosVenc: extremosDaCurva(curvaVenc),
    };
  }, [cfg, hoje, spot, pernas, selic, volPts, dataAlvo, primeiro]);

  const quantidade = Math.max(1, Math.floor(Number(quantidadePadrao.replace(/\./g, '')) || 100));
  const montar = (s: SerieDaCadeia, lado: 'compra' | 'venda') => {
    if (!cadeia?.vencimento) return;
    setAviso(null);
    setPernas((ps) => adicionarPerna(ps, pernaDaSerie(s, cadeia.vencimento as string, lado, quantidade)));
  };
  const mudar = (id: string, x: Partial<PernaNaTela>) => setPernas((ps) => ps.map((p) => (p.id === id ? { ...p, ...x } : p)));
  const novas = pernas.filter((p) => !p.base);
  const caixa = caixaDaMontagem(novas);
  const valorConsulta = (() => { const n = Number(precoConsulta.replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : spot; })();

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nomeParaGuardar.trim()) return setErro('Dê um nome à carteira simulada (ex.: "Trava PETR4 novembro").');
    if (novas.some((p) => p.preco <= 0 && p.tipo !== 'ativo')) return setErro('Há perna sem preço. Digite o preço antes de guardar.');
    setOcupado(true);
    setErro(null);
    try {
      const r = await chamar<{ id: string }>('POST', '/api/simulacoes', { nome: nomeParaGuardar.trim(), ativoObjeto: ativo, execucoes: execucoesParaApi(novas) });
      setAviso(`Carteira simulada "${nomeParaGuardar.trim()}" guardada. Ela acompanha o preço real a partir de agora.`);
      setNomeParaGuardar('');
      await carregarCarteiras();
      await abrirCarteira(r.id);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível guardar agora.');
    } finally {
      setOcupado(false);
    }
  }

  async function abrirCarteira(id: string) {
    setErro(null);
    try {
      const d = await chamar<DetalheDaCarteira>('GET', `/api/simulacoes/${id}`);
      setCarteira(d);
      setPernas(d.abertos.map((a) => ({
        id: novoId(), base: true, codigo: a.codigo, tipo: a.tipo, lado: a.quantidade > 0 ? 'compra' : 'venda', quantidade: Math.abs(a.quantidade),
        preco: Math.round(a.precoMedio), vol: a.vol, ...(a.strike !== null ? { strike: a.strike } : {}), ...(a.vencimento ? { vencimento: a.vencimento } : {}),
      })));
      setDiasAdiante(null);
      if (d.ativoObjeto !== ativo) await carregarCadeia(d.ativoObjeto);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível abrir agora.');
    }
  }

  async function registrarAjustes() {
    if (!carteira || !novas.length) return;
    if (novas.some((p) => p.preco <= 0 && p.tipo !== 'ativo')) return setErro('Há perna sem preço. Digite o preço antes de registrar.');
    setOcupado(true);
    setErro(null);
    try {
      await chamar('POST', `/api/simulacoes/${carteira.id}/execucoes`, { execucoes: execucoesParaApi(novas), observacao: novas.some((p) => pernas.some((b) => b.base && b.codigo === p.codigo && b.lado !== p.lado)) ? 'rolagem simulada' : 'ajuste simulado' });
      setAviso('Ajuste registrado na carteira simulada.');
      await carregarCarteiras();
      await abrirCarteira(carteira.id);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível registrar agora.');
    } finally {
      setOcupado(false);
    }
  }

  // Encerrar uma perna da carteira (primeiro passo de uma rolagem): ordem contrária pelo preço de mercado.
  function encerrar(p: PernaNaTela) {
    const c = carteira?.abertos.find((a) => a.codigo === p.codigo)?.cotacao ?? cadeia?.series.find((s) => s.codigo === p.codigo)?.cotacao ?? (p.tipo === 'ativo' ? cadeia?.ativo.cotacao ?? null : null);
    const preco = precoDeMercado(c ?? null, p.lado === 'compra' ? 'venda' : 'compra')?.preco ?? 0;
    setPernas((ps) => [...ps, pernaQueEncerra(p, preco)]);
    setAviso(`Saída de ${p.codigo} incluída${preco ? ` a ${reais(preco)}` : ' (digite o preço)'}. Para rolar, escolha a série nova na cadeia e depois "Registrar na carteira".`);
  }

  const rotulo = calculo ? `Resultado estimado da montagem em ${ativo}: hoje, em ${dataAlvo ? formatarData(dataAlvo) : '—'} e no vencimento de ${primeiro ? formatarData(primeiro) : '—'}.` : '';

  return (
    <>
      <Cabecalho
        titulo="Simulador de opções"
        apoio="Monte pela cadeia (C compra, V vende), veja o resultado hoje, numa data escolhida e no vencimento, e guarde como carteira simulada. Nada aqui envia ordem nem mexe nas suas posições."
      />
      <MensagemDeErro texto={erro} />
      <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>

      {carteira && (
        <div className="alerta" role="note" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
          <Icone nome="simulador" />
          <span style={{ flex: '1 1 300px' }}>
            Carteira simulada <strong>{carteira.nome}</strong>: posição atual carregada.
            {carteira.resultado && <> Resultado pelo mercado: realizado {formatarReais(carteira.resultado.realizadoLiquido)}, em aberto {formatarReais(carteira.resultado.naoRealizadoEstimado)}.</>}
            {' '}Inclua ajustes ou rolagens e registre.
          </span>
          <button type="button" className="botao botao-pequeno" onClick={() => { setCarteira(null); setPernas([]); setAviso(null); }}>Fechar a carteira</button>
        </div>
      )}

      <section className="secao" aria-labelledby="ativo-titulo" style={{ gap: 12 }}>
        <h2 id="ativo-titulo" className="so-leitor">Ativo e vencimento</h2>
        <div className="form-em-linha">
          <form className="form-em-linha" noValidate onSubmit={(e) => { e.preventDefault(); if (entradaAtivo.trim()) void carregarCadeia(entradaAtivo.trim().toUpperCase()); }}>
            <div className="campo" style={{ flex: '0 1 160px' }}>
              <label htmlFor="sim-ativo">Ativo</label>
              <input id="sim-ativo" value={entradaAtivo} maxLength={12} list="sim-favoritos" autoCapitalize="characters" onChange={(e) => setEntradaAtivo(e.target.value.toUpperCase())} />
              <datalist id="sim-favoritos">{favoritos.map((f) => <option key={f} value={f} />)}</datalist>
            </div>
            <button type="submit" className="botao">Carregar</button>
          </form>
          {cadeia && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{cadeia.ativo.codigo} {spot ? reais(spot) : '—'}</span>
              <span><SeloDoPreco c={cadeia.ativo.cotacao} /> <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Selic {selic ? `${selic.toLocaleString('pt-BR')}%` : 'indisponível (juros zero no cálculo)'}</span></span>
            </div>
          )}
        </div>
        {cadeia && cadeia.vencimentos.length > 0 && (
          <div className="atalhos" role="group" aria-label="Vencimentos">
            {cadeia.vencimentos.map((v) => (
              <button key={v} type="button" className={`botao botao-pequeno ${v === cadeia.vencimento ? 'botao-contorno' : ''}`} aria-pressed={v === cadeia.vencimento}
                onClick={() => void carregarCadeia(cadeia.ativo.codigo, v)}>
                {formatarData(v)}{hoje ? ` (${diasEntre(hoje, v)}d)` : ''}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="grade-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))' }}>
        <section className="secao" aria-labelledby="cadeia-titulo">
          <div className="secao-topo">
            <h2 id="cadeia-titulo">Cadeia {cadeia?.vencimento ? `· vence ${formatarData(cadeia.vencimento)}` : ''}</h2>
            <div className="form-em-linha">
              <label className="rotulo-em-linha" htmlFor="sim-qtd">Quantidade
                <input id="sim-qtd" inputMode="numeric" value={quantidadePadrao} onChange={(e) => setQuantidadePadrao(e.target.value)} style={{ width: 90, minHeight: 40, padding: '0 8px', borderRadius: 8, border: '1px solid var(--borda-campo)', background: 'var(--bg)', color: 'var(--texto)', font: 'inherit' }} />
              </label>
              <label className="rotulo-em-linha" htmlFor="sim-faixa">Strikes
                <select id="sim-faixa" value={faixa} onChange={(e) => setFaixa(e.target.value as 'perto' | 'todas')}>
                  <option value="perto">até 20% do preço</option><option value="todas">todos</option>
                </select>
              </label>
            </div>
          </div>
          {!cadeia && !erro && <p className="secao-vazia" role="status">Carregando…</p>}
          {cadeia && <Cadeia cadeia={cadeia} spot={spot} faixa={faixa} aoMontar={montar} />}
          {cadeia && (
            <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>
              Preços: {cadeia.series.some((s) => s.cotacao?.provedor === 'mt5') ? 'MetaTrader 5 onde houver; nas demais séries, ' : ''}fechamento da B3 de {formatarData(cadeia.dia)}. Vol e Δ calculados pelo sistema no fechamento. C compra pelo preço de venda (ask); V vende pelo preço de compra (bid).
              {' '}<button type="button" className="botao-texto" style={{ minHeight: 0 }} onClick={() => setPernas((ps) => adicionarPerna(ps, pernaDoAtivo(cadeia.ativo.codigo, cadeia.ativo.cotacao, 'compra', quantidade)))}>+ comprar {cadeia.ativo.codigo}</button>
            </p>
          )}
        </section>

        <div className="coluna">
          <section className="secao" aria-labelledby="pernas-titulo">
            <div className="secao-topo">
              <h2 id="pernas-titulo">Montagem</h2>
              {novas.length > 0 && <button type="button" className="botao-texto" onClick={() => setPernas((ps) => ps.filter((p) => p.base))}>Limpar o que é novo</button>}
            </div>
            {pernas.length === 0 ? <p className="secao-vazia">Clique em C ou V na cadeia para montar.</p> : (
              <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Pernas da montagem" style={{ margin: '0 -24px' }}>
                <table className="tabela">
                  <thead>
                    <tr><th scope="col">Perna</th><th scope="col">Operação</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Preço</th><th scope="col" className="numero">Vol</th><th scope="col"><span className="so-leitor">Ações</span></th></tr>
                  </thead>
                  <tbody>
                    {pernas.map((p) => (
                      <tr key={p.id} style={p.base ? { background: 'var(--painel2)' } : undefined}>
                        <th scope="row">{p.codigo}<span className="sub">{p.tipo === 'ativo' ? 'Ação' : `${p.tipo === 'call' ? 'Call' : 'Put'} ${reais(p.strike as number)} · ${formatarData(p.vencimento as string)}`}{p.base ? ' · posição da carteira' : ''}</span></th>
                        <td>
                          {p.base ? <span className={p.lado === 'venda' ? 'resultado-baixa' : ''} style={{ fontWeight: 600 }}>{p.lado === 'compra' ? 'Comprado' : 'Vendido'}</span> : (
                            <select aria-label={`Operação em ${p.codigo}`} value={p.lado} onChange={(e) => mudar(p.id, { lado: e.target.value as 'compra' | 'venda' })} style={{ minHeight: 36, borderRadius: 8, background: 'var(--bg)', color: 'var(--texto)', border: '1px solid var(--borda-campo)' }}>
                              <option value="compra">Compra</option><option value="venda">Venda</option>
                            </select>
                          )}
                        </td>
                        <td className="numero">
                          {p.base ? p.quantidade.toLocaleString('pt-BR') : <input aria-label={`Quantidade de ${p.codigo}`} type="number" min={1} step={100} value={p.quantidade} onChange={(e) => mudar(p.id, { quantidade: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} style={{ width: 90 }} />}
                        </td>
                        <td className="numero">
                          {p.base ? reais(p.preco) : <input aria-label={`Preço de ${p.codigo} em reais`} type="number" min={0} step={0.01} value={(p.preco / 100).toFixed(2)} onChange={(e) => mudar(p.id, { preco: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })} style={{ width: 90 }} />}
                        </td>
                        <td className="numero">
                          {p.tipo === 'ativo' ? '—' : <input aria-label={`Volatilidade de ${p.codigo} em %`} type="number" min={1} max={300} step={0.5} value={p.vol === null ? '' : Math.round(p.vol * 1000) / 10} placeholder="?" onChange={(e) => { const n = Number(e.target.value); mudar(p.id, { vol: e.target.value === '' || !(n > 0) ? null : n / 100 }); }} style={{ width: 72 }} />}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {p.base
                            ? <button type="button" className="botao botao-pequeno" onClick={() => encerrar(p)}>Encerrar</button>
                            : <button type="button" className="botao-texto botao-perigo" onClick={() => setPernas((ps) => ps.filter((x) => x.id !== p.id))} aria-label={`Tirar ${p.codigo}`}><Icone nome="lixeira" tamanho={18} /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {novas.length > 0 && (
              <p style={{ margin: 0 }}>
                {carteira ? 'Caixa do ajuste' : 'Caixa da montagem'}: <strong className={classeDoValor(caixa)}>{caixa > 0 ? `crédito de ${formatarReais(caixa)}` : caixa < 0 ? `débito de ${formatarReais(-caixa)}` : 'zero'}</strong>
                <span className="linha-lista-apoio" style={{ fontSize: 13 }}> (sem custos; crédito não é lucro)</span>
              </p>
            )}
            {pernas.some((p) => p.tipo !== 'ativo' && p.vol === null) && (
              <p className="aviso-tracejado">Série sem volatilidade calculada: digite uma (em %) para estimar antes do vencimento. Sem ela, só o vencimento é calculado.</p>
            )}
            {!carteira && novas.length > 0 && (
              <form className="form-em-linha" noValidate onSubmit={guardar}>
                <div className="campo" style={{ flex: '1 1 220px' }}>
                  <label htmlFor="sim-nome">Guardar como carteira simulada</label>
                  <input id="sim-nome" value={nomeParaGuardar} maxLength={80} placeholder="Ex.: Trava de alta PETR4 dezembro" onChange={(e) => setNomeParaGuardar(e.target.value)} />
                </div>
                <button type="submit" className="botao botao-principal" disabled={ocupado}>Guardar</button>
              </form>
            )}
            {carteira && novas.length > 0 && (
              <div><button type="button" className="botao botao-principal" disabled={ocupado} onClick={() => void registrarAjustes()}>Registrar na carteira simulada</button></div>
            )}
          </section>

          {calculo && (
            <section className="secao" aria-labelledby="resultado-titulo">
              <h2 id="resultado-titulo">Resultado (estimativa)</h2>
              <div className="grade-cartoes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                  <span className="fonte-texto">Agora (pelo modelo)</span>
                  <strong className={classeDoValor(calculo.agora.resultado)} style={{ fontSize: 18 }}>{formatarReais(calculo.agora.resultado)}</strong>
                </div>
                <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                  <span className="fonte-texto">Máx. no vencimento</span>
                  <strong style={{ fontSize: 18 }}>{formatarReais(calculo.extremosVenc.maximo?.valor ?? null)}</strong>
                  <span className="fonte-texto" style={{ fontSize: 12 }}>dentro da faixa do gráfico</span>
                </div>
                <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                  <span className="fonte-texto">Mín. no vencimento</span>
                  <strong className={classeDoValor(calculo.extremosVenc.minimo?.valor ?? null)} style={{ fontSize: 18 }}>{formatarReais(calculo.extremosVenc.minimo?.valor ?? null)}</strong>
                  <span className="fonte-texto" style={{ fontSize: 12 }}>dentro da faixa do gráfico</span>
                </div>
                <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                  <span className="fonte-texto">Equilíbrio no vencimento</span>
                  <strong style={{ fontSize: 16 }}>{calculo.equilibriosVenc.length ? calculo.equilibriosVenc.map(reais).join(' · ') : '—'}</strong>
                </div>
                <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                  <span className="fonte-texto">Gregas (hoje)</span>
                  <span style={{ fontSize: 13 }}>Δ {calculo.gregas.delta.toLocaleString('pt-BR')} ações · Γ {calculo.gregas.gamma.toLocaleString('pt-BR')}</span>
                  <span style={{ fontSize: 13 }}>Θ {formatarReais(calculo.gregas.theta)}/dia · Vega {formatarReais(calculo.gregas.vega)}/ponto</span>
                </div>
              </div>

              <Grafico
                rotulos={rotulo}
                spot={spot}
                strikes={[...new Set(pernas.filter((p) => p.strike !== undefined).map((p) => p.strike as number))]}
                curvas={[
                  { nome: 'Hoje', pontos: calculo.curvaHoje, cor: CORES.hoje },
                  { nome: `Em ${dataAlvo ? formatarData(dataAlvo) : '—'}`, pontos: calculo.curvaAlvo, cor: CORES.alvo },
                  { nome: `No vencimento ${primeiro ? `(${formatarData(primeiro)})` : ''}`, pontos: calculo.curvaVenc, cor: CORES.venc, tracejado: true },
                ]}
              />

              <div className="form-em-linha" style={{ alignItems: 'center' }}>
                <div className="campo" style={{ flex: '2 1 260px' }}>
                  <label htmlFor="sim-data">Data da simulação: {dataAlvo ? formatarData(dataAlvo) : '—'} ({dias} {dias === 1 ? 'dia' : 'dias'} à frente)</label>
                  <input id="sim-data" type="range" min={0} max={Math.max(totalDias, 1)} value={dias} onChange={(e) => setDiasAdiante(Number(e.target.value))} />
                </div>
                <div className="campo" style={{ flex: '1 1 200px' }}>
                  <label htmlFor="sim-vol">Volatilidade: {volPts > 0 ? '+' : ''}{volPts} pontos</label>
                  <input id="sim-vol" type="range" min={-20} max={20} step={1} value={volPts} onChange={(e) => setVolPts(Number(e.target.value))} />
                </div>
              </div>

              <div className="form-em-linha" style={{ alignItems: 'center' }}>
                <div className="campo" style={{ flex: '0 1 200px' }}>
                  <label htmlFor="sim-consulta">E se {ativo} for a (R$)</label>
                  <input id="sim-consulta" inputMode="decimal" value={precoConsulta} placeholder={spot ? reais(spot) : ''} onChange={(e) => setPrecoConsulta(e.target.value)} />
                </div>
                {valorConsulta && (
                  <p style={{ margin: 0 }} aria-live="polite">
                    Hoje: <strong className={classeDoValor(resultadoEmPreco(calculo.curvaHoje, valorConsulta))}>{formatarReais(resultadoEmPreco(calculo.curvaHoje, valorConsulta))}</strong>
                    {' · '}Em {dataAlvo ? formatarData(dataAlvo) : '—'}: <strong className={classeDoValor(resultadoEmPreco(calculo.curvaAlvo, valorConsulta))}>{formatarReais(resultadoEmPreco(calculo.curvaAlvo, valorConsulta))}</strong>
                    {' · '}No vencimento: <strong className={classeDoValor(resultadoEmPreco(calculo.curvaVenc, valorConsulta))}>{formatarReais(resultadoEmPreco(calculo.curvaVenc, valorConsulta))}</strong>
                  </p>
                )}
              </div>
              {vencs.length > 1 && <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>Vencimentos diferentes: no primeiro vencimento ({primeiro ? formatarData(primeiro) : ''}), as pernas que continuam vivas são estimadas pelo modelo.</p>}
              <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>
                Estimativa Black-Scholes com a volatilidade de cada perna{volPts ? ` ${volPts > 0 ? '+' : ''}${volPts} pontos` : ''}, Selic contínua e pregões até o vencimento. Exercício europeu: opções americanas podem ser exercidas antes. Sem custos de corretagem.
              </p>
            </section>
          )}
        </div>
      </div>

      <section className="secao" aria-labelledby="carteiras-titulo">
        <h2 id="carteiras-titulo">Carteiras simuladas</h2>
        {carteiras.length === 0 ? <p className="secao-vazia">Nenhuma ainda. Monte acima e use "Guardar" para acompanhar uma ideia com o preço real, sem dinheiro de verdade.</p> : (
          <div className="pontes">
            {carteiras.map((c) => (
              <div key={c.id} className="ponte" style={{ padding: '10px 14px' }}>
                <div className="ponte-texto">
                  <div className="ponte-nome"><strong>{c.nome}</strong><span className={`selo ${c.situacao === 'aberta' ? 'selo-alta' : 'selo-neutro'}`} style={{ fontSize: 13 }}>{c.situacao === 'aberta' ? 'Aberta' : 'Encerrada'}</span></div>
                  <span className="ponte-apoio">
                    {c.ativoObjeto} · {c.operacoes} operações · {c.abertos} pernas abertas · atualizada {quandoCurto(c.atualizadaEm)}
                    {c.resultado && <> · realizado <span className={classeDoValor(c.resultado.realizadoLiquido)}>{formatarReais(c.resultado.realizadoLiquido)}</span>, em aberto <span className={classeDoValor(c.resultado.naoRealizadoEstimado)}>{formatarReais(c.resultado.naoRealizadoEstimado)}</span></>}
                  </span>
                </div>
                <div className="ponte-acoes">
                  {c.situacao === 'aberta' && <button type="button" className="botao botao-pequeno" onClick={() => void abrirCarteira(c.id)}>Abrir no simulador</button>}
                  <button type="button" className="botao-texto" onClick={() => void chamar('PATCH', `/api/simulacoes/${c.id}`, { situacao: c.situacao === 'aberta' ? 'encerrada' : 'aberta' }).then(carregarCarteiras)}>{c.situacao === 'aberta' ? 'Encerrar' : 'Reabrir'}</button>
                  <button type="button" className="botao-texto botao-perigo" onClick={() => { if (window.confirm(`Excluir a carteira simulada "${c.nome}"?`)) void chamar('DELETE', `/api/simulacoes/${c.id}`).then(() => { if (carteira?.id === c.id) { setCarteira(null); setPernas([]); } return carregarCarteiras(); }); }}>Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
