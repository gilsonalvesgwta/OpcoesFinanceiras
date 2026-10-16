// Previsão dos próximos vencimentos mensais de opções sobre ações: terceira
// sexta-feira do mês (regra da B3 desde 2021). É PREVISÃO: feriados ainda não
// são considerados aqui, e a data oficial de cada série vem do arquivo da B3.

import { terceiraSexta } from '@wta/domain';

export function proximosVencimentos(hoje: string, quantidade = 2): string[] {
  const [ano, mes] = hoje.split('-').map(Number) as [number, number];
  const r: string[] = [];
  for (let i = 0; r.length < quantidade && i < 24; i += 1) {
    const total = mes - 1 + i;
    const d = terceiraSexta(ano + Math.floor(total / 12), (total % 12) + 1);
    if (d >= hoje) r.push(d);
  }
  return r;
}
