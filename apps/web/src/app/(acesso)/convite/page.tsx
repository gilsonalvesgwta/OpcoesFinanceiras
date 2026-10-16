'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { MensagemDeErro, MolduraDeAcesso } from '../../../componentes/Acesso.tsx';
import { CamposDeSenhaNova, problemaNaSenhaNova } from '../../../componentes/SenhaNova.tsx';
import { chamar, ErroDaApi, tokenDoEndereco } from '../../../lib/api.ts';
import { PAPEIS } from '../../../lib/formatos.ts';

type Convite = { email: string; papel: string; organizacao: string };

export default function PaginaConvite() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [convite, setConvite] = useState<Convite | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const t = tokenDoEndereco(window.location.hash);
    history.replaceState(null, '', window.location.pathname);
    setToken(t);
    if (!t) return setConvite(null);
    chamar<Convite>('GET', `/api/convites/${t}`).then(setConvite).catch(() => setConvite(null));
  }, []);

  async function aceitar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const nome = String(d.get('nome') ?? '').trim();
    const senha = String(d.get('senha') ?? '');
    if (!nome) return setErro('Escreva seu nome.');
    const problema = problemaNaSenhaNova(senha, String(d.get('confirmacao') ?? ''));
    if (problema) return setErro(problema);
    setErro(null);
    setEnviando(true);
    try {
      await chamar('POST', '/api/convites/aceitar', { token, nome, senha });
      router.replace('/');
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível criar o acesso agora.');
      setEnviando(false);
    }
  }

  return (
    <MolduraDeAcesso>
      <form className="acesso-form" onSubmit={aceitar} noValidate>
        <h1>Criar seu acesso</h1>
        {convite === undefined && <p className="acesso-nota" role="status">Conferindo o convite…</p>}
        {convite === null && (
          <>
            <MensagemDeErro texto="Este convite não vale mais. Peça um convite novo a quem convidou você." />
            <Link href="/entrar">Ir para entrar</Link>
          </>
        )}
        {convite && (
          <>
            <p className="acesso-nota">
              Convite para <strong style={{ color: 'var(--texto)' }}>{convite.email}</strong>, como {PAPEIS[convite.papel]?.toLowerCase() ?? convite.papel}.
            </p>
            <div className="campo">
              <label htmlFor="nome">Seu nome</label>
              <input id="nome" name="nome" type="text" autoComplete="name" maxLength={120} required />
            </div>
            <CamposDeSenhaNova rotulo="Crie uma senha" />
            <button type="submit" className="botao botao-principal botao-grande" disabled={enviando}>{enviando ? 'Criando…' : 'Criar acesso'}</button>
            <MensagemDeErro texto={erro} />
          </>
        )}
      </form>
    </MolduraDeAcesso>
  );
}
