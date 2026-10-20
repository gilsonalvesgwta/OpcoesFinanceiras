'use client';

// Posições: estratégias com as operações feitas na corretora, resultado realizado e
// estimado, payoff no vencimento, exposição e conferência com o MetaTrader 5.
// Nada aqui envia ordem.

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { quandoCurto } from '../../../lib/mercado.ts';
import { lerVolatilidade, NOME_DO_EVENTO, rotuloDaVariacao, type EventoDePosicao, type RespostaDeCenarios } from '../../../lib/inteligencia.ts';
import {
  conferirComCorretora, descreverExecucao, descreverInstrumento, descreverPosicao, execucaoDoFormulario, montarGrafico, MOTIVO_DO_PAYOFF,
  NOME_DO_TIPO, ORIGEM_DO_PRECO, pernaVazia, QUALIDADE, textoDoExtremo,
  type CotacaoDaApi, type Estrategia, type FormularioDaPerna, type PosicaoDaCorretora, type RespostaDePosicoes,
} from '../../../lib/posicoes.ts';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const classeDoValor = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');

function SeloDaCotacao({ q }: { q: CotacaoDaApi | null }) {
  if (!q) return <span className="selo selo-neutro">Sem preço</span>;
  const s = QUALIDADE[q.qualidade] ?? { texto: q.qualidade, classe: 'selo-neutro' };
  return <span className={`selo ${s.classe}`} title={q.instanteDaFonte ? `Dado de ${quandoCurto(q.instanteDaFonte)}` : undefined} style={{ fontSize: 13 }}>{s.texto}</span>;
}

// ---------- Gráfico de lucro e prejuízo no vencimento ----------

function GraficoDoPayoff({ e }: { e: Estrategia }) {
  const p = e.payoff;
  if (!p) return null;
  if ('motivo' in p) return <p className="aviso-tracejado">{MOTIVO_DO_PAYOFF[p.motivo]}</p>;
  if (!p.curva) return <p className="aviso-tracejado">Sem preço do ativo-objeto para desenhar o gráfico.</p>;
  const g = montarGrafico(p.curva);
  if (!g) return null;
  const strikes = [...new Set(e.instrumentos.filter((i) => i.quantidade !== 0 && i.strike !== null).map((i) => i.strike as number))];
  const spot = e.ativo?.ultimo ?? null;
  const equilibrios = p.analise.pontosDeEquilibrio.map((x) => Math.round(x * 100));
  const descricao = `Resultado no vencimento de ${e.nome} conforme o preço de ${e.ativoObjeto}: perda máxima ${textoDoExtremo(p.analise.perdaMaxima)}, lucro máximo ${textoDoExtremo(p.analise.lucroMaximo)}, equilíbrio em ${equilibrios.map(reais).join(' e ') || 'nenhum ponto'}.`;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${g.largura} ${g.altura}`} width="100%" role="img" aria-label={descricao} style={{ display: 'block' }}>
        <path d={g.caminhoLucro} fill="var(--alta)" opacity="0.16" />
        <path d={g.caminhoPrejuizo} fill="var(--baixa)" opacity="0.16" />
        {g.yZero !== null && <line x1={g.x(g.de)} x2={g.x(g.ate)} y1={g.yZero} y2={g.yZero} stroke="var(--apoio)" strokeWidth="1" />}
        {strikes.map((k) => (
          <g key={k}>
            <line x1={g.x(k)} x2={g.x(k)} y1={14} y2={g.altura - 28} stroke="var(--linha)" strokeDasharray="2 4" />
            <text x={g.x(k)} y={g.altura - 14} textAnchor="middle" fontSize="11" fill="var(--apoio)">{reais(k)}</text>
          </g>
        ))}
        <path d={g.linha} fill="none" stroke="var(--texto)" strokeWidth="2" />
        {equilibrios.map((b) => (
          <g key={b}>
            <circle cx={g.x(b)} cy={g.yZero ?? 0} r="4" fill="var(--latao)" />
            <text x={g.x(b)} y={(g.yZero ?? 0) - 8} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--latao)">{reais(b)}</text>
          </g>
        ))}
        {spot !== null && spot >= g.de && spot <= g.ate && (
          <g>
            <line x1={g.x(spot)} x2={g.x(spot)} y1={14} y2={g.altura - 28} stroke="var(--vivo)" strokeWidth="1.5" />
            <text x={g.x(spot) + 4} y={24} fontSize="11" fill="var(--vivo)">hoje {reais(spot)}</text>
          </g>
        )}
        <text x={g.x(g.de) - 6} y={g.y(g.max) + 10} textAnchor="end" fontSize="11" fill="var(--apoio)">{formatarReais(Math.round(g.max))}</text>
        {g.yZero !== null && <text x={g.x(g.de) - 6} y={g.yZero + 4} textAnchor="end" fontSize="11" fill="var(--apoio)">R$ 0</text>}
        <text x={g.x(g.de) - 6} y={g.y(g.min)} textAnchor="end" fontSize="11" fill="var(--apoio)">{formatarReais(Math.round(g.min))}</text>
        <text x={g.x(g.de)} y={g.altura - 2} fontSize="11" fill="var(--apoio)">{reais(g.de)}</text>
        <text x={g.x(g.ate)} y={g.altura - 2} textAnchor="end" fontSize="11" fill="var(--apoio)">{reais(g.ate)}</text>
      </svg>
      <figcaption className="linha-lista-apoio" style={{ fontSize: 13 }}>
        Resultado total da estratégia{p.vencimento ? ` no vencimento (${formatarData(p.vencimento)})` : ''} conforme o preço de {e.ativoObjeto}, já com o realizado e os custos pagos.
        {' '}<span style={{ color: 'var(--latao)' }}>●</span> equilíbrio · <span style={{ color: 'var(--vivo)' }}>│</span> preço de hoje · linhas pontilhadas: strikes.
      </figcaption>
    </figure>
  );
}

// ---------- Formulário de uma perna ----------

function CamposDaPerna({ id, f, mudar, aoBuscar }: { id: string; f: FormularioDaPerna; mudar: (x: Partial<FormularioDaPerna>) => void; aoBuscar?: (codigo: string) => void }) {
  return (
    <div className="form-em-linha linha-condicao">
      <div className="campo" style={{ flex: '1 1 130px' }}>
        <label htmlFor={`${id}-codigo`}>Código</label>
        <input id={`${id}-codigo`} value={f.codigo} maxLength={12} placeholder="PETRK380" autoCapitalize="characters"
          onChange={(e) => mudar({ codigo: e.target.value.toUpperCase() })} onBlur={() => aoBuscar?.(f.codigo)} />
      </div>
      <div className="campo" style={{ flex: '0 1 110px' }}>
        <label htmlFor={`${id}-tipo`}>Tipo</label>
        <select id={`${id}-tipo`} value={f.tipo} onChange={(e) => mudar({ tipo: e.target.value as FormularioDaPerna['tipo'] })}>
          <option value="call">Call</option><option value="put">Put</option><option value="ativo">Ação</option>
        </select>
      </div>
      <div className="campo" style={{ flex: '0 1 110px' }}>
        <label htmlFor={`${id}-lado`}>Operação</label>
        <select id={`${id}-lado`} value={f.lado} onChange={(e) => mudar({ lado: e.target.value as FormularioDaPerna['lado'] })}>
          <option value="compra">Compra</option><option value="venda">Venda</option>
        </select>
      </div>
      {f.tipo !== 'ativo' && (
        <>
          <div className="campo" style={{ flex: '0 1 110px' }}>
            <label htmlFor={`${id}-strike`}>Strike (R$)</label>
            <input id={`${id}-strike`} inputMode="decimal" value={f.strike} placeholder="38,00" onChange={(e) => mudar({ strike: e.target.value })} />
          </div>
          <div className="campo" style={{ flex: '0 1 160px' }}>
            <label htmlFor={`${id}-venc`}>Vencimento</label>
            <input id={`${id}-venc`} type="date" value={f.vencimento} onChange={(e) => mudar({ vencimento: e.target.value })} />
          </div>
        </>
      )}
      <div className="campo" style={{ flex: '0 1 110px' }}>
        <label htmlFor={`${id}-qtd`}>Quantidade</label>
        <input id={`${id}-qtd`} inputMode="numeric" value={f.quantidade} onChange={(e) => mudar({ quantidade: e.target.value })} />
      </div>
      <div className="campo" style={{ flex: '0 1 110px' }}>
        <label htmlFor={`${id}-preco`}>Preço (R$)</label>
        <input id={`${id}-preco`} inputMode="decimal" value={f.preco} placeholder="1,25" onChange={(e) => mudar({ preco: e.target.value })} />
      </div>
      <div className="campo" style={{ flex: '0 1 110px' }}>
        <label htmlFor={`${id}-custos`}>Custos (R$)</label>
        <input id={`${id}-custos`} inputMode="decimal" value={f.custos} placeholder="0,00" onChange={(e) => mudar({ custos: e.target.value })} />
      </div>
      <div className="campo" style={{ flex: '0 1 150px' }}>
        <label htmlFor={`${id}-data`}>Data</label>
        <input id={`${id}-data`} type="date" value={f.data} onChange={(e) => mudar({ data: e.target.value })} />
      </div>
      <div className="campo" style={{ flex: '0 1 100px' }}>
        <label htmlFor={`${id}-hora`}>Hora</label>
        <input id={`${id}-hora`} type="time" value={f.hora} onChange={(e) => mudar({ hora: e.target.value })} />
      </div>
    </div>
  );
}

type Serie = { tipo: FormularioDaPerna['tipo']; strike: number | null; vencimento: string | null; ativoObjeto: string | null; cotacao: CotacaoDaApi | null };

async function buscarSerie(codigo: string): Promise<Serie | null> {
  if (!/^[A-Z0-9]{4,12}$/.test(codigo)) return null;
  try {
    return await chamar<Serie>('GET', `/api/posicoes/serie/${codigo}`);
  } catch {
    return null;
  }
}

function preencherDaSerie(f: FormularioDaPerna, s: Serie): Partial<FormularioDaPerna> {
  const preco = s.cotacao ? (f.lado === 'compra' ? s.cotacao.ask : s.cotacao.bid) ?? s.cotacao.ultimo : null;
  return {
    tipo: s.tipo,
    strike: s.strike !== null ? reais(s.strike) : '',
    vencimento: s.vencimento ?? '',
    ...(f.preco === '' && preco !== null ? { preco: reais(preco) } : {}),
  };
}

// ---------- Cartão de uma estratégia ----------

function CartaoDaEstrategia({ e, aoAgir }: { e: Estrategia; aoAgir: (fn: () => Promise<unknown>, texto: string) => Promise<boolean> }) {
  const [registrando, setRegistrando] = useState<FormularioDaPerna | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const abertos = e.instrumentos.filter((i) => i.quantidade !== 0);
  const r = e.resultado;
  const p = e.payoff && 'analise' in e.payoff ? e.payoff : null;
  const marcacao = new Map((r?.marcacoes ?? []).map((m) => [m.codigo, m]));
  const proximo = abertos.filter((i) => i.diasCorridos !== null && i.diasCorridos >= 0).sort((a, b) => (a.diasCorridos as number) - (b.diasCorridos as number))[0];
  const callsVendidas = -abertos.filter((i) => i.tipo === 'call').reduce((t, i) => t + i.quantidade * i.multiplicador, 0);
  const acoes = abertos.filter((i) => i.tipo === 'ativo').reduce((t, i) => t + i.quantidade * i.multiplicador, 0);
  const descobertas = Math.max(0, callsVendidas - Math.max(0, acoes));
  const encerrada = e.situacao === 'encerrada';

  async function registrar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!registrando) return;
    const x = execucaoDoFormulario(registrando, new Date());
    if (!x.ok) return setErroForm(x.erro);
    setErroForm(null);
    const ok = await aoAgir(() => chamar('POST', `/api/posicoes/${e.id}/execucoes`, x.execucao), `Operação registrada em "${e.nome}".`);
    if (ok) setRegistrando(null);
  }

  return (
    <section className="secao" aria-labelledby={`est-${e.id}`}>
      <div className="secao-topo">
        <div className="ponte-texto">
          <div className="ponte-nome">
            <h2 id={`est-${e.id}`} style={{ fontSize: 20 }}>{e.nome}</h2>
            <span className={`selo ${encerrada ? 'selo-neutro' : 'selo-alta'}`}>{encerrada ? `Encerrada em ${e.encerradaEm ? formatarData(e.encerradaEm) : '—'}` : 'Aberta'}</span>
          </div>
          <span className="ponte-apoio">
            <strong style={{ color: 'var(--texto)' }}>{e.ativoObjeto}</strong>
            {e.ativo && <> {formatarReais(e.ativo.ultimo)} <SeloDaCotacao q={e.ativo} /></>}
            {proximo && <> · vence em {proximo.diasCorridos} {proximo.diasCorridos === 1 ? 'dia' : 'dias'} ({proximo.diasDePregao} {proximo.diasDePregao === 1 ? 'pregão' : 'pregões'})</>}
            {e.observacao && <> · {e.observacao}</>}
          </span>
        </div>
        <div className="ponte-acoes">
          {!encerrada && abertos.some((i) => i.tipo !== 'ativo') && <Link className="botao botao-pequeno" href={`/rolagens?estrategia=${e.id}`}>Simular rolagem</Link>}
          {!encerrada && !registrando && <button type="button" className="botao botao-pequeno botao-principal" onClick={() => { setErroForm(null); setRegistrando(pernaVazia(new Date())); }}>Registrar operação</button>}
          {!encerrada && abertos.length === 0 && e.execucoes.length > 0 && (
            <button type="button" className="botao botao-pequeno" onClick={() => void aoAgir(() => chamar('PATCH', `/api/posicoes/${e.id}`, { situacao: 'encerrada' }), `"${e.nome}" encerrada.`)}>Encerrar</button>
          )}
          {encerrada && <button type="button" className="botao botao-pequeno" onClick={() => void aoAgir(() => chamar('PATCH', `/api/posicoes/${e.id}`, { situacao: 'aberta' }), `"${e.nome}" reaberta.`)}>Reabrir</button>}
          {confirmar === 'estrategia' ? (
            <>
              <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void aoAgir(() => chamar('DELETE', `/api/posicoes/${e.id}`), `"${e.nome}" excluída.`)}>Confirmar exclusão</button>
              <button type="button" className="botao botao-pequeno" onClick={() => setConfirmar(null)}>Manter</button>
            </>
          ) : (
            <button type="button" className="botao-texto botao-perigo" onClick={() => setConfirmar('estrategia')} aria-label={`Excluir a estratégia ${e.nome}`}>Excluir</button>
          )}
        </div>
      </div>

      {e.erro && <div className="alerta" role="note"><Icone nome="aviso" /><span>As operações desta estratégia não fecham entre si ({e.erro}). Confira as execuções abaixo.</span></div>}
      {descobertas > 0 && (
        <div className="alerta" role="note"><Icone nome="aviso" /><span>{descobertas.toLocaleString('pt-BR')} calls vendidas sem cobertura nesta estratégia: o prejuízo não tem limite se {e.ativoObjeto} subir.</span></div>
      )}

      {r && (
        <div className="grade-cartoes" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
            <span className="fonte-texto">Realizado (líquido)</span>
            <strong className={classeDoValor(r.realizadoLiquido)} style={{ fontSize: 20 }}>{formatarReais(r.realizadoLiquido)}</strong>
            <span className="fonte-texto" style={{ fontSize: 12 }}>custos pagos {formatarReais(r.custosPagos)}</span>
          </div>
          {!encerrada && (
            <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
              <span className="fonte-texto">Não realizado (estimado)</span>
              <strong className={classeDoValor(r.naoRealizadoEstimado)} style={{ fontSize: 20 }}>{formatarReais(r.naoRealizadoEstimado)}</strong>
              <span className="fonte-texto" style={{ fontSize: 12 }}>
                {r.naoRealizadoEstimado === null ? `sem preço de ${r.instrumentosSemPreco.join(', ')}` : r.usaEstimativa ? 'parte pelo último negócio' : 'pelo preço para sair agora'}
              </span>
            </div>
          )}
          {p && (
            <>
              <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                <span className="fonte-texto">Lucro máximo</span>
                <strong style={{ fontSize: 20 }}>{textoDoExtremo(p.analise.lucroMaximo)}</strong>
                <span className="fonte-texto" style={{ fontSize: 12 }}>no vencimento</span>
              </div>
              <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                <span className="fonte-texto">Perda máxima</span>
                <strong className={p.analise.perdaMaxima.tipo === 'ilimitado' ? 'resultado-baixa' : ''} style={{ fontSize: 20 }}>{textoDoExtremo(p.analise.perdaMaxima)}</strong>
                <span className="fonte-texto" style={{ fontSize: 12 }}>no vencimento</span>
              </div>
              <div className="fonte" style={{ flexDirection: 'column', gap: 2 }}>
                <span className="fonte-texto">Equilíbrio</span>
                <strong style={{ fontSize: 20 }}>{p.analise.pontosDeEquilibrio.length ? p.analise.pontosDeEquilibrio.map((x) => `R$ ${x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' · ') : 'Nenhum'}</strong>
                <span className="fonte-texto" style={{ fontSize: 12 }}>preço de {e.ativoObjeto} no vencimento</span>
              </div>
            </>
          )}
        </div>
      )}

      {!encerrada && <GraficoDoPayoff e={e} />}

      {abertos.length > 0 && (
        <div className="tabela-caixa" tabIndex={0} role="region" aria-label={`Pernas abertas de ${e.nome}`} style={{ margin: '0 -24px' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Perna</th>
                <th scope="col">Posição</th>
                <th scope="col" className="numero">Preço médio</th>
                <th scope="col" className="numero">Preço para sair</th>
                <th scope="col" className="numero">Resultado estimado</th>
                <th scope="col">Dado</th>
                <th scope="col">Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {abertos.map((i) => {
                const m = marcacao.get(i.codigo);
                const est = m ? Math.round(i.quantidade * (m.preco - i.precoMedio) * i.multiplicador) : null;
                return (
                  <tr key={i.codigo}>
                    <th scope="row">{i.codigo}<span className="sub">{descreverInstrumento(i)}</span></th>
                    <td className={i.quantidade < 0 ? 'resultado-baixa' : ''} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{descreverPosicao(i.quantidade)}</td>
                    <td className="numero">{reais(Math.round(i.precoMedio))}</td>
                    <td className="numero">{m ? reais(Math.round(m.preco)) : '—'}{m && <span className="sub">{ORIGEM_DO_PRECO[m.origem] ?? m.origem}</span>}</td>
                    <td className={`numero ${classeDoValor(est)}`}>{formatarReais(est)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><SeloDaCotacao q={i.cotacao} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {i.vencimento ? (
                        i.vencido ? (
                          !encerrada && <button type="button" className="botao botao-pequeno" onClick={() => void aoAgir(() => chamar('POST', `/api/posicoes/${e.id}/vencer`, { codigo: i.codigo }), `${i.codigo} registrada como vencida sem exercício.`)}
                            title="Registra a saída a R$ 0,00 no dia do vencimento. Se houve exercício, registre a operação real em vez disso.">Venceu sem exercício</button>
                        ) : <>{formatarData(i.vencimento)}<span className="sub">{i.diasCorridos} dias · {i.diasDePregao} pregões</span></>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {registrando && (
        <form onSubmit={registrar} noValidate>
          <fieldset className="grupo-de-campos" style={{ borderColor: 'var(--latao)' }}>
          <legend>Registrar operação</legend>
          <p className="linha-lista-apoio" style={{ margin: 0 }}>Para sair de uma perna, registre a operação contrária (ex.: comprar de volta a call vendida). Para rolar, registre a saída e a entrada nova.</p>
          <CamposDaPerna id={`reg-${e.id}`} f={registrando} mudar={(x) => setRegistrando((f) => (f ? { ...f, ...x } : f))}
            aoBuscar={(codigo) => {
              const ja = e.instrumentos.find((i) => i.codigo === codigo);
              if (ja) {
                setRegistrando((f) => (f ? {
                  ...f, tipo: ja.tipo, strike: ja.strike !== null ? reais(ja.strike) : '', vencimento: ja.vencimento ?? '',
                  lado: ja.quantidade > 0 ? 'venda' : 'compra', quantidade: f.quantidade || String(Math.abs(ja.quantidade)),
                } : f));
                return;
              }
              void buscarSerie(codigo).then((s) => { if (s) setRegistrando((f) => (f ? { ...f, ...preencherDaSerie(f, s) } : f)); });
            }} />
          <MensagemDeErro texto={erroForm} />
          <div className="form-em-linha">
            <button type="submit" className="botao botao-principal">Registrar</button>
            <button type="button" className="botao" onClick={() => setRegistrando(null)}>Cancelar</button>
          </div>
          </fieldset>
        </form>
      )}

      {!encerrada && abertos.length > 0 && <Cenarios e={e} />}

      <details>
        <summary className="linha-lista-apoio">Operações registradas ({e.execucoes.length})</summary>
        <div className="pontes" style={{ marginTop: 8 }}>
          {e.execucoes.map((x) => (
            <div key={x.id} className="ponte" style={{ padding: '10px 14px' }}>
              <div className="ponte-texto">
                <span>{descreverExecucao(x)}{x.custos > 0 && <span className="linha-lista-apoio"> · custos {formatarReais(x.custos)}</span>}</span>
                <span className="ponte-apoio" style={{ fontSize: 13 }}>
                  {quandoCurto(x.instante)} · {NOME_DO_TIPO[x.tipo]}{x.strike !== null ? ` ${reais(x.strike)}` : ''}
                  {x.origem === 'importada_mt5' ? ' · importada do MetaTrader 5' : ''}{x.observacao ? ` · ${x.observacao}` : ''}
                </span>
              </div>
              {!encerrada && x.rolagemId && <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Parte de uma rolagem (<Link href={`/rolagens?estrategia=${e.id}`}>desfazer em Rolagens</Link>)</span>}
              {!encerrada && !x.rolagemId && (
                <div className="ponte-acoes">
                  {confirmar === x.id ? (
                    <>
                      <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void aoAgir(() => chamar('DELETE', `/api/posicoes/${e.id}/execucoes/${x.id}`), 'Operação apagada.')}>Confirmar</button>
                      <button type="button" className="botao botao-pequeno" onClick={() => setConfirmar(null)}>Manter</button>
                    </>
                  ) : (
                    <button type="button" className="botao-texto botao-perigo" onClick={() => setConfirmar(x.id)} aria-label={`Apagar: ${descreverExecucao(x)}`}>Apagar</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

// ---------- Cenários "e se" ----------

function Cenarios({ e }: { e: Estrategia }) {
  const [aberto, setAberto] = useState(false);
  const [vol, setVol] = useState('');
  const [r, setR] = useState<RespostaDeCenarios | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function calcular(volTexto: string) {
    const v = lerVolatilidade(volTexto);
    if (!v.ok) return setErro(v.erro);
    setErro(null);
    try {
      setR(await chamar<RespostaDeCenarios>('POST', `/api/posicoes/${e.id}/cenarios`, v.volPct === null ? {} : { volPct: v.volPct }));
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível calcular agora.');
    }
  }

  return (
    <details onToggle={(ev) => { const a = (ev.currentTarget as HTMLDetailsElement).open; setAberto(a); if (a && !r) void calcular(vol); }}>
      <summary className="linha-lista-apoio">E se {e.ativoObjeto} for para outro preço? (cenários)</summary>
      {aberto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <MensagemDeErro texto={erro} />
          {!r && !erro && <p className="secao-vazia" role="status">Calculando…</p>}
          {r && (
            <>
              <div className="tabela-caixa" tabIndex={0} role="region" aria-label={`Cenários de ${e.nome}`} style={{ margin: '0 -24px' }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th scope="col">{e.ativoObjeto} a</th>
                      {r.grade.colunas.map((c) => <th key={c.rotulo} scope="col" className="numero">{c.rotulo}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {r.grade.linhas.map((l) => (
                      <tr key={l.preco} style={l.variacao === 0 ? { background: 'var(--painel2)' } : undefined}>
                        <th scope="row">{reais(l.preco)}<span className="sub">{rotuloDaVariacao(l.variacao)}</span></th>
                        {l.resultados.map((v, i) => <td key={i} className={`numero ${classeDoValor(v)}`}>{formatarReais(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.grade.semVol.length > 0 && <p className="aviso-tracejado">Sem volatilidade para {r.grade.semVol.join(', ')}: informe uma abaixo para estimar.</p>}
              <form className="form-em-linha" noValidate onSubmit={(ev) => { ev.preventDefault(); void calcular(vol); }}>
                <div className="campo" style={{ flex: '0 1 220px' }}>
                  <label htmlFor={`vol-${e.id}`}>Volatilidade (% ao ano)</label>
                  <input id={`vol-${e.id}`} inputMode="decimal" value={vol} placeholder="a implícita" onChange={(ev) => setVol(ev.target.value)} />
                </div>
                <button type="submit" className="botao botao-pequeno">Recalcular</button>
              </form>
              <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>
                Volatilidade usada: {r.vols.length ? r.vols.map((v) => `${v.codigo} ${v.volPct === null ? 'sem dado' : `${v.volPct.toLocaleString('pt-BR')}% (${v.origem})`}`).join('; ') : 'não se aplica (só ações)'}.
                {' '}Selic {r.selic.valor.toLocaleString('pt-BR')}% ao ano. Preço de partida: {r.ativo?.ultimo ? reais(r.ativo.ultimo) : '—'} ({QUALIDADE[r.ativo?.qualidade ?? '']?.texto ?? r.ativo?.qualidade ?? '—'}).
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--apoio)', fontSize: 13 }}>{r.premissas.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </details>
  );
}

// ---------- Avisos das posições ----------

function AvisosDasPosicoes({ eventos, aoLer }: { eventos: EventoDePosicao[]; aoLer: (ids?: number[]) => void }) {
  const novos = eventos.filter((x) => !x.lido);
  if (novos.length === 0) return null;
  return (
    <section className="secao" aria-labelledby="avisos-titulo" style={{ borderColor: 'var(--atencao)' }}>
      <div className="secao-topo">
        <h2 id="avisos-titulo">Avisos das suas posições ({novos.length})</h2>
        <div className="form-em-linha">
          <Link href="/preferencias#avisos-posicao" className="botao-texto">Configurar</Link>
          <button type="button" className="botao botao-pequeno" onClick={() => aoLer()}>Marcar todos como lidos</button>
        </div>
      </div>
      <div className="pontes">
        {novos.slice(0, 8).map((x) => (
          <div key={x.id} className="ponte" style={{ padding: '10px 14px' }}>
            <div className="ponte-texto">
              <div className="ponte-nome">
                <span className={`selo ${x.tipo === 'sugestao_rolagem' ? 'selo-periodica' : 'selo-atencao'}`} style={{ fontSize: 13 }}><Icone nome="aviso" tamanho={14} />{NOME_DO_EVENTO[x.tipo]}</span>
                <strong>{x.titulo}</strong>
              </div>
              <span className="ponte-apoio">{x.texto}</span>
              <span className="ponte-apoio" style={{ fontSize: 12 }}>{quandoCurto(x.criadoEm)}{x.aviso === 'enviado' ? ' · enviado no Telegram' : ''}</span>
            </div>
            <div className="ponte-acoes">
              {x.tipo === 'sugestao_rolagem' && x.estrategiaId && <Link className="botao botao-pequeno" href={`/rolagens?estrategia=${x.estrategiaId}`}>Comparar em Rolagens</Link>}
              <button type="button" className="botao-texto" onClick={() => aoLer([x.id])} aria-label={`Marcar como lido: ${x.titulo}`}>Lido</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Página ----------

export default function PaginaPosicoes() {
  const [dados, setDados] = useState<RespostaDePosicoes | null>(null);
  const [corretora, setCorretora] = useState<PosicaoDaCorretora[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nova, setNova] = useState<{ nome: string; ativoObjeto: string; observacao: string; pernas: FormularioDaPerna[] } | null>(null);
  const [erroNova, setErroNova] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [importar, setImportar] = useState<{ codigos: string[]; destino: string; nome: string }>({ codigos: [], destino: 'nova', nome: '' });
  const [eventos, setEventos] = useState<EventoDePosicao[]>([]);

  const carregar = useCallback(async () => {
    const [p, c, v] = await Promise.all([
      chamar<RespostaDePosicoes>('GET', '/api/posicoes'),
      chamar<{ posicoes: PosicaoDaCorretora[] }>('GET', '/api/posicoes-corretora').catch(() => ({ posicoes: [] })),
      chamar<{ eventos: EventoDePosicao[] }>('GET', '/api/avisos-posicao').catch(() => ({ eventos: [] })),
    ]);
    setDados(p);
    setCorretora(c.posicoes);
    setEventos(v.eventos);
  }, []);

  useEffect(() => {
    carregar().catch((e: Error) => setErro(e.message));
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar().catch(() => undefined); }, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function agir(fn: () => Promise<unknown>, texto: string): Promise<boolean> {
    setErro(null);
    setAviso(null);
    try {
      await fn();
      setAviso(texto);
      await carregar();
      return true;
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível concluir agora.');
      return false;
    }
  }

  async function criar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!nova) return;
    if (!nova.nome.trim()) return setErroNova('Dê um nome à estratégia (ex.: "Venda coberta PETR4").');
    if (!/^[A-Z0-9]{4,12}$/.test(nova.ativoObjeto)) return setErroNova('Informe o ativo-objeto (ex.: PETR4).');
    const execucoes = [];
    for (const [i, f] of nova.pernas.entries()) {
      const x = execucaoDoFormulario(f, new Date());
      if (!x.ok) return setErroNova(`Perna ${i + 1}: ${x.erro}`);
      execucoes.push(x.execucao);
    }
    setErroNova(null);
    setSalvando(true);
    try {
      await chamar('POST', '/api/posicoes', { nome: nova.nome.trim(), ativoObjeto: nova.ativoObjeto, ...(nova.observacao.trim() ? { observacao: nova.observacao.trim() } : {}), execucoes });
      setAviso(`Estratégia "${nova.nome.trim()}" criada.`);
      setNova(null);
      await carregar();
    } catch (x) {
      setErroNova(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar agora.');
    } finally {
      setSalvando(false);
    }
  }

  const mudarPerna = (i: number, x: Partial<FormularioDaPerna>) => setNova((n) => (n ? { ...n, pernas: n.pernas.map((p, j) => (j === i ? { ...p, ...x } : p)) } : n));
  const buscarParaNova = (i: number, codigo: string) => {
    void buscarSerie(codigo).then((s) => {
      if (!s) return;
      setNova((n) => {
        if (!n) return n;
        const p = n.pernas[i];
        if (!p) return n;
        return { ...n, ativoObjeto: n.ativoObjeto || (s.ativoObjeto ?? ''), pernas: n.pernas.map((q, j) => (j === i ? { ...q, ...preencherDaSerie(q, s) } : q)) };
      });
    });
  };

  const abertas = dados?.estrategias.filter((e) => e.situacao === 'aberta') ?? [];
  const encerradas = dados?.estrategias.filter((e) => e.situacao === 'encerrada') ?? [];
  const conferencia = dados ? conferirComCorretora(corretora, dados.liquidoPorCodigo) : [];
  const exposicoes = (dados?.exposicoes ?? []).filter((x) => x.vencimento !== null || x.quantidadeLiquidaAcoes !== 0);

  return (
    <>
      <Cabecalho
        titulo="Posições"
        apoio="As operações que você fez na corretora, com resultado, risco e o gráfico no vencimento. Só acompanhamento: nada aqui envia ordem."
        acoes={!nova ? (
          <button type="button" className="botao botao-principal" onClick={() => { setErroNova(null); setNova({ nome: '', ativoObjeto: '', observacao: '', pernas: [pernaVazia(new Date())] }); }}>
            <Icone nome="mais" tamanho={18} />Nova estratégia
          </button>
        ) : undefined}
      />

      <MensagemDeErro texto={erro} />
      <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>
      <AvisosDasPosicoes eventos={eventos} aoLer={(ids) => void chamar('POST', '/api/avisos-posicao/lidos', ids ? { ids } : {}).then(() => carregar()).catch(() => undefined)} />

      {nova && (
        <section className="secao" aria-labelledby="nova-titulo">
          <h2 id="nova-titulo">Nova estratégia</h2>
          <form onSubmit={criar} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-em-linha">
              <div className="campo" style={{ flex: '2 1 240px' }}>
                <label htmlFor="nova-nome">Nome</label>
                <input id="nova-nome" value={nova.nome} maxLength={80} placeholder="Ex.: Trava de alta PETR4 novembro" onChange={(e) => setNova({ ...nova, nome: e.target.value })} />
              </div>
              <div className="campo" style={{ flex: '1 1 140px' }}>
                <label htmlFor="nova-ativo">Ativo-objeto</label>
                <input id="nova-ativo" value={nova.ativoObjeto} maxLength={12} placeholder="PETR4" autoCapitalize="characters" onChange={(e) => setNova({ ...nova, ativoObjeto: e.target.value.toUpperCase() })} />
              </div>
              <div className="campo" style={{ flex: '2 1 240px' }}>
                <label htmlFor="nova-obs">Observação (opcional)</label>
                <input id="nova-obs" value={nova.observacao} maxLength={1000} placeholder="Ex.: objetivo, plano de saída" onChange={(e) => setNova({ ...nova, observacao: e.target.value })} />
              </div>
            </div>
            {nova.pernas.map((p, i) => (
              <fieldset key={i} className="grupo-de-campos">
                <legend>Perna {i + 1}</legend>
                <CamposDaPerna id={`nova-${i}`} f={p} mudar={(x) => mudarPerna(i, x)} aoBuscar={(c) => buscarParaNova(i, c)} />
                {nova.pernas.length > 1 && (
                  <div><button type="button" className="botao-texto botao-perigo" onClick={() => setNova({ ...nova, pernas: nova.pernas.filter((_, j) => j !== i) })}>Remover perna {i + 1}</button></div>
                )}
              </fieldset>
            ))}
            <p className="linha-lista-apoio" style={{ margin: 0 }}>Ao digitar o código de uma opção, o tipo, o strike e o vencimento vêm do cadastro da B3. Preço é por unidade; custos são o total da operação (corretagem, emolumentos, taxas).</p>
            {nova.pernas.length < 8 && (
              <div><button type="button" className="botao botao-pequeno" onClick={() => setNova({ ...nova, pernas: [...nova.pernas, { ...pernaVazia(new Date()), data: nova.pernas[0]?.data ?? '', hora: nova.pernas[0]?.hora ?? '' }] })}>Adicionar perna</button></div>
            )}
            <MensagemDeErro texto={erroNova} />
            <div className="form-em-linha">
              <button type="submit" className="botao botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Criar estratégia'}</button>
              <button type="button" className="botao" onClick={() => setNova(null)}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      {dados === null && !erro && <p className="secao-vazia" role="status">Carregando…</p>}
      {dados && abertas.length === 0 && !nova && (
        <section className="secao">
          <p className="secao-vazia">Nenhuma estratégia aberta. Use <strong>Nova estratégia</strong> para registrar uma operação feita na corretora{corretora.length ? ', ou importe abaixo o que o MetaTrader 5 mostra' : ''}.</p>
        </section>
      )}

      {abertas.map((e) => <CartaoDaEstrategia key={e.id} e={e} aoAgir={agir} />)}

      {exposicoes.length > 0 && (
        <section className="secao secao-tabela" aria-labelledby="exp-titulo">
          <div className="secao-topo"><h2 id="exp-titulo">Exposição somada</h2><span className="linha-lista-apoio">Todas as estratégias abertas, por ativo e vencimento, em quantidade de ações.</span></div>
          <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Exposição por ativo e vencimento">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Ativo</th><th scope="col">Vencimento</th>
                  <th scope="col" className="numero">Calls</th><th scope="col" className="numero">Puts</th><th scope="col" className="numero">Ações</th>
                  <th scope="col" className="numero">Calls sem cobertura</th>
                </tr>
              </thead>
              <tbody>
                {exposicoes.map((x) => (
                  <tr key={`${x.ativoObjeto}|${x.vencimento}`}>
                    <th scope="row">{x.ativoObjeto}</th>
                    <td>{x.vencimento ? formatarData(x.vencimento) : 'Ações'}</td>
                    <td className="numero">{x.quantidadeLiquidaCalls.toLocaleString('pt-BR').replace('-', '−')}</td>
                    <td className="numero">{x.quantidadeLiquidaPuts.toLocaleString('pt-BR').replace('-', '−')}</td>
                    <td className="numero">{x.quantidadeLiquidaAcoes.toLocaleString('pt-BR').replace('-', '−')}</td>
                    <td className={`numero ${x.callsVendidasDescobertas > 0 ? 'resultado-baixa' : ''}`}>{x.vencimento ? x.callsVendidasDescobertas.toLocaleString('pt-BR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {conferencia.length > 0 && (
        <section className="secao" aria-labelledby="mt5-titulo">
          <div className="secao-topo">
            <h2 id="mt5-titulo">Conferência com a corretora</h2>
            <span className="linha-lista-apoio">O que o MetaTrader 5 mostra × o que está registrado aqui. <Link href="/preferencias#metatrader">Ponte MT5</Link></span>
          </div>
          <div className="pontes">
            {conferencia.map((c) => {
              const pode = c.situacao === 'nao_registrada' || c.situacao === 'diferente';
              const marcado = importar.codigos.includes(c.codigo);
              return (
                <div key={c.codigo} className="ponte" style={{ padding: '10px 14px' }}>
                  <div className="ponte-texto">
                    <div className="ponte-nome">
                      <strong>{c.codigo}</strong>
                      {c.situacao === 'confere' && <span className="selo selo-alta"><Icone nome="certo" tamanho={16} />Confere</span>}
                      {c.situacao === 'diferente' && <span className="selo selo-atencao"><Icone nome="aviso" tamanho={16} />Quantidade diferente</span>}
                      {c.situacao === 'nao_registrada' && <span className="selo selo-atencao"><Icone nome="aviso" tamanho={16} />Não registrada aqui</span>}
                      {c.situacao === 'so_no_sistema' && <span className="selo selo-neutro">Só aqui (não aparece no MT5)</span>}
                    </div>
                    <span className="ponte-apoio">Corretora: {c.corretora === 0 ? 'nada' : descreverPosicao(c.corretora).toLowerCase()} · Registrado aqui: {c.registrado === 0 ? 'nada' : descreverPosicao(c.registrado).toLowerCase()}</span>
                  </div>
                  {pode && c.situacao === 'nao_registrada' && (
                    <label className="caixa-de-marcar" style={{ paddingTop: 0 }}>
                      <input type="checkbox" checked={marcado} onChange={(ev) => setImportar({ ...importar, codigos: ev.target.checked ? [...importar.codigos, c.codigo] : importar.codigos.filter((x) => x !== c.codigo) })} />
                      <span>Importar</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {importar.codigos.length > 0 && (
            <div className="form-em-linha">
              <div className="campo" style={{ flex: '1 1 220px' }}>
                <label htmlFor="imp-destino">Importar {importar.codigos.join(', ')} para</label>
                <select id="imp-destino" value={importar.destino} onChange={(ev) => setImportar({ ...importar, destino: ev.target.value })}>
                  <option value="nova">Uma estratégia nova</option>
                  {abertas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              {importar.destino === 'nova' && (
                <div className="campo" style={{ flex: '2 1 240px' }}>
                  <label htmlFor="imp-nome">Nome da estratégia</label>
                  <input id="imp-nome" value={importar.nome} maxLength={80} placeholder="Ex.: Venda coberta PETR4" onChange={(ev) => setImportar({ ...importar, nome: ev.target.value })} />
                </div>
              )}
              <button type="button" className="botao botao-principal" disabled={importar.destino === 'nova' && !importar.nome.trim()}
                onClick={() => void agir(
                  () => chamar('POST', '/api/posicoes/importar', { codigos: importar.codigos, ...(importar.destino === 'nova' ? { nova: { nome: importar.nome.trim() } } : { estrategiaId: importar.destino }) }),
                  'Posições importadas do MetaTrader 5 com o preço médio da corretora. Ajuste data e custos se quiser.',
                ).then((ok) => { if (ok) setImportar({ codigos: [], destino: 'nova', nome: '' }); })}>
                Importar
              </button>
            </div>
          )}
        </section>
      )}

      {encerradas.length > 0 && (
        <section className="secao" aria-labelledby="enc-titulo">
          <h2 id="enc-titulo">Encerradas</h2>
          <div className="pontes">
            {encerradas.map((e) => (
              <div key={e.id} className="ponte" style={{ padding: '10px 14px' }}>
                <div className="ponte-texto">
                  <strong>{e.nome}</strong>
                  <span className="ponte-apoio">{e.ativoObjeto} · {e.execucoes.length} operações · encerrada em {e.encerradaEm ? formatarData(e.encerradaEm) : '—'}</span>
                </div>
                <div className="ponte-acoes" style={{ alignItems: 'center' }}>
                  <span className={classeDoValor(e.resultado?.realizadoLiquido ?? null)} style={{ fontSize: 18 }}>{formatarReais(e.resultado?.realizadoLiquido ?? null)}</span>
                  <button type="button" className="botao botao-pequeno" onClick={() => void agir(() => chamar('PATCH', `/api/posicoes/${e.id}`, { situacao: 'aberta' }), `"${e.nome}" reaberta.`)}>Reabrir</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {dados && (
        <section className="secao" aria-labelledby="premissas-titulo">
          <h2 id="premissas-titulo" style={{ fontSize: 16 }}>Como os números são calculados</h2>
          <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--apoio)', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dados.premissas.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
