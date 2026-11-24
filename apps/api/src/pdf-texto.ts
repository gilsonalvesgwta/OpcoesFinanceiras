// Texto posicionado de um PDF de nota de corretagem, sem dependências.
//
// Lê as páginas, as fontes de cada página e os fluxos de conteúdo (FlateDecode), e devolve
// cada trecho de texto com x e y (pontos, origem embaixo à esquerda). Dois tipos de fonte:
// - fontes comuns (Helvetica etc. com WinAnsiEncoding, como nas notas da BTG): cada
//   string vira um trecho na posição em que começa;
// - fontes "Type 3" sem tabela de caracteres (desenhos, como nas notas da CM Capital
//   geradas pelo Ghostscript): cada glifo é reconhecido pelo desenho (pdf-glifos.ts), a
//   posição de cada letra é calculada, e as palavras próximas são juntadas em trechos.
// PDF escaneado (imagem) ou com fonte desconhecida devolve pouco ou nenhum texto: quem
// chama avisa que a nota não foi lida.

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { GLIFOS_CONHECIDOS } from './pdf-glifos.ts';

export type TrechoDeTexto = { x: number; y: number; texto: string; pagina: number };

const LIMITE_DE_BYTES = 5 * 1024 * 1024;
const DESCONHECIDO = '�';

type Pdf = { bruto: string; bytes: Buffer; objetos: Map<number, number> };

function abrir(bytes: Buffer): Pdf {
  const bruto = bytes.toString('latin1');
  const objetos = new Map<number, number>();
  const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) objetos.set(Number(m[1]), m.index + m[0].length);
  return { bruto, bytes, objetos };
}

function corpo(pdf: Pdf, n: number): string | null {
  const ini = pdf.objetos.get(n);
  if (ini === undefined) return null;
  const fim = pdf.bruto.indexOf('endobj', ini);
  return pdf.bruto.slice(ini, fim < 0 ? undefined : fim);
}

function fluxo(pdf: Pdf, n: number): Buffer | null {
  const ini = pdf.objetos.get(n);
  const o = corpo(pdf, n);
  if (ini === undefined || !o) return null;
  const s = /stream\r?\n/.exec(o);
  if (!s) return null;
  const dic = o.slice(0, s.index);
  const inicio = ini + s.index + s[0].length;
  const tam = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dic);
  let fim = tam ? inicio + Number(tam[1]) : pdf.bruto.indexOf('endstream', inicio);
  if (fim < inicio || fim > pdf.bytes.length) fim = pdf.bruto.indexOf('endstream', inicio);
  const dados = pdf.bytes.subarray(inicio, fim);
  if (!/FlateDecode/.test(dic)) return dados;
  try { return inflateSync(dados, { finishFlush: 2 }); } catch { return null; }
}

// Valor de uma chave: dicionário/vetor direto ou referência "n 0 R".
function valorDe(pdf: Pdf, dic: string, chave: string): string | null {
  const i = dic.indexOf(`/${chave}`);
  if (i < 0) return null;
  let j = i + chave.length + 1;
  while (/\s/.test(dic[j] ?? '')) j += 1;
  const ref = /^(\d+)\s+\d+\s+R/.exec(dic.slice(j, j + 24));
  if (ref) return corpo(pdf, Number(ref[1]));
  if (dic.startsWith('<<', j)) {
    let prof = 0;
    for (let k = j; k < dic.length; k += 1) {
      if (dic.startsWith('<<', k)) { prof += 1; k += 1; } else if (dic.startsWith('>>', k)) { prof -= 1; k += 1; if (prof === 0) return dic.slice(j, k + 1); }
    }
  }
  if (dic[j] === '[') return dic.slice(j, dic.indexOf(']', j) + 1);
  return dic.slice(j, j + 40);
}

// ---------- Fontes ----------

type Fonte = { tipo3: boolean; codigos: Map<number, string>; larguras: Map<number, number>; direita: Map<number, number>; escala: number };

function lerFonte(pdf: Pdf, n: number): Fonte {
  const o = corpo(pdf, n) ?? '';
  const tipo3 = /\/Subtype\s*\/Type3/.test(o);
  const fonte: Fonte = { tipo3, codigos: new Map(), larguras: new Map(), direita: new Map(), escala: 1 };
  if (!tipo3) return fonte;
  const fm = /\/FontMatrix\s*\[\s*([-\d.]+)/.exec(o);
  fonte.escala = fm ? Number(fm[1]) : 1;
  const primeiro = Number(/\/FirstChar\s+(\d+)/.exec(o)?.[1] ?? 0);
  const larg = valorDe(pdf, o, 'Widths');
  (larg?.match(/[-\d.]+/g) ?? []).forEach((w, i) => fonte.larguras.set(primeiro + i, Number(w)));
  // Desenhos: nome do glifo → objeto.
  const procs = new Map<string, number>();
  const cp = valorDe(pdf, o, 'CharProcs') ?? '';
  for (const m of cp.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) procs.set(m[1] as string, Number(m[2]));
  // Código → nome (Differences).
  const enc = valorDe(pdf, o, 'Encoding') ?? '';
  const dif = /\/Differences\s*\[([\s\S]*?)\]/.exec(enc)?.[1] ?? '';
  let codigo = 0;
  for (const tok of dif.match(/\d+|\/[^\s/[\]]+/g) ?? []) {
    if (tok.startsWith('/')) {
      const nome = tok.slice(1);
      const obj = procs.get(nome);
      let ch = ' ';
      if (obj !== undefined) {
        const desenho = fluxo(pdf, obj);
        if (desenho) fonte.direita.set(codigo, bordaDireita(desenho.toString('latin1')));
        if (!desenho) ch = DESCONHECIDO;
        else if (!/\s(m|re)\s/.test(` ${desenho.toString('latin1')} `)) ch = ' '; // desenho vazio: espaço
        else ch = GLIFOS_CONHECIDOS[createHash('sha1').update(desenho).digest('hex').slice(0, 12)] ?? DESCONHECIDO;
      }
      fonte.codigos.set(codigo, ch);
      codigo += 1;
    } else codigo = Number(tok);
  }
  return fonte;
}

// Borda direita do desenho do glifo, em "em" (o desenho vem escalado por "cm").
function bordaDireita(d: string): number {
  const cm = /([-\d.]+)\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+[-\d.]+\s+[-\d.]+\s+cm/.exec(d);
  const k = cm ? Number(cm[1]) : 1;
  let max = 0;
  const pilha: number[] = [];
  for (const t of d.split(/\s+/)) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) { pilha.push(Number(t)); continue; }
    if (t === 'm' || t === 'l') max = Math.max(max, pilha[pilha.length - 2] ?? 0);
    else if (t === 'c') max = Math.max(max, pilha[pilha.length - 6] ?? 0, pilha[pilha.length - 4] ?? 0, pilha[pilha.length - 2] ?? 0);
    else if (t === 're') max = Math.max(max, (pilha[pilha.length - 4] ?? 0) + (pilha[pilha.length - 2] ?? 0));
    pilha.length = 0;
  }
  return max * k;
}

const winAnsi = (bytes: string) => bytes.replace(/[\x80-\x9f]/g, (c) => ({ '\x96': '–', '\x97': '—', '\x91': '‘', '\x92': '’', '\x93': '“', '\x94': '”', '\x95': '•', '\x80': '€' } as Record<string, string>)[c] ?? ' ');

// ---------- Strings do conteúdo ----------

function lerLiteral(s: string, i: number): { valor: string; fim: number } {
  let profundidade = 1;
  let out = '';
  let j = i + 1;
  while (j < s.length && profundidade > 0) {
    const c = s[j] as string;
    if (c === '\\') {
      const n = s[j + 1] as string;
      if (/[0-7]/.test(n)) {
        let oct = n;
        if (/[0-7]/.test(s[j + 2] ?? '')) oct += s[j + 2];
        if (oct.length === 2 && /[0-7]/.test(s[j + 3] ?? '')) oct += s[j + 3];
        out += String.fromCharCode(parseInt(oct, 8));
        j += 1 + oct.length;
        continue;
      }
      if (n === '\r' || n === '\n') { j += n === '\r' && s[j + 2] === '\n' ? 3 : 2; continue; }
      out += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[n] ?? n;
      j += 2;
      continue;
    }
    if (c === '(') profundidade += 1;
    if (c === ')') { profundidade -= 1; if (profundidade === 0) break; }
    out += c;
    j += 1;
  }
  return { valor: out, fim: j + 1 };
}

const lerHex = (h: string) => { const s = h.replace(/\s/g, ''); let r = ''; for (let i = 0; i < s.length; i += 2) r += String.fromCharCode(parseInt((s.slice(i, i + 2) + '0').slice(0, 2), 16)); return r; };

// ---------- Interpretação do conteúdo de uma página ----------

type Glifo = { x: number; y: number; ch: string; largura: number; tamanho: number };

function interpretar(conteudo: string, fontes: Map<string, Fonte>, pagina: number): TrechoDeTexto[] {
  const trechos: TrechoDeTexto[] = [];
  const glifos: Glifo[] = [];
  let fonte: Fonte | undefined;
  let tam = 1;
  let tm = [1, 0, 0, 1, 0, 0];
  let lm = [1, 0, 0, 1, 0, 0];
  let entrelinha = 0;
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilhaCtm: number[][] = [];
  const pilha: (number | string)[] = [];
  const mult = (a: number[], b: number[]) => [a[0]! * b[0]! + a[1]! * b[2]!, a[0]! * b[1]! + a[1]! * b[3]!, a[2]! * b[0]! + a[3]! * b[2]!, a[2]! * b[1]! + a[3]! * b[3]!, a[4]! * b[0]! + a[5]! * b[2]! + b[4]!, a[4]! * b[1]! + a[5]! * b[3]! + b[5]!];
  const ponto = () => { const m = mult(tm, ctm); return { x: m[4] as number, y: m[5] as number, escala: Math.hypot(m[0] as number, m[1] as number) }; };
  const novaLinha = (tx: number, ty: number) => { lm = mult([1, 0, 0, 1, tx, ty], lm); tm = [...lm]; };
  const mostrar = (s: string) => {
    if (fonte?.tipo3) {
      for (let k = 0; k < s.length; k += 1) {
        const cod = s.charCodeAt(k);
        const p = ponto();
        const w = (fonte.larguras.get(cod) ?? 0) * fonte.escala * tam;
        // Largura visível (até a borda direita do desenho), não o avanço declarado.
        const visivel = (fonte.direita.get(cod) ?? 0.5) * fonte.escala * tam * p.escala;
        glifos.push({ x: p.x, y: p.y, ch: fonte.codigos.get(cod) ?? DESCONHECIDO, largura: visivel, tamanho: tam * p.escala });
        tm = mult([1, 0, 0, 1, w, 0], tm);
      }
    } else if (s.trim()) {
      const p = ponto();
      trechos.push({ x: p.x, y: p.y, texto: winAnsi(s), pagina });
    }
  };
  const ajustar = (n: number) => { tm = mult([1, 0, 0, 1, (-n / 1000) * tam, 0], tm); };
  let i = 0;
  const n = conteudo.length;
  while (i < n) {
    const c = conteudo[i] as string;
    if (c === '(') { const l = lerLiteral(conteudo, i); pilha.push(`(${l.valor}`); i = l.fim; continue; }
    if (c === '<' && conteudo[i + 1] !== '<') { const f = conteudo.indexOf('>', i); pilha.push(`(${lerHex(conteudo.slice(i + 1, f))}`); i = f + 1; continue; }
    if (c === '[') { pilha.push('['); i += 1; continue; }
    if (c === ']') { pilha.push(']'); i += 1; continue; }
    if (c === '/') { const m = /^\/[^\s/()<>[\]{}%]+/.exec(conteudo.slice(i, i + 64)); pilha.push(m ? m[0] : '/'); i += m ? m[0].length : 1; continue; }
    if (c === '%') { const f = conteudo.indexOf('\n', i); i = f < 0 ? n : f + 1; continue; }
    if (/\s/.test(c) || c === '<' || c === '>') { i += 1; continue; }
    const m = /^[-+]?(\d+\.?\d*|\.\d+)|^[A-Za-z'"*]+/.exec(conteudo.slice(i, i + 32));
    if (!m) { i += 1; continue; }
    i += m[0].length;
    const tok = m[0];
    if (/^[-+.\d]/.test(tok)) { pilha.push(Number(tok)); continue; }
    const nums = pilha.filter((x): x is number => typeof x === 'number');
    const ult = (k: number) => nums[nums.length - k] as number;
    switch (tok) {
      case 'q': pilhaCtm.push([...ctm]); break;
      case 'Q': ctm = pilhaCtm.pop() ?? [1, 0, 0, 1, 0, 0]; break;
      case 'cm': if (nums.length >= 6) ctm = mult(nums.slice(-6), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; lm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': { const nome = pilha.find((x) => typeof x === 'string' && x.startsWith('/')) as string | undefined; fonte = nome ? fontes.get(nome.slice(1)) : undefined; tam = ult(1) || 1; break; }
      case 'Tm': if (nums.length >= 6) { lm = nums.slice(-6); tm = [...lm]; } break;
      case 'Td': novaLinha(ult(2), ult(1)); break;
      case 'TD': entrelinha = -ult(1); novaLinha(ult(2), ult(1)); break;
      case 'TL': entrelinha = ult(1); break;
      case 'T*': novaLinha(0, -entrelinha); break;
      case 'Tj': { const s = [...pilha].reverse().find((x) => typeof x === 'string' && x.startsWith('(')) as string | undefined; if (s) mostrar(s.slice(1)); break; }
      case "'": case '"': { novaLinha(0, -entrelinha); const s = [...pilha].reverse().find((x) => typeof x === 'string' && x.startsWith('(')) as string | undefined; if (s) mostrar(s.slice(1)); break; }
      case 'TJ': {
        const ini = pilha.lastIndexOf('[');
        let texto = '';
        let inicio: { x: number; y: number } | null = null;
        for (const x of pilha.slice(ini + 1)) {
          if (x === ']') break;
          if (typeof x === 'number') {
            if (fonte?.tipo3) ajustar(x);
            continue;
          }
          if (typeof x === 'string' && x.startsWith('(')) {
            if (fonte?.tipo3) mostrar(x.slice(1));
            else { if (!inicio) inicio = ponto(); texto += x.slice(1); }
          }
        }
        if (!fonte?.tipo3 && inicio && texto.trim()) trechos.push({ x: inicio.x, y: inicio.y, texto: winAnsi(texto), pagina });
        break;
      }
      default: break;
    }
    pilha.length = 0;
  }
  // Glifos → palavras → trechos (palavras com espaço normal entre si ficam juntas;
  // espaços largos, como entre colunas, separam).
  const linhas = new Map<number, Glifo[]>();
  for (const g of glifos) { const k = Math.round(g.y * 2) / 2; (linhas.get(k) ?? linhas.set(k, []).get(k)!).push(g); }
  for (const [y, gs] of linhas) {
    gs.sort((a, b) => a.x - b.x);
    let atual: { x: number; fim: number; texto: string } | null = null;
    let espacos = 0;
    const fechar = () => { if (atual && atual.texto.trim()) trechos.push({ x: atual.x, y, texto: atual.texto.trim(), pagina }); atual = null; };
    for (const g of gs) {
      if (g.ch === ' ') { espacos += 1; continue; }
      const lacuna = atual ? g.x - atual.fim : 0;
      // Entre letras da mesma palavra a lacuna é mínima; cada espaço vale ~0,3 do tamanho
      // da letra. Salto maior que isso é outra coluna.
      const permitido = g.tamanho * (0.24 + espacos * 0.42);
      if (atual && lacuna > permitido) fechar();
      else if (atual && espacos > 0) atual.texto += ' '.repeat(Math.min(espacos, 3));
      if (!atual) atual = { x: g.x, fim: g.x, texto: '' };
      atual.texto += g.ch;
      atual.fim = g.x + g.largura;
      espacos = 0;
    }
    fechar();
  }
  return trechos;
}

// ---------- Páginas ----------

export function textoDoPdf(bytes: Buffer): TrechoDeTexto[] {
  if (bytes.length > LIMITE_DE_BYTES) throw new Error('pdf_grande_demais');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('nao_e_pdf');
  const pdf = abrir(bytes);
  if (/\/Encrypt\b/.test(pdf.bruto)) throw new Error('pdf_protegido');
  const paginas = [...pdf.objetos.keys()].filter((n) => /\/Type\s*\/Page(?!s)\b/.test(corpo(pdf, n) ?? ''));
  // Ordem das páginas: a do vetor /Kids (quando houver); senão, a dos objetos.
  const kids = [...pdf.objetos.keys()].map((n) => corpo(pdf, n) ?? '').filter((o) => /\/Type\s*\/Pages\b/.test(o)).flatMap((o) => [...(valorDe(pdf, o, 'Kids') ?? '').matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])));
  const ordem = kids.filter((k) => paginas.includes(k)).length === paginas.length ? kids.filter((k) => paginas.includes(k)) : paginas.sort((a, b) => a - b);
  const trechos: TrechoDeTexto[] = [];
  ordem.forEach((n, i) => {
    const o = corpo(pdf, n) ?? '';
    const recursos = valorDe(pdf, o, 'Resources') ?? '';
    const dicFontes = valorDe(pdf, recursos, 'Font') ?? '';
    const fontes = new Map<string, Fonte>();
    for (const m of dicFontes.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) fontes.set(m[1] as string, lerFonte(pdf, Number(m[2])));
    const cont = valorDe(pdf, o, 'Contents') ?? '';
    const refs = [...cont.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    const contRef = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(o);
    const lista = contRef ? (/^\s*\[/.test(corpo(pdf, Number(contRef[1])) ?? '') ? refs : [Number(contRef[1])]) : refs;
    const conteudo = lista.map((r) => fluxo(pdf, r)?.toString('latin1') ?? '').join('\n');
    trechos.push(...interpretar(conteudo, fontes, i + 1));
  });
  return trechos;
}
