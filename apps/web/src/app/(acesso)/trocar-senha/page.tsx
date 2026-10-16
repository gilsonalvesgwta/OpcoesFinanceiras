'use client';

// Troca obrigatória da senha inicial (primeiro acesso do superadministrador).

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MensagemDeErro, MolduraDeAcesso } from '../../../componentes/Acesso.tsx';
import { ProvedorDeSessao, useSessao } from '../../../componentes/Sessao.tsx';
import { CamposDeSenhaNova, problemaNaSenhaNova } from '../../../componentes/SenhaNova.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';

function Formulario() {
  const router = useRouter();
  const { sessao, sair } = useSessao();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function trocar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const nova = String(d.get('senha') ?? '');
    const problema = problemaNaSenhaNova(nova, String(d.get('confirmacao') ?? ''));
    if (problema) return setErro(problema);
    setErro(null);
    setEnviando(true);
    try {
      await chamar('POST', '/api/auth/trocar-senha', { atual: String(d.get('atual') ?? ''), nova });
      router.replace('/');
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível trocar a senha agora.');
      setEnviando(false);
    }
  }

  return (
    <form className="acesso-form" onSubmit={trocar} noValidate>
      <h1>Crie sua senha</h1>
      <p className="acesso-nota">
        {sessao.deveTrocarSenha
          ? 'Esta é a senha inicial da instalação. Troque por uma senha só sua para continuar.'
          : 'Troque a senha da sua conta.'}
      </p>
      <div className="campo">
        <label htmlFor="atual">Senha atual</label>
        <input id="atual" name="atual" type="password" autoComplete="current-password" required />
      </div>
      <CamposDeSenhaNova />
      <button type="submit" className="botao botao-principal botao-grande" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar e continuar'}</button>
      <MensagemDeErro texto={erro} />
      <button type="button" className="botao-texto" onClick={() => void sair()}>Sair</button>
    </form>
  );
}

export default function PaginaTrocarSenha() {
  return (
    <MolduraDeAcesso>
      <ProvedorDeSessao permitirTrocaPendente>
        <Formulario />
      </ProvedorDeSessao>
    </MolduraDeAcesso>
  );
}
