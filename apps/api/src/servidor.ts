// Ponto de entrada da api.

import { construirApp } from './app.ts';
import { criarPool, emTransacao } from './banco.ts';
import { lerConfig } from './config.ts';
import { CorreioDesligado } from './correio.ts';
import { gerarHashDeSenha } from './seguranca.ts';

const config = lerConfig();
const pool = criarPool(config.bancoUrl);
const app = await construirApp({ config, pool, correio: new CorreioDesligado((m) => console.warn(m)) });

// Primeira conta: só é criada se ainda não existir nenhum superadministrador.
if (config.superadmin) {
  const hash = await gerarHashDeSenha(config.superadmin.senhaInicial);
  const criado = await emTransacao(pool, null, async (c) =>
    (await c.query('select app.garantir_superadmin($1, $2) as id', [config.superadmin?.email, hash])).rows[0]?.id,
  );
  if (criado) app.log.info('superadministrador criado; a senha inicial deve ser trocada no primeiro acesso');
}

const encerrar = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

await app.listen({ host: '0.0.0.0', port: config.porta });
