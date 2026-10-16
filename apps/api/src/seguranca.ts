// Senhas, tokens e e-mails: só node:crypto, sem dependências.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

function scrypt(senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, erro) => scryptCb(senha, sal, tamanho, opcoes, (e, chave) => (e ? erro(e) : ok(chave))));
}

// Parâmetros do scrypt: N=2^15, r=8, p=1 (≈32 MB e algumas dezenas de ms por senha).
const N = 2 ** 15;
const R = 8;
const P = 1;
const TAMANHO = 64;
const MEMORIA = 128 * N * R * 2;

export const SENHA_MINIMA = 12;
export const SENHA_MAXIMA = 200;

export function problemaDaSenha(senha: unknown): string | null {
  if (typeof senha !== 'string') return 'senha_invalida';
  if (senha.length < SENHA_MINIMA) return 'senha_curta';
  if (senha.length > SENHA_MAXIMA) return 'senha_longa';
  if (senha.trim().length === 0) return 'senha_invalida';
  return null;
}

// Formato guardado: scrypt$N$r$p$sal(base64)$hash(base64)
export async function gerarHashDeSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await scrypt(senha.normalize('NFC'), sal, TAMANHO, { N, r: R, p: P, maxmem: MEMORIA });
  return ['scrypt', N, R, P, sal.toString('base64'), chave.toString('base64')].join('$');
}

// Hash de uma senha qualquer, usado quando o e-mail não existe: o tempo de
// resposta do login fica igual com ou sem conta (sem enumeração por tempo).
let hashDeEnfeite: Promise<string> | null = null;
export function hashFalso(): Promise<string> {
  hashDeEnfeite ??= gerarHashDeSenha(randomBytes(24).toString('base64'));
  return hashDeEnfeite;
}

export async function conferirSenha(senha: string, guardado: string | null): Promise<boolean> {
  const alvo = guardado ?? (await hashFalso());
  const partes = alvo.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') {
    // Hash guardado em formato desconhecido: gasta o mesmo tempo e recusa.
    await conferirSenha(senha, null);
    return false;
  }
  const [, n, r, p, sal64, chave64] = partes as [string, string, string, string, string, string];
  const esperado = Buffer.from(chave64, 'base64');
  const nNum = Number(n);
  const rNum = Number(r);
  const obtido = await scrypt(senha.normalize('NFC'), Buffer.from(sal64, 'base64'), esperado.length, {
    N: nNum, r: rNum, p: Number(p), maxmem: 128 * nNum * rNum * 2,
  });
  return guardado !== null && obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

// Token aleatório para cookie, convite e recuperação. Só o hash vai para o banco.
export function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDoToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function tokenComFormatoValido(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function normalizarEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

// Comparação de tamanho fixo para o token CSRF.
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}
