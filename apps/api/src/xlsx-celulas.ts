// Células da primeira planilha de um .xlsx (Excel 2007+), sem dependências: o .xlsx é
// um zip de XMLs; lê os textos compartilhados (sharedStrings), descobre a primeira aba
// pelo workbook e devolve linha, coluna e texto de cada célula preenchida.

import { arquivosDoZip, ehZip } from './coleta/zip.ts';
import type { CelulaXls } from './xls-celulas.ts';

export function ehXlsx(bytes: Buffer): boolean {
  if (!ehZip(bytes)) return false;
  try { return [...arquivosDoZip(bytes).keys()].some((n) => n === 'xl/workbook.xml'); } catch { return false; }
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function texto(xml: string): string {
  return xml.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTIDADES[e] ?? m;
  });
}
// Junta os <t> de um trecho (textos com formatação vêm em vários <r><t>).
const juntarT = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1] as string)).join('');

function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function lerArquivos(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > 12 * 1024 * 1024) throw new Error('xlsx_grande_demais');
  try { return arquivosDoZip(bytes, 120 * 1024 * 1024); } catch { throw new Error('xlsx_ilegivel'); }
}

function celulasDaFolha(folha: string, compartilhados: readonly string[]): CelulaXls[] {
  const r: CelulaXls[] = [];
  for (const m of folha.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1] as string;
    const dentro = m[2] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
    const v = /<v>([\s\S]*?)<\/v>/.exec(dentro)?.[1];
    let valor: string;
    if (t === 's') valor = compartilhados[Number(v)] ?? '';
    else if (t === 'inlineStr') valor = juntarT(dentro);
    else valor = v === undefined ? '' : texto(v);
    if (!valor.trim()) continue;
    r.push({ linha: Number(/\d+$/.exec(ref)?.[0]) - 1, coluna: coluna(ref), texto: valor });
  }
  return r.sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
}

// Todas as abas, na ordem do arquivo, com o nome de cada uma.
export function planilhasDoXlsx(bytes: Buffer): { nome: string; celulas: CelulaXls[] }[] {
  const arquivos = lerArquivos(bytes);
  const ler = (n: string) => arquivos.get(n)?.toString('utf8') ?? null;
  const compartilhados = [...(ler('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => juntarT(m[1] as string));
  const wb = ler('xl/workbook.xml') ?? '';
  const rels = ler('xl/_rels/workbook.xml.rels') ?? '';
  const alvos = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const alvo = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && alvo) alvos.set(id, alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`);
  }
  const r: { nome: string; celulas: CelulaXls[] }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const nome = texto(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const folha = rid ? ler(alvos.get(rid) ?? '') : null;
    if (folha) r.push({ nome, celulas: celulasDaFolha(folha, compartilhados) });
  }
  if (!r.length) {
    const folha = ler('xl/worksheets/sheet1.xml');
    if (folha) r.push({ nome: 'Planilha1', celulas: celulasDaFolha(folha, compartilhados) });
  }
  if (!r.length) throw new Error('xlsx_sem_planilha');
  return r;
}

export function celulasDoXlsx(bytes: Buffer): CelulaXls[] {
  return (planilhasDoXlsx(bytes)[0] as { celulas: CelulaXls[] }).celulas;
}
