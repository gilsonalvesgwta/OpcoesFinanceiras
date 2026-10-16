// Cliente da api (mesmo endereço do site: o Next repassa /api para o serviço da api).
// Guarda o token CSRF recebido no login/sessão e o envia em toda alteração.

import { mensagemDoErro } from './mensagens.ts';

export class ErroDaApi extends Error {
  readonly status: number;
  readonly codigo: string;
  constructor(status: number, codigo: string) {
    super(mensagemDoErro(codigo));
    this.status = status;
    this.codigo = codigo;
  }
}

let csrf: string | null = null;
export function definirCsrf(valor: string | null): void {
  csrf = valor;
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function chamar<T>(metodo: Metodo, caminho: string, corpo?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (metodo !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  let r: Response;
  try {
    r = await fetch(caminho, {
      method: metodo, headers, credentials: 'same-origin', cache: 'no-store',
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch {
    throw new ErroDaApi(0, 'sem_conexao');
  }
  let dados: unknown = null;
  try {
    dados = await r.json();
  } catch {
    dados = null;
  }
  if (!r.ok) {
    const codigo = typeof dados === 'object' && dados !== null && typeof (dados as { erro?: unknown }).erro === 'string'
      ? (dados as { erro: string }).erro
      : 'erro_interno';
    throw new ErroDaApi(r.status, codigo);
  }
  if (typeof dados === 'object' && dados !== null && typeof (dados as { csrf?: unknown }).csrf === 'string') {
    csrf = (dados as { csrf: string }).csrf;
  }
  return dados as T;
}

export type Papel = 'superadmin' | 'admin' | 'usuario';
export type SessaoPublica = {
  usuario: { id: string; email: string; nome: string; papel: Papel; organizacaoId: string };
  csrf: string;
  deveTrocarSenha: boolean;
};
export type Usuario = {
  id: string; organizacaoId: string; email: string; nome: string; papel: Papel; situacao: 'ativo' | 'suspenso';
  ultimoLogin: string | null; criadoEm: string;
};
export type Convite = {
  id: string; email: string; papel: 'admin' | 'usuario'; criadoEm: string; expiraEm: string; usadoEm: string | null; canceladoEm: string | null;
};
export type Favorito = { codigo: string; ordem: number; criadoEm: string };

// O token dos links de convite e de recuperação vem depois do "#", que o navegador não envia ao servidor.
export function tokenDoEndereco(hash: string): string | null {
  const t = hash.replace(/^#/, '');
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
}
