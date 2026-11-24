'use client';

// Visão da Minha carteira: resumo com a divisão por classe, seções por classe (ações, FIIs,
// ETFs, renda fixa, BDRs) com uma lista limpa de ativos que abre ao clicar (preço médio,
// lotes, opções do ativo) e o painel de lucros e perdas das opções.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatarData, formatarReais } from '../lib/formatos.ts';
import {
  NOME_DA_CLASSE, ORDEM_DAS_CLASSES, pctBr, type Carteira, type ClasseDoAtivo, type GrupoDaCarteira, type SerieDeOpcao, type SomaDasOpcoes,
} from '../lib/carteira.ts';
import { Icone } from './Icone.tsx';
import { LotesDoAtivo } from './LotesDoAtivo.tsx';

const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const preco = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sinal = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${formatarReais(v)}`);
const COR_DA_CLASSE: Record<ClasseDoAtivo, string> = { acoes: 'var(--latao)', fiis: 'var(--vivo)', etfs: 'var(--periodica)', renda_fixa: 'var(--historico)', bdrs: 'var(--alta)' };
type Grupo = GrupoDaCarteira & { classe: ClasseDoAtivo };

// Ação (ou fundo/ETF) do grupo e números de "patrimônio": só a parte comprada do ativo.
function resumoDoGrupo(g: Grupo) {
  const acao = g.itens.find((i) => i.tipo === 'ativo' && !i.vencida) ?? null;
  const opcoes = g.itens.filter((i) => i.tipo !== 'ativo');
  const valor = acao && acao.quantidade > 0 ? acao.valorDeMercado : null;
  return { acao, opcoes, valor };
}

function DetalheDoAtivo({ g }: { g: Grupo }) {
  const ativas = g.itens.filter((i) => !i.vencida);
  const vencidas = g.itens.filter((i) => i.vencida);
  const { acao } = resumoDoGrupo(g);
  const descricao = (i: { tipo: string; strike: number | null; vencimento: string | null }) => (i.tipo === 'ativo' ? 'Ação / cota' : `${i.tipo === 'call' ? 'Call' : 'Put'} ${preco(i.strike)} · ${i.vencimento ? formatarData(i.vencimento) : '—'}`);
  return (
    <div className="ativo-detalhe">
      {acao && acao.quantidade > 0 && (
        <dl className="ativo-numeros">
          <div><dt>Quantidade</dt><dd>{acao.quantidade.toLocaleString('pt-BR')}</dd></div>
          <div><dt>Preço médio</dt><dd>R$ {preco(acao.precoMedio)}</dd></div>
          <div><dt>Médio com custos</dt><dd>R$ {preco(acao.precoMedioComCustos)}</dd></div>
          <div><dt>Preço agora</dt><dd>R$ {preco(acao.preco)}</dd></div>
          <div><dt>Custo total</dt><dd>{formatarReais(acao.custoDaPosicao)}</dd></div>
          <div><dt>Valor de mercado</dt><dd>{formatarReais(acao.valorDeMercado)}</dd></div>
          <div><dt>Resultado</dt><dd className={classe(acao.resultado)}>{sinal(acao.resultado)} <small>{pctBr(acao.resultadoFracao)}</small></dd></div>
          <div><dt>Realizado</dt><dd className={classe(acao.realizadoLiquido)}>{acao.realizadoLiquido ? sinal(acao.realizadoLiquido) : '—'}</dd></div>
        </dl>
      )}
      {g.cobertura.descobertas > 0 && (
        <div className="alerta" role="note"><Icone nome="aviso" /><span>{g.cobertura.descobertas.toLocaleString('pt-BR')} calls vendidas sem ações nem calls compradas que as cubram: o prejuízo não tem limite se {g.ativoObjeto} subir.</span></div>
      )}
      {acao && acao.quantidade > 0 && <LotesDoAtivo ativo={acao.codigo} acao={acao} callsVendidas={g.cobertura.callsVendidas} />}
      <div className="tabela-caixa" tabIndex={0} role="region" aria-label={`Posição em ${g.ativoObjeto}`}>
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Código</th><th scope="col" className="numero">Quantidade</th><th scope="col" className="numero">Preço médio</th>
              <th scope="col" className="numero">Médio c/ custos</th><th scope="col" className="numero">Preço agora</th>
              <th scope="col" className="numero">Valor de mercado</th><th scope="col" className="numero">Resultado</th><th scope="col" className="numero">%</th>
            </tr>
          </thead>
          <tbody>
            {ativas.map((i) => (
              <tr key={i.codigo}>
                <th scope="row">{i.codigo}<span className="sub">{descricao(i)}{i.diasAteVencimento !== null ? ` · ${i.diasAteVencimento} dias` : ''}</span></th>
                <td className={`numero ${i.quantidade < 0 ? 'resultado-baixa' : ''}`}>{i.quantidade.toLocaleString('pt-BR')}{i.quantidade < 0 ? ' (vendida)' : ''}</td>
                <td className="numero">{preco(i.precoMedio)}</td>
                <td className="numero"><strong>{preco(i.precoMedioComCustos)}</strong></td>
                <td className="numero" style={i.provedor === 'mt5' && i.qualidade === 'tempo_real' ? { color: 'var(--vivo)' } : undefined}>{preco(i.preco)}</td>
                <td className="numero">{formatarReais(i.valorDeMercado)}</td>
                <td className={`numero ${classe(i.resultado)}`}>{sinal(i.resultado)}</td>
                <td className={`numero ${classe(i.resultadoFracao)}`}>{pctBr(i.resultadoFracao)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {vencidas.length > 0 && (
        <div className="alerta" role="note"><Icone nome="aviso" /><span>
          Opções vencidas ainda com quantidade: {vencidas.map((v) => `${v.codigo} (${v.quantidade.toLocaleString('pt-BR')})`).join(', ')}. Se viraram pó, marque &quot;Vencer&quot; em <Link href="/posicoes">Posições</Link>; se foram exercidas, lance a ação.
        </span></div>
      )}
      <div className="ativo-acoes">
        <span className="linha-lista-apoio" style={{ fontSize: 13 }}>{g.cobertura.acoes.toLocaleString('pt-BR')} em carteira · {g.cobertura.callsVendidas.toLocaleString('pt-BR')} calls vendidas · {g.cobertura.callsCompradas.toLocaleString('pt-BR')} calls compradas</span>
        <Link className="botao botao-pequeno" href={`/simulador?ativo=${g.ativoObjeto}&carteira=1`}>Simular com esta posição</Link>
      </div>
    </div>
  );
}

function LinhaDoAtivo({ g, aberto, alternar, total }: { g: Grupo; aberto: boolean; alternar: () => void; total: number }) {
  const { acao, opcoes, valor } = resumoDoGrupo(g);
  const vivas = opcoes.filter((o) => !o.vencida);
  const id = `ativo-${g.ativoObjeto}`;
  const sub = acao && acao.quantidade > 0
    ? `${acao.quantidade.toLocaleString('pt-BR')} × PM R$ ${preco(acao.precoMedioComCustos)}`
    : 'sem o ativo em carteira';
  return (
    <li className={`ativo-linha${aberto ? ' aberto' : ''}`}>
      <button type="button" className="ativo-cabeca" aria-expanded={aberto} {...(aberto ? { "aria-controls": id } : {})} onClick={alternar}>
        <span className="ativo-nome"><strong>{g.ativoObjeto}</strong><span>{sub}{vivas.length ? ` · ${vivas.length} opç${vivas.length > 1 ? 'ões' : 'ão'}` : ''}</span></span>
        <span className="ativo-col"><span className="ativo-rotulo">Agora</span>R$ {preco(g.cotacao?.ultimo ?? null)}</span>
        <span className="ativo-col"><span className="ativo-rotulo">Valor</span>{formatarReais(valor)}{valor !== null && total > 0 ? <small> {((valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small> : null}</span>
        <span className={`ativo-col ${classe(g.resultado)}`}><span className="ativo-rotulo">Resultado</span>{sinal(g.resultado)}{acao?.resultadoFracao != null && acao.quantidade > 0 ? <small> {pctBr(acao.resultadoFracao)}</small> : null}</span>
        <span className="ativo-seta" aria-hidden="true">{aberto ? '▴' : '▾'}</span>
      </button>
      {aberto && <div id={id}><DetalheDoAtivo g={g} /></div>}
    </li>
  );
}

function CartaoOpcoes({ titulo, s, apoio }: { titulo: string; s: SomaDasOpcoes; apoio: string }) {
  return (
    <div className="opc-cartao">
      <span className="lotes-rotulo">{titulo}</span>
      <strong className={classe(s.resultado)}>{sinal(s.resultado)}</strong>
      <span className={classe(s.fracao)} style={{ fontWeight: 600 }}>{pctBr(s.fracao)} <small className="lotes-rotulo">sobre {formatarReais(s.base)} de prêmio</small></span>
      <span className="lotes-rotulo">{apoio.replace('{n}', String(s.series)).replace('{g}', String(s.ganhos)).replace('{p}', String(s.perdas))}</span>
    </div>
  );
}

function PainelDasOpcoes({ opcoes }: { opcoes: Carteira['opcoes'] }) {
  const [filtro, setFiltro] = useState<'abertas' | 'encerradas' | 'todas'>('abertas');
  const [limite, setLimite] = useState(30);
  const lista = opcoes.series.filter((o) => (filtro === 'todas' ? true : filtro === 'abertas' ? !o.encerrada : o.encerrada));
  if (!opcoes.series.length) return null;
  const situacao = (o: SerieDeOpcao) => (o.encerrada ? `encerrada ${formatarData(o.ultima.slice(0, 10))}` : o.vencida ? 'vencida' : `aberta · ${Math.abs(o.quantidadeAberta).toLocaleString('pt-BR')}`);
  return (
    <section className="secao opc-painel" aria-labelledby="opc-titulo">
      <div className="secao-topo" style={{ padding: 0 }}>
        <h2 id="opc-titulo">Opções: lucros e perdas</h2>
      </div>
      <div className="opc-cartoes">
        <CartaoOpcoes titulo="Total" s={opcoes.todas} apoio="{n} séries · {g} com lucro, {p} com prejuízo" />
        <CartaoOpcoes titulo="Encerradas (realizado)" s={opcoes.encerradas} apoio="{n} séries · {g} com lucro, {p} com prejuízo" />
        <CartaoOpcoes titulo="Em aberto (pelo preço de agora)" s={opcoes.abertas} apoio="{n} séries abertas" />
      </div>
      <div className="opc-filtro" role="group" aria-label="Quais séries mostrar">
        {(['abertas', 'encerradas', 'todas'] as const).map((f) => (
          <button key={f} type="button" className={`botao botao-pequeno${filtro === f ? ' botao-principal' : ''}`} aria-pressed={filtro === f} onClick={() => { setFiltro(f); setLimite(30); }}>
            {f === 'abertas' ? 'Em aberto' : f === 'encerradas' ? 'Encerradas' : 'Todas'}
          </button>
        ))}
      </div>
      {lista.length === 0 ? <p className="secao-vazia">Nenhuma série aqui.</p> : (
        <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Lucros e perdas por série de opção">
          <table className="tabela">
            <thead><tr><th scope="col">Série</th><th scope="col">Ativo</th><th scope="col">Posição</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Prêmio</th><th scope="col" className="numero">Resultado</th><th scope="col" className="numero">%</th><th scope="col">Situação</th></tr></thead>
            <tbody>
              {lista.slice(0, limite).map((o) => (
                <tr key={`${o.codigo}-${o.vencimento}`}>
                  <th scope="row">{o.codigo}<span className="sub">{o.tipo === 'call' ? 'Call' : 'Put'} {preco(o.strike)} · {formatarData(o.vencimento)}</span></th>
                  <td>{o.ativoObjeto ?? '—'}</td>
                  <td>{o.lado === 'vendida' ? 'Vendida' : 'Comprada'}</td>
                  <td className="numero">{o.quantidadeNegociada.toLocaleString('pt-BR')}</td>
                  <td className="numero">{formatarReais(o.base)}</td>
                  <td className={`numero ${classe(o.resultado)}`}>{sinal(o.resultado)}{!o.encerrada && o.emAberto === null && !o.vencida ? <span className="sub">sem preço agora</span> : null}</td>
                  <td className={`numero ${classe(o.fracao)}`}>{pctBr(o.fracao)}</td>
                  <td><span className="sub" style={{ marginTop: 0 }}>{situacao(o)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lista.length > limite && <button type="button" className="botao-texto" onClick={() => setLimite((l) => l + 50)}>Mostrar mais ({lista.length - limite})</button>}
    </section>
  );
}

export function VisaoDaCarteira({ carteira }: { carteira: Carteira }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (a: string) => setAbertos((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  const porClasse = useMemo(() => {
    const m = new Map<ClasseDoAtivo, Grupo[]>();
    for (const g of carteira.grupos) { if (!m.has(g.classe)) m.set(g.classe, []); (m.get(g.classe) as Grupo[]).push(g); }
    return ORDEM_DAS_CLASSES.filter((c) => m.has(c)).map((c) => {
      const grupos = (m.get(c) as Grupo[]).sort((a, b) => (resumoDoGrupo(b).valor ?? 0) - (resumoDoGrupo(a).valor ?? 0));
      const valor = grupos.reduce((t, g) => t + (resumoDoGrupo(g).valor ?? 0), 0);
      const resultado = grupos.reduce((t, g) => t + (g.resultado ?? 0), 0);
      return { classe: c, grupos, valor, resultado };
    });
  }, [carteira.grupos]);
  const patrimonio = porClasse.reduce((t, c) => t + c.valor, 0);
  const t = carteira.totais;

  return (
    <>
      <section className="carteira-resumo" aria-label="Resumo da carteira">
        <div className="carteira-cartoes">
          <div className="carteira-cartao destaque"><span className="lotes-rotulo">Patrimônio em bolsa</span><strong>{formatarReais(patrimonio)}</strong><span className="lotes-rotulo">ações, fundos, ETFs e renda fixa pelo preço de agora</span></div>
          <div className="carteira-cartao"><span className="lotes-rotulo">Resultado em aberto</span><strong className={classe(t.resultadoEmAberto)}>{sinal(t.resultadoEmAberto)}</strong><span className="lotes-rotulo">contra o preço médio com custos (inclui opções)</span></div>
          <div className="carteira-cartao"><span className="lotes-rotulo">Realizado (líquido)</span><strong className={classe(t.realizadoLiquido)}>{sinal(t.realizadoLiquido)}</strong><span className="lotes-rotulo">bruto {formatarReais(t.realizadoBruto)}</span></div>
          <div className="carteira-cartao"><span className="lotes-rotulo">Custos pagos</span><strong>{formatarReais(t.custosPagos)}</strong><span className="lotes-rotulo">corretagem, taxas e emolumentos</span></div>
        </div>
        {patrimonio > 0 && (
          <div className="carteira-divisao">
            <div className="carteira-barra" role="img" aria-label={porClasse.map((c) => `${NOME_DA_CLASSE[c.classe]} ${((c.valor / patrimonio) * 100).toFixed(1)}%`).join(', ')}>
              {porClasse.filter((c) => c.valor > 0).map((c) => <span key={c.classe} style={{ width: `${(c.valor / patrimonio) * 100}%`, background: COR_DA_CLASSE[c.classe] }} />)}
            </div>
            <ul className="carteira-legenda">
              {porClasse.filter((c) => c.valor > 0).map((c) => (
                <li key={c.classe}><i style={{ background: COR_DA_CLASSE[c.classe] }} />{NOME_DA_CLASSE[c.classe]} <strong>{((c.valor / patrimonio) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong> <span className="lotes-rotulo">{formatarReais(c.valor)}</span></li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {porClasse.map((c) => (
        <section key={c.classe} className="secao classe-secao" aria-labelledby={`classe-${c.classe}`}>
          <div className="classe-topo">
            <h2 id={`classe-${c.classe}`}><i style={{ background: COR_DA_CLASSE[c.classe] }} />{NOME_DA_CLASSE[c.classe]} <span className="lotes-rotulo">{c.grupos.length} ativo{c.grupos.length > 1 ? 's' : ''}</span></h2>
            <span className="classe-totais">
              <span>{formatarReais(c.valor)}{patrimonio > 0 ? <small className="lotes-rotulo"> · {((c.valor / patrimonio) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da carteira</small> : null}</span>
              <span className={classe(c.resultado)}>{sinal(c.resultado)}</span>
            </span>
          </div>
          <ul className="ativo-lista">
            {c.grupos.map((g) => <LinhaDoAtivo key={g.ativoObjeto} g={g} aberto={abertos.has(g.ativoObjeto)} alternar={() => alternar(g.ativoObjeto)} total={patrimonio} />)}
          </ul>
        </section>
      ))}

      <PainelDasOpcoes opcoes={carteira.opcoes} />
    </>
  );
}
