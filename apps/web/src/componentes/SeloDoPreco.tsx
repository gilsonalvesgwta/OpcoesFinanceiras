// Selo da origem do preço: tempo real (MT5), brapi (~30 min) ou fechamento.

import { quandoCurto } from '../lib/mercado.ts';
import { QUALIDADE } from '../lib/posicoes.ts';
import type { CotacaoResumida } from '../lib/simulador.ts';

export function SeloDoPreco({ c }: { c: CotacaoResumida }) {
  if (!c) return <span className="selo selo-neutro" style={{ fontSize: 12 }}>sem preço</span>;
  const s = c.provedor === 'brapi' ? { texto: 'brapi (~30 min)', classe: 'selo-periodica' } : QUALIDADE[c.qualidade] ?? { texto: c.qualidade, classe: 'selo-neutro' };
  return <span className={`selo ${s.classe}`} style={{ fontSize: 12 }} title={c.instanteDaFonte ? `Preço de ${quandoCurto(c.instanteDaFonte)}` : undefined}>{s.texto}</span>;
}
