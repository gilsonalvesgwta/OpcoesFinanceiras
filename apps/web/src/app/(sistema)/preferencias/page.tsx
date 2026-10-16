'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { aplicarTema, useSessao } from '../../../componentes/Sessao.tsx';
import { chamar, ErroDaApi } from '../../../lib/api.ts';
import { PAPEIS } from '../../../lib/formatos.ts';

type Tema = 'escuro' | 'claro' | 'sistema';
const OPCOES: { valor: Tema; nome: string; texto: string }[] = [
  { valor: 'escuro', nome: 'Escuro', texto: 'Fundo ardósia, o padrão.' },
  { valor: 'claro', nome: 'Claro', texto: 'Fundo claro, para ambientes iluminados.' },
  { valor: 'sistema', nome: 'Igual ao aparelho', texto: 'Segue a configuração do computador ou do celular.' },
];

export default function PaginaPreferencias() {
  const { sessao } = useSessao();
  const [tema, setTema] = useState<Tema | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    chamar<{ tema: Tema }>('GET', '/api/preferencias').then((p) => setTema(p.tema)).catch((e: Error) => setErro(e.message));
  }, []);

  async function escolher(novo: Tema) {
    const anterior = tema;
    setTema(novo);
    aplicarTema(novo);
    setErro(null);
    try {
      await chamar('PUT', '/api/preferencias', { tema: novo });
      setAviso('Tema salvo.');
    } catch (x) {
      if (anterior) {
        setTema(anterior);
        aplicarTema(anterior);
      }
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar agora.');
    }
  }

  return (
    <>
      <Cabecalho titulo="Preferências" />

      <section className="secao" aria-labelledby="conta-titulo">
        <h2 id="conta-titulo">Sua conta</h2>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>{sessao.usuario.nome || 'Sem nome'}</span>
          <span style={{ color: 'var(--apoio)' }}>{sessao.usuario.email}</span>
          <span style={{ color: 'var(--apoio)', fontSize: 14 }}>{PAPEIS[sessao.usuario.papel]}</span>
        </div>
        <div><Link href="/trocar-senha" className="botao">Trocar senha</Link></div>
      </section>

      <section className="secao" aria-labelledby="tema-titulo">
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ padding: 0, marginBottom: 8 }}><h2 id="tema-titulo">Aparência</h2></legend>
          {OPCOES.map((o) => (
            <label
              key={o.valor}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${tema === o.valor ? 'var(--latao)' : 'var(--linha)'}`, background: 'var(--painel2)',
              }}
            >
              <input type="radio" name="tema" value={o.valor} checked={tema === o.valor} onChange={() => void escolher(o.valor)} style={{ width: 18, height: 18, marginTop: 3 }} />
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{o.nome}</span>
                <span style={{ display: 'block', color: 'var(--apoio)', fontSize: 14 }}>{o.texto}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <MensagemDeErro texto={erro} />
        <div role="status" aria-live="polite" className="selo selo-alta">{aviso}</div>
      </section>
    </>
  );
}
