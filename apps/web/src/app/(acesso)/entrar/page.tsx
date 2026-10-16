'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { MensagemDeErro, MolduraDeAcesso } from '../../../componentes/Acesso.tsx';
import { chamar, ErroDaApi, type SessaoPublica } from '../../../lib/api.ts';

// Só volta para endereços internos (evita redirecionar para outro site).
function destinoSeguro(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/';
}

function Formulario() {
  const router = useRouter();
  const voltar = destinoSeguro(useSearchParams()?.get('voltar') ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro(null);
    setEnviando(true);
    try {
      const s = await chamar<SessaoPublica>('POST', '/api/auth/entrar', { email: String(dados.get('email') ?? ''), senha: String(dados.get('senha') ?? '') });
      router.replace(s.deveTrocarSenha ? '/trocar-senha' : voltar);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível entrar agora.');
      setEnviando(false);
    }
  }

  return (
    <form className="acesso-form" onSubmit={entrar} noValidate>
      <h1>Entrar</h1>
      <div className="campo">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="campo">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label htmlFor="senha">Senha</label>
          <Link href="/esqueci-a-senha" style={{ fontSize: 14, padding: '6px 0' }}>Esqueci a senha</Link>
        </div>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required />
      </div>
      <button type="submit" className="botao botao-principal botao-grande" disabled={enviando}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
      <MensagemDeErro texto={erro} />
      <p className="acesso-nota">O acesso é só por convite. Se você recebeu um, abra o link do e-mail para criar sua senha.</p>
    </form>
  );
}

export default function PaginaEntrar() {
  return (
    <MolduraDeAcesso>
      <Suspense>
        <Formulario />
      </Suspense>
    </MolduraDeAcesso>
  );
}
