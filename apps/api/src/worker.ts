// Worker de coleta: roda um ciclo a cada COLETA_INTERVALO_MIN minutos (padrão 10).
// Usa o papel wtaopt_coleta (DATABASE_URL_COLETA), que só escreve dados de mercado.
// Uso: node src/worker.ts

import { hostname } from 'node:os';
import { criarPool } from './banco.ts';
import { cicloDeColeta } from './coleta/coleta.ts';

const url = process.env.DATABASE_URL_COLETA?.trim();
if (!url) throw new Error('variável DATABASE_URL_COLETA não definida');
const intervaloMin = Number(process.env.COLETA_INTERVALO_MIN ?? '10');
if (!Number.isFinite(intervaloMin) || intervaloMin < 1) throw new Error('COLETA_INTERVALO_MIN inválido');

const pool = criarPool(url);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
let parar = false;
let espera: NodeJS.Timeout | null = null;

async function rodar(): Promise<void> {
  if (parar) return;
  try {
    const r = await cicloDeColeta({ pool, buscar: fetch, log, nome: `coleta@${hostname()}` });
    const dias = Object.entries(r.cotahist).map(([d, s]) => `${d}:${s}`).join(' ');
    log(`ciclo concluído${dias ? ` | COTAHIST ${dias}` : ''} | Selic ${r.selic}`);
  } catch (e) {
    log(`ciclo falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parar) espera = setTimeout(() => void rodar(), intervaloMin * 60_000);
}

const encerrar = async () => {
  parar = true;
  if (espera) clearTimeout(espera);
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

log(`coleta iniciada, ciclo a cada ${intervaloMin} min`);
await rodar();
