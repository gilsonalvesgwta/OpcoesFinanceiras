// Linhas e arquivo COTAHIST (layout oficial, posições 1-indexadas) para os testes.
import { montarZip } from './coleta/zip.ts';

export type CamposCotahist = { data?: string; codigo: string; tpmerc: number; especi?: string; ult?: number; exe?: number; venc?: string };
export function linhaCotahist(c: CamposCotahist): string {
  const l = Array(245).fill(' ');
  const pos = (de: number, ate: number, v: string, num = false) => {
    const tam = ate - de + 1;
    const s = num ? v.padStart(tam, '0') : v.padEnd(tam, ' ');
    for (let i = 0; i < tam; i += 1) l[de - 1 + i] = s[i] as string;
  };
  const n = (de: number, ate: number, v: number) => pos(de, ate, String(v), true);
  pos(1, 2, '01'); pos(3, 10, c.data ?? '20261124'); pos(11, 12, '02'); pos(13, 24, c.codigo); n(25, 27, c.tpmerc);
  pos(28, 39, 'EMPRESA'); pos(40, 49, c.especi ?? 'ON'); pos(53, 56, 'R$');
  for (const [de, ate] of [[57, 69], [70, 82], [83, 95], [96, 108], [109, 121]] as const) n(de, ate, c.ult ?? 0);
  n(122, 134, 0); n(135, 147, 0); n(148, 152, 1); n(153, 170, 100); n(171, 188, 1000);
  n(189, 201, c.exe ?? 0); n(202, 202, 0); pos(203, 210, c.venc ?? '99991231'); n(211, 217, 1); n(218, 230, 0);
  pos(231, 242, 'BRXXXXACNOR0'); n(243, 245, 100);
  return l.join('');
}

export function zipDoCotahist(dia: string, linhas: string[]): Buffer {
  const d = dia.replaceAll('-', '');
  const texto = [`00COTAHIST.${d.slice(0, 4)}BOVESPA ${d}`.padEnd(245, ' '), ...linhas, '99COTAHIST'.padEnd(245, ' ')].join('\r\n');
  return montarZip(`COTAHIST_D${d.slice(6, 8)}${d.slice(4, 6)}${d.slice(0, 4)}.TXT`, Buffer.from(texto, 'latin1'));
}
