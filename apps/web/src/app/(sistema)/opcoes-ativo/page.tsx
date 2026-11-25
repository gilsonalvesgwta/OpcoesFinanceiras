'use client';

// Opções por ativo: o espaço exclusivo das opções de BBAS3, PETR4 e de qualquer ativo em
// que você opera opções. Resultado, prêmio por mês, rendimento sobre as ações, taxa de
// acerto, pernas abertas e o histórico. Atualiza sozinho com as notas e o extrato da B3.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { pctBr } from '../../../lib/carteira.ts';

type Serie = {
  codigo: string; tipo: 'call' | 'put'; strike: number; vencimento: string; lado: 'vendida' | 'comprada'; quantidadeNegociada: number; base: number;
  realizadoLiquido: number; custos: number; quantidadeAberta: number; precoMedioComCustos: number; vencida: boolean; encerrada: boolean;
  precoAgora: number | null; emAberto: number | null; resultado: number; fracao: number | null; diasAteVencimento: number | null; distancia: number | null; dentroDoDinheiro: boolean | null; ultima: string;
};
type Operacao = { instante: string; data: string; codigo: string; tipo: 'call' | 'put'; strike: number; vencimento: string; lado: 'compra' | 'venda'; quantidade: number; preco: number; custos: number; total: number; saldo: number };
type Mes = { mes: string; vendas: number; compras: number; custos: number; liquido: number; operacoes: number };
type Painel = {
  ativo: string; hoje: string; cotacao: { ultimo: number | null; variacao: number | null; qualidade: string | null; provedor: string | null } | null;
  acao: { quantidade: number; precoMedio: number; precoMedioComCustos: number; custo: number } | null;
  totais: {
    vendas: number; compras: number; custos: number; liquido: number; realizado: number; emAberto: number; resultado: number; series: number; encerradas: number; comLucro: number;
    acerto: number | null; meses: number; mediaMensal: number | null; rendimentoSobreAcoes: number | null; rendimentoMensal: number | null;
    cobertura: { acoes: number; callsVendidas: number; descobertas: number };
  };
  meses: Mes[]; series: Serie[]; operacoes: Operacao[];
};

const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const reais = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sinal = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${formatarReais(v)}`);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeDoMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const PREFERIDOS = ['BBAS3', 'PETR4'];

function GraficoDosMeses({ meses }: { meses: Mes[] }) {
  if (!meses.length) return null;
  const ultimos = meses.slice(-18);
  const w = 760; const h = 200; const base = 150; const topo = 20;
  const max = Math.max(1, ...ultimos.map((m) => Math.abs(m.liquido)));
  const temNeg = ultimos.some((m) => m.liquido < 0);
  const zero = temNeg ? (topo + base) / 2 : base;
  const escala = (zero - topo) / max;
  const larg = w / ultimos.length;
  return (
    <svg className="oa-grafico" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Prêmio líquido por mês: ${ultimos.map((m) => `${nomeDoMes(m.mes)} ${reais(m.liquido)}`).join('; ')}`}>
      <line x1={0} x2={w} y1={zero} y2={zero} style={{ stroke: 'var(--linha)' }} />
      {ultimos.map((m, i) => {
        const alt = Math.max(2, Math.abs(m.liquido) * escala);
        const x = i * larg + larg * 0.18;
        const y = m.liquido >= 0 ? zero - alt : zero;
        return (
          <g key={m.mes}>
            <title>{`${nomeDoMes(m.mes)}: ${reais(m.liquido)} (${m.operacoes} operações)`}</title>
            <rect x={x} y={y} width={larg * 0.64} height={alt} rx={4} style={{ fill: m.liquido >= 0 ? 'var(--alta)' : 'var(--baixa)', opacity: 0.9 }} />
            {ultimos.length <= 12 && <text x={x + larg * 0.32} y={m.liquido >= 0 ? y - 6 : y + alt + 14} textAnchor="middle" style={{ fill: 'var(--texto)', fontSize: 12, fontWeight: 600 }}>{Math.round(m.liquido / 100).toLocaleString('pt-BR')}</text>}
            <text x={x + larg * 0.32} y={h - 12} textAnchor="middle" style={{ fill: 'var(--apoio)', fontSize: 12 }}>{nomeDoMes(m.mes)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function PaginaOpcoesDoAtivo() {
  const [ativos, setAtivos] = useState<{ ativo: string; operacoes: number }[] | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'abertas' | 'encerradas' | 'todas'>('todas');
  const [limiteOps, setLimiteOps] = useState(40);
  const carregando = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await chamar<{ ativos: { ativo: string; operacoes: number }[] }>('GET', '/api/opcoes-do-ativo/ativos');
        const lista = [...r.ativos].sort((a, b) => (PREFERIDOS.indexOf(a.ativo) + 1 || 99) - (PREFERIDOS.indexOf(b.ativo) + 1 || 99) || b.operacoes - a.operacoes);
        setAtivos(lista);
        const daUrl = new URLSearchParams(window.location.search).get('ativo');
        let salvo: string | null = null;
        try { salvo = window.localStorage.getItem('wta-opcoes-ativo'); } catch { /* sem armazenamento */ }
        setAtivo([daUrl, salvo].find((a) => a && lista.some((x) => x.ativo === a)) ?? lista[0]?.ativo ?? null);
      } catch (x) {
        setErro(x instanceof Error ? x.message : 'Não foi possível carregar.');
      }
    })();
  }, []);

  const carregar = useCallback(async (a: string) => {
    if (carregando.current) return;
    carregando.current = true;
    try {
      const r = await chamar<Painel>('GET', `/api/opcoes-do-ativo?ativo=${a}`);
      setP((atual) => (r.ativo === a ? r : atual));
      setErro(null);
    } catch (x) {
      setErro(x instanceof ErroDaApi && x.codigo === 'sem_operacoes_do_ativo' ? `Nenhuma operação de ${a} ainda.` : x instanceof Error ? x.message : 'Não foi possível carregar.');
    } finally {
      carregando.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ativo) return;
    setP(null);
    setLimiteOps(40);
    try { window.localStorage.setItem('wta-opcoes-ativo', ativo); } catch { /* sem armazenamento */ }
    window.history.replaceState(null, '', `?ativo=${ativo}`);
    void carregar(ativo);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar(ativo); }, 10_000);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  const t = p?.totais;
  const abertas = p?.series.filter((x) => !x.encerrada && !x.vencida) ?? [];
  const lista = (p?.series ?? []).filter((x) => (filtro === 'todas' ? true : filtro === 'abertas' ? !x.encerrada : x.encerrada));

  return (
    <>
      <Cabecalho titulo="Opções por ativo" apoio="Tudo o que você operou em opções de cada ativo, atualizado sozinho com as notas e o extrato da B3. Só acompanhamento: nada aqui envia ordem." />
      <MensagemDeErro texto={erro} />

      {ativos && ativos.length === 0 && (
        <section className="secao"><p className="secao-vazia">Nenhuma operação de opção ainda. Importe as notas ou o extrato da B3 em <Link href="/carteira">Minha carteira</Link>.</p></section>
      )}

      {ativos && ativos.length > 0 && (
        <nav className="oa-abas" aria-label="Ativo">
          {ativos.map((a) => (
            <button key={a.ativo} type="button" className={`oa-aba${a.ativo === ativo ? ' ativa' : ''}`} aria-pressed={a.ativo === ativo} onClick={() => setAtivo(a.ativo)}>
              <strong>{a.ativo}</strong><span>{a.operacoes} operações</span>
            </button>
          ))}
        </nav>
      )}

      {ativo && !p && !erro && <section className="secao"><p className="secao-vazia" role="status">Carregando {ativo}…</p></section>}

      {p && t && (
        <>
          <section className="oa-hero" aria-label={`Resumo das opções de ${p.ativo}`}>
            <div className="oa-hero-topo">
              <div>
                <span className="lotes-rotulo">Opções de</span>
                <h2>{p.ativo}</h2>
                <span className="oa-preco">
                  {p.cotacao?.ultimo ? `R$ ${reais(p.cotacao.ultimo)}` : 'sem preço agora'}
                  {p.cotacao?.variacao != null && <span className={classe(p.cotacao.variacao)}> {pctBr(p.cotacao.variacao)} hoje</span>}
                </span>
              </div>
              <div className="oa-acao">
                {p.acao && p.acao.quantidade > 0 ? (
                  <>
                    <span className="lotes-rotulo">Suas ações</span>
                    <strong>{p.acao.quantidade.toLocaleString('pt-BR')} × PM R$ {reais(p.acao.precoMedioComCustos)}</strong>
                    <span className="lotes-rotulo">{t.cobertura.callsVendidas.toLocaleString('pt-BR')} cobertas por calls · {Math.max(0, t.cobertura.acoes - t.cobertura.callsVendidas).toLocaleString('pt-BR')} livres</span>
                  </>
                ) : <span className="lotes-rotulo">Você não tem ações de {p.ativo} em carteira.</span>}
              </div>
            </div>
            <dl className="oa-kpis">
              <div className="destaque"><dt>Resultado das opções</dt><dd className={classe(t.resultado)}>{sinal(t.resultado)}</dd><dd className="oa-nota">realizado {sinal(t.realizado)} · em aberto {sinal(t.emAberto)}</dd></div>
              <div><dt>Prêmio líquido</dt><dd className={classe(t.liquido)}>{sinal(t.liquido)}</dd><dd className="oa-nota">vendas {formatarReais(t.vendas)} − compras {formatarReais(t.compras)} − custos {formatarReais(t.custos)}</dd></div>
              <div><dt>Média mensal</dt><dd className={classe(t.mediaMensal)}>{sinal(t.mediaMensal)}</dd><dd className="oa-nota">{t.meses} {t.meses === 1 ? 'mês' : 'meses'} operando</dd></div>
              <div><dt>Rendimento sobre as ações</dt><dd className={classe(t.rendimentoSobreAcoes)}>{pctBr(t.rendimentoSobreAcoes)}</dd><dd className="oa-nota">{t.rendimentoMensal !== null ? `${(t.rendimentoMensal * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% ao mês` : 'sem ações em carteira'}</dd></div>
              <div><dt>Taxa de acerto</dt><dd>{t.acerto !== null ? `${Math.round(t.acerto * 100)}%` : '—'}</dd><dd className="oa-nota">{t.comLucro} de {t.encerradas} séries encerradas com lucro</dd></div>
            </dl>
            {t.cobertura.descobertas > 0 && (
              <div className="alerta" role="note"><Icone nome="aviso" /><span>{t.cobertura.descobertas.toLocaleString('pt-BR')} calls vendidas sem ações que as cubram: o prejuízo não tem limite se {p.ativo} subir.</span></div>
            )}
          </section>

          <section className="secao" aria-labelledby="oa-meses">
            <div className="secao-topo" style={{ padding: 0 }}><h2 id="oa-meses">Prêmio líquido por mês</h2><span className="linha-lista-apoio">vendas − compras − custos, no mês de cada operação</span></div>
            <GraficoDosMeses meses={p.meses} />
          </section>

          <section className="secao" aria-labelledby="oa-abertas">
            <h2 id="oa-abertas">Pernas abertas ({abertas.length})</h2>
            {abertas.length === 0 ? <p className="secao-vazia" style={{ margin: 0 }}>Nenhuma opção aberta de {p.ativo} agora.</p> : (
              <ul className="oa-pernas">
                {abertas.map((x) => {
                  const perigo = x.quantidadeAberta < 0 && x.dentroDoDinheiro;
                  return (
                    <li key={`${x.codigo}-${x.vencimento}`} className={perigo ? 'atencao' : ''}>
                      <div className="oa-perna-topo">
                        <span className={`vaca-tipo ${x.tipo}`}>{x.tipo === 'call' ? 'CALL' : 'PUT'}</span>
                        <strong>{x.codigo}</strong>
                        <span className={`oa-dinheiro ${x.dentroDoDinheiro ? 'dentro' : ''}`}>{x.dentroDoDinheiro === null ? '' : x.dentroDoDinheiro ? 'dentro do dinheiro' : 'fora do dinheiro'}</span>
                      </div>
                      <dl className="oa-perna-dados">
                        <div><dt>Posição</dt><dd>{x.quantidadeAberta < 0 ? 'vendida' : 'comprada'} {Math.abs(x.quantidadeAberta).toLocaleString('pt-BR')}</dd></div>
                        <div><dt>Strike</dt><dd>R$ {reais(x.strike)}{x.distancia !== null ? <small> {pctBr(x.distancia)}</small> : null}</dd></div>
                        <div><dt>Vence</dt><dd>{formatarData(x.vencimento)}{x.diasAteVencimento !== null ? <small> {x.diasAteVencimento} d</small> : null}</dd></div>
                        <div><dt>Preço médio</dt><dd>R$ {reais(x.precoMedioComCustos)}</dd></div>
                        <div><dt>Preço agora</dt><dd>R$ {reais(x.precoAgora)}</dd></div>
                        <div><dt>Resultado</dt><dd className={classe(x.emAberto)}>{sinal(x.emAberto)}</dd></div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="secao" aria-labelledby="oa-series">
            <div className="secao-topo" style={{ padding: 0 }}>
              <h2 id="oa-series">Resultado por série ({p.series.length})</h2>
              <div className="opc-filtro" role="group" aria-label="Quais séries mostrar">
                {(['todas', 'encerradas', 'abertas'] as const).map((f) => (
                  <button key={f} type="button" className={`botao botao-pequeno${filtro === f ? ' botao-principal' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{f === 'todas' ? 'Todas' : f === 'encerradas' ? 'Encerradas' : 'Em aberto'}</button>
                ))}
              </div>
            </div>
            <div className="tabela-caixa" tabIndex={0} role="region" aria-label={`Resultado por série de ${p.ativo}`}>
              <table className="tabela">
                <thead><tr><th scope="col">Série</th><th scope="col">Posição</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Prêmio</th><th scope="col" className="numero">Resultado</th><th scope="col" className="numero">%</th><th scope="col">Situação</th></tr></thead>
                <tbody>
                  {lista.map((x) => (
                    <tr key={`${x.codigo}-${x.vencimento}`}>
                      <th scope="row">{x.codigo}<span className="sub">{x.tipo === 'call' ? 'Call' : 'Put'} {reais(x.strike)} · {formatarData(x.vencimento)}</span></th>
                      <td>{x.lado === 'vendida' ? 'Vendida' : 'Comprada'}</td>
                      <td className="numero">{x.quantidadeNegociada.toLocaleString('pt-BR')}</td>
                      <td className="numero">{formatarReais(x.base)}</td>
                      <td className={`numero ${classe(x.resultado)}`}>{sinal(x.resultado)}</td>
                      <td className={`numero ${classe(x.fracao)}`}>{pctBr(x.fracao)}</td>
                      <td><span className="sub" style={{ marginTop: 0 }}>{x.encerrada ? `encerrada ${formatarData(x.ultima.slice(0, 10))}` : x.vencida ? 'vencida' : 'aberta'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="secao" aria-labelledby="oa-ops">
            <h2 id="oa-ops">Operações ({p.operacoes.length})</h2>
            <div className="tabela-caixa vaca-tabela" tabIndex={0} role="region" aria-label={`Operações de opções de ${p.ativo}`}>
              <table className="tabela">
                <thead><tr><th scope="col">Data</th><th scope="col">Operação</th><th scope="col">Código</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Preço</th><th scope="col" className="numero">Custos</th><th scope="col" className="numero">Total</th><th scope="col" className="numero">Saldo</th></tr></thead>
                <tbody>
                  {p.operacoes.slice(0, limiteOps).map((o, i) => (
                    <tr key={`${o.instante}-${i}`}>
                      <td>{formatarData(o.data)}</td>
                      <td><span className={`vaca-lado ${o.lado}`}>{o.lado === 'venda' ? 'VENDA' : 'COMPRA'}</span> {o.tipo.toUpperCase()}</td>
                      <td><strong>{o.codigo}</strong><span className="sub" style={{ marginTop: 0 }}>strike {reais(o.strike)} · {formatarData(o.vencimento)}</span></td>
                      <td className="numero">{o.quantidade.toLocaleString('pt-BR')}</td>
                      <td className="numero">{reais(o.preco)}</td>
                      <td className="numero">{o.custos ? formatarReais(o.custos) : '—'}</td>
                      <td className={`numero vaca-total ${o.total >= 0 ? 'mais' : 'menos'}`}>{formatarReais(o.total)}</td>
                      <td className={`numero ${classe(o.saldo)}`}>{formatarReais(o.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {p.operacoes.length > limiteOps && <button type="button" className="botao-texto" onClick={() => setLimiteOps((l) => l + 60)}>Mostrar mais ({p.operacoes.length - limiteOps})</button>}
          </section>
        </>
      )}
    </>
  );
}
