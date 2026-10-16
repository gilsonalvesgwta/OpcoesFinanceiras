'use client';

// Casca das telas do sistema: menu lateral no computador; no celular, barra
// no topo com o botão "Menu" que abre a mesma lista.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PAPEIS } from '../lib/formatos.ts';
import { Icone, type NomeDoIcone } from './Icone.tsx';
import { useSessao } from './Sessao.tsx';

// As telas das próximas fases já existem no menu e explicam o que vai chegar.
type Item = { href: string; nome: string; icone: NomeDoIcone };

const PRINCIPAL: Item[] = [
  { href: '/', nome: 'Painel', icone: 'painel' },
  { href: '/ativos', nome: 'Ativos', icone: 'ativos' },
  { href: '/cadeia', nome: 'Cadeia de opções', icone: 'cadeia' },
  { href: '/alertas', nome: 'Alertas', icone: 'alertas' },
  { href: '/posicoes', nome: 'Posições', icone: 'posicoes' },
  { href: '/rolagens', nome: 'Rolagens', icone: 'rolagens' },
  { href: '/historico', nome: 'Histórico', icone: 'historico' },
];

const ADMINISTRACAO: Item[] = [
  { href: '/usuarios', nome: 'Usuários', icone: 'usuarios' },
  { href: '/diagnostico', nome: 'Diagnóstico', icone: 'diagnostico' },
];

function Marca({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="marca" aria-label="WTA Options Intelligence, ir para o painel">
      <span className="marca-sigla">WTA</span>
      <span className="marca-nome">Options Intelligence</span>
    </Link>
  );
}

function ItemDoMenu({ item, atual }: { item: Item; atual: boolean }) {
  return (
    <Link href={item.href} className="menu-item" aria-current={atual ? 'page' : undefined}>
      <Icone nome={item.icone} />
      <span>{item.nome}</span>
    </Link>
  );
}

export function Casca({ children }: { children: ReactNode }) {
  const { sessao, sair } = useSessao();
  const caminho = usePathname() ?? '/';
  const [aberto, setAberto] = useState(false);
  const administra = sessao.usuario.papel !== 'usuario';

  useEffect(() => setAberto(false), [caminho]);

  const atual = (href: string) => (href === '/' ? caminho === '/' : caminho === href || caminho.startsWith(`${href}/`));

  return (
    <div className="casca">
      <header className="topo-celular">
        <Marca />
        <button
          type="button" className="botao-icone" aria-label={aberto ? 'Fechar o menu' : 'Abrir o menu'}
          aria-expanded={aberto} aria-controls="menu-principal" onClick={() => setAberto((v) => !v)}
        >
          <Icone nome={aberto ? 'fechar' : 'menu'} tamanho={22} />
        </button>
      </header>

      <nav id="menu-principal" aria-label="Navegação principal" className={`menu${aberto ? ' aberto' : ''}`}>
        <Marca />
        <div className="menu-grupo">
          {PRINCIPAL.map((i) => <ItemDoMenu key={i.href} item={i} atual={atual(i.href)} />)}
        </div>
        {administra && (
          <div className="menu-grupo">
            <span className="menu-titulo" id="titulo-admin">Administração</span>
            {ADMINISTRACAO.map((i) => <ItemDoMenu key={i.href} item={i} atual={atual(i.href)} />)}
          </div>
        )}
        <div className="menu-pe">
          <div>
            <span className="menu-pe-nome" style={{ display: 'block' }}>{sessao.usuario.nome || sessao.usuario.email}</span>
            <span className="menu-pe-papel">{PAPEIS[sessao.usuario.papel]}</span>
          </div>
          <div className="menu-pe-acoes">
            <Link href="/preferencias" className="botao-texto" aria-current={atual('/preferencias') ? 'page' : undefined}>Preferências</Link>
            <button type="button" className="botao-texto" onClick={() => void sair()}>Sair</button>
          </div>
        </div>
      </nav>

      <main className="conteudo" id="conteudo">{children}</main>
    </div>
  );
}

export function Cabecalho({ titulo, apoio, acoes }: { titulo: string; apoio?: ReactNode; acoes?: ReactNode }) {
  return (
    <header className="cabecalho">
      <div className="cabecalho-texto">
        <h1>{titulo}</h1>
        {apoio && <span className="cabecalho-apoio">{apoio}</span>}
      </div>
      {acoes && <div className="cabecalho-acoes">{acoes}</div>}
    </header>
  );
}
