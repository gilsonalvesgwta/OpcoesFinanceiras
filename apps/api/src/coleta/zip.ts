// Leitura do único arquivo de um .ZIP (o COTAHIST da B3 vem assim), só com node:zlib.
// Lê o diretório central (não confia nos tamanhos do cabeçalho local, que podem vir
// zerados) e limita o tamanho descompactado para não estourar a memória.

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const FIM_DO_DIRETORIO = 0x06054b50;
const ENTRADA_CENTRAL = 0x02014b50;
const CABECALHO_LOCAL = 0x04034b50;

export class ErroDeZip extends Error {}

export function ehZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

export function extrairPrimeiroArquivo(zip: Buffer, limite = 400 * 1024 * 1024): { nome: string; conteudo: Buffer } {
  if (!ehZip(zip)) throw new ErroDeZip('nao_e_zip');
  // O fim do diretório central fica nos últimos 22 bytes + comentário (até 64 KiB).
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i -= 1) {
    if (zip.readUInt32LE(i) === FIM_DO_DIRETORIO) { fim = i; break; }
  }
  if (fim < 0) throw new ErroDeZip('zip_sem_diretorio');
  const inicioCentral = zip.readUInt32LE(fim + 16);
  if (inicioCentral + 46 > zip.length || zip.readUInt32LE(inicioCentral) !== ENTRADA_CENTRAL) throw new ErroDeZip('zip_corrompido');
  const metodo = zip.readUInt16LE(inicioCentral + 10);
  const crc = zip.readUInt32LE(inicioCentral + 16);
  const compactado = zip.readUInt32LE(inicioCentral + 20);
  const tamanho = zip.readUInt32LE(inicioCentral + 24);
  const tamNome = zip.readUInt16LE(inicioCentral + 28);
  const local = zip.readUInt32LE(inicioCentral + 42);
  const nome = zip.subarray(inicioCentral + 46, inicioCentral + 46 + tamNome).toString('latin1');
  if (tamanho > limite) throw new ErroDeZip('arquivo_grande_demais');
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== CABECALHO_LOCAL) throw new ErroDeZip('zip_corrompido');
  const dados = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  if (dados + compactado > zip.length) throw new ErroDeZip('zip_truncado');
  const bruto = zip.subarray(dados, dados + compactado);
  let conteudo: Buffer;
  if (metodo === 0) conteudo = Buffer.from(bruto);
  else if (metodo === 8) conteudo = inflateRawSync(bruto, { maxOutputLength: limite });
  else throw new ErroDeZip('compressao_nao_suportada');
  if (conteudo.length !== tamanho || crc32(conteudo) !== crc) throw new ErroDeZip('zip_corrompido');
  return { nome, conteudo };
}

// Monta um .ZIP de um arquivo só (usado nos testes e para conferir a leitura).
export function montarZip(nome: string, conteudo: Buffer): Buffer {
  const comprimido = deflateRawSync(conteudo);
  const n = Buffer.from(nome, 'latin1');
  const crc = crc32(conteudo);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(CABECALHO_LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(ENTRADA_CENTRAL, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(conteudo.length, 24);
  central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const inicioCentral = 30 + n.length + comprimido.length;
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(FIM_DO_DIRETORIO, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(46 + n.length, 12); fim.writeUInt32LE(inicioCentral, 16);
  return Buffer.concat([local, n, comprimido, central, n, fim]);
}
