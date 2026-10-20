'use client';

// Preferências › Avisos das posições: o que o sistema avisa sozinho sobre as suas posições
// (vencimento, risco, cobertura) e o consentimento para sugestões de rolagem.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { chamar, ErroDaApi } from '../lib/api.ts';
import { descreverCriterios, type PreferenciasDeAvisos } from '../lib/inteligencia.ts';
import { MensagemDeErro } from './Acesso.tsx';

type Resposta = { preferencias: PreferenciasDeAvisos; criterios: Record<string, unknown>; telegramVinculado: boolean };

export function AvisosDasPosicoes() {
  const [d, setD] = useState<Resposta | null>(null);
  const [dias, setDias] = useState('');
  const [distancia, setDistancia] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    chamar<Resposta>('GET', '/api/avisos-posicao/preferencias').then((r) => {
      setD(r);
      setDias(r.preferencias.diasAntes.join(', '));
      setDistancia(String(r.preferencias.distanciaStrikePct).replace('.', ','));
    }).catch((e: Error) => setErro(e.message));
  }, []);

  async function salvar(x: Partial<PreferenciasDeAvisos>, texto: string) {
    setErro(null);
    setAviso(null);
    try {
      const r = await chamar<{ preferencias: PreferenciasDeAvisos; criterios: Record<string, unknown> }>('PUT', '/api/avisos-posicao/preferencias', { preferencias: x });
      setD((atual) => (atual ? { ...atual, ...r } : atual));
      setDias(r.preferencias.diasAntes.join(', '));
      setDistancia(String(r.preferencias.distanciaStrikePct).replace('.', ','));
      setAviso(texto);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível salvar agora.');
    }
  }

  function salvarNumeros() {
    const lista = dias.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!lista.length || lista.some((n) => !Number.isInteger(n) || n < 0 || n > 30)) return setErro('Dias antes do vencimento: números inteiros de 0 a 30, separados por vírgula (ex.: 5, 1).');
    const dist = Number(distancia.replace(',', '.'));
    if (!Number.isFinite(dist) || dist < 0 || dist > 20) return setErro('Distância do strike: um percentual de 0 a 20.');
    void salvar({ diasAntes: lista.slice(0, 4), distanciaStrikePct: dist }, 'Limites salvos.');
  }

  const p = d?.preferencias;
  const marcar = (campo: keyof PreferenciasDeAvisos, rotulo: string, texto: string) => p && (
    <label className="caixa-de-marcar">
      <input type="checkbox" checked={p[campo] as boolean} onChange={(e) => void salvar({ [campo]: e.target.checked } as Partial<PreferenciasDeAvisos>, `${rotulo}: ${e.target.checked ? 'ligado' : 'desligado'}.`)} />
      <span><strong>{rotulo}.</strong> {texto}</span>
    </label>
  );

  return (
    <section className="secao" id="avisos-posicao" aria-labelledby="avisos-posicao-titulo" style={{ gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 id="avisos-posicao-titulo">Avisos das posições</h2>
        <p className="secao-vazia" style={{ margin: 0, maxWidth: '70ch' }}>
          O sistema confere suas estratégias abertas entre 8h e 21h, com o fechamento oficial da B3, e avisa uma vez só por situação. Os avisos aparecem em Posições e, se você quiser, no Telegram.
        </p>
      </div>
      <MensagemDeErro texto={erro} />
      <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>
      {!p && !erro && <p className="secao-vazia" role="status">Carregando…</p>}
      {p && (
        <>
          {marcar('vencimento', 'Vencimento chegando', 'Avisa quando uma opção sua estiver perto de vencer, dizendo se está dentro ou fora do dinheiro.')}
          <div className="form-em-linha" style={{ paddingLeft: 28 }}>
            <div className="campo" style={{ flex: '0 1 220px' }}>
              <label htmlFor="av-dias">Pregões antes do vencimento</label>
              <input id="av-dias" value={dias} onChange={(e) => setDias(e.target.value)} placeholder="5, 1" />
            </div>
            <div className="campo" style={{ flex: '0 1 220px' }}>
              <label htmlFor="av-dist">Distância do strike (%)</label>
              <input id="av-dist" inputMode="decimal" value={distancia} onChange={(e) => setDistancia(e.target.value)} />
            </div>
            <button type="button" className="botao botao-pequeno" onClick={salvarNumeros}>Salvar limites</button>
          </div>
          {marcar('risco', 'Opção vendida perto do strike', 'Avisa quando o ativo fechar perto do strike de uma opção que você vendeu, ou já dentro do dinheiro.')}
          {marcar('descoberta', 'Calls sem cobertura', 'Avisa quando uma estratégia tiver calls vendidas sem ações ou calls compradas que as cubram.')}
          {marcar('telegram', 'Mandar também pelo Telegram', d.telegramVinculado ? 'Seu Telegram está ligado.' : 'Seu Telegram ainda não está ligado: os avisos ficam só na tela até você ligar.')}
          <fieldset className="grupo-de-campos">
            <legend>Sugestões de rolagem</legend>
            <label className="caixa-de-marcar" style={{ paddingTop: 0 }}>
              <input type="checkbox" checked={p.sugestoes} onChange={(e) => void salvar({ sugestoes: e.target.checked }, e.target.checked ? 'Sugestões autorizadas. Você pode desligar quando quiser.' : 'Sugestões desligadas.')} />
              <span>
                <strong>Autorizo o sistema a me mandar sugestões de rolagem.</strong> Quando uma opção vendida chegar ao limite de pregões acima, o sistema lista as séries que atendem aos seus critérios, com os preços do fechamento da B3. É só informação: nada é enviado à corretora e nenhuma série é recomendada.
              </span>
            </label>
            <p className="linha-lista-apoio" style={{ margin: 0 }}>
              Critérios: {descreverCriterios(d.criterios)}. Para mudar, ajuste em <Link href="/rolagens">Rolagens</Link> e use "Usar estes critérios nos avisos".
            </p>
          </fieldset>
        </>
      )}
    </section>
  );
}
