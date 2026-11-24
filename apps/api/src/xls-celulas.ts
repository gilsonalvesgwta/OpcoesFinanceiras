// Células da primeira planilha de um arquivo Excel 97-2003 (.xls), sem dependências.
//
// O .xls é um "arquivo composto" (OLE2/CFB) com o fluxo "Workbook" (BIFF8) ou "Book"
// (BIFF5) dentro. Aqui: lê o FAT, o diretório e o mini-fluxo (arquivos pequenos, como as
// notas de corretagem em XLS da CM Capital, ficam nele) e, do BIFF, só o que traz valor
// de célula: textos (SST/LABELSST/LABEL), números (NUMBER/RK/MULRK) e fórmulas com
// resultado. Formatação, fontes e as outras planilhas são ignoradas.

export type CelulaXls = { linha: number; coluna: number; texto: string };

const ASSINATURA = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FIM_DA_CADEIA = 0xfffffffe;
const LIVRE = 0xffffffff;

export function ehXls(bytes: Buffer): boolean {
  return bytes.length >= 512 && ASSINATURA.every((b, i) => bytes[i] === b);
}

function fluxoDoWorkbook(b: Buffer): Buffer {
  if (!ehXls(b)) throw new Error('nao_e_xls');
  const tamSetor = 1 << b.readUInt16LE(0x1e);
  const tamMini = 1 << b.readUInt16LE(0x20);
  const nFat = b.readUInt32LE(0x2c);
  const dir0 = b.readUInt32LE(0x30);
  const corte = b.readUInt32LE(0x38);
  const miniFat0 = b.readUInt32LE(0x3c);
  let difat = b.readUInt32LE(0x44);
  const setor = (n: number) => {
    const ini = 512 + n * tamSetor;
    if (ini >= b.length) throw new Error('xls_corrompido');
    return b.subarray(ini, Math.min(ini + tamSetor, b.length));
  };
  // Setores do FAT: 109 no cabeçalho e o resto em setores DIFAT encadeados.
  const setoresDoFat: number[] = [];
  for (let i = 0; i < 109 && setoresDoFat.length < nFat; i++) {
    const s = b.readUInt32LE(0x4c + i * 4);
    if (s !== LIVRE) setoresDoFat.push(s);
  }
  for (let guarda = 0; difat !== FIM_DA_CADEIA && difat !== LIVRE && setoresDoFat.length < nFat && guarda < 10_000; guarda++) {
    const d = setor(difat);
    for (let i = 0; i < tamSetor / 4 - 1 && setoresDoFat.length < nFat; i++) setoresDoFat.push(d.readUInt32LE(i * 4));
    difat = d.readUInt32LE(tamSetor - 4);
  }
  const fat: number[] = [];
  for (const s of setoresDoFat) { const d = setor(s); for (let i = 0; i + 4 <= d.length; i += 4) fat.push(d.readUInt32LE(i)); }
  const cadeia = (ini: number, tabela: number[]) => {
    const r: number[] = [];
    const vistos = new Set<number>();
    for (let s = ini; s !== FIM_DA_CADEIA && s !== LIVRE; s = tabela[s] ?? FIM_DA_CADEIA) {
      if (vistos.has(s) || s >= tabela.length) throw new Error('xls_corrompido');
      vistos.add(s);
      r.push(s);
    }
    return r;
  };
  const lerCadeia = (ini: number) => Buffer.concat(cadeia(ini, fat).map(setor));

  const dir = lerCadeia(dir0);
  type Entrada = { nome: string; tipo: number; inicio: number; tamanho: number };
  const entradas: Entrada[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const tamNome = dir.readUInt16LE(o + 0x40);
    entradas.push({
      nome: dir.subarray(o, o + Math.max(0, tamNome - 2)).toString('utf16le'),
      tipo: dir[o + 0x42] as number, inicio: dir.readUInt32LE(o + 0x74), tamanho: dir.readUInt32LE(o + 0x78),
    });
  }
  const raiz = entradas.find((e) => e.tipo === 5);
  const wb = entradas.find((e) => e.tipo === 2 && /^(Workbook|Book)$/i.test(e.nome));
  if (!raiz || !wb) throw new Error('xls_sem_planilha');
  if (wb.tamanho >= corte) return lerCadeia(wb.inicio).subarray(0, wb.tamanho);
  // Fluxo pequeno: está no mini-fluxo (guardado na cadeia da raiz), em mini-setores.
  const miniFluxo = lerCadeia(raiz.inicio);
  const miniFat: number[] = [];
  if (miniFat0 !== FIM_DA_CADEIA) { const m = lerCadeia(miniFat0); for (let i = 0; i + 4 <= m.length; i += 4) miniFat.push(m.readUInt32LE(i)); }
  const partes = cadeia(wb.inicio, miniFat).map((s) => miniFluxo.subarray(s * tamMini, (s + 1) * tamMini));
  return Buffer.concat(partes).subarray(0, wb.tamanho);
}

// Número RK do BIFF: inteiro ou os 30 bits altos de um double, opcionalmente ÷ 100.
function rk(v: number): number {
  const div100 = (v & 1) !== 0;
  let n: number;
  if ((v & 2) !== 0) n = v >> 2;
  else { const d = Buffer.alloc(8); d.writeUInt32LE((v & 0xfffffffc) >>> 0, 4); n = d.readDoubleLE(0); }
  return div100 ? n / 100 : n;
}

function numeroComoTexto(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e8) / 1e8);
}

export function celulasDoXls(bytes: Buffer): CelulaXls[] {
  if (bytes.length > 5 * 1024 * 1024) throw new Error('xls_grande_demais');
  const wb = fluxoDoWorkbook(bytes);
  // Registros, com os CONTINUE juntados ao anterior (guardando onde cada pedaço começa,
  // porque uma string da SST que atravessa o CONTINUE ganha um novo byte de opções).
  type Registro = { tipo: number; dados: Buffer; quebras: number[] };
  const regs: Registro[] = [];
  for (let o = 0; o + 4 <= wb.length;) {
    const tipo = wb.readUInt16LE(o);
    const tam = wb.readUInt16LE(o + 2);
    const dados = wb.subarray(o + 4, o + 4 + tam);
    o += 4 + tam;
    const ant = regs[regs.length - 1];
    if (tipo === 0x003c && ant) { ant.quebras.push(ant.dados.length); ant.dados = Buffer.concat([ant.dados, dados]); continue; }
    regs.push({ tipo, dados, quebras: [] });
  }
  let biff8 = true;
  const sst: string[] = [];
  const celulas: CelulaXls[] = [];
  let planilha = -1; // 0 = globais; 1 = primeira planilha
  let formulaPendente: { linha: number; coluna: number } | null = null;

  const lerTexto = (r: Registro, o: number, cch: number, comOpcoes: boolean): { texto: string; fim: number } => {
    if (!biff8) return { texto: r.dados.subarray(o, o + cch).toString('latin1'), fim: o + cch };
    let p = o;
    let opcoes = comOpcoes ? (r.dados[p++] as number) : 0;
    let rich = 0;
    let ext = 0;
    if (opcoes & 0x08) { rich = r.dados.readUInt16LE(p); p += 2; }
    if (opcoes & 0x04) { ext = r.dados.readInt32LE(p); p += 4; }
    let texto = '';
    let falta = cch;
    while (falta > 0) {
      const largo = (opcoes & 1) !== 0;
      const proxQuebra = r.quebras.find((q) => q > p) ?? r.dados.length;
      const cabem = Math.min(falta, Math.floor((proxQuebra - p) / (largo ? 2 : 1)));
      texto += largo ? r.dados.subarray(p, p + cabem * 2).toString('utf16le') : r.dados.subarray(p, p + cabem).toString('latin1');
      p += cabem * (largo ? 2 : 1);
      falta -= cabem;
      if (falta > 0) { if (p >= r.dados.length) break; opcoes = r.dados[p++] as number; } // novo byte de opções após o CONTINUE
      if (cabem === 0 && falta > 0 && p >= proxQuebra && proxQuebra === r.dados.length) break;
    }
    return { texto, fim: p + rich * 4 + Math.max(0, ext) };
  };

  for (const r of regs) {
    const d = r.dados;
    switch (r.tipo) {
      case 0x0809: { // BOF
        planilha += 1;
        biff8 = d.readUInt16LE(0) === 0x0600;
        break;
      }
      case 0x00fc: { // SST
        const n = d.readUInt32LE(4);
        let o = 8;
        for (let i = 0; i < n && o + 2 < d.length; i++) {
          const cch = d.readUInt16LE(o);
          const t = lerTexto(r, o + 2, cch, true);
          sst.push(t.texto);
          o = t.fim;
        }
        break;
      }
      case 0x00fd: // LABELSST
        if (planilha === 1) celulas.push({ linha: d.readUInt16LE(0), coluna: d.readUInt16LE(2), texto: sst[d.readUInt32LE(6)] ?? '' });
        break;
      case 0x0204: // LABEL
        if (planilha === 1) celulas.push({ linha: d.readUInt16LE(0), coluna: d.readUInt16LE(2), texto: lerTexto(r, 8, d.readUInt16LE(6), true).texto });
        break;
      case 0x0203: // NUMBER
        if (planilha === 1) celulas.push({ linha: d.readUInt16LE(0), coluna: d.readUInt16LE(2), texto: numeroComoTexto(d.readDoubleLE(6)) });
        break;
      case 0x027e: // RK
        if (planilha === 1) celulas.push({ linha: d.readUInt16LE(0), coluna: d.readUInt16LE(2), texto: numeroComoTexto(rk(d.readUInt32LE(6))) });
        break;
      case 0x00bd: { // MULRK
        if (planilha !== 1) break;
        const linha = d.readUInt16LE(0);
        const c0 = d.readUInt16LE(2);
        for (let k = 0, o = 4; o + 6 <= d.length - 2; k++, o += 6) celulas.push({ linha, coluna: c0 + k, texto: numeroComoTexto(rk(d.readUInt32LE(o + 2))) });
        break;
      }
      case 0x0006: { // FORMULA: resultado guardado
        if (planilha !== 1) break;
        const linha = d.readUInt16LE(0);
        const coluna = d.readUInt16LE(2);
        if (d.readUInt16LE(12) === 0xffff) { if (d[6] === 0) formulaPendente = { linha, coluna }; }
        else celulas.push({ linha, coluna, texto: numeroComoTexto(d.readDoubleLE(6)) });
        break;
      }
      case 0x0207: // STRING (resultado texto da fórmula anterior)
        if (planilha === 1 && formulaPendente) {
          celulas.push({ ...formulaPendente, texto: lerTexto(r, 2, d.readUInt16LE(0), true).texto });
          formulaPendente = null;
        }
        break;
      default:
        break;
    }
    if (planilha > 1) break; // só a primeira planilha
  }
  return celulas.filter((c) => c.texto.trim() !== '').sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
}
