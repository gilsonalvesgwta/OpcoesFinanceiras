'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone, type NomeDoIcone } from '../../../componentes/Icone.tsx';
import { useSessao } from '../../../componentes/Sessao.tsx';
import { chamar, ErroDaApi, type Convite, type Usuario } from '../../../lib/api.ts';
import { formatarData, formatarDataHora, PAPEIS } from '../../../lib/formatos.ts';

type Selo = { texto: string; classe: string; icone: NomeDoIcone };
const ATIVO: Selo = { texto: 'Ativo', classe: 'selo-alta', icone: 'certo' };
const SUSPENSO: Selo = { texto: 'Suspenso', classe: 'selo-atencao', icone: 'pausa' };
const PENDENTE: Selo = { texto: 'Convite pendente', classe: 'selo-periodica', icone: 'envelope' };

function SeloDeSituacao({ selo }: { selo: Selo }) {
  return <span className={`selo ${selo.classe}`}><Icone nome={selo.icone} tamanho={16} />{selo.texto}</span>;
}

export default function PaginaUsuarios() {
  const { sessao } = useSessao();
  const souSuper = sessao.usuario.papel === 'superadmin';
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ email: string; link: string; emailEnviado: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    const [u, c] = await Promise.all([
      chamar<{ usuarios: Usuario[] }>('GET', '/api/usuarios'),
      chamar<{ convites: Convite[] }>('GET', '/api/convites'),
    ]);
    setUsuarios(u.usuarios);
    setConvites(c.convites.filter((x) => !x.usadoEm && !x.canceladoEm && new Date(x.expiraEm) > new Date()));
  }, []);

  useEffect(() => {
    carregar().catch((e: Error) => setErro(e.message));
  }, [carregar]);

  if (sessao.usuario.papel === 'usuario') {
    return (
      <>
        <Cabecalho titulo="Usuários" />
        <p className="secao-vazia">Esta área é só para administradores.</p>
      </>
    );
  }

  async function convidar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const email = String(d.get('email') ?? '').trim();
    const papel = String(d.get('papel') ?? 'usuario');
    setErro(null);
    setCriado(null);
    setCopiado(false);
    setEnviando(true);
    try {
      const r = await chamar<{ link: string; emailEnviado: boolean }>('POST', '/api/convites', { email, papel });
      setCriado({ email, link: r.link, emailEnviado: r.emailEnviado });
      (e.target as HTMLFormElement).reset();
      await carregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível criar o convite agora.');
    } finally {
      setEnviando(false);
    }
  }

  async function agir(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      await carregar();
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível concluir agora.');
    }
  }

  const alterar = (id: string, corpo: Record<string, string>) => agir(() => chamar('PATCH', `/api/usuarios/${id}`, corpo));
  const cancelarConvite = (id: string) => agir(() => chamar('DELETE', `/api/convites/${id}`));

  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <>
      <Cabecalho titulo="Usuários" apoio="Quem tem acesso ao sistema. Cada pessoa só vê os próprios dados." />

      <section className="secao" aria-labelledby="convite-titulo" style={{ gap: 16 }}>
        <h2 id="convite-titulo">Convidar pessoa</h2>
        <form onSubmit={convidar} noValidate style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div className="campo" style={{ flex: '2 1 280px' }}>
            <label htmlFor="conv-email">E-mail</label>
            <input id="conv-email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="campo" style={{ flex: '1 1 200px' }}>
            <label htmlFor="conv-papel">Papel</label>
            <select id="conv-papel" name="papel" defaultValue="usuario">
              <option value="usuario">Usuário</option>
              {souSuper && <option value="admin">Administrador</option>}
            </select>
          </div>
          <button type="submit" className="botao botao-principal botao-grande" disabled={enviando}>{enviando ? 'Criando…' : 'Criar convite'}</button>
        </form>
        <MensagemDeErro texto={erro} />
        {criado && (
          <div className="sucesso" role="status">
            <span className="sucesso-titulo"><Icone nome="certo" tamanho={18} />Convite criado para {criado.email}</span>
            <span style={{ color: 'var(--apoio)', fontSize: 14 }}>
              {criado.emailEnviado
                ? 'O e-mail foi enviado. Se preferir, copie o link e mande por outro meio. Ele vale por 7 dias e uma única vez.'
                : 'O envio de e-mail ainda não está configurado. Copie o link e mande para a pessoa por outro meio. Ele vale por 7 dias e uma única vez.'}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <label htmlFor="conv-link" className="so-leitor">Link do convite</label>
              <input id="conv-link" type="text" readOnly value={criado.link} onFocus={(e) => e.currentTarget.select()}
                style={{ flex: '1 1 320px', font: 'inherit', fontSize: 14, minHeight: 44, padding: '0 12px', borderRadius: 8, border: '1px solid var(--borda-campo)', background: 'var(--bg)', color: 'var(--texto)' }} />
              <button type="button" className="botao botao-contorno" onClick={() => void copiar(criado.link)}>{copiado ? 'Link copiado' : 'Copiar link'}</button>
            </div>
          </div>
        )}
      </section>

      <section className="secao secao-tabela" aria-labelledby="lista-titulo">
        <div className="secao-topo"><h2 id="lista-titulo">Pessoas com acesso</h2></div>
        {usuarios === null ? (
          <p className="secao-vazia" style={{ padding: '0 24px 12px' }} role="status">Carregando…</p>
        ) : (
          <div className="tabela-caixa">
            <table className="tabela" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  <th scope="col">Papel</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Último acesso</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const eu = u.id === sessao.usuario.id;
                  const podeMexer = !eu && (souSuper || u.papel === 'usuario');
                  return (
                    <tr key={u.id}>
                      <th scope="row">
                        <span style={{ display: 'block' }}>{u.nome || 'Sem nome'}</span>
                        <span className="sub">{u.email}</span>
                      </th>
                      <td>{PAPEIS[u.papel]}</td>
                      <td><SeloDeSituacao selo={u.situacao === 'ativo' ? ATIVO : SUSPENSO} /></td>
                      <td style={{ color: 'var(--apoio)', fontSize: 14 }}>{u.ultimoLogin ? formatarDataHora(u.ultimoLogin) : 'Nunca entrou'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {eu && <span style={{ color: 'var(--apoio)', fontSize: 14 }}>Você</span>}
                        {podeMexer && (
                          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {souSuper && u.papel !== 'superadmin' && (
                              <button type="button" className="botao botao-pequeno" onClick={() => void alterar(u.id, { papel: u.papel === 'admin' ? 'usuario' : 'admin' })}>
                                {u.papel === 'admin' ? 'Tornar usuário' : 'Tornar administrador'}
                              </button>
                            )}
                            <button type="button" className="botao botao-pequeno" onClick={() => void alterar(u.id, { situacao: u.situacao === 'ativo' ? 'suspenso' : 'ativo' })}>
                              {u.situacao === 'ativo' ? 'Suspender' : 'Reativar'}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {convites.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      <span style={{ display: 'block', color: 'var(--apoio)', fontWeight: 400 }}>Ainda sem conta</span>
                      <span className="sub">{c.email}</span>
                    </th>
                    <td>{PAPEIS[c.papel]}</td>
                    <td><SeloDeSituacao selo={PENDENTE} /></td>
                    <td style={{ color: 'var(--apoio)', fontSize: 14 }}>Convite vale até {formatarData(c.expiraEm)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="botao botao-pequeno" onClick={() => void cancelarConvite(c.id)}>Cancelar convite</button>
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
