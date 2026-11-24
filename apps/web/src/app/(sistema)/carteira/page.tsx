'use client';

// Minha carteira: posição atual por ativo (ações e as opções de cada uma), preço médio com
// custos, preço de agora e resultado; importar notas de corretagem (PDF) com prévia;
// lançar a posição que já existia; notas importadas. Só acompanhamento: nada envia ordem.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { lerReais } from '../../../lib/simulador.ts';
import {
  ALERTA_DO_NEGOCIO, arquivoParaBase64, ERRO_DA_NOTA, NOME_DO_CUSTO, notaPronta, pctBr,
  type Carteira, type GrupoDaCarteira, type NotaDaPrevia,
} from '../../../lib/carteira.ts';

const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const preco = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sinal = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${formatarReais(v)}`);
const descricao = (i: { tipo: string; strike: number | null; vencimento: string | null }) => (i.tipo === 'ativo' ? 'Ação' : `${i.tipo === 'call' ? 'Call' : 'Put'} ${preco(i.strike)} · ${i.vencimento ? formatarData(i.vencimento) : '—'}`);
type NotaImportada = { id: string; corretora: string; numero: string; dataPregao: string; custoTotal: number; irrf: number; liquido: number | null; conferida: boolean; negocios: number };

function Grupo({ g }: { g: GrupoDaCarteira }) {
  const ativas = g.itens.filter((i) => !i.vencida);
  const vencidas = g.itens.filter((i) => i.vencida);
  const q = g.cotacao;
  const ref = q?.fechamentoAnterior ?? null;
  const agora = q?.ultimo ?? null;
  const dia = agora !== null && ref ? (agora - ref) / ref : null;
  return (
    <section className="secao secao-tabela" aria-labelledby={`g-${g.ativoObjeto}`}>
      <div className="secao-topo" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 id={`g-${g.ativoObjeto}`}>
          {g.ativoObjeto} <span style={{ fontWeight: 600 }}>R$ {preco(agora)}</span>{' '}
          {dia !== null && <span className={classe(dia)} style={{ fontSize: 15 }}>{pctBr(dia)} hoje</span>}
        </h2>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="linha-lista-apoio">Resultado em aberto <strong className={classe(g.resultado)}>{sinal(g.resultado)}</strong></span>
          <Link className="botao botao-pequeno" href={`/simulador?ativo=${g.ativoObjeto}&carteira=1`}>Simular com esta posição</Link>
        </span>
      </div>
      {g.cobertura.descobertas > 0 && (
        <div className="alerta" role="note" style={{ margin: '0 24px' }}><Icone nome="aviso" /><span>{g.cobertura.descobertas.toLocaleString('pt-BR')} calls vendidas sem ações nem calls compradas que as cubram: o prejuízo não tem limite se {g.ativoObjeto} subir.</span></div>
      )}
      <div className="tabela-caixa" tabIndex={0} role="region" aria-label={`Posição em ${g.ativoObjeto}`}>
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Código</th><th scope="col" className="numero">Quantidade</th><th scope="col" className="numero">Preço médio</th>
              <th scope="col" className="numero">Médio c/ custos</th><th scope="col" className="numero">Preço agora</th>
              <th scope="col" className="numero">Valor de mercado</th><th scope="col" className="numero">Resultado</th><th scope="col" className="numero">%</th>
              <th scope="col" className="numero">Realizado</th>
            </tr>
          </thead>
          <tbody>
            {ativas.map((i) => (
              <tr key={i.codigo}>
                <th scope="row">{i.codigo}<span className="sub">{descricao(i)}{i.diasAteVencimento !== null ? ` · ${i.diasAteVencimento} dias` : ''}</span></th>
                <td className={`numero ${i.quantidade < 0 ? 'resultado-baixa' : ''}`}>{i.quantidade.toLocaleString('pt-BR')}{i.quantidade < 0 ? ' (vendida)' : ''}</td>
                <td className="numero">{preco(i.precoMedio)}</td>
                <td className="numero"><strong>{preco(i.precoMedioComCustos)}</strong></td>
                <td className="numero" title={i.origemDoPreco === 'bid' ? 'Melhor oferta de compra (para vender agora)' : i.origemDoPreco === 'ask' ? 'Melhor oferta de venda (para recomprar agora)' : 'Último negócio'}
                  style={i.provedor === 'mt5' && i.qualidade === 'tempo_real' ? { color: 'var(--vivo)' } : undefined}>{preco(i.preco)}</td>
                <td className="numero">{formatarReais(i.valorDeMercado)}</td>
                <td className={`numero ${classe(i.resultado)}`}>{sinal(i.resultado)}</td>
                <td className={`numero ${classe(i.resultadoFracao)}`}>{pctBr(i.resultadoFracao)}</td>
                <td className={`numero ${classe(i.realizadoLiquido)}`}>{i.realizadoLiquido ? sinal(i.realizadoLiquido) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="linha-lista-apoio" style={{ margin: '0 24px', fontSize: 13 }}>
        {g.cobertura.acoes.toLocaleString('pt-BR')} ações · {g.cobertura.callsVendidas.toLocaleString('pt-BR')} calls vendidas · {g.cobertura.callsCompradas.toLocaleString('pt-BR')} calls compradas.
        {' '}Preço em destaque: MetaTrader 5 em tempo real.
      </p>
      {vencidas.length > 0 && (
        <div className="alerta" role="note" style={{ margin: '0 24px 12px' }}>
          <Icone nome="aviso" />
          <span>
            Opções vencidas ainda com quantidade: {vencidas.map((v) => `${v.codigo} (${v.quantidade.toLocaleString('pt-BR')})`).join(', ')}.
            {' '}Se viraram pó, marque "Vencer" na estratégia em <Link href="/posicoes">Posições</Link>; se foram exercidas, lance a ação. Se a compra encerrou uma venda feita antes das notas, lance essa venda em Posição inicial.
          </span>
        </div>
      )}
    </section>
  );
}

export default function PaginaCarteira() {
  const [carteira, setCarteira] = useState<Carteira | null>(null);
  const [notas, setNotas] = useState<NotaImportada[] | null>(null);
  const [previa, setPrevia] = useState<NotaDaPrevia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [inicial, setInicial] = useState({ codigo: '', lado: 'compra' as 'compra' | 'venda', quantidade: '', preco: '', data: '', strike: '', vencimento: '' });
  const arquivos = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      const [c, n] = await Promise.all([chamar<Carteira>('GET', '/api/carteira'), chamar<{ notas: NotaImportada[] }>('GET', '/api/notas')]);
      setCarteira(c);
      setNotas(n.notas);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível carregar a carteira.');
    }
  }, []);
  useEffect(() => {
    void carregar();
    // Preços: a cada 5 s no pregão, a cada minuto fora dele.
    const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, 5_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function lerNotas(lista: FileList | null) {
    if (!lista?.length) return;
    setErro(null); setAviso(null); setOcupado(true);
    try {
      const arqs = await Promise.all([...lista].slice(0, 20).map(async (f) => ({ nome: f.name, conteudo: await arquivoParaBase64(f) })));
      const r = await chamar<{ notas: NotaDaPrevia[] }>('POST', '/api/notas/ler', { arquivos: arqs });
      setPrevia(r.notas);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível ler as notas.');
    } finally {
      setOcupado(false);
      if (arquivos.current) arquivos.current.value = '';
    }
  }

  function completar(iNota: number, iNeg: number, campo: 'strike' | 'vencimento' | 'ativoObjeto', valor: string) {
    setPrevia((p) => p && p.map((n, a) => (a !== iNota ? n : {
      ...n,
      negocios: n.negocios?.map((x, b) => {
        if (b !== iNeg) return x;
        const v = campo === 'strike' ? lerReais(valor) : campo === 'ativoObjeto' ? valor.toUpperCase().trim() || null : valor || null;
        const nx = { ...x, [campo]: v } as typeof x;
        const falta = [
          ...(nx.tipo !== 'ativo' && !nx.strike ? ['strike'] : []),
          ...(nx.tipo !== 'ativo' && !nx.vencimento ? ['vencimento'] : []),
          ...(!nx.ativoObjeto || !/^[A-Z]{4}\d{1,2}$/.test(nx.ativoObjeto) ? ['ativo_objeto'] : []),
          ...(!nx.codigo ? ['codigo'] : []),
        ];
        return { ...nx, falta };
      }),
    })));
  }

  async function importar() {
    const prontas = (previa ?? []).filter(notaPronta);
    if (!prontas.length) return;
    setOcupado(true); setErro(null);
    try {
      const r = await chamar<{ notas: { numero: string; situacao: string; execucoes: number }[] }>('POST', '/api/notas/importar', { notas: prontas });
      const novas = r.notas.filter((x) => x.situacao === 'importada');
      setAviso(`${novas.length} nota(s) importada(s), ${novas.reduce((t, x) => t + x.execucoes, 0)} negócio(s). As operações estão em Posições, nas estratégias "Carteira <ativo>".`);
      setPrevia(null);
      await carregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível importar agora.');
    } finally {
      setOcupado(false);
    }
  }

  async function apagarNota(n: NotaImportada) {
    if (!window.confirm(`Apagar a nota ${n.numero} de ${formatarData(n.dataPregao)}? As operações que vieram dela saem da carteira.`)) return;
    try {
      await chamar('DELETE', `/api/notas/${n.id}`);
      setAviso(`Nota ${n.numero} apagada.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível apagar.');
    }
  }

  async function lancarInicial(e: FormEvent) {
    e.preventDefault();
    const quantidade = Number(inicial.quantidade.replace(/\./g, ''));
    const p = lerReais(inicial.preco);
    if (!/^[A-Za-z0-9]{4,12}$/.test(inicial.codigo.trim())) return setErro('Digite o código (ex.: BBAS3 ou BBASL145W1).');
    if (!Number.isInteger(quantidade) || quantidade <= 0) return setErro('Digite a quantidade.');
    if (p === null) return setErro('Digite o preço médio (ex.: 14,34).');
    if (!inicial.data) return setErro('Escolha a data.');
    setErro(null);
    try {
      await chamar('POST', '/api/carteira/posicao-inicial', {
        codigo: inicial.codigo.trim().toUpperCase(), lado: inicial.lado, quantidade, preco: p, data: inicial.data,
        ...(lerReais(inicial.strike) ? { strike: lerReais(inicial.strike) } : {}), ...(inicial.vencimento ? { vencimento: inicial.vencimento } : {}),
      });
      setAviso(`${inicial.lado === 'compra' ? 'Compra' : 'Venda'} de ${quantidade.toLocaleString('pt-BR')} ${inicial.codigo.toUpperCase()} lançada.`);
      setInicial((v) => ({ ...v, codigo: '', quantidade: '', preco: '', strike: '', vencimento: '' }));
      await carregar();
    } catch (x) {
      const m = x instanceof ErroDaApi ? x.codigo : '';
      setErro(m === 'opcao_sem_strike_ou_vencimento' ? 'Essa opção não está no cadastro da B3 do sistema: preencha o strike e o vencimento.' : x instanceof Error ? x.message : 'Não foi possível lançar.');
    }
  }

  const t = carteira?.totais;
  const prontas = (previa ?? []).filter(notaPronta).length;
  return (
    <>
      <Cabecalho titulo="Minha carteira" apoio="Sua posição atual, com preço médio com custos e o resultado pelo preço de agora. Importe as notas de corretagem para os custos exatos. Só acompanhamento: nada aqui envia ordem." />
      <MensagemDeErro texto={erro} />
      {aviso && <p className="sucesso-titulo" role="status" style={{ margin: 0 }}>{aviso}</p>}

      {t && (
        <div className="grade-cartoes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}><span className="fonte-texto">Valor de mercado</span><strong style={{ fontSize: 22 }}>{formatarReais(t.valorDeMercado)}</strong><span className="fonte-texto" style={{ fontSize: 12 }}>ações − opções vendidas + compradas</span></div>
          <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}><span className="fonte-texto">Resultado em aberto</span><strong className={classe(t.resultadoEmAberto)} style={{ fontSize: 22 }}>{sinal(t.resultadoEmAberto)}</strong><span className="fonte-texto" style={{ fontSize: 12 }}>contra o preço médio com custos</span></div>
          <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}><span className="fonte-texto">Realizado (líquido)</span><strong className={classe(t.realizadoLiquido)} style={{ fontSize: 22 }}>{sinal(t.realizadoLiquido)}</strong><span className="fonte-texto" style={{ fontSize: 12 }}>bruto {formatarReais(t.realizadoBruto)}</span></div>
          <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}><span className="fonte-texto">Custos pagos</span><strong style={{ fontSize: 22 }}>{formatarReais(t.custosPagos)}</strong><span className="fonte-texto" style={{ fontSize: 12 }}>corretagem, taxas e emolumentos</span></div>
        </div>
      )}

      {carteira && carteira.grupos.length === 0 && (
        <section className="secao"><p className="secao-vazia">Nenhuma posição ainda. Importe suas notas de corretagem ou lance sua posição atual abaixo.</p></section>
      )}
      {carteira?.grupos.map((g) => <Grupo key={g.ativoObjeto} g={g} />)}

      <section className="secao" aria-labelledby="importar-titulo">
        <h2 id="importar-titulo">Importar notas de corretagem</h2>
        <p className="linha-lista-apoio" style={{ margin: 0 }}>
          PDF da nota (padrão Sinacor: BTG, CM Capital, XP, Clear, Genial e outras). Pode enviar várias de uma vez. Você vê a prévia antes de gravar; a mesma nota não entra duas vezes.
          O PDF não fica guardado: só os negócios e os custos.
        </p>
        <div>
          <input ref={arquivos} id="notas-pdf" type="file" accept="application/pdf,.pdf" multiple className="so-leitor" onChange={(e) => void lerNotas(e.target.files)} />
          <label htmlFor="notas-pdf" className="botao botao-principal" style={{ display: 'inline-flex' }} aria-disabled={ocupado}>{ocupado ? 'Lendo…' : 'Escolher PDFs das notas'}</label>
        </div>
        {previa && (
          <div className="coluna" style={{ gap: 14 }}>
            {previa.map((n, iN) => (
              <div key={`${n.arquivo}-${iN}`} className="secao" style={{ background: 'var(--painel2)', padding: 16, gap: 8 }}>
                {n.erro ? (
                  <p style={{ margin: 0 }}><strong>{n.arquivo}</strong>: <span className="resultado-baixa">{ERRO_DA_NOTA[n.erro] ?? n.erro}</span></p>
                ) : (
                  <>
                    <p style={{ margin: 0 }}>
                      <strong>Nota {n.numero}</strong> · {n.dataPregao ? formatarData(n.dataPregao) : ''} · {n.corretora}{' '}
                      {n.jaImportada ? <span className="selo selo-neutro">já importada</span> : n.conferida ? <span className="selo selo-alta">conferida</span> : <span className="selo selo-atencao">líquido não confere: confira</span>}
                    </p>
                    <div className="tabela-caixa"><table className="tabela">
                      <thead><tr><th scope="col">Negócio</th><th scope="col">Código</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Preço</th><th scope="col" className="numero">Valor</th><th scope="col" className="numero">Custos</th><th scope="col">Série</th></tr></thead>
                      <tbody>
                        {n.negocios?.map((x, iX) => (
                          <tr key={iX}>
                            <td className={x.lado === 'venda' ? 'resultado-baixa' : 'resultado-alta'}>{x.lado === 'compra' ? 'Compra' : 'Venda'}<span className="sub">{x.tipo === 'ativo' ? 'à vista' : x.tipo === 'call' ? 'call' : x.tipo === 'put' ? 'put' : x.mercado}</span></td>
                            <td><strong>{x.codigo ?? '—'}</strong>{x.ativoObjeto && x.tipo !== 'ativo' ? <span className="sub">de {x.ativoObjeto}</span> : null}</td>
                            <td className="numero">{x.quantidade.toLocaleString('pt-BR')}</td>
                            <td className="numero">{preco(x.preco)}</td>
                            <td className="numero">{formatarReais(x.valor)}</td>
                            <td className="numero">{formatarReais(x.custos)}</td>
                            <td>
                              {x.tipo === 'ativo' ? '—' : (
                                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <input aria-label={`Strike de ${x.codigo}`} placeholder="strike" inputMode="decimal" defaultValue={x.strike ? (x.strike / 100).toFixed(2).replace('.', ',') : ''} onChange={(e) => completar(iN, iX, 'strike', e.target.value)} style={{ width: 80 }} />
                                  <input aria-label={`Vencimento de ${x.codigo}`} type="date" defaultValue={x.vencimento ?? ''} onChange={(e) => completar(iN, iX, 'vencimento', e.target.value)} />
                                  {x.vencimentoEstimado && <span className="linha-lista-apoio" style={{ fontSize: 12 }}>vencimento estimado: confira</span>}
                                  {x.falta.includes('ativo_objeto') && <input aria-label={`Ativo-objeto de ${x.codigo}`} placeholder="ativo (ex.: BOVA11)" onChange={(e) => completar(iN, iX, 'ativoObjeto', e.target.value)} style={{ width: 120 }} />}
                                </span>
                              )}
                              {x.alertas.map((a) => <span key={a} className="sub" style={{ color: 'var(--atencao)' }}>{ALERTA_DO_NEGOCIO[a] ?? a}</span>)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                    <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>
                      Custos da nota {formatarReais(n.custoTotal)}
                      {n.custos ? ` (${Object.entries(n.custos).filter(([, v]) => v > 0).map(([k, v]) => `${NOME_DO_CUSTO[k] ?? k} ${formatarReais(v)}`).join(' · ') || 'nenhum'})` : ''}
                      {n.irrf ? ` · IRRF ${formatarReais(n.irrf)} (não é custo: é antecipação de imposto)` : ''}
                      {' '}· Líquido {formatarReais(n.liquido ?? null)}. Custos divididos entre os negócios na proporção do valor.
                    </p>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="botao botao-principal" disabled={!prontas || ocupado} onClick={() => void importar()}>Importar {prontas} nota(s)</button>
              <button type="button" className="botao" onClick={() => setPrevia(null)}>Cancelar</button>
              {previa.length > prontas && <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Notas com erro, já importadas ou com campo faltando não entram.</span>}
            </div>
          </div>
        )}
      </section>

      <section className="secao" aria-labelledby="inicial-titulo">
        <h2 id="inicial-titulo">Lançar posição atual</h2>
        <p className="linha-lista-apoio" style={{ margin: 0 }}>Para o que você já tinha antes das notas: código, quantidade e preço médio. Opção vendida: escolha "Venda" e use o prêmio recebido.</p>
        <form className="boleta" noValidate onSubmit={(e) => void lancarInicial(e)}>
          <div className="campo" style={{ flex: '0 1 150px' }}><label htmlFor="ini-cod">Código</label><input id="ini-cod" value={inicial.codigo} onChange={(e) => setInicial({ ...inicial, codigo: e.target.value.toUpperCase() })} placeholder="BBAS3" /></div>
          <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor="ini-lado">Operação</label><select id="ini-lado" value={inicial.lado} onChange={(e) => setInicial({ ...inicial, lado: e.target.value as 'compra' | 'venda' })}><option value="compra">Compra</option><option value="venda">Venda</option></select></div>
          <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor="ini-qtd">Quantidade</label><input id="ini-qtd" inputMode="numeric" value={inicial.quantidade} onChange={(e) => setInicial({ ...inicial, quantidade: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 130px' }}><label htmlFor="ini-preco">Preço médio (R$)</label><input id="ini-preco" inputMode="decimal" value={inicial.preco} onChange={(e) => setInicial({ ...inicial, preco: e.target.value })} placeholder="14,34" /></div>
          <div className="campo" style={{ flex: '0 1 160px' }}><label htmlFor="ini-data">Data</label><input id="ini-data" type="date" value={inicial.data} onChange={(e) => setInicial({ ...inicial, data: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 120px' }}><label htmlFor="ini-strike">Strike (opção)</label><input id="ini-strike" inputMode="decimal" value={inicial.strike} onChange={(e) => setInicial({ ...inicial, strike: e.target.value })} placeholder="se pedir" /></div>
          <div className="campo" style={{ flex: '0 1 160px' }}><label htmlFor="ini-venc">Vencimento (opção)</label><input id="ini-venc" type="date" value={inicial.vencimento} onChange={(e) => setInicial({ ...inicial, vencimento: e.target.value })} /></div>
          <button type="submit" className="botao botao-principal">Lançar</button>
        </form>
      </section>

      <section className="secao secao-tabela" aria-labelledby="notas-titulo">
        <div className="secao-topo"><h2 id="notas-titulo">Notas importadas</h2></div>
        {notas && notas.length === 0 ? <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhuma nota importada.</p> : (
          <div className="tabela-caixa"><table className="tabela">
            <thead><tr><th scope="col">Data</th><th scope="col">Nota</th><th scope="col">Corretora</th><th scope="col" className="numero">Negócios</th><th scope="col" className="numero">Custos</th><th scope="col" className="numero">Líquido</th><th scope="col"><span className="so-leitor">Ações</span></th></tr></thead>
            <tbody>
              {notas?.map((n) => (
                <tr key={n.id}>
                  <td>{formatarData(n.dataPregao)}</td>
                  <td>{n.numero}{!n.conferida && <span className="sub" style={{ color: 'var(--atencao)' }}>líquido não conferiu</span>}</td>
                  <td>{n.corretora}</td>
                  <td className="numero">{n.negocios}</td>
                  <td className="numero">{formatarReais(n.custoTotal)}</td>
                  <td className={`numero ${classe(n.liquido)}`}>{formatarReais(n.liquido)}</td>
                  <td><button type="button" className="botao-texto botao-perigo" onClick={() => void apagarNota(n)} aria-label={`Apagar a nota ${n.numero}`}><Icone nome="lixeira" tamanho={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {carteira && (
        <section className="secao" aria-labelledby="premissas-carteira">
          <details>
            <summary><h2 id="premissas-carteira" style={{ display: 'inline' }}>Como os números são calculados</h2></summary>
            <ul style={{ margin: '12px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {carteira.premissas.map((p) => <li key={p} className="linha-lista-apoio">{p}</li>)}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
