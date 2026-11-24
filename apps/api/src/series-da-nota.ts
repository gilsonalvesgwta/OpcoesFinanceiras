// Séries de opções que não estão no cadastro do sistema (ex.: já vencidas antes da
// instalação): busca nos arquivos COTAHIST da B3, onde a série aparece com strike e
// vencimento oficiais no dia em que a pessoa negociou. Primeiro o arquivo diário do
// pregão da nota; se a B3 não tiver mais o diário, o mensal daquele mês (lido aos poucos,
// guardando só as linhas das séries procuradas e das ações com a mesma raiz).

import { lerCotahist, lerLinhaCotahist, seriesDeOpcoes, urlDoCotahistDiario, urlDoCotahistMensal, type RegistroCotahist } from '@wta/domain';
import type { Buscar } from './coleta/coleta.ts';
import { ehZip, extrairPrimeiroArquivo, linhasDoPrimeiroArquivo } from './coleta/zip.ts';

export type SerieDaB3 = { codigo: string; tipo: 'call' | 'put'; strike: number; vencimento: string; ativoObjeto: string | null };

const diarios = new Map<string, Promise<Map<string, SerieDaB3>>>();
const achadas = new Map<string, SerieDaB3>(); // código@mês → série (do arquivo mensal)
const LIMITE = 150 * 1024 * 1024;

function paraMapa(registros: readonly RegistroCotahist[]): Map<string, SerieDaB3> {
  const m = new Map<string, SerieDaB3>();
  for (const s of seriesDeOpcoes(registros)) m.set(s.codigo, { codigo: s.codigo, tipo: s.tipo, strike: s.strike, vencimento: s.vencimento, ativoObjeto: s.ativoObjeto });
  return m;
}

async function baixar(buscar: Buscar, url: string, tempoMs: number): Promise<Buffer | null> {
  const r = await buscar(url, { signal: AbortSignal.timeout(tempoMs) });
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  return b.length <= LIMITE && ehZip(b) ? b : null;
}

function doDia(buscar: Buscar, dia: string): Promise<Map<string, SerieDaB3>> {
  let p = diarios.get(dia);
  if (!p) {
    p = baixar(buscar, urlDoCotahistDiario(dia), 30_000)
      .then((b) => (b ? paraMapa(lerCotahist(extrairPrimeiroArquivo(b).conteudo.toString('latin1')).registros) : new Map<string, SerieDaB3>()))
      .catch(() => new Map<string, SerieDaB3>());
    diarios.set(dia, p);
    while (diarios.size > 8) diarios.delete(diarios.keys().next().value as string);
    void p.then((m) => { if (!m.size) diarios.delete(dia); }); // falhou: tenta de novo depois
  }
  return p;
}

async function doMes(buscar: Buscar, mes: string, codigos: readonly string[]): Promise<Map<string, SerieDaB3>> {
  const b = await baixar(buscar, urlDoCotahistMensal(mes), 180_000).catch(() => null);
  if (!b) return new Map();
  const procurados = new Set(codigos);
  const raizes = new Set(codigos.map((c) => c.slice(0, 4)));
  const registros: RegistroCotahist[] = [];
  for await (const linha of linhasDoPrimeiroArquivo(b)) {
    if (!linha.startsWith('01')) continue;
    const codigo = linha.slice(12, 24).trim();
    if (!procurados.has(codigo) && !(linha.slice(24, 27) === '010' && raizes.has(codigo.slice(0, 4)))) continue;
    const r = lerLinhaCotahist(linha);
    if (r) registros.push(r);
  }
  return paraMapa(registros);
}

export async function seriesDaB3(buscar: Buscar | undefined, dia: string, codigos: readonly string[]): Promise<Map<string, SerieDaB3>> {
  const r = new Map<string, SerieDaB3>();
  if (!buscar || !codigos.length) return r;
  const mes = dia.slice(0, 7);
  const diario = await doDia(buscar, dia);
  for (const c of codigos) {
    const s = diario.get(c) ?? achadas.get(`${c}@${mes}`);
    if (s) r.set(c, s);
  }
  const faltam = codigos.filter((c) => !r.has(c));
  if (faltam.length) {
    for (const [c, s] of await doMes(buscar, mes, faltam)) {
      if (!faltam.includes(c)) continue;
      r.set(c, s);
      achadas.set(`${c}@${mes}`, s);
    }
  }
  return r;
}
