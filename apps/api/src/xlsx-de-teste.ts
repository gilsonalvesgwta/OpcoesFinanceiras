// Monta um .xlsx mínimo (zip de XMLs) para os testes: textos pela sharedStrings e números.
import { montarZipDeVarios } from './coleta/zip.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const letra = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

export function xlsxDeTeste(linhas: readonly (readonly (string | number | null)[])[], nomeDaAba = 'Negociação'): Buffer {
  const textos: string[] = [];
  const idx = new Map<string, number>();
  const rows = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => {
    if (v === null || v === '') return '';
    const ref = `${letra(c)}${r + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (!idx.has(v)) { idx.set(v, textos.length); textos.push(v); }
    return `<c r="${ref}" t="s"><v>${idx.get(v)}</v></c>`;
  }).join('')}</row>`).join('');
  return montarZipDeVarios({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(nomeDaAba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  });
}
