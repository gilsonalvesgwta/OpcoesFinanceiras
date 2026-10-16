'use client';

// Senha nova com confirmação. A regra (12 caracteres ou mais) aparece antes
// de a pessoa errar, e a conferência acontece no navegador e na api.

import { useState } from 'react';

export function problemaNaSenhaNova(senha: string, confirmacao: string): string | null {
  if (senha.length < 12) return 'A senha precisa ter pelo menos 12 caracteres.';
  if (senha.length > 200) return 'A senha pode ter no máximo 200 caracteres.';
  if (senha !== confirmacao) return 'A confirmação não é igual à senha.';
  return null;
}

export function CamposDeSenhaNova({ rotulo = 'Senha nova' }: { rotulo?: string }) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <>
      <div className="campo">
        <label htmlFor="senha-nova">{rotulo}</label>
        <input id="senha-nova" name="senha" type={mostrar ? 'text' : 'password'} autoComplete="new-password" required minLength={12} aria-describedby="senha-regra" />
        <span className="ajuda" id="senha-regra">Pelo menos 12 caracteres. Uma frase que só você conhece funciona bem.</span>
      </div>
      <div className="campo">
        <label htmlFor="senha-confirmacao">Repita a senha</label>
        <input id="senha-confirmacao" name="confirmacao" type={mostrar ? 'text' : 'password'} autoComplete="new-password" required />
      </div>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 44, cursor: 'pointer' }}>
        <input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} style={{ width: 18, height: 18 }} />
        Mostrar a senha
      </label>
    </>
  );
}
