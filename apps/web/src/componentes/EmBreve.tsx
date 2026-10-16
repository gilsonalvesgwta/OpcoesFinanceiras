import Link from 'next/link';
import { Cabecalho } from './Casca.tsx';

// Telas das próximas fases: dizem o que vai existir aqui e quando, sem números de mentira.
export function EmBreve({ titulo, fase, texto }: { titulo: string; fase: string; texto: string }) {
  return (
    <>
      <Cabecalho titulo={titulo} />
      <section className="secao" aria-label={`${titulo}: em construção`}>
        <p>{texto}</p>
        <p className="secao-vazia">Chega na {fase} do plano. Enquanto isso, você já pode escolher os ativos que vai acompanhar.</p>
        <div><Link href="/ativos" className="botao">Ir para ativos</Link></div>
      </section>
    </>
  );
}
