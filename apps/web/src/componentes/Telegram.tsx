'use client';

// Preferências › Telegram: ligar o chat à conta (código de uso único), silêncio e desligar.

import { useState } from 'react';
import { chamar, ErroDaApi } from '../lib/api.ts';
import { quandoCurto } from '../lib/mercado.ts';
import { MensagemDeErro } from './Acesso.tsx';
import { useConsultaPeriodica } from './Consulta.tsx';
import { Icone } from './Icone.tsx';

type Situacao = { botConfigurado: boolean; bot: string | null; vinculado: boolean; nomeNoTelegram: string | null; vinculadoEm: string | null; silencioAte: string | null };

export function Telegram() {
  const { dados, erro: erroCarga, recarregar } = useConsultaPeriodica<Situacao>('/api/telegram', 5_000);
  const [codigo, setCodigo] = useState<{ codigo: string; link: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  async function executar(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      await recarregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível concluir agora.');
    }
  }

  const d = dados;
  return (
    <section className="secao" id="telegram" aria-labelledby="telegram-titulo" style={{ gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 id="telegram-titulo">Telegram</h2>
        <p className="secao-vazia" style={{ margin: 0, maxWidth: '70ch' }}>
          Os alertas chegam como mensagem no seu Telegram. Pelo próprio chat você pode pausar (/silencio 1h), voltar (/ativar) ou desligar (/sair).
        </p>
      </div>
      <MensagemDeErro texto={erroCarga ?? erro} />
      {!d && !erroCarga && <p className="secao-vazia" role="status">Carregando…</p>}

      {d && !d.botConfigurado && (
        <p className="secao-vazia">O bot do Telegram ainda não foi configurado no servidor. Quando for, aparece aqui o botão para ligar.</p>
      )}

      {d && d.botConfigurado && !d.vinculado && (
        <>
          {!codigo ? (
            <div><button type="button" className="botao botao-principal" onClick={() => void executar(async () => setCodigo(await chamar<{ codigo: string; link: string }>('POST', '/api/telegram/codigo')))}>Ligar o Telegram</button></div>
          ) : (
            <div className="chave-nova" role="status">
              <span style={{ fontWeight: 600 }}>Abra o link no celular ou no computador com o Telegram e toque em "Iniciar". Vale por 15 minutos.</span>
              <div className="chave-nova-linha">
                <a className="botao botao-principal" href={codigo.link} target="_blank" rel="noopener noreferrer">Abrir no Telegram</a>
                <span>ou envie ao bot <strong>@{d.bot}</strong>: <code>/start {codigo.codigo}</code></span>
              </div>
              <span style={{ fontSize: 14 }}>Esta página atualiza sozinha quando o Telegram for ligado.</span>
            </div>
          )}
        </>
      )}

      {d?.vinculado && (
        <div className="pontes">
          <div className="ponte">
            <div className="ponte-texto">
              <div className="ponte-nome">
                <strong>{d.nomeNoTelegram ? `@${d.nomeNoTelegram}` : 'Telegram'}</strong>
                {d.silencioAte
                  ? <span className="selo selo-neutro"><Icone nome="pausa" tamanho={16} />Em silêncio até {quandoCurto(d.silencioAte)}</span>
                  : <span className="selo selo-alta"><Icone nome="certo" tamanho={16} />Recebendo alertas</span>}
              </div>
              <span className="ponte-apoio">Ligado em {d.vinculadoEm ? quandoCurto(d.vinculadoEm) : '—'}.</span>
            </div>
            <div className="ponte-acoes">
              {d.silencioAte ? (
                <button type="button" className="botao botao-pequeno" onClick={() => void executar(() => chamar('POST', '/api/telegram/silencio', { minutos: null }))}>Voltar a avisar</button>
              ) : (
                <>
                  <button type="button" className="botao botao-pequeno" onClick={() => void executar(() => chamar('POST', '/api/telegram/silencio', { minutos: 60 }))}>Silenciar 1 hora</button>
                  <button type="button" className="botao botao-pequeno" onClick={() => void executar(() => chamar('POST', '/api/telegram/silencio', { minutos: 24 * 60 }))}>Silenciar 1 dia</button>
                </>
              )}
              {confirmar ? (
                <>
                  <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void executar(async () => { await chamar('DELETE', '/api/telegram'); setConfirmar(false); setCodigo(null); })}>Confirmar: desligar</button>
                  <button type="button" className="botao botao-pequeno" onClick={() => setConfirmar(false)}>Manter</button>
                </>
              ) : (
                <button type="button" className="botao-texto botao-perigo" onClick={() => setConfirmar(true)}>Desligar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
