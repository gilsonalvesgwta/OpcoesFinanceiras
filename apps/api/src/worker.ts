// Worker de coleta: roda um ciclo a cada COLETA_INTERVALO_MIN minutos (padrão 10).
// Usa o papel wtaopt_coleta (DATABASE_URL_COLETA), que só escreve dados de mercado.
// Uso: node src/worker.ts

import { hostname } from 'node:os';
import { criarPool } from './banco.ts';
import { cicloDeColeta } from './coleta/coleta.ts';
import { cicloDeAvisosDePosicao } from './coleta/avisos-posicao.ts';
import { enviarAvisos, processarAtualizacoes, telegramReal } from './coleta/telegram.ts';

const url = process.env.DATABASE_URL_COLETA?.trim();
if (!url) throw new Error('variável DATABASE_URL_COLETA não definida');
const intervaloMin = Number(process.env.COLETA_INTERVALO_MIN ?? '10');
if (!Number.isFinite(intervaloMin) || intervaloMin < 1) throw new Error('COLETA_INTERVALO_MIN inválido');

const pool = criarPool(url);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
let parar = false;
let espera: NodeJS.Timeout | null = null;

// Ciclo que falhou (ex.: o banco ainda subindo, nome "db" ainda sem DNS) tenta de novo em 1 minuto.
async function rodar(): Promise<void> {
  if (parar) return;
  let proximoMin = intervaloMin;
  try {
    const r = await cicloDeColeta({ pool, buscar: fetch, log, nome: `coleta@${hostname()}` });
    const dias = Object.entries(r.cotahist).map(([d, s]) => `${d}:${s}`).join(' ');
    const calc = Object.entries(r.calculos).map(([d, x]) => `${d}:${x.calculadas}`).join(' ');
    const hist = Object.entries(r.historico).map(([m, x]) => `${m}:${x}`).join(' ');
    log(`ciclo concluído${dias ? ` | COTAHIST ${dias}` : ''} | Selic ${r.selic}${calc ? ` | gregas ${calc}` : ''}${hist ? ` | histórico ${hist}` : ''}`);
  } catch (e) {
    log(`ciclo falhou: ${e instanceof Error ? e.message : String(e)}; nova tentativa em 1 minuto`);
    proximoMin = 1;
  }
  // Avisos das posições (vencimento, risco, cobertura, sugestões com consentimento).
  if (proximoMin !== 1) {
    try {
      const a = await cicloDeAvisosDePosicao(pool, new Date(), log);
      if (a.eventos || a.sugestoes) log(`avisos das posições: ${a.eventos} eventos, ${a.sugestoes} sugestões`);
    } catch (e) {
      log(`avisos das posições falharam: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!parar) espera = setTimeout(() => void rodar(), proximoMin * 60_000);
}

const encerrar = async () => {
  parar = true;
  if (espera) clearTimeout(espera);
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

// Telegram: dois laços contínuos (avisos a cada 3 s; comandos por "long polling").
const tokenTelegram = process.env.TELEGRAM_BOT_TOKEN?.trim();
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function lacoDeAvisos(tg: ReturnType<typeof telegramReal>): Promise<void> {
  while (!parar) {
    try {
      const r = await enviarAvisos(pool, tg);
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      if (total > 0) log(`avisos: ${Object.entries(r).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    } catch (e) {
      log(`envio de avisos falhou: ${e instanceof Error ? e.message : String(e)}`);
      await pausa(10_000);
    }
    await pausa(3_000);
  }
}
async function lacoDeComandos(tg: ReturnType<typeof telegramReal>): Promise<void> {
  while (!parar) {
    try {
      await processarAtualizacoes(pool, tg, 20);
    } catch (e) {
      log(`comandos do Telegram: ${e instanceof Error ? e.message : String(e)}`);
      await pausa(15_000);
    }
  }
}

log(`coleta iniciada, ciclo a cada ${intervaloMin} min`);
if (tokenTelegram) {
  const tg = telegramReal(tokenTelegram, fetch);
  void lacoDeAvisos(tg);
  void lacoDeComandos(tg);
  log('Telegram ligado: avisos e comandos');
} else {
  log('Telegram desligado (sem TELEGRAM_BOT_TOKEN): os avisos ficam guardados e vencem em 30 minutos');
}
await rodar();
