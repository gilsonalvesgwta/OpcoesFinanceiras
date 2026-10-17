'use client';

// Calendário da B3: dias sem pregão e dias com horário diferente. Só o
// superadministrador altera. Conforme a prévia aprovada em 17/10/2026.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { useSessao } from '../../../componentes/Sessao.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { emBrasilia } from '../../../lib/regua.ts';
import { dataBr, faltaCalendarioDe, feriadosDoAno, type Calendario } from '../../../lib/mercado.ts';

export default function PaginaCalendario() {
  const { sessao } = useSessao();
  const superadmin = sessao.usuario.papel === 'superadmin';
  const [cal, setCal] = useState<Calendario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [hoje] = useState(() => emBrasilia(new Date()).dia);
  const [ano, setAno] = useState(() => hoje.slice(0, 4));
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCal(await chamar<Calendario>('GET', '/api/calendario'));
  }, []);
  useEffect(() => {
    carregar().catch((e: Error) => setErro(e.message));
  }, [carregar]);

  if (!superadmin) {
    return (
      <>
        <Cabecalho titulo="Calendário da B3" />
        <p className="secao-vazia">Esta área é só para o superadministrador.</p>
      </>
    );
  }

  async function executar(acao: () => Promise<unknown>, sucesso: string, form?: HTMLFormElement) {
    setErro(null);
    setAviso(null);
    try {
      await acao();
      form?.reset();
      setConfirmar(null);
      setAviso(sucesso);
      await carregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar agora.');
    }
  }

  function adicionarFeriado(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const dia = String(d.get('dia') ?? '');
    const descricao = String(d.get('descricao') ?? '').trim();
    if (!dia || !descricao) return setErro('Preencha a data e o motivo.');
    void executar(() => chamar('POST', '/api/calendario/feriados', { dia, descricao }), `${dataBr(dia)} agora é dia sem pregão.`, form);
  }

  function adicionarSessao(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const corpo = { dia: String(d.get('dia') ?? ''), abertura: String(d.get('abertura') ?? ''), fechamento: String(d.get('fechamento') ?? ''), descricao: String(d.get('descricao') ?? '').trim() };
    if (!corpo.dia || !corpo.abertura || !corpo.fechamento || !corpo.descricao) return setErro('Preencha a data, os horários e o motivo.');
    void executar(() => chamar('POST', '/api/calendario/sessoes-especiais', corpo), `Horário de ${dataBr(corpo.dia)} salvo.`, form);
  }

  const anos = cal ? [...new Set([hoje.slice(0, 4), String(Number(hoje.slice(0, 4)) + 1), ...cal.feriados.map((f) => f.dia.slice(0, 4))])].sort() : [];
  const feriados = cal ? feriadosDoAno(cal.feriados, ano, hoje) : [];
  const sessoes = cal ? feriadosDoAno(cal.sessoesEspeciais, ano, hoje) : [];
  const falta = cal ? faltaCalendarioDe(cal.feriados, hoje) : null;
  const padrao = cal?.sessaoPadrao ?? { abertura: '10:00', fechamento: '17:00' };

  return (
    <>
      <Cabecalho
        titulo="Calendário da B3"
        apoio={`Dias sem pregão e dias com horário diferente. Vale para o painel, os vencimentos e a coleta. Pregão normal: segunda a sexta, das ${padrao.abertura} às ${padrao.fechamento}.`}
      />

      {falta && (
        <div className="alerta" role="note">
          <Icone nome="aviso" />
          <span>Falta o calendário de {falta}. A B3 costuma publicar em dezembro; até lá, o sistema considera só sábados e domingos como dias sem pregão em {falta}.</span>
        </div>
      )}

      <MensagemDeErro texto={erro} />
      <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>
      {!cal && !erro && <p className="secao-vazia" role="status">Carregando…</p>}

      {cal && (
        <div className="grade-2">
          <section className="secao" aria-labelledby="feriados-titulo">
            <div className="secao-topo">
              <h2 id="feriados-titulo">Dias sem pregão</h2>
              <label className="rotulo-em-linha">
                Ano
                <select value={ano} onChange={(e) => setAno(e.target.value)}>
                  {anos.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            </div>
            <form onSubmit={adicionarFeriado} noValidate className="form-em-linha">
              <div className="campo" style={{ flex: '0 1 180px' }}>
                <label htmlFor="feriado-dia">Data</label>
                <input id="feriado-dia" name="dia" type="date" required />
              </div>
              <div className="campo" style={{ flex: '1 1 200px' }}>
                <label htmlFor="feriado-motivo">Motivo</label>
                <input id="feriado-motivo" name="descricao" type="text" maxLength={120} placeholder="Ex.: Carnaval" required />
              </div>
              <button type="submit" className="botao botao-principal">Adicionar</button>
            </form>
            {feriados.length === 0 && <p className="secao-vazia">Nenhum dia sem pregão cadastrado em {ano}.</p>}
            <div>
              {feriados.map((f) => (
                <div key={f.dia} className="linha-lista" style={{ opacity: f.passou ? 0.6 : 1, padding: '6px 0' }}>
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{dataBr(f.dia, true)}</span>
                    <span className="linha-lista-apoio">{f.descricao}{f.passou ? ' (já passou)' : ''}</span>
                  </span>
                  {confirmar === `f:${f.dia}` ? (
                    <span className="ponte-acoes">
                      <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void executar(() => chamar('DELETE', `/api/calendario/feriados/${f.dia}`), `${dataBr(f.dia)} voltou a ser dia de pregão.`)}>Confirmar</button>
                      <button type="button" className="botao botao-pequeno" onClick={() => setConfirmar(null)}>Manter</button>
                    </span>
                  ) : (
                    <button type="button" className="botao-texto botao-perigo" onClick={() => setConfirmar(`f:${f.dia}`)} aria-label={`Remover ${dataBr(f.dia)}`}>Remover</button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="secao" aria-labelledby="especiais-titulo">
            <h2 id="especiais-titulo">Dias com horário diferente</h2>
            <form onSubmit={adicionarSessao} noValidate className="form-em-linha">
              <div className="campo" style={{ flex: '0 1 170px' }}>
                <label htmlFor="sessao-dia">Data</label>
                <input id="sessao-dia" name="dia" type="date" required />
              </div>
              <div className="campo" style={{ flex: '0 1 110px' }}>
                <label htmlFor="sessao-abre">Abre</label>
                <input id="sessao-abre" name="abertura" type="time" defaultValue="13:00" required />
              </div>
              <div className="campo" style={{ flex: '0 1 110px' }}>
                <label htmlFor="sessao-fecha">Fecha</label>
                <input id="sessao-fecha" name="fechamento" type="time" defaultValue="17:00" required />
              </div>
              <div className="campo" style={{ flex: '1 1 160px' }}>
                <label htmlFor="sessao-motivo">Motivo</label>
                <input id="sessao-motivo" name="descricao" type="text" maxLength={120} placeholder="Ex.: Quarta-feira de Cinzas" required />
              </div>
              <button type="submit" className="botao botao-contorno">Adicionar</button>
            </form>
            {sessoes.length === 0 && <p className="secao-vazia">Nenhum dia com horário diferente em {ano}.</p>}
            <div>
              {sessoes.map((s) => (
                <div key={s.dia} className="linha-lista" style={{ opacity: s.passou ? 0.6 : 1, padding: '6px 0' }}>
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{dataBr(s.dia, true)} · {s.abertura} às {s.fechamento}</span>
                    <span className="linha-lista-apoio">{s.descricao}{s.passou ? ' (já passou)' : ''}</span>
                  </span>
                  {confirmar === `s:${s.dia}` ? (
                    <span className="ponte-acoes">
                      <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void executar(() => chamar('DELETE', `/api/calendario/sessoes-especiais/${s.dia}`), `${dataBr(s.dia)} voltou ao horário normal.`)}>Confirmar</button>
                      <button type="button" className="botao botao-pequeno" onClick={() => setConfirmar(null)}>Manter</button>
                    </span>
                  ) : (
                    <button type="button" className="botao-texto botao-perigo" onClick={() => setConfirmar(`s:${s.dia}`)} aria-label={`Remover o horário de ${dataBr(s.dia)}`}>Remover</button>
                  )}
                </div>
              ))}
            </div>
            <p className="secao-vazia" style={{ fontSize: 14 }}>Só o superadministrador altera o calendário. Toda mudança fica registrada na auditoria.</p>
          </section>
        </div>
      )}
    </>
  );
}
