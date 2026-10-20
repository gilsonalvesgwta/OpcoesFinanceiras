'use client';

// Rolagens: sugestões por critérios, comparação de alternativas lado a lado (com o
// gráfico de antes e depois), registro da rolagem feita na corretora e histórico.
// Crédito não é lucro, o sistema não escolhe a melhor e nada aqui envia ordem.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { quandoCurto } from '../../../lib/mercado.ts';
import {
  dataEHoraEmBrasilia, descreverInstrumento, descreverPosicao, ORIGEM_DO_PRECO, QUALIDADE, textoDoExtremo,
  type Estrategia, type InstrumentoDaApi, type RespostaDePosicoes,
} from '../../../lib/posicoes.ts';
import {
  alternativaDoCandidato, consultaDasSugestoes, corpoDaConfirmacao, criteriosDoFormulario, CRITERIOS_PADRAO, graficoComparado, linhasDaConfirmacao,
  textoDoErroDaAlternativa, textoDoFluxo, textoDoLiquido,
  type Alternativa, type Candidato, type FormularioDeCriterios, type LinhaDaConfirmacao, type ResumoDoPayoff, type Simulada,
} from '../../../lib/rolagens.ts';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const classeDoValor = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const CORES = ['var(--vivo)', 'var(--latao)', 'var(--periodica)', 'var(--historico)'];
const equilibrio = (p: ResumoDoPayoff) => (p ? (p.pontosDeEquilibrio.length ? p.pontosDeEquilibrio.map((x) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).join(' · ') : 'nenhum') : '—');

type Sugestoes = {
  dia: string;
  perna: { codigo: string; quantidade: number; strike: number; vencimento: string; precoDeSaida: { valor: number; origem: string; estimativa: boolean } | null; qualidade: string | null };
  candidatos: Candidato[];
  premissas: string[];
};
type RespostaDaSimulacao = { alternativas: Simulada[]; premissas: string[] };

function SeloDoCriterio({ c }: { c: Candidato['criterios'][number] }) {
  const icone = c.situacao === 'atendido' ? '✓' : c.situacao === 'nao_atendido' ? '✗' : '?';
  const classe = c.situacao === 'atendido' ? 'selo-alta' : c.situacao === 'nao_atendido' ? 'selo-baixa' : 'selo-neutro';
  const rotulo = c.situacao === 'atendido' ? 'atende' : c.situacao === 'nao_atendido' ? 'não atende' : 'sem dado';
  return <span className={`selo ${classe}`} style={{ fontSize: 13, fontWeight: 500 }} title={`${c.texto}: ${rotulo}`}><span aria-hidden="true">{icone}</span><span className="so-leitor">{rotulo}:</span> {c.texto}</span>;
}

function GraficoComparado({ simuladas }: { simuladas: Extract<Simulada, { ok: true }>[] }) {
  const antes = simuladas.find((s) => s.curvas?.antes)?.curvas?.antes ?? null;
  const g = graficoComparado([antes, ...simuladas.map((s) => s.curvas?.depois ?? null)]);
  if (!g) return <p className="aviso-tracejado">Sem gráfico: alguma posição mistura vencimentos ou falta o preço do ativo.</p>;
  const ref = simuladas.find((s) => s.curvas)?.curvas?.referencia ?? null;
  const y0 = g.y(0);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${g.largura} ${g.altura}`} width="100%" role="img" style={{ display: 'block' }}
        aria-label={`Resultado da estratégia no vencimento: antes (tracejado) e depois de cada alternativa (${simuladas.map((s) => s.nome).join(', ')}).`}>
        <line x1={g.x(g.de)} x2={g.x(g.ate)} y1={y0} y2={y0} stroke="var(--apoio)" />
        {ref !== null && ref >= g.de && ref <= g.ate && (
          <g>
            <line x1={g.x(ref)} x2={g.x(ref)} y1={14} y2={g.altura - 28} stroke="var(--linha)" strokeWidth="1.5" />
            <text x={g.x(ref) + 4} y={24} fontSize="11" fill="var(--apoio)">hoje {reais(ref)}</text>
          </g>
        )}
        {g.caminhos[0] && <path d={g.caminhos[0]} fill="none" stroke="var(--apoio)" strokeWidth="2" strokeDasharray="6 4" />}
        {g.caminhos.slice(1).map((d, i) => d && <path key={i} d={d} fill="none" stroke={CORES[i % CORES.length]} strokeWidth="2.25" />)}
        <text x={g.x(g.de) - 6} y={g.y(g.max) + 10} textAnchor="end" fontSize="11" fill="var(--apoio)">{formatarReais(Math.round(g.max))}</text>
        <text x={g.x(g.de) - 6} y={y0 + 4} textAnchor="end" fontSize="11" fill="var(--apoio)">R$ 0</text>
        <text x={g.x(g.de) - 6} y={g.y(g.min)} textAnchor="end" fontSize="11" fill="var(--apoio)">{formatarReais(Math.round(g.min))}</text>
        <text x={g.x(g.de)} y={g.altura - 4} fontSize="11" fill="var(--apoio)">{reais(g.de)}</text>
        <text x={g.x(g.ate)} y={g.altura - 4} textAnchor="end" fontSize="11" fill="var(--apoio)">{reais(g.ate)}</text>
      </svg>
      <figcaption className="linha-lista-apoio" style={{ fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        <span><span style={{ color: 'var(--apoio)' }}>╍</span> antes</span>
        {simuladas.map((s, i) => <span key={s.nome}><span style={{ color: CORES[i % CORES.length] }}>━</span> {s.nome}</span>)}
        <span>Resultado total da estratégia no vencimento, com o realizado e os custos.</span>
      </figcaption>
    </figure>
  );
}

export default function PaginaRolagens() {
  const [posicoes, setPosicoes] = useState<RespostaDePosicoes | null>(null);
  const [estrategiaId, setEstrategiaId] = useState('');
  const [codigo, setCodigo] = useState('');
  const [criterios, setCriterios] = useState<FormularioDeCriterios>(CRITERIOS_PADRAO);
  const [sugestoes, setSugestoes] = useState<Sugestoes | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [soQueAtendem, setSoQueAtendem] = useState(false);
  const [alternativas, setAlternativas] = useState<Alternativa[]>([]);
  const [simulacao, setSimulacao] = useState<RespostaDaSimulacao | null>(null);
  const [manual, setManual] = useState<{ codigo: string; quantidade: string; preco: string } | null>(null);
  const [confirmando, setConfirmando] = useState<{ nome: string; linhas: LinhaDaConfirmacao[]; data: string; hora: string; observacao: string } | null>(null);
  const [desfazer, setDesfazer] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const p = await chamar<RespostaDePosicoes>('GET', '/api/posicoes');
    setPosicoes(p);
    return p;
  }, []);

  useEffect(() => {
    carregar().then((p) => {
      const pedida = new URLSearchParams(window.location.search).get('estrategia');
      const abertas = p.estrategias.filter((e) => e.situacao === 'aberta' && e.instrumentos.some((i) => i.quantidade !== 0 && i.tipo !== 'ativo'));
      const escolhida = abertas.find((e) => e.id === pedida) ?? abertas[0];
      if (escolhida) setEstrategiaId(escolhida.id);
    }).catch((e: Error) => setErro(e.message));
  }, [carregar]);

  const abertas = useMemo(
    () => (posicoes?.estrategias ?? []).filter((e) => e.situacao === 'aberta' && e.instrumentos.some((i) => i.quantidade !== 0 && i.tipo !== 'ativo')),
    [posicoes],
  );
  const estrategia: Estrategia | undefined = posicoes?.estrategias.find((e) => e.id === estrategiaId);
  const opcoesAbertas: InstrumentoDaApi[] = useMemo(
    () => (estrategia?.instrumentos ?? []).filter((i) => i.quantidade !== 0 && i.tipo !== 'ativo').sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? '')),
    [estrategia],
  );
  const perna = opcoesAbertas.find((i) => i.codigo === codigo);

  // Ao trocar de estratégia: perna do vencimento mais próximo e comparação zerada.
  useEffect(() => {
    setCodigo(opcoesAbertas[0]?.codigo ?? '');
    setAlternativas([]);
    setSimulacao(null);
    setSugestoes(null);
    setConfirmando(null);
  }, [estrategiaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simula de novo sempre que a lista de alternativas muda.
  useEffect(() => {
    if (!estrategiaId || alternativas.length === 0) { setSimulacao(null); return; }
    let vivo = true;
    chamar<RespostaDaSimulacao>('POST', '/api/rolagens/simular', { estrategiaId, alternativas })
      .then((r) => { if (vivo) setSimulacao(r); })
      .catch((e: Error) => { if (vivo) setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível simular agora.'); });
    return () => { vivo = false; };
  }, [estrategiaId, alternativas]);

  async function buscar(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (!perna) return;
    const c = consultaDasSugestoes(estrategiaId, perna.codigo, criterios);
    if (!c.ok) return setErroForm(c.erro);
    setErroForm(null);
    setBuscando(true);
    try {
      setSugestoes(await chamar<Sugestoes>('GET', `/api/rolagens/sugestoes?${c.consulta}`));
    } catch (x) {
      setErroForm(x instanceof ErroDaApi ? x.message : 'Não foi possível buscar agora.');
    } finally {
      setBuscando(false);
    }
  }

  function adicionar(a: Alternativa) {
    setAviso(null);
    if (alternativas.some((x) => x.nome === a.nome)) return;
    if (alternativas.length >= 4) return setErro('Compare até 4 alternativas por vez. Remova uma para incluir outra.');
    setErro(null);
    setAlternativas([...alternativas, a]);
  }

  function adicionarManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!manual || !perna) return;
    const cod = manual.codigo.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(cod)) return setErroForm('Informe o código da série nova (ex.: PETRL400).');
    const q = Number(manual.quantidade.replace(/\./g, ''));
    if (!Number.isInteger(q) || q <= 0) return setErroForm('A quantidade precisa ser um inteiro maior que zero.');
    const base = alternativaDoCandidato(perna, { codigo: cod, strike: 0, vencimento: '2000-01-01' });
    const preco = manual.preco.trim() ? Number(manual.preco.replace(/\./g, '').replace(',', '.')) : null;
    if (preco !== null && (!Number.isFinite(preco) || preco < 0)) return setErroForm('Preço em reais (ex.: 1,25), ou em branco para usar o do mercado.');
    setErroForm(null);
    adicionar({
      nome: `${cod} × ${q.toLocaleString('pt-BR')}${preco !== null ? ` a ${preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}`,
      encerrar: base.encerrar,
      abrir: [{ codigo: cod, lado: perna.quantidade > 0 ? 'compra' : 'venda', quantidade: q, ...(preco !== null ? { preco: Math.round(preco * 100) } : {}) }],
    });
    setManual(null);
  }

  async function registrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmando) return;
    const c = corpoDaConfirmacao(estrategiaId, confirmando.linhas, confirmando.data, confirmando.hora, confirmando.observacao, new Date());
    if (!c.ok) return setErroForm(c.erro);
    setErroForm(null);
    try {
      await chamar('POST', '/api/rolagens', c.corpo);
      setAviso(`Rolagem "${confirmando.nome}" registrada na estratégia. A posição e o resultado já foram atualizados.`);
      setConfirmando(null);
      setAlternativas([]);
      setSugestoes(null);
      const p = await carregar();
      const est = p.estrategias.find((x) => x.id === estrategiaId);
      setCodigo(est?.instrumentos.filter((i) => i.quantidade !== 0 && i.tipo !== 'ativo').sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''))[0]?.codigo ?? '');
    } catch (x) {
      setErroForm(x instanceof ErroDaApi ? x.message : 'Não foi possível registrar agora.');
    }
  }

  async function desfazerRolagem(id: string) {
    setErro(null);
    try {
      await chamar('DELETE', `/api/rolagens/${id}`);
      setAviso('Rolagem desfeita: as operações dela foram apagadas e a posição voltou ao que era antes.');
      setDesfazer(null);
      await carregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível desfazer agora.');
    }
  }

  const simuladas = (simulacao?.alternativas ?? []).filter((s): s is Extract<Simulada, { ok: true }> => s.ok);
  const visiveis = (sugestoes?.candidatos ?? []).filter((c) => !soQueAtendem || c.resumo.todos);
  const mudarCriterio = (x: Partial<FormularioDeCriterios>) => setCriterios({ ...criterios, ...x });

  return (
    <>
      <Cabecalho
        titulo="Rolagens"
        apoio="Compare alternativas para rolar uma perna antes de agir na corretora. O sistema não escolhe a melhor e nada aqui envia ordem."
      />
      <MensagemDeErro texto={erro} />
      <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>

      {posicoes === null && !erro && <p className="secao-vazia" role="status">Carregando…</p>}
      {posicoes && abertas.length === 0 && (
        <section className="secao">
          <p className="secao-vazia">Nenhuma estratégia aberta com opção. Registre a operação em <Link href="/posicoes">Posições</Link> e volte aqui para simular a rolagem.</p>
        </section>
      )}

      {abertas.length > 0 && (
        <section className="secao" aria-labelledby="perna-titulo">
          <h2 id="perna-titulo">O que rolar</h2>
          <div className="form-em-linha">
            <div className="campo" style={{ flex: '2 1 260px' }}>
              <label htmlFor="rol-estrategia">Estratégia</label>
              <select id="rol-estrategia" value={estrategiaId} onChange={(e) => setEstrategiaId(e.target.value)}>
                {abertas.map((e) => <option key={e.id} value={e.id}>{e.nome} ({e.ativoObjeto})</option>)}
              </select>
            </div>
            <div className="campo" style={{ flex: '2 1 260px' }}>
              <label htmlFor="rol-perna">Perna</label>
              <select id="rol-perna" value={codigo} onChange={(e) => { setCodigo(e.target.value); setSugestoes(null); setAlternativas([]); }}>
                {opcoesAbertas.map((i) => <option key={i.codigo} value={i.codigo}>{i.codigo}: {descreverPosicao(i.quantidade)}, {descreverInstrumento(i)}</option>)}
              </select>
            </div>
          </div>
          {perna && (
            <p className="linha-lista-apoio" style={{ margin: 0 }}>
              {descreverPosicao(perna.quantidade)} {perna.codigo} a {reais(Math.round(perna.precoMedio))} (preço médio).
              {perna.cotacao && <> Para sair agora: {reais((perna.quantidade > 0 ? perna.cotacao.bid : perna.cotacao.ask) ?? perna.cotacao.ultimo ?? 0)} ({QUALIDADE[perna.cotacao.qualidade]?.texto ?? perna.cotacao.qualidade}).</>}
              {perna.diasCorridos !== null && <> Vence em {perna.diasCorridos} dias.</>}
            </p>
          )}
        </section>
      )}

      {perna && (
        <section className="secao" aria-labelledby="sug-titulo">
          <div className="secao-topo">
            <h2 id="sug-titulo">Sugestões pelos seus critérios</h2>
            <span className="linha-lista-apoio">Deixe em branco o que não importa.</span>
          </div>
          <form onSubmit={buscar} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-em-linha">
              <div className="campo" style={{ flex: '0 1 110px' }}><label htmlFor="c-dmin">Dias (mín.)</label><input id="c-dmin" inputMode="numeric" value={criterios.diasMin} onChange={(e) => mudarCriterio({ diasMin: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 110px' }}><label htmlFor="c-dmax">Dias (máx.)</label><input id="c-dmax" inputMode="numeric" value={criterios.diasMax} onChange={(e) => mudarCriterio({ diasMax: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 110px' }}><label htmlFor="c-deltamin">Delta (mín.)</label><input id="c-deltamin" inputMode="decimal" placeholder="0,15" value={criterios.deltaMin} onChange={(e) => mudarCriterio({ deltaMin: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 110px' }}><label htmlFor="c-deltamax">Delta (máx.)</label><input id="c-deltamax" inputMode="decimal" placeholder="0,35" value={criterios.deltaMax} onChange={(e) => mudarCriterio({ deltaMax: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 140px' }}><label htmlFor="c-cred">Crédito mín. (R$)</label><input id="c-cred" inputMode="decimal" placeholder="0,00" value={criterios.creditoMinimo} onChange={(e) => mudarCriterio({ creditoMinimo: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 140px' }}><label htmlFor="c-deb">Débito máx. (R$)</label><input id="c-deb" inputMode="decimal" value={criterios.debitoMaximo} onChange={(e) => mudarCriterio({ debitoMaximo: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 130px' }}><label htmlFor="c-neg">Negócios (mín.)</label><input id="c-neg" inputMode="numeric" value={criterios.negociosMin} onChange={(e) => mudarCriterio({ negociosMin: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 150px' }}><label htmlFor="c-spread">Diferença compra/venda (máx. %)</label><input id="c-spread" inputMode="decimal" placeholder="20" value={criterios.spreadMaximoPct} onChange={(e) => mudarCriterio({ spreadMaximoPct: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 170px' }}>
                <label htmlFor="c-strike">Strike</label>
                <select id="c-strike" value={criterios.strike} onChange={(e) => mudarCriterio({ strike: e.target.value as FormularioDeCriterios['strike'] })}>
                  <option value="qualquer">Qualquer</option><option value="manter">Manter o atual</option><option value="acima">Acima do atual</option><option value="abaixo">Abaixo do atual</option>
                </select>
              </div>
            </div>
            <div className="form-em-linha" style={{ gap: '0 24px' }}>
              <label className="caixa-de-marcar"><input type="checkbox" checked={criterios.perdaMaximaNaoAumenta} onChange={(e) => mudarCriterio({ perdaMaximaNaoAumenta: e.target.checked })} /><span>Perda máxima não pode aumentar</span></label>
              <label className="caixa-de-marcar"><input type="checkbox" checked={criterios.mesmoVencimento} onChange={(e) => mudarCriterio({ mesmoVencimento: e.target.checked })} /><span>Incluir o mesmo vencimento (só mudar o strike)</span></label>
            </div>
            <MensagemDeErro texto={erroForm && !confirmando && !manual ? erroForm : null} />
            <div className="form-em-linha">
              <button type="submit" className="botao botao-principal" disabled={buscando}>{buscando ? 'Buscando…' : 'Buscar séries'}</button>
              {!manual && <button type="button" className="botao" onClick={() => { setErroForm(null); setManual({ codigo: '', quantidade: String(Math.abs(perna.quantidade)), preco: '' }); }}>Montar alternativa à mão</button>}
              <button type="button" className="botao-texto" onClick={() => {
                const c = criteriosDoFormulario(criterios);
                if (!c.ok) return setErroForm(c.erro);
                setErroForm(null);
                chamar('PUT', '/api/avisos-posicao/preferencias', { criterios: c.criterios })
                  .then(() => setAviso('Critérios guardados para as sugestões automáticas. Para receber, autorize em Preferências › Avisos das posições.'))
                  .catch((x: Error) => setErroForm(x instanceof ErroDaApi ? x.message : 'Não foi possível guardar agora.'));
              }}>Usar estes critérios nos avisos</button>
            </div>
          </form>

          {manual && (
            <form onSubmit={adicionarManual} noValidate>
              <fieldset className="grupo-de-campos">
                <legend>Alternativa à mão: sair de {perna.codigo} e {perna.quantidade > 0 ? 'comprar' : 'vender'}</legend>
                <div className="form-em-linha">
                  <div className="campo" style={{ flex: '1 1 140px' }}><label htmlFor="m-cod">Série nova</label><input id="m-cod" value={manual.codigo} maxLength={12} placeholder="PETRL400" onChange={(e) => setManual({ ...manual, codigo: e.target.value.toUpperCase() })} /></div>
                  <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor="m-qtd">Quantidade</label><input id="m-qtd" inputMode="numeric" value={manual.quantidade} onChange={(e) => setManual({ ...manual, quantidade: e.target.value })} /></div>
                  <div className="campo" style={{ flex: '0 1 150px' }}><label htmlFor="m-preco">Preço (R$, opcional)</label><input id="m-preco" inputMode="decimal" placeholder="do mercado" value={manual.preco} onChange={(e) => setManual({ ...manual, preco: e.target.value })} /></div>
                </div>
                <MensagemDeErro texto={erroForm} />
                <div className="form-em-linha">
                  <button type="submit" className="botao botao-principal">Comparar</button>
                  <button type="button" className="botao" onClick={() => setManual(null)}>Cancelar</button>
                </div>
              </fieldset>
            </form>
          )}

          {sugestoes && (
            <>
              <div className="secao-topo">
                <span className="linha-lista-apoio">
                  {sugestoes.candidatos.length} séries do fechamento da B3 de {formatarData(sugestoes.dia)}. Saída de {sugestoes.perna.codigo}: {sugestoes.perna.precoDeSaida ? `${reais(sugestoes.perna.precoDeSaida.valor)} (${ORIGEM_DO_PRECO[sugestoes.perna.precoDeSaida.origem] ?? sugestoes.perna.precoDeSaida.origem})` : 'sem preço'}.
                </span>
                <label className="caixa-de-marcar" style={{ paddingTop: 0 }}><input type="checkbox" checked={soQueAtendem} onChange={(e) => setSoQueAtendem(e.target.checked)} /><span>Só as que atendem a tudo</span></label>
              </div>
              {visiveis.length === 0 ? <p className="secao-vazia">Nenhuma série {soQueAtendem ? 'atende a todos os critérios' : 'encontrada nos próximos vencimentos'}.</p> : (
                <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Séries candidatas" style={{ margin: '0 -24px' }}>
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th scope="col">Série</th><th scope="col" className="numero">Delta</th><th scope="col" className="numero">Entrada</th>
                        <th scope="col" className="numero">Caixa da rolagem</th><th scope="col" className="numero">Equilíbrio depois</th>
                        <th scope="col">Critérios</th><th scope="col"><span className="so-leitor">Ação</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((c) => {
                        const nome = alternativaDoCandidato(sugestoes.perna, c).nome;
                        const ja = alternativas.some((a) => a.nome === nome);
                        return (
                          <tr key={c.codigo}>
                            <th scope="row">{c.codigo}<span className="sub">{reais(c.strike)} · {formatarData(c.vencimento)} ({c.dias} dias)</span></th>
                            <td className="numero">{c.delta === null ? '—' : Math.abs(c.delta).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                            <td className="numero">{c.precoDeEntrada ? reais(c.precoDeEntrada.valor) : '—'}<span className="sub">{c.precoDeEntrada ? ORIGEM_DO_PRECO[c.precoDeEntrada.origem] ?? c.precoDeEntrada.origem : 'sem oferta'}</span></td>
                            <td className={`numero ${classeDoValor(c.liquido)}`}>{textoDoLiquido(c.liquido)}</td>
                            <td className="numero">{equilibrio(c.payoffDepois)}</td>
                            <td><div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{c.criterios.length ? c.criterios.map((k) => <SeloDoCriterio key={k.criterio} c={k} />) : <span className="linha-lista-apoio">sem critérios</span>}</div></td>
                            <td>
                              <button type="button" className="botao botao-pequeno" disabled={ja || alternativas.length >= 4} onClick={() => adicionar(alternativaDoCandidato(sugestoes.perna, c))}
                                aria-label={`Comparar ${c.codigo}`}>{ja ? 'Na comparação' : 'Comparar'}</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--apoio)', fontSize: 13 }}>{sugestoes.premissas.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {alternativas.length > 0 && (
        <section className="secao" aria-labelledby="comp-titulo">
          <div className="secao-topo">
            <h2 id="comp-titulo">Comparação</h2>
            <button type="button" className="botao-texto" onClick={() => setAlternativas([])}>Limpar</button>
          </div>
          {!simulacao && <p className="secao-vazia" role="status">Simulando…</p>}
          {simulacao && (
            <>
              {simuladas.length > 0 && <GraficoComparado simuladas={simuladas} />}
              <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Comparação das alternativas" style={{ margin: '0 -24px' }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th scope="col"><span className="so-leitor">Item</span></th>
                      {simulacao.alternativas.map((s, i) => (
                        <th key={s.nome} scope="col" style={{ minWidth: 190 }}>
                          <span style={{ color: s.ok ? CORES[simuladas.indexOf(s as Extract<Simulada, { ok: true }>) % CORES.length] : undefined }}>━ </span>{s.nome}
                          <button type="button" className="botao-texto" style={{ minHeight: 0, marginLeft: 8, fontSize: 13 }} onClick={() => setAlternativas(alternativas.filter((_, j) => j !== i))} aria-label={`Remover ${s.nome}`}>remover</button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Caixa da rolagem</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome} className={s.ok ? classeDoValor(s.fluxo.liquido) : ''}>{s.ok ? textoDoFluxo(s.fluxo) : <span className="resultado-baixa">{textoDoErroDaAlternativa(s)}</span>}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Preços usados</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome} className="linha-lista-apoio">{s.ok ? s.precos.map((p) => <span key={p.codigo} style={{ display: 'block' }}>{p.lado === 'compra' ? 'Compra' : 'Venda'} {p.quantidade.toLocaleString('pt-BR')} {p.codigo} a {reais(p.preco)} <span style={{ fontSize: 12 }}>({ORIGEM_DO_PRECO[p.origem] ?? (p.origem === 'informado' ? 'informado por você' : p.origem)})</span></span>) : '—'}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Realizado ao sair</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome} className={s.ok ? classeDoValor(s.realizadoNoEncerramento) : ''}>{s.ok ? formatarReais(s.realizadoNoEncerramento) : '—'}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Equilíbrio (antes → depois)</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome}>{s.ok ? `${equilibrio(s.payoff.antes)} → ${equilibrio(s.payoff.depois)}` : '—'}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Perda máxima (antes → depois)</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome}>{s.ok ? `${s.payoff.antes ? textoDoExtremo(s.payoff.antes.perdaMaxima) : '—'} → ${s.payoff.depois ? textoDoExtremo(s.payoff.depois.perdaMaxima) : '—'}` : '—'}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Lucro máximo depois</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome}>{s.ok && s.payoff.depois ? textoDoExtremo(s.payoff.depois.lucroMaximo) : '—'}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Vencimento</th>
                      {simulacao.alternativas.map((s) => <td key={s.nome}>{s.ok ? `${s.ultimoVencimento.antes ? formatarData(s.ultimoVencimento.antes) : '—'} → ${s.ultimoVencimento.depois ? formatarData(s.ultimoVencimento.depois) : '—'}` : '—'}</td>)}
                    </tr>
                    <tr>
                      <th scope="row">Atenção</th>
                      {simulacao.alternativas.map((s) => (
                        <td key={s.nome} style={{ fontSize: 13 }}>
                          {s.ok && s.avisos.length ? s.avisos.map((a) => <span key={a.codigo} style={{ display: 'flex', gap: 6, color: 'var(--atencao)', marginBottom: 4 }}><Icone nome="aviso" tamanho={14} /><span>{a.texto}</span></span>) : s.ok ? <span className="linha-lista-apoio">Nada a destacar.</span> : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row"><span className="so-leitor">Registrar</span></th>
                      {simulacao.alternativas.map((s) => (
                        <td key={s.nome}>
                          {s.ok && (
                            <button type="button" className="botao botao-pequeno" onClick={() => {
                              const { data, hora } = dataEHoraEmBrasilia(new Date());
                              setErroForm(null);
                              setConfirmando({ nome: s.nome, linhas: linhasDaConfirmacao(s), data, hora, observacao: '' });
                            }}>Registrar esta rolagem</button>
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--apoio)', fontSize: 13 }}>{simulacao.premissas.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {confirmando && (
        <section className="secao" aria-labelledby="conf-titulo" style={{ borderColor: 'var(--latao)' }}>
          <h2 id="conf-titulo">Registrar a rolagem: {confirmando.nome}</h2>
          <div className="alerta" role="note"><Icone nome="aviso" /><span>Registre só depois de executar na corretora, com os preços e custos que saíram na nota. Nada aqui envia ordem.</span></div>
          <form onSubmit={registrar} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {confirmando.linhas.map((l, i) => {
              const mudar = (x: Partial<LinhaDaConfirmacao>) => setConfirmando({ ...confirmando, linhas: confirmando.linhas.map((y, j) => (j === i ? { ...y, ...x } : y)) });
              return (
                <div key={`${l.acao}-${l.codigo}`} className="form-em-linha">
                  <span style={{ flex: '1 1 220px', alignSelf: 'center', fontWeight: 600 }}>{l.acao === 'encerrar' ? 'Sair' : 'Entrar'}: {l.lado === 'compra' ? 'compra' : 'venda'} de {l.codigo}</span>
                  <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor={`cf-q-${i}`}>Quantidade</label><input id={`cf-q-${i}`} inputMode="numeric" value={l.quantidade} onChange={(e) => mudar({ quantidade: e.target.value })} /></div>
                  <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor={`cf-p-${i}`}>Preço (R$)</label><input id={`cf-p-${i}`} inputMode="decimal" value={l.preco} onChange={(e) => mudar({ preco: e.target.value })} /></div>
                  <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor={`cf-c-${i}`}>Custos (R$)</label><input id={`cf-c-${i}`} inputMode="decimal" placeholder="0,00" value={l.custos} onChange={(e) => mudar({ custos: e.target.value })} /></div>
                </div>
              );
            })}
            <div className="form-em-linha">
              <div className="campo" style={{ flex: '0 1 160px' }}><label htmlFor="cf-data">Data</label><input id="cf-data" type="date" value={confirmando.data} onChange={(e) => setConfirmando({ ...confirmando, data: e.target.value })} /></div>
              <div className="campo" style={{ flex: '0 1 110px' }}><label htmlFor="cf-hora">Hora</label><input id="cf-hora" type="time" value={confirmando.hora} onChange={(e) => setConfirmando({ ...confirmando, hora: e.target.value })} /></div>
              <div className="campo" style={{ flex: '2 1 260px' }}><label htmlFor="cf-obs">Observação (opcional)</label><input id="cf-obs" maxLength={300} value={confirmando.observacao} onChange={(e) => setConfirmando({ ...confirmando, observacao: e.target.value })} /></div>
            </div>
            <MensagemDeErro texto={erroForm} />
            <div className="form-em-linha">
              <button type="submit" className="botao botao-principal">Registrar rolagem</button>
              <button type="button" className="botao" onClick={() => setConfirmando(null)}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      {estrategia && (estrategia.rolagens?.length ?? 0) > 0 && (
        <section className="secao" aria-labelledby="hist-titulo">
          <h2 id="hist-titulo">Rolagens registradas em {estrategia.nome}</h2>
          <div className="pontes">
            {estrategia.rolagens?.map((r) => (
              <div key={r.id} className="ponte" style={{ padding: '10px 14px' }}>
                <div className="ponte-texto">
                  <strong>{quandoCurto(r.instante)}{r.resumo?.fluxo ? ` · ${textoDoFluxo(r.resumo.fluxo)}` : ''}</strong>
                  <span className="ponte-apoio">
                    {(r.resumo?.pernas ?? []).map((p) => `${p.lado === 'compra' ? 'Compra' : 'Venda'} ${p.quantidade.toLocaleString('pt-BR')} ${p.codigo} a ${reais(p.preco)}`).join(' · ')}
                    {r.observacao ? ` · ${r.observacao}` : ''}
                  </span>
                </div>
                <div className="ponte-acoes">
                  {desfazer === r.id ? (
                    <>
                      <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void desfazerRolagem(r.id)}>Confirmar: desfazer</button>
                      <button type="button" className="botao botao-pequeno" onClick={() => setDesfazer(null)}>Manter</button>
                    </>
                  ) : (
                    <button type="button" className="botao-texto botao-perigo" onClick={() => setDesfazer(r.id)} aria-label={`Desfazer a rolagem de ${quandoCurto(r.instante)}`}>Desfazer</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
