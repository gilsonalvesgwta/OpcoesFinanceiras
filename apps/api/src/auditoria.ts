import type { Cliente } from './banco.ts';
import type { Sessao } from './app.ts';

// Registra uma ação no nome de quem está agindo (o banco confere que é ele).
export async function auditar(
  c: Cliente,
  s: Pick<Sessao, 'usuarioId' | 'organizacaoId'>,
  acao: string,
  alvo: { tipo?: string; id?: string; antes?: unknown; depois?: unknown } = {},
  ip: string | null = null,
): Promise<void> {
  await c.query(
    `insert into audit_logs (organization_id, ator_id, acao, alvo_tipo, alvo_id, antes, depois, ip)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      s.organizacaoId, s.usuarioId, acao, alvo.tipo ?? null, alvo.id ?? null,
      alvo.antes === undefined ? null : JSON.stringify(alvo.antes),
      alvo.depois === undefined ? null : JSON.stringify(alvo.depois),
      ip,
    ],
  );
}
