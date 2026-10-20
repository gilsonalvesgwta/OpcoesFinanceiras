'use client';

// Alertas: regras, editor e histórico de disparos. Os avisos saem pelo Telegram.

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { descreverCondicao, descreverRearme } from '@wta/domain';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi, type Favorito } from '../../../lib/api.ts';
import { formatarReais } from '../../../lib/formatos.ts';
import {
  CAMPOS, FORMULARIO_VAZIO, formularioDaRegra, OPERADORES, regraDoFormulario, SITUACAO_DO_AVISO, TEXTO_DA_QUALIDADE,
  type FormularioDaRegra, type LinhaDaCondicao, type RegraParaApi,
} from '../../../lib/alertas.ts';
import { quandoCurto } from '../../../lib/mercado.ts';

type Regra = RegraParaApi & { id: string; descricao: string; descricaoRearme: string; ativa: boolean; versao: number; disparos: number; ultimoDisparo: string | null };
type Evento = {
  id: number; regra: string | null; codigo: string; descricao: string; instante: string; qualidade: string; fonte: string;
  valores: { ultimo?: number | null }; aviso: { situacao: string; erro: string | null } | null;
};
type Telegram = { botConfigurado: boolean; vinculado: boolean; silencioAte: string | null };

function previa(f: FormularioDaRegra): string {
  const r = regraDoFormulario(f);
  if (!r.ok) return 'Preencha os campos para ver como a regra vai funcionar.';
  return `Vai avisar quando ${r.regra.codigo}: ${descreverCondicao(r.regra.condicao)}. ${descreverRearme(r.regra.rearme)[0]?.toUpperCase()}${descreverRearme(r.regra.rearme).slice(1)}.`;
}

export default function PaginaAlertas() {
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [telegram, setTelegram] = useState<Telegram | null>(null);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [editando, setEditando] = useState<{ id: string | null; f: FormularioDaRegra } | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [a, t] = await Promise.all([
      chamar<{ regras: Regra[]; eventos: Evento[] }>('GET', '/api/alertas'),
      chamar<Telegram>('GET', '/api/telegram'),
    ]);
    setRegras(a.regras);
    setEventos(a.eventos);
    setTelegram(t);
  }, []);

  useEffect(() => {
    carregar().catch((e: Error) => setErro(e.message));
    chamar<{ favoritos: Favorito[] }>('GET', '/api/favoritos').then((r) => setFavoritos(r.favoritos.map((x) => x.codigo))).catch(() => undefined);
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar().catch(() => undefined); }, 15_000);
    return () => clearInterval(t);
  }, [carregar]);

  const f = editando?.f;
  const mudar = (x: Partial<FormularioDaRegra>) => setEditando((e) => (e ? { ...e, f: { ...e.f, ...x } } : e));
  const mudarLinha = (i: number, x: Partial<LinhaDaCondicao>) => mudar({ linhas: (f?.linhas ?? []).map((l, j) => (j === i ? { ...l, ...x } : l)) });

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editando) return;
    const r = regraDoFormulario(editando.f);
    if (!r.ok) return setErroForm(r.erro);
    setErroForm(null);
    setSalvando(true);
    try {
      if (editando.id) await chamar('PATCH', `/api/alertas/${editando.id}`, r.regra);
      else await chamar('POST', '/api/alertas', r.regra);
      setAviso(editando.id ? 'Regra alterada. Ela recomeça a observar a partir de agora.' : 'Regra criada.');
      setEditando(null);
      await carregar();
    } catch (x) {
      setErroForm(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar agora.');
    } finally {
      setSalvando(false);
    }
  }

  async function acao(fn: () => Promise<unknown>, texto: string) {
    setErro(null);
    setAviso(null);
    try {
      await fn();
      setConfirmar(null);
      setAviso(texto);
      await carregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível concluir agora.');
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Alertas"
        apoio="Avisos no Telegram quando o preço chegar onde você quer. Sem ordem automática: o aviso é só para você decidir."
        acoes={!editando ? <button type="button" className="botao botao-principal" onClick={() => { setErroForm(null); setEditando({ id: null, f: { ...FORMULARIO_VAZIO, codigo: favoritos[0] ?? '' } }); }}>Nova regra</button> : undefined}
      />

      {telegram && !telegram.vinculado && (
        <div className="alerta" role="note">
          <Icone nome="aviso" />
          <span>
            {telegram.botConfigurado
              ? <>O Telegram ainda não está ligado à sua conta: as regras funcionam e ficam no histórico, mas nenhum aviso chega. <Link href="/preferencias#telegram">Ligar o Telegram</Link>.</>
              : <>O bot do Telegram ainda não foi configurado no servidor. As regras já funcionam e ficam no histórico; os avisos passam a chegar quando o bot for ligado.</>}
          </span>
        </div>
      )}
      {telegram?.silencioAte && (
        <div className="alerta" role="note"><Icone nome="pausa" /><span>Avisos em silêncio até {quandoCurto(telegram.silencioAte)}. <Link href="/preferencias#telegram">Mudar</Link>.</span></div>
      )}

      <MensagemDeErro texto={erro} />
      <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>

      {editando && f && (
        <section className="secao" aria-labelledby="editor-titulo">
          <h2 id="editor-titulo">{editando.id ? 'Editar regra' : 'Nova regra'}</h2>
          <form onSubmit={salvar} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-em-linha">
              <div className="campo" style={{ flex: '2 1 240px' }}>
                <label htmlFor="regra-nome">Nome</label>
                <input id="regra-nome" value={f.nome} maxLength={80} placeholder="Ex.: PETR4 rompendo 38,50" onChange={(e) => mudar({ nome: e.target.value })} />
              </div>
              <div className="campo" style={{ flex: '1 1 140px' }}>
                <label htmlFor="regra-codigo">Ativo</label>
                <input id="regra-codigo" value={f.codigo} maxLength={12} list="lista-favoritos" placeholder="PETR4" autoCapitalize="characters" onChange={(e) => mudar({ codigo: e.target.value.toUpperCase() })} />
                <datalist id="lista-favoritos">{favoritos.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>

            <fieldset className="grupo-de-campos">
              <legend>Quando avisar</legend>
              {f.linhas.length > 1 && (
                <div className="rotulo-em-linha">
                  <label htmlFor="regra-juncao">Avisar quando</label>
                  <select id="regra-juncao" value={f.juncao} onChange={(e) => mudar({ juncao: e.target.value as 'e' | 'ou' })}>
                    <option value="e">todas as condições valerem</option>
                    <option value="ou">qualquer uma valer</option>
                  </select>
                </div>
              )}
              {f.linhas.map((l, i) => {
                const faixa = l.operador === 'dentro' || l.operador === 'fora';
                const un = CAMPOS.find((c) => c.valor === l.campo)?.unidade;
                return (
                  <div key={i} className="form-em-linha linha-condicao">
                    <div className="campo" style={{ flex: '1 1 190px' }}>
                      <label htmlFor={`c${i}-campo`}>Condição {i + 1}</label>
                      <select id={`c${i}-campo`} value={l.campo} onChange={(e) => mudarLinha(i, { campo: e.target.value as LinhaDaCondicao['campo'] })}>
                        {CAMPOS.map((c) => <option key={c.valor} value={c.valor}>{c.nome}</option>)}
                      </select>
                    </div>
                    <div className="campo" style={{ flex: '1 1 190px' }}>
                      <label htmlFor={`c${i}-op`}>Quando</label>
                      <select id={`c${i}-op`} value={l.operador} onChange={(e) => mudarLinha(i, { operador: e.target.value as LinhaDaCondicao['operador'] })}>
                        {OPERADORES.map((o) => <option key={o.valor} value={o.valor}>{o.nome}</option>)}
                      </select>
                    </div>
                    <div className="campo" style={{ flex: '0 1 130px' }}>
                      <label htmlFor={`c${i}-valor`}>{un === 'reais' ? 'Valor (R$)' : un === 'percentual' ? 'Valor (%)' : 'Valor'}</label>
                      <input id={`c${i}-valor`} inputMode="decimal" value={l.valor} placeholder={un === 'reais' ? '38,50' : un === 'percentual' ? '-3' : '1000000'} onChange={(e) => mudarLinha(i, { valor: e.target.value })} />
                    </div>
                    {faixa && (
                      <div className="campo" style={{ flex: '0 1 130px' }}>
                        <label htmlFor={`c${i}-valor2`}>e</label>
                        <input id={`c${i}-valor2`} inputMode="decimal" value={l.valor2} onChange={(e) => mudarLinha(i, { valor2: e.target.value })} />
                      </div>
                    )}
                    {f.linhas.length > 1 && (
                      <button type="button" className="botao-texto botao-perigo" onClick={() => mudar({ linhas: f.linhas.filter((_, j) => j !== i) })} aria-label={`Remover a condição ${i + 1}`}>Remover</button>
                    )}
                  </div>
                );
              })}
              {f.linhas.length < 5 && (
                <div><button type="button" className="botao botao-pequeno" onClick={() => mudar({ linhas: [...f.linhas, { campo: 'ultimo', operador: '>', valor: '', valor2: '' }] })}>Adicionar condição</button></div>
              )}
            </fieldset>

            <fieldset className="grupo-de-campos">
              <legend>Depois de avisar</legend>
              <div className="form-em-linha">
                <div className="campo" style={{ flex: '2 1 280px' }}>
                  <label htmlFor="regra-rearme">Repetir o aviso</label>
                  <select id="regra-rearme" value={f.rearme} onChange={(e) => mudar({ rearme: e.target.value as FormularioDaRegra['rearme'] })}>
                    <option value="ao_desfazer">De novo só depois que a condição deixar de valer</option>
                    <option value="intervalo">De novo depois de um intervalo, se ainda valer</option>
                    <option value="uma_vez">Uma vez só, e desligar a regra</option>
                  </select>
                </div>
                {f.rearme === 'intervalo' && (
                  <div className="campo" style={{ flex: '0 1 130px' }}>
                    <label htmlFor="regra-minutos">Minutos</label>
                    <input id="regra-minutos" inputMode="numeric" value={f.minutos} onChange={(e) => mudar({ minutos: e.target.value })} />
                  </div>
                )}
                <div className="campo" style={{ flex: '0 1 150px' }}>
                  <label htmlFor="regra-limite">Máximo por dia</label>
                  <input id="regra-limite" inputMode="numeric" value={f.limitePorDia} onChange={(e) => mudar({ limitePorDia: e.target.value })} />
                </div>
              </div>
              <label className="caixa-de-marcar">
                <input type="checkbox" checked={f.usarJanela} onChange={(e) => mudar({ usarJanela: e.target.checked })} />
                <span>Só avisar dentro de um horário</span>
              </label>
              {f.usarJanela && (
                <div className="form-em-linha">
                  <div className="campo" style={{ flex: '0 1 130px' }}>
                    <label htmlFor="regra-inicio">Das</label>
                    <input id="regra-inicio" type="time" value={f.janelaInicio} onChange={(e) => mudar({ janelaInicio: e.target.value })} />
                  </div>
                  <div className="campo" style={{ flex: '0 1 130px' }}>
                    <label htmlFor="regra-fim">Até</label>
                    <input id="regra-fim" type="time" value={f.janelaFim} onChange={(e) => mudar({ janelaFim: e.target.value })} />
                  </div>
                </div>
              )}
              <label className="caixa-de-marcar">
                <input type="checkbox" checked={f.aceitarPeriodica} onChange={(e) => mudar({ aceitarPeriodica: e.target.checked })} />
                <span>Também avisar com preço de atualização periódica (até 30 minutos de atraso). Desmarcado: só com o MetaTrader 5 em tempo real.</span>
              </label>
            </fieldset>

            <p className="previa-da-regra" aria-live="polite">{previa(f)}</p>
            <MensagemDeErro texto={erroForm} />
            <div className="form-em-linha">
              <button type="submit" className="botao botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : editando.id ? 'Salvar alterações' : 'Criar regra'}</button>
              <button type="button" className="botao" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </form>
        </section>
      )}

      <section className="secao" aria-labelledby="regras-titulo">
        <h2 id="regras-titulo">Suas regras</h2>
        {regras === null && !erro && <p className="secao-vazia" role="status">Carregando…</p>}
        {regras?.length === 0 && <p className="secao-vazia">Nenhuma regra ainda. Crie uma para ser avisado quando um preço cruzar o nível que você escolher.</p>}
        {regras && regras.length > 0 && <div className="pontes">
          {regras.map((r) => (
            <div key={r.id} className="ponte">
              <div className="ponte-texto">
                <div className="ponte-nome">
                  <strong>{r.nome}</strong>
                  <span className={`selo ${r.ativa ? 'selo-alta' : 'selo-neutro'}`}><Icone nome={r.ativa ? 'certo' : 'pausa'} tamanho={16} />{r.ativa ? 'Ativa' : 'Pausada'}</span>
                </div>
                <span className="ponte-apoio"><strong style={{ color: 'var(--texto)' }}>{r.codigo}</strong>: {r.descricao}</span>
                <span className="ponte-apoio" style={{ fontSize: 13 }}>
                  {r.descricaoRearme[0]?.toUpperCase()}{r.descricaoRearme.slice(1)}. Até {r.limitePorDia} por dia{r.janela ? `, das ${r.janela.inicio} às ${r.janela.fim}` : ''}.
                  {r.ultimoDisparo ? ` Último aviso: ${quandoCurto(r.ultimoDisparo)}.` : ' Ainda não avisou.'}
                </span>
              </div>
              <div className="ponte-acoes">
                {confirmar === r.id ? (
                  <>
                    <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void acao(() => chamar('DELETE', `/api/alertas/${r.id}`), `Regra "${r.nome}" excluída.`)}>Confirmar exclusão</button>
                    <button type="button" className="botao botao-pequeno" onClick={() => setConfirmar(null)}>Manter</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="botao botao-pequeno" onClick={() => void acao(() => chamar('PATCH', `/api/alertas/${r.id}`, { ativa: !r.ativa }), r.ativa ? `Regra "${r.nome}" pausada.` : `Regra "${r.nome}" ativada.`)}>{r.ativa ? 'Pausar' : 'Ativar'}</button>
                    {formularioDaRegra(r) && (
                      <button type="button" className="botao botao-pequeno" onClick={() => { setErroForm(null); setEditando({ id: r.id, f: formularioDaRegra(r) as FormularioDaRegra }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
                    )}
                    <button type="button" className="botao-texto botao-perigo" onClick={() => setConfirmar(r.id)} aria-label={`Excluir a regra ${r.nome}`}>Excluir</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>}
      </section>

      <section className="secao secao-tabela" aria-labelledby="historico-titulo">
        <div className="secao-topo"><h2 id="historico-titulo">Últimos avisos</h2></div>
        {eventos.length === 0 ? (
          <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhum aviso ainda.</p>
        ) : (
          <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Tabela dos últimos avisos">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Ativo</th>
                  <th scope="col">Condição</th>
                  <th scope="col" className="numero">Último</th>
                  <th scope="col">Dado</th>
                  <th scope="col">Aviso</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => {
                  const s = e.aviso ? SITUACAO_DO_AVISO[e.aviso.situacao] : null;
                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{quandoCurto(e.instante)}</td>
                      <th scope="row">{e.codigo}{e.regra && <span className="sub">{e.regra}</span>}</th>
                      <td className="linha-lista-apoio">{e.descricao}</td>
                      <td className="numero">{formatarReais(e.valores.ultimo ?? null)}</td>
                      <td className="linha-lista-apoio" style={{ whiteSpace: 'nowrap' }}>{TEXTO_DA_QUALIDADE[e.qualidade] ?? e.qualidade}, {e.fonte}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{s ? <span className={`selo ${s.classe}`} title={e.aviso?.erro ?? undefined}>{s.texto}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
