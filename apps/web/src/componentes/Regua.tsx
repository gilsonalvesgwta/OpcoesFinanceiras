'use client';

import { useEffect, useState } from 'react';
import { emBrasilia, estadoDaSessao, marcasDeHora, posicaoNaSessao, type Sessao } from '../lib/regua.ts';
import { Icone } from './Icone.tsx';

const SESSAO: Sessao = { abertura: '10:00', fechamento: '17:00' };

// Até o calendário de feriados entrar (Fase 3), só sábado e domingo ficam sem pregão.
function ehDiaUtil(d: Date): boolean {
  const dia = emBrasilia(d).dia;
  const [a, m, x] = dia.split('-').map(Number) as [number, number, number];
  const semana = new Date(Date.UTC(a, m - 1, x)).getUTCDay();
  return semana !== 0 && semana !== 6;
}

const TEXTO_ESTADO = {
  aberta: { texto: `Mercado aberto, fecha às ${SESSAO.fechamento}`, classe: 'selo-alta' },
  antes: { texto: `Mercado abre às ${SESSAO.abertura}`, classe: 'selo-neutro' },
  depois: { texto: 'Pregão encerrado', classe: 'selo-neutro' },
  sem_pregao: { texto: 'Sem pregão hoje', classe: 'selo-neutro' },
} as const;

// aoVivo: a ponte com o MetaTrader 5 está mandando sinal; o trecho passado fica na cor do tempo real.
export function ReguaDoPregao({ chegadas = [], aoVivo = false }: { chegadas?: Date[]; aoVivo?: boolean }) {
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!agora) return <div className="regua" aria-hidden="true" />;
  const estado = estadoDaSessao(agora, SESSAO, ehDiaUtil(agora));
  const pos = posicaoNaSessao(agora, SESSAO);
  const hora = emBrasilia(agora).hora;
  const rotulo = TEXTO_ESTADO[estado];
  const descricao = `Linha do pregão das ${SESSAO.abertura} às ${SESSAO.fechamento}. Agora são ${hora}. ${
    aoVivo ? 'A ponte com o MetaTrader 5 está mandando cotações em tempo real.' : chegadas.length === 0 ? 'Nenhuma cotação recebida hoje.' : `${chegadas.length} consultas de cotação hoje.`
  }`;

  return (
    <>
      <div className="secao-topo">
        <h2 id="regua-titulo">Pregão de hoje</h2>
        <span className={`selo ${rotulo.classe}`}>
          <Icone nome="ponto" tamanho={16} preenchido={estado === 'aberta'} />
          {rotulo.texto}
        </span>
      </div>
      <div className="regua" role="img" aria-label={descricao}>
        <div className="regua-trilho" />
        {marcasDeHora(SESSAO).slice(1, -1).map((m) => (
          <div key={m.rotulo} className="regua-hora" style={{ left: `${m.pos}%` }} />
        ))}
        {estado !== 'sem_pregao' && <div className={`regua-passado${aoVivo ? ' ao-vivo' : ''}`} style={{ width: `${pos}%` }} />}
        {chegadas.map((c) => (
          <div key={c.toISOString()} className="regua-chegada" style={{ left: `${posicaoNaSessao(c, SESSAO)}%` }} />
        ))}
        {estado === 'aberta' && (
          <>
            <div className="regua-agora" style={{ left: `${pos}%` }} />
            <span className="regua-agora-rotulo" style={{ left: `${Math.min(Math.max(pos, 6), 94)}%` }}>agora {hora}</span>
          </>
        )}
        <span className="regua-ponta" style={{ left: 0 }}>{SESSAO.abertura}</span>
        <span className="regua-ponta" style={{ right: 0 }}>{SESSAO.fechamento}</span>
      </div>
    </>
  );
}
