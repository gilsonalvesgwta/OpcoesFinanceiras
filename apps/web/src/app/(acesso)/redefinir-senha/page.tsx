'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { MensagemDeErro, MolduraDeAcesso } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { CamposDeSenhaNova, problemaNaSenhaNova } from '../../../componentes/SenhaNova.tsx';
import { chamar, ErroDaApi, tokenDoEndereco } from '../../../lib/api.ts';

export default function PaginaRedefinir() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setToken(tokenDoEndereco(window.location.hash));
    // Tira o token da barra de endereço (e do histórico) assim que é lido.
    history.replaceState(null, '', window.location.pathname);
  }, []);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const senha = String(d.get('senha') ?? '');
    const problema = problemaNaSenhaNova(senha, String(d.get('confirmacao') ?? ''));
    if (problema) return setErro(problema);
    setErro(null);
    setEnviando(true);
    try {
      await chamar('POST', '/api/auth/redefinir', { token, senha });
      setPronto(true);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MolduraDeAcesso>
      <form className="acesso-form" onSubmit={salvar} noValidate>
        <h1>Criar senha nova</h1>
        {token === null && <MensagemDeErro texto="Este link não vale mais. Peça um novo em “Esqueci a senha”." />}
        {pronto ? (
          <div className="sucesso" role="status">
            <span className="sucesso-titulo"><Icone nome="certo" tamanho={18} />Senha nova salva</span>
            <span className="cabecalho-apoio" style={{ fontSize: 14 }}>As sessões abertas em outros aparelhos foram encerradas.</span>
            <Link href="/entrar" className="botao botao-principal">Entrar</Link>
          </div>
        ) : token ? (
          <>
            <CamposDeSenhaNova />
            <button type="submit" className="botao botao-principal botao-grande" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha nova'}</button>
            <MensagemDeErro texto={erro} />
          </>
        ) : null}
        <Link href="/entrar">Voltar para entrar</Link>
      </form>
    </MolduraDeAcesso>
  );
}
