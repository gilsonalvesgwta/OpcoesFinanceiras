'use client';

// Sessão do usuário para as telas do sistema: confere na api ao abrir, manda
// para "Entrar" quando não há sessão e para "Trocar senha" quando a troca é
// obrigatória. O tema escolhido nas preferências é aplicado aqui.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { chamar, definirCsrf, ErroDaApi, type SessaoPublica } from '../lib/api.ts';

type Tema = 'escuro' | 'claro' | 'sistema';

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.theme = tema;
  try {
    localStorage.setItem('wtaopt_tema', tema);
  } catch {
    // armazenamento indisponível (janela privada): o tema vale só nesta página
  }
}

type Contexto = {
  sessao: SessaoPublica;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
};

const SessaoContexto = createContext<Contexto | null>(null);

export function useSessao(): Contexto {
  const c = useContext(SessaoContexto);
  if (!c) throw new Error('useSessao fora do ProvedorDeSessao');
  return c;
}

export function ProvedorDeSessao({ children, permitirTrocaPendente = false }: { children: ReactNode; permitirTrocaPendente?: boolean }) {
  const [sessao, setSessao] = useState<SessaoPublica | null>(null);
  const router = useRouter();
  const caminho = usePathname();

  const recarregar = useCallback(async () => {
    try {
      const s = await chamar<SessaoPublica>('GET', '/api/auth/sessao');
      definirCsrf(s.csrf);
      if (s.deveTrocarSenha && !permitirTrocaPendente) {
        router.replace('/trocar-senha');
        return;
      }
      setSessao(s);
      chamar<{ tema: Tema }>('GET', '/api/preferencias')
        .then((p) => aplicarTema(p.tema))
        .catch(() => undefined);
    } catch (e) {
      if (e instanceof ErroDaApi && (e.status === 401 || e.status === 403)) {
        if (e.codigo === 'troca_de_senha_obrigatoria') router.replace('/trocar-senha');
        else router.replace(`/entrar?voltar=${encodeURIComponent(caminho ?? '/')}`);
        return;
      }
      throw e;
    }
  }, [router, caminho, permitirTrocaPendente]);

  useEffect(() => {
    // Só na abertura; as telas chamam recarregar() quando precisam.
    void recarregar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sair = useCallback(async () => {
    try {
      await chamar('POST', '/api/auth/sair');
    } finally {
      definirCsrf(null);
      router.replace('/entrar');
    }
  }, [router]);

  if (!sessao) {
    return (
      <div className="carregando" role="status">
        Abrindo sua sessão…
      </div>
    );
  }
  return <SessaoContexto.Provider value={{ sessao, recarregar, sair }}>{children}</SessaoContexto.Provider>;
}
