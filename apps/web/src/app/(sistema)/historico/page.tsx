'use client';

// Histórico: operações, rolagens, disparos de alerta e avisos das posições numa lista só,
// com filtros e exportação em CSV (abre no Excel), e o retrospecto das regras de alerta.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { formatarReais } from '../../../lib/formatos.ts';
import { quandoCurto } from '../../../lib/mercado.ts';
import { consultaDoHistorico, TIPOS_DO_HISTORICO, type FiltrosDoHistorico, type ItemDoHistorico } from '../../../lib/inteligencia.ts';

type Desempenho = {
  periodoDias: number;
  regras: { id: string; nome: string; codigo: string; ativa: boolean; disparos: number; enviados: number; naoEntregues: number; ultimo: string | null; amostras: number; mediaPct: number | null; subiuPct: number | null }[];
  premissas: string[];
};

const NOME: Record<ItemDoHistorico['tipo'], { texto: string; classe: string }> = {
  operacao: { texto: 'Operação', classe: 'selo-neutro' },
  rolagem: { texto: 'Rolagem', classe: 'selo-periodica' },
  alerta: { texto: 'Alerta', classe: 'selo-historico' },
  posicao: { texto: 'Aviso', classe: 'selo-atencao' },
};
const pct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

export default function PaginaHistorico() {
  const [filtros, setFiltros] = useState<FiltrosDoHistorico>({ tipos: TIPOS_DO_HISTORICO.map((t) => t.valor), codigo: '', de: '', ate: '' });
  const [itens, setItens] = useState<ItemDoHistorico[] | null>(null);
  const [cortado, setCortado] = useState(false);
  const [desempenho, setDesempenho] = useState<Desempenho | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async (f: FiltrosDoHistorico) => {
    const c = consultaDoHistorico(f);
    if (!c.ok) return setErro(c.erro);
    setErro(null);
    try {
      const r = await chamar<{ itens: ItemDoHistorico[]; cortado: boolean }>('GET', `/api/historico${c.consulta ? `?${c.consulta}` : ''}`);
      setItens(r.itens);
      setCortado(r.cortado);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível carregar agora.');
    }
  }, []);

  useEffect(() => {
    void buscar(filtros);
    chamar<Desempenho>('GET', '/api/alertas/desempenho').then(setDesempenho).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const csv = consultaDoHistorico(filtros, 'csv');
  const filtrar = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); void buscar(filtros); };

  return (
    <>
      <Cabecalho titulo="Histórico" apoio="Tudo o que aconteceu: operações registradas, rolagens, alertas disparados e avisos das posições." />
      <section className="secao" aria-labelledby="filtros-titulo">
        <h2 id="filtros-titulo" className="so-leitor">Filtros</h2>
        <form onSubmit={filtrar} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <fieldset className="grupo-de-campos" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '0 20px', padding: '8px 16px' }}>
            <legend>Mostrar</legend>
            {TIPOS_DO_HISTORICO.map((t) => (
              <label key={t.valor} className="caixa-de-marcar" style={{ paddingTop: 0 }}>
                <input type="checkbox" checked={filtros.tipos.includes(t.valor)}
                  onChange={(e) => setFiltros({ ...filtros, tipos: e.target.checked ? [...filtros.tipos, t.valor] : filtros.tipos.filter((x) => x !== t.valor) })} />
                <span>{t.nome}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-em-linha">
            <div className="campo" style={{ flex: '1 1 160px' }}>
              <label htmlFor="h-codigo">Código (ou parte)</label>
              <input id="h-codigo" value={filtros.codigo} maxLength={12} placeholder="PETR" onChange={(e) => setFiltros({ ...filtros, codigo: e.target.value.toUpperCase() })} />
            </div>
            <div className="campo" style={{ flex: '0 1 170px' }}>
              <label htmlFor="h-de">De</label>
              <input id="h-de" type="date" value={filtros.de} onChange={(e) => setFiltros({ ...filtros, de: e.target.value })} />
            </div>
            <div className="campo" style={{ flex: '0 1 170px' }}>
              <label htmlFor="h-ate">Até</label>
              <input id="h-ate" type="date" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} />
            </div>
            <button type="submit" className="botao botao-principal">Filtrar</button>
            {csv.ok && <a className="botao" href={`/api/historico?${csv.consulta}`} download>Exportar para planilha (CSV)</a>}
          </div>
        </form>
        <MensagemDeErro texto={erro} />
      </section>

      <section className="secao secao-tabela" aria-labelledby="lista-titulo">
        <div className="secao-topo">
          <h2 id="lista-titulo">O que aconteceu</h2>
          {itens && <span className="linha-lista-apoio">{itens.length} {itens.length === 1 ? 'registro' : 'registros'}{cortado ? ' (os mais recentes; use os filtros ou exporte para ver mais)' : ''}</span>}
        </div>
        {itens === null && !erro && <p className="secao-vazia" style={{ padding: '0 24px' }} role="status">Carregando…</p>}
        {itens?.length === 0 && <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nada no período e nos filtros escolhidos.</p>}
        {itens && itens.length > 0 && (
          <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Histórico">
            <table className="tabela">
              <thead>
                <tr><th scope="col">Quando</th><th scope="col">Tipo</th><th scope="col">O que houve</th><th scope="col" className="numero">Valor</th></tr>
              </thead>
              <tbody>
                {itens.map((i, n) => (
                  <tr key={`${i.tipo}-${i.instante}-${n}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{quandoCurto(i.instante)}</td>
                    <td><span className={`selo ${NOME[i.tipo].classe}`} style={{ fontSize: 13 }}>{NOME[i.tipo].texto}</span></td>
                    <th scope="row" style={{ fontWeight: 500 }}>
                      {i.titulo}
                      <span className="sub">{[i.estrategia ? `em "${i.estrategia}"` : null, i.detalhe].filter(Boolean).join(' · ')}</span>
                    </th>
                    <td className={`numero ${i.tipo === 'operacao' || i.tipo === 'rolagem' ? (i.valor ?? 0) > 0 ? 'resultado-alta' : (i.valor ?? 0) < 0 ? 'resultado-baixa' : '' : ''}`}>
                      {formatarReais(i.valor)}
                      {i.custos ? <span className="sub">custos {formatarReais(i.custos)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="linha-lista-apoio" style={{ padding: '0 24px', margin: 0, fontSize: 13 }}>
          Valor: em operações e rolagens, o dinheiro que entrou (+) ou saiu (−) da conta, sem os custos; em alertas, o preço no momento do aviso.
        </p>
      </section>

      {desempenho && (
        <section className="secao secao-tabela" aria-labelledby="desempenho-titulo">
          <div className="secao-topo"><h2 id="desempenho-titulo">Retrospecto das regras de alerta</h2><span className="linha-lista-apoio">Últimos {desempenho.periodoDias} dias</span></div>
          {desempenho.regras.length === 0 ? <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhuma regra de alerta ainda.</p> : (
            <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Retrospecto das regras">
              <table className="tabela">
                <thead>
                  <tr>
                    <th scope="col">Regra</th><th scope="col" className="numero">Avisos</th><th scope="col" className="numero">Entregues</th>
                    <th scope="col" className="numero">Preço no pregão seguinte (média)</th><th scope="col" className="numero">Vezes em que subiu</th><th scope="col">Último</th>
                  </tr>
                </thead>
                <tbody>
                  {desempenho.regras.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.nome}<span className="sub">{r.codigo}{r.ativa ? '' : ' · pausada'}</span></th>
                      <td className="numero">{r.disparos}</td>
                      <td className="numero">{r.enviados}{r.naoEntregues ? <span className="sub">{r.naoEntregues} não entregue(s)</span> : null}</td>
                      <td className={`numero ${r.mediaPct === null ? '' : r.mediaPct > 0 ? 'resultado-alta' : r.mediaPct < 0 ? 'resultado-baixa' : ''}`}>{pct(r.mediaPct)}<span className="sub">{r.amostras} {r.amostras === 1 ? 'amostra' : 'amostras'}</span></td>
                      <td className="numero">{r.subiuPct === null ? '—' : `${r.subiuPct}%`}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.ultimo ? quandoCurto(r.ultimo) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul style={{ margin: 0, padding: '0 24px 0 44px', color: 'var(--apoio)', fontSize: 13 }}>{desempenho.premissas.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}
    </>
  );
}
