// Ponto de entrada da api.

import { construirApp } from './app.ts';
import { criarPool, emTransacao } from './banco.ts';
import { lerConfig } from './config.ts';
import { CorreioDesligado } from './correio.ts';
import { gerarHashDeSenha } from './seguranca.ts';
import { avaliarAlertasDaBrapi } from './alertas/brapi.ts';
import { lerCalendario } from './calendario.ts';

const config = lerConfig();
const pool = criarPool(config.bancoUrl);
const app = await construirApp({ config, pool, correio: new CorreioDesligado((m) => console.warn(m)) });

// Ao subir junto com a stack, o banco pode ainda não estar pronto (ou as migrações ainda
// rodando): espera até 2 minutos pelo banco com as funções de acesso criadas.
for (let tentativa = 1; ; tentativa += 1) {
  let motivo = 'migrações ainda não aplicadas';
  try {
    const r = await pool.query("select to_regproc('app.garantir_superadmin') is not null as pronto");
    if (r.rows[0]?.pronto) break;
  } catch (e) {
    motivo = e instanceof Error ? e.message : String(e);
  }
  if (tentativa >= 24) throw new Error(`banco indisponível: ${motivo}`);
  app.log.warn(`banco ainda indisponível (${motivo}); nova tentativa em 5 s`);
  await new Promise((ok) => setTimeout(ok, 5000));
}

// Primeira conta: só é criada se ainda não existir nenhum superadministrador.
if (config.superadmin) {
  const hash = await gerarHashDeSenha(config.superadmin.senhaInicial);
  const criado = await emTransacao(pool, null, async (c) =>
    (await c.query('select app.garantir_superadmin($1, $2) as id', [config.superadmin?.email, hash])).rows[0]?.id,
  );
  if (criado) app.log.info('superadministrador criado; a senha inicial deve ser trocada no primeiro acesso');
}

// Alertas com as cotações da brapi (gravadas pelo worker): confere a cada minuto.
const lacoDaBrapi = setInterval(() => {
  void (async () => {
    try {
      const cfg = await emTransacao(pool, null, lerCalendario);
      const r = await avaliarAlertasDaBrapi(pool, new Date(), cfg);
      if (r.disparos) app.log.info(`alertas pela brapi: ${r.disparos} disparo(s)`);
    } catch (e) {
      app.log.error({ err: e }, 'falha ao avaliar alertas da brapi');
    }
  })();
}, 60_000);

const encerrar = async () => {
  clearInterval(lacoDaBrapi);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

await app.listen({ host: '0.0.0.0', port: config.porta });
