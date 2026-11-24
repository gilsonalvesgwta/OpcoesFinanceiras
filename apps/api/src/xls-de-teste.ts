// Monta um .xls mínimo (BIFF8 dentro de um arquivo composto OLE2, no mini-fluxo) para os
// testes do leitor de planilhas: textos pela SST (UTF-16, aceita acentos) e números.

function registro(tipo: number, dados: Buffer): Buffer {
  const cab = Buffer.alloc(4);
  cab.writeUInt16LE(tipo, 0);
  cab.writeUInt16LE(dados.length, 2);
  return Buffer.concat([cab, dados]);
}

function bof(tipo: number): Buffer {
  const d = Buffer.alloc(16);
  d.writeUInt16LE(0x0600, 0);
  d.writeUInt16LE(tipo, 2);
  return registro(0x0809, d);
}

export function xlsDeTeste(linhas: readonly (readonly (string | number | null)[])[]): Buffer {
  const textos: string[] = [];
  const indice = new Map<string, number>();
  const celulas: Buffer[] = [];
  linhas.forEach((l, r) => l.forEach((v, c) => {
    if (v === null || v === '') return;
    if (typeof v === 'number') {
      const d = Buffer.alloc(14);
      d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeDoubleLE(v, 6);
      celulas.push(registro(0x0203, d));
      return;
    }
    if (!indice.has(v)) { indice.set(v, textos.length); textos.push(v); }
    const d = Buffer.alloc(10);
    d.writeUInt16LE(r, 0); d.writeUInt16LE(c, 2); d.writeUInt32LE(indice.get(v) as number, 6);
    celulas.push(registro(0x00fd, d));
  }));
  const sst = Buffer.concat([
    (() => { const b = Buffer.alloc(8); b.writeUInt32LE(textos.length, 0); b.writeUInt32LE(textos.length, 4); return b; })(),
    ...textos.map((t) => { const b = Buffer.alloc(3); b.writeUInt16LE(t.length, 0); b[2] = 1; return Buffer.concat([b, Buffer.from(t, 'utf16le')]); }),
  ]);
  const wb = Buffer.concat([bof(0x0005), registro(0x00fc, sst), registro(0x000a, Buffer.alloc(0)), bof(0x0010), ...celulas, registro(0x000a, Buffer.alloc(0))]);
  if (wb.length >= 4096) throw new Error('planilha de teste grande demais para o mini-fluxo');

  const FIM = 0xfffffffe, LIVRE = 0xffffffff;
  const miniSetores = Math.ceil(wb.length / 64);
  const mini = Buffer.alloc(Math.ceil((miniSetores * 64) / 512) * 512);
  wb.copy(mini);
  const k = mini.length / 512; // setores do mini-fluxo (a partir do setor 3)

  const header = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x003e, 0x18); header.writeUInt16LE(3, 0x1a); header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e); header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c); header.writeUInt32LE(1, 0x30); header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(2, 0x3c); header.writeUInt32LE(1, 0x40); header.writeUInt32LE(FIM, 0x44); header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : LIVRE, 0x4c + i * 4);

  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(FIM, 4); fat.writeUInt32LE(FIM, 8);
  for (let i = 0; i < k; i++) fat.writeUInt32LE(i === k - 1 ? FIM : 3 + i + 1, (3 + i) * 4);

  const entrada = (nome: string, tipo: number, filho: number, inicio: number, tamanho: number) => {
    const e = Buffer.alloc(128, 0);
    Buffer.from(`${nome}\0`, 'utf16le').copy(e);
    e.writeUInt16LE((nome.length + 1) * 2, 0x40);
    e[0x42] = tipo; e[0x43] = 1;
    e.writeUInt32LE(LIVRE, 0x44); e.writeUInt32LE(LIVRE, 0x48); e.writeUInt32LE(filho, 0x4c);
    e.writeUInt32LE(inicio, 0x74); e.writeUInt32LE(tamanho, 0x78);
    return e;
  };
  const vazia = () => { const e = Buffer.alloc(128, 0); e.writeUInt32LE(LIVRE, 0x44); e.writeUInt32LE(LIVRE, 0x48); e.writeUInt32LE(LIVRE, 0x4c); return e; };
  const dir = Buffer.concat([entrada('Root Entry', 5, 1, 3, miniSetores * 64), entrada('Workbook', 2, LIVRE, 0, wb.length), vazia(), vazia()]);

  const miniFat = Buffer.alloc(512, 0xff);
  for (let i = 0; i < miniSetores; i++) miniFat.writeUInt32LE(i === miniSetores - 1 ? FIM : i + 1, i * 4);

  return Buffer.concat([header, fat, dir, miniFat, mini]);
}
