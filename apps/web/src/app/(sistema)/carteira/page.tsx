'use client';

// Minha carteira: resumo, classes (ações, FIIs, ETFs, renda fixa, BDRs) com cada ativo
// abrindo ao clicar (preço médio, lotes, opções), lucros e perdas das opções e, recolhido,
// importar o extrato da B3, notas, lançar posição atual e zerar. Nada aqui envia ordem.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { VisaoDaCarteira } from '../../../componentes/CarteiraVisao.tsx';
import { ExtratoB3 } from '../../../componentes/ExtratoB3.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { lerReais } from '../../../lib/simulador.ts';
import {
  ALERTA_DO_NEGOCIO, arquivoParaBase64, ERRO_DA_NOTA, NOME_DO_CUSTO, notaPronta, textoDoErroDasNotas,
  type Carteira, type NotaDaPrevia,
} from '../../../lib/carteira.ts';

const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const preco = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
type NotaImportada = { id: string; corretora: string; numero: string; dataPregao: string; custoTotal: number; irrf: number; liquido: number | null; conferida: boolean; negocios: number };

export default function PaginaCarteira() {
  const [carteira, setCarteira] = useState<Carteira | null>(null);
  const [notas, setNotas] = useState<NotaImportada[] | null>(null);
  const [previa, setPrevia] = useState<NotaDaPrevia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [zerar, setZerar] = useState('');
  const [inicial, setInicial] = useState({ codigo: '', lado: 'compra' as 'compra' | 'venda', quantidade: '', preco: '', data: '', strike: '', vencimento: '' });
  const arquivos = useRef<HTMLInputElement>(null);

  const carregando = useRef(false);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    if (carregando.current) return; // não empilha consultas se a anterior ainda não voltou
    carregando.current = true;
    try {
      const [c, n] = await Promise.all([chamar<Carteira>('GET', '/api/carteira'), chamar<{ notas: NotaImportada[] }>('GET', '/api/notas')]);
      setCarteira(c);
      setNotas(n.notas);
      setErroDeCarga(null);
    } catch (x) {
      // Uma atualização que falha não apaga o que já está na tela; tenta de novo em 5 s.
      setErroDeCarga(x instanceof Error ? x.message : 'Não foi possível carregar a carteira.');
    } finally {
      carregando.current = false;
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
      const arqs = await Promise.all([...lista].slice(0, 40).map(async (f) => ({ nome: f.name, conteudo: await arquivoParaBase64(f) })));
      // Em grupos de 4: cada pedido fica curto (séries antigas são buscadas na B3).
      const lidas: NotaDaPrevia[] = [];
      for (let i = 0; i < arqs.length; i += 4) {
        setAviso(arqs.length > 4 ? `Lendo ${Math.min(i + 4, arqs.length)} de ${arqs.length} arquivos…` : null);
        const r = await chamar<{ notas: NotaDaPrevia[] }>('POST', '/api/notas/ler', { arquivos: arqs.slice(i, i + 4) });
        lidas.push(...r.notas);
      }
      setAviso(null);
      setPrevia(lidas);
    } catch (x) {
      setErro(textoDoErroDasNotas(x, 'Não foi possível ler as notas.'));
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await carregar();
    } catch (x) {
      setErro(textoDoErroDasNotas(x, 'Não foi possível importar agora.'));
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

  async function zerarCarteira() {
    if (zerar !== 'ZERAR') return;
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await chamar<{ apagado: { estrategias: number; execucoes: number; notas: number } }>('POST', '/api/carteira/zerar', { confirmacao: 'ZERAR' });
      setZerar('');
      setPrevia(null);
      setAviso(`Carteira zerada: ${r.apagado.estrategias} estratégia(s), ${r.apagado.execucoes} operação(ões) e ${r.apagado.notas} nota(s) apagadas. Pode começar a cadastrar do zero.`);
      await carregar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível zerar agora.');
    } finally {
      setOcupado(false);
    }
  }

  const prontas = (previa ?? []).filter(notaPronta).length;
  return (
    <>
      <Cabecalho titulo="Minha carteira" apoio="Sua posição atual, com preço médio com custos e o resultado pelo preço de agora. Importe as notas de corretagem para os custos exatos. Só acompanhamento: nada aqui envia ordem." />
      <MensagemDeErro texto={erro} />
      {aviso && <p className="sucesso-titulo" role="status" style={{ margin: 0 }}>{aviso}</p>}

      {erroDeCarga && !carteira && <MensagemDeErro texto={erroDeCarga} />}
      {!carteira && !erro && !erroDeCarga && <section className="secao"><p className="secao-vazia" role="status">Carregando sua carteira…</p></section>}
      {carteira && carteira.grupos.length === 0 && (
        <section className="secao"><p className="secao-vazia">Nenhuma posição ainda. Importe o extrato da B3 ou as notas de corretagem em &quot;Importar e lançar operações&quot;, abaixo.</p></section>
      )}
      {carteira && carteira.grupos.length > 0 && <VisaoDaCarteira carteira={carteira} />}

      <details className="secao importar-area" open={carteira ? carteira.grupos.length === 0 : false}>
        <summary><h2 style={{ display: 'inline' }}>Importar e lançar operações</h2> <span className="lotes-rotulo">extrato da B3, notas de corretagem, posição atual e zerar</span></summary>
        <div className="coluna" style={{ gap: 16, marginTop: 16 }}>
      <ExtratoB3 aoImportar={carregar} />

      <section className="secao" aria-labelledby="importar-titulo">
        <h2 id="importar-titulo">Importar notas de corretagem</h2>
        <p className="linha-lista-apoio" style={{ margin: 0 }}>
          PDF da nota (padrão Sinacor: BTG, CM Capital, XP, Clear, Genial e outras) ou a planilha XLS da CM Capital. Pode enviar várias de uma vez. Você vê a prévia antes de gravar; a mesma nota não entra duas vezes.
          O arquivo não fica guardado: só os negócios e os custos.
        </p>
        <div>
          <input ref={arquivos} id="notas-pdf" type="file" accept="application/pdf,.pdf,application/vnd.ms-excel,.xls" multiple className="so-leitor" onChange={(e) => void lerNotas(e.target.files)} />
          <label htmlFor="notas-pdf" className="botao botao-principal" style={{ display: 'inline-flex' }} aria-disabled={ocupado}>{ocupado ? 'Lendo…' : 'Escolher notas (PDF ou XLS)'}</label>
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
              <button type="button" className="botao botao-principal" disabled={!prontas || ocupado} onClick={() => void importar()}>{ocupado ? 'Importando…' : `Importar ${prontas} nota(s)`}</button>
              <button type="button" className="botao" disabled={ocupado} onClick={() => setPrevia(null)}>Cancelar</button>
              {previa.length > prontas && <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Notas com erro, já importadas ou com campo faltando não entram.</span>}
            </div>
            {/* O erro também aparece aqui, junto do botão (o do topo pode estar fora da tela). */}
            {erro && <div className="alerta"><Icone nome="aviso" tamanho={18} /><span>{erro}</span></div>}
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

      <section className="secao zona-perigo" aria-labelledby="zerar-titulo">
        <h2 id="zerar-titulo">Zerar minha carteira</h2>
        <p className="linha-lista-apoio" style={{ margin: 0 }}>
          Apaga <strong>todas</strong> as suas posições e estratégias (inclusive as lançadas em Posições), as operações, as rolagens, as notas importadas e os avisos de posições.
          {' '}Continuam: alertas de preço, favoritos, carteiras simuladas, a chave do MetaTrader 5 e o Telegram. Não dá para desfazer.
        </p>
        <div className="boleta" style={{ alignItems: 'flex-end' }}>
          <div className="campo" style={{ flex: '0 1 260px' }}>
            <label htmlFor="zerar-confirma">Para confirmar, digite ZERAR</label>
            <input id="zerar-confirma" value={zerar} autoComplete="off" onChange={(e) => setZerar(e.target.value.toUpperCase())} />
          </div>
          <button type="button" className="botao botao-perigo" disabled={zerar !== 'ZERAR' || ocupado} onClick={() => void zerarCarteira()}>Zerar tudo</button>
        </div>
      </section>

        </div>
      </details>

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
