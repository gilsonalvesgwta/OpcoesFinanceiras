'use client';

// Preferências › MetaTrader 5: chaves da ponte (criar, ver situação, revogar) e
// o passo a passo para ligar o robô. A chave nova aparece uma vez só.

import { useRef, useState, type FormEvent } from 'react';
import { chamar, ErroDaApi } from '../lib/api.ts';
import { contaDaPonte, estadoDaPonte, haQuanto, MAXIMO_DE_PONTES, type Ponte } from '../lib/ponte.ts';
import { formatarData } from '../lib/formatos.ts';
import { MensagemDeErro } from './Acesso.tsx';
import { useConsultaPeriodica } from './Consulta.tsx';
import { Icone } from './Icone.tsx';

const ENDERECO = 'https://opcoes.wtatech.com.br';

const PASSOS = [
  {
    titulo: 'Abra o MetaTrader 5 da VPS',
    texto: 'Pelo navegador, na tela do MetaTrader (endereço e senha estão na stack). Entre na sua conta da Genial; se ela fornecer senha de investidor, use essa: só permite consultar.',
  },
  { titulo: 'Copie o robô para a pasta Experts', texto: 'Arquivo › Abrir pasta de dados › MQL5 › Experts. Depois, no Navegador, clique com o botão direito em Expert Advisors › Atualizar.' },
  { titulo: 'Libere o endereço do sistema', texto: `Ferramentas › Opções › Expert Advisors › Permitir WebRequest para as URLs listadas: ${ENDERECO}` },
  { titulo: 'Ligue o robô com a chave', texto: 'Arraste WTA_Ponte para qualquer gráfico, cole a chave em Entradas e deixe o Algo Trading ligado (o robô continua sem enviar ordens).' },
  { titulo: 'Confira aqui', texto: 'Em poucos segundos a ponte passa para Conectada e o painel mostra os preços com a marca Tempo real.' },
];

export function PonteMt5() {
  const { dados, erro: erroLista, recarregar } = useConsultaPeriodica<{ pontes: Ponte[] }>('/api/ponte', 5_000);
  const [nova, setNova] = useState<{ nome: string; chave: string } | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [criando, setCriando] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const campoDaChave = useRef<HTMLInputElement>(null);

  const pontes = dados?.pontes ?? null;
  const ativas = pontes?.filter((p) => !p.revogadaEm) ?? [];
  const agora = new Date();

  async function criar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nome = String(new FormData(e.currentTarget).get('nome-ponte') ?? '').trim() || 'MetaTrader 5';
    setErro(null);
    setAviso(null);
    setCriando(true);
    try {
      const r = await chamar<{ id: string; nome: string; chave: string }>('POST', '/api/ponte', { nome });
      setNova({ nome: r.nome, chave: r.chave });
      setCopiada(false);
      await recarregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível criar agora.');
    } finally {
      setCriando(false);
    }
  }

  async function revogar(p: Ponte) {
    setErro(null);
    setAviso(null);
    try {
      await chamar('DELETE', `/api/ponte/${p.id}`);
      setConfirmar(null);
      setAviso(`Chave de "${p.nome}" revogada. O robô que usava essa chave parou de ser aceito.`);
      await recarregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível revogar agora.');
    }
  }

  async function copiar() {
    if (!nova) return;
    try {
      await navigator.clipboard.writeText(nova.chave);
      setCopiada(true);
    } catch {
      // Sem acesso à área de transferência: deixa a chave selecionada para copiar à mão.
      campoDaChave.current?.select();
    }
  }

  return (
    <>
      <section className="secao" id="metatrader" aria-labelledby="mt5-titulo" style={{ gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="mt5-titulo">MetaTrader 5 da corretora</h2>
          <p className="secao-vazia" style={{ margin: 0, maxWidth: '70ch' }}>
            Um robô dentro do seu MetaTrader 5 envia as cotações dos seus ativos e as posições da sua conta. Ele só lê: não envia, altera nem cancela ordens. Esses dados são da sua conta na corretora e só você vê.
          </p>
        </div>

        {pontes === null && !erroLista && <p className="secao-vazia" role="status">Carregando…</p>}
        <MensagemDeErro texto={erroLista} />

        {pontes && pontes.length > 0 && (
          <div className="pontes">
            {pontes.map((p) => {
              const e = estadoDaPonte(p);
              const detalhe = p.revogadaEm
                ? `Revogada em ${formatarData(p.revogadaEm)}.`
                : p.ultimoContatoEm
                  ? `Último sinal ${haQuanto(p.ultimoContatoEm, agora)}.${p.versao ? ` Robô versão ${p.versao}.` : ''} Criada em ${formatarData(p.criadaEm ?? '')}.`
                  : 'Cole a chave no robô para ligar.';
              return (
                <div key={p.id} className="ponte">
                  <div className="ponte-texto">
                    <div className="ponte-nome">
                      <strong>{p.nome}</strong>
                      <span className={`selo ${e.classe}`}><Icone nome="ponto" tamanho={14} preenchido={e.classe === 'selo-vivo'} />{e.texto}</span>
                    </div>
                    <span className="ponte-apoio">{detalhe}</span>
                    {!p.revogadaEm && <span className="ponte-apoio" style={{ fontSize: 13 }}>{contaDaPonte(p)}</span>}
                  </div>
                  {!p.revogadaEm && (
                    <div className="ponte-acoes">
                      {confirmar === p.id ? (
                        <>
                          <button type="button" className="botao botao-perigo" onClick={() => void revogar(p)}>Confirmar: revogar</button>
                          <button type="button" className="botao" onClick={() => setConfirmar(null)}>Manter</button>
                        </>
                      ) : (
                        <button type="button" className="botao botao-perigo" onClick={() => setConfirmar(p.id)}>Revogar chave</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {nova && (
          <div className="chave-nova" role="status">
            <span style={{ fontWeight: 600 }}>Chave criada para &quot;{nova.nome}&quot;. Copie agora: ela não aparece de novo.</span>
            <div className="chave-nova-linha">
              <label htmlFor="chave-nova" className="so-leitor">Chave da ponte</label>
              <input id="chave-nova" ref={campoDaChave} readOnly value={nova.chave} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="botao botao-principal" onClick={() => void copiar()}>{copiada ? 'Copiada' : 'Copiar chave'}</button>
            </div>
            <span style={{ fontSize: 14 }}>
              Perdeu a chave? Revogue e crie outra. Quem tiver a chave consegue enviar preços em seu nome, mas não consegue ler nada nem entrar no sistema.
            </span>
            <div><button type="button" className="botao" onClick={() => setNova(null)}>Já copiei</button></div>
          </div>
        )}

        <form onSubmit={criar} noValidate style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <div className="campo" style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <label htmlFor="nome-ponte">Nome para reconhecer esta ponte</label>
            <input id="nome-ponte" name="nome-ponte" type="text" maxLength={60} defaultValue="MetaTrader 5" />
          </div>
          <button type="submit" className="botao botao-contorno" disabled={criando || ativas.length >= MAXIMO_DE_PONTES}>
            {criando ? 'Criando…' : 'Criar chave da ponte'}
          </button>
          <span className="secao-vazia" style={{ fontSize: 14, paddingBottom: 10 }}>{ativas.length} de {MAXIMO_DE_PONTES} chaves em uso</span>
        </form>
        <MensagemDeErro texto={erro} />
        <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>
      </section>

      <section className="secao" aria-labelledby="instalar-titulo">
        <div className="secao-topo">
          <h2 id="instalar-titulo">Como ligar o robô no MetaTrader 5</h2>
          <a href="/ponte/WTA_Ponte.mq5" download style={{ fontWeight: 600, padding: '10px 0' }}>Baixar o robô (WTA_Ponte.mq5)</a>
        </div>
        <ol className="passos">
          {PASSOS.map((p) => (
            <li key={p.titulo}>
              <span className="titulo">{p.titulo}</span>
              <span className="texto">{p.texto}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
