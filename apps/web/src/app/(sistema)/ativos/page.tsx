'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { chamar, ErroDaApi, type Favorito } from '../../../lib/api.ts';
import { formatarData } from '../../../lib/formatos.ts';

export default function PaginaAtivos() {
  const [lista, setLista] = useState<Favorito[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  async function carregar() {
    const r = await chamar<{ favoritos: Favorito[] }>('GET', '/api/favoritos');
    setLista(r.favoritos);
  }
  useEffect(() => {
    carregar().catch((e: Error) => setErro(e.message));
  }, []);

  async function adicionar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const codigo = String(new FormData(e.currentTarget).get('codigo') ?? '').trim().toUpperCase();
    setErro(null);
    setAviso(null);
    if (!/^[A-Z0-9]{4,12}$/.test(codigo)) return setErro('Use o código de negociação, como PETR4 ou BOVA11.');
    try {
      await chamar('POST', '/api/favoritos', { codigo });
      await carregar();
      setAviso(`${codigo} adicionado.`);
      if (campo.current) campo.current.value = '';
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível adicionar agora.');
    }
  }

  async function remover(codigo: string) {
    setErro(null);
    try {
      await chamar('DELETE', `/api/favoritos/${encodeURIComponent(codigo)}`);
      setConfirmando(null);
      await carregar();
      setAviso(`${codigo} removido.`);
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível remover agora.');
    }
  }

  return (
    <>
      <Cabecalho titulo="Ativos" apoio="Os ativos que você acompanha aparecem no painel e servem de base para alertas." />

      <section className="secao" aria-labelledby="adicionar-titulo">
        <h2 id="adicionar-titulo">Adicionar ativo</h2>
        <form onSubmit={adicionar} noValidate style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div className="campo" style={{ flex: '1 1 240px', maxWidth: 360 }}>
            <label htmlFor="codigo">Código de negociação</label>
            <input
              id="codigo" name="codigo" ref={campo} type="text" inputMode="text" autoCapitalize="characters" autoComplete="off"
              maxLength={12} placeholder="PETR4" aria-describedby="codigo-ajuda" style={{ textTransform: 'uppercase' }}
            />
          </div>
          <button type="submit" className="botao botao-principal botao-grande">Adicionar</button>
        </form>
        <span className="ajuda" id="codigo-ajuda" style={{ color: 'var(--apoio)', fontSize: 14 }}>
          A confirmação de que o código existe na B3 entra com a coleta de cotações.
        </span>
        <MensagemDeErro texto={erro} />
        <div role="status" aria-live="polite" className="selo selo-alta" style={{ minHeight: 0 }}>{aviso}</div>
      </section>

      <section className="secao secao-tabela" aria-labelledby="lista-titulo">
        <div className="secao-topo"><h2 id="lista-titulo">Você acompanha</h2></div>
        {lista === null && <p className="secao-vazia" style={{ padding: '0 24px 12px' }} role="status">Carregando…</p>}
        {lista?.length === 0 && <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhum ativo ainda.</p>}
        {lista && lista.length > 0 && (
          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr><th scope="col">Ativo</th><th scope="col">Desde</th><th scope="col" style={{ textAlign: 'right' }}>Ação</th></tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.codigo}>
                    <th scope="row">{f.codigo}</th>
                    <td style={{ color: 'var(--apoio)' }}>{formatarData(f.criadoEm)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {confirmando === f.codigo ? (
                        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="botao botao-pequeno" onClick={() => setConfirmando(null)}>Manter</button>
                          <button type="button" className="botao botao-pequeno botao-contorno" onClick={() => void remover(f.codigo)}>Confirmar remoção</button>
                        </span>
                      ) : (
                        <button type="button" className="botao botao-pequeno" onClick={() => setConfirmando(f.codigo)} aria-label={`Remover ${f.codigo}`}>Remover</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
