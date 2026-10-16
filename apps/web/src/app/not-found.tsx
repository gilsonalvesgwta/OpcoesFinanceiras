import Link from 'next/link';

export default function NaoEncontrada() {
  return (
    <main className="carregando" style={{ flexDirection: 'column', gap: 16, padding: 24, textAlign: 'center' }}>
      <h1>Página não encontrada</h1>
      <p style={{ color: 'var(--apoio)' }}>O endereço pode ter mudado ou sido digitado errado.</p>
      <Link href="/" className="botao botao-principal">Ir para o painel</Link>
    </main>
  );
}
