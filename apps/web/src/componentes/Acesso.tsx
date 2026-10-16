// Moldura das telas de acesso (entrar, convite, senha): o lado da marca à
// esquerda, com a régua como desenho, e o formulário à direita.

import type { ReactNode } from 'react';
import { Icone } from './Icone.tsx';

const MARCAS = [0, 7.6, 15.2, 22.8, 30.4, 38, 45.6, 53.2, 60.8];

export function MolduraDeAcesso({ children }: { children: ReactNode }) {
  return (
    <div className="acesso">
      <section className="acesso-lado" aria-label="Sobre o sistema">
        <div className="marca" style={{ padding: 0 }}>
          <span className="marca-sigla" style={{ fontSize: 26 }}>WTA</span>
          <span className="marca-nome" style={{ fontSize: 15 }}>Options Intelligence</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <p className="acesso-frase">Suas opções da B3, com a idade de cada dado à vista.</p>
          <div className="regua" style={{ height: 40, marginTop: 0, maxWidth: 520 }} aria-hidden="true">
            <div className="regua-trilho" style={{ top: 16 }} />
            <div className="regua-passado" style={{ top: 16, width: '62%' }} />
            {MARCAS.map((m) => <div key={m} className="regua-chegada" style={{ left: `${m}%`, top: 10 }} />)}
            <div className="regua-agora" style={{ left: '62%', top: 0 }} />
          </div>
          <p className="acesso-apoio">
            Alertas no Telegram, posições de várias pernas e comparação de rolagens. Você executa as ordens na sua corretora; aqui você analisa e registra.
          </p>
        </div>
        <span className="acesso-rodape">Análise e organização de informações. Não é recomendação de investimento.</span>
      </section>
      <main className="acesso-principal">{children}</main>
    </div>
  );
}

export function MensagemDeErro({ texto }: { texto: string | null }) {
  // A região existe sempre, para leitores de tela anunciarem a mensagem quando ela aparece.
  return (
    <div role="alert" aria-live="assertive">
      {texto && (
        <div className="alerta">
          <Icone nome="aviso" tamanho={18} />
          <span>{texto}</span>
        </div>
      )}
    </div>
  );
}
