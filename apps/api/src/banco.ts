// Acesso ao PostgreSQL com o papel da aplicação (wtaopt_app), que NÃO ignora as
// regras por linha. Toda consulta roda numa transação com o usuário definido:
// é isso que faz o banco aplicar o isolamento, além da checagem da api.

import pg from 'pg';

export type Cliente = pg.PoolClient;
export type Pool = pg.Pool;

export function criarPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function emTransacao<T>(pool: pg.Pool, usuarioId: string | null, fn: (c: Cliente) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [usuarioId ?? '']);
    const resultado = await fn(c);
    await c.query('commit');
    return resultado;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

// Erros levantados de propósito pelas funções do banco (errcode P0001).
export function erroDoBanco(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P0001') {
    return (e as { message?: string }).message ?? null;
  }
  return null;
}

export function violacaoDeUnicidade(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
