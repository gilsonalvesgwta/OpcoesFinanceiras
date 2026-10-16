'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MensagemDeErro, MolduraDeAcesso } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';

export default function PaginaEsqueci() {
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function pedir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    setErro(null);
    setEnviando(true);
    try {
      await chamar('POST', '/api/auth/recuperar', { email });
      setEnviado(true);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível pedir o link agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MolduraDeAcesso>
      <form className="acesso-form" onSubmit={pedir} noValidate>
        <h1>Esqueci a senha</h1>
        {enviado ? (
          <div className="sucesso" role="status">
            <span className="sucesso-titulo"><Icone nome="envelope" tamanho={18} />Pedido registrado</span>
            <span className="cabecalho-apoio" style={{ fontSize: 14 }}>
              Se o e-mail tiver conta, chega um link para criar uma senha nova. Ele vale por 30 minutos e uma única vez.
            </span>
          </div>
        ) : (
          <>
            <p className="acesso-nota">Digite o e-mail da sua conta. Enviaremos um link para criar uma senha nova.</p>
            <div className="campo">
              <label htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <button type="submit" className="botao botao-principal botao-grande" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar link'}
            </button>
          </>
        )}
        <MensagemDeErro texto={erro} />
        <Link href="/entrar">Voltar para entrar</Link>
      </form>
    </MolduraDeAcesso>
  );
}
