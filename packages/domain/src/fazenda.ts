// Vaca (Fazenda): venda de call e put (BOVA11) rolada semana a semana / mês a mês para
// "ordenhar" prêmio. Mesmas contas da planilha do usuário:
// - Total da operação: venda soma (quantidade × preço), compra subtrai; Saldo acumula.
// - Ordenha bruta: soma dos totais. Ordenha líquida: menos os custos das notas.
// - Ordenha média mensal: ordenha ÷ (dias desde a compra ÷ 30), ou a ordenha, com menos de 30 dias.
// - Rentabilidade (produtividade a.m.): (1 + ordenha ÷ margem)^(30 ÷ dias) − 1.
// - Risco PUT: puts vendidas em aberto × preço do ativo agora.
// - Atenção: strike mais longe que a distância escolhida (padrão 10%) do preço de agora.
// "Em custódia" (perna em aberto) é calculado: mesma série (ticker sem o prefixo do ativo,
// tipo e strike) com saldo de quantidade e sem ter vencido.

export type OperacaoDaVaca = {
  id: string; data: string; lado: 'compra' | 'venda'; tipo: 'call' | 'put' | 'ativo'; prazo: 'CURTA' | 'LONGA' | null;
  quantidade: number; ticker: string; strike: number | null; vencimento: string | null; preco: number; custos: number;
  origem: 'planilha' | 'nota' | 'manual'; execucaoId: string | null;
};
export type LinhaDaVaca = OperacaoDaVaca & { total: number; saldo: number; emCustodia: boolean; atencao: string | null };
export type PernaAberta = { chave: string; ticker: string; tipo: 'call' | 'put'; strike: number | null; vencimento: string | null; quantidade: number; dias: number | null; distancia: number | null; atencao: string | null };
export type ResumoDaVaca = {
  ordenhaBruta: number; custos: number; ordenhaLiquida: number; dias: number; rentabilidadeMensal: number | null; ordenhaMediaMensal: number;
  riscoPut: number | null; callsAbertas: number; putsAbertas: number; pernas: PernaAberta[]; serie: { data: string; saldo: number }[];
  operacoes: number; ultimaOperacao: string | null;
};

const dia = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

// Série da perna: ticker sem o prefixo do ativo ("BOVAL137W2" e "l137w2" são a mesma) + tipo + strike.
export function chaveDaSerie(ticker: string, tipo: string, strike: number | null, raiz = 'BOVA'): string {
  const t = ticker.toUpperCase().replace(/\s+/g, '');
  return `${t.startsWith(raiz) ? t.slice(raiz.length) : t}|${tipo}|${strike ?? ''}`;
}

export function analisarVaca(
  vaca: { dataInicio: string; margem: number; distancia: number; ativoObjeto: string },
  operacoes: readonly OperacaoDaVaca[], spot: number | null, hoje: string,
): { linhas: LinhaDaVaca[]; resumo: ResumoDaVaca } {
  const raiz = vaca.ativoObjeto.slice(0, 4);
  const ordem = [...operacoes].sort((a, b) => a.data.localeCompare(b.data));
  // Pernas em aberto: saldo por série; vencida não está mais aberta.
  const saldoDaSerie = new Map<string, { q: number; op: OperacaoDaVaca; ultima: string }>();
  for (const o of ordem) {
    if (o.tipo === 'ativo') continue;
    const k = chaveDaSerie(o.ticker, o.tipo, o.strike, raiz);
    const s = saldoDaSerie.get(k) ?? { q: 0, op: o, ultima: o.data };
    s.q += o.lado === 'compra' ? o.quantidade : -o.quantidade;
    s.ultima = o.data;
    if (o.vencimento) s.op = o; // guarda a que traz o vencimento
    saldoDaSerie.set(k, s);
  }
  const alerta = (strike: number | null, vencimento: string | null) => {
    if (!strike || !spot || (vencimento && vencimento < hoje)) return null;
    if (strike < spot * (1 - vaca.distancia) || strike > spot * (1 + vaca.distancia)) return 'Strike distante';
    return null;
  };
  const pernas: PernaAberta[] = [];
  for (const [chave, s] of saldoDaSerie) {
    if (s.q === 0 || (s.op.vencimento && s.op.vencimento < hoje)) continue;
    // Sem vencimento anotado (planilha antiga): só conta como aberta se mexeu nos últimos 40 dias.
    if (!s.op.vencimento && dia(s.ultima, hoje) > 40) continue;
    const dias = s.op.vencimento ? dia(hoje, s.op.vencimento) : null;
    let atencao = alerta(s.op.strike, s.op.vencimento);
    if (!atencao && dias !== null && dias <= 1) atencao = dias <= 0 ? 'Vence hoje' : 'Vence amanhã';
    pernas.push({
      chave, ticker: s.op.ticker.toUpperCase(), tipo: s.op.tipo as 'call' | 'put', strike: s.op.strike, vencimento: s.op.vencimento, quantidade: s.q,
      dias, distancia: s.op.strike && spot ? s.op.strike / spot - 1 : null, atencao,
    });
  }
  pernas.sort((a, b) => (a.vencimento ?? '9').localeCompare(b.vencimento ?? '9'));
  const abertas = new Set(pernas.map((p) => p.chave));

  let saldo = 0;
  let custos = 0;
  const serie: { data: string; saldo: number }[] = [];
  const linhas = ordem.map((o) => {
    const total = (o.lado === 'venda' ? 1 : -1) * Math.round(o.quantidade * o.preco);
    saldo += total;
    custos += o.custos;
    if (serie.length && (serie[serie.length - 1] as { data: string }).data === o.data) (serie[serie.length - 1] as { saldo: number }).saldo = saldo;
    else serie.push({ data: o.data, saldo });
    const emCustodia = o.tipo !== 'ativo' && abertas.has(chaveDaSerie(o.ticker, o.tipo, o.strike, raiz));
    return { ...o, total, saldo, emCustodia, atencao: alerta(o.strike, o.vencimento) };
  });
  const dias = Math.max(0, dia(vaca.dataInicio, hoje));
  const meses = dias < 30 ? 1 : dias / 30;
  const ordenhaBruta = saldo;
  const rentabilidadeMensal = vaca.margem > 0 && dias >= 1 && 1 + ordenhaBruta / vaca.margem > 0 ? (1 + ordenhaBruta / vaca.margem) ** (30 / dias) - 1 : null;
  const putsVendidas = pernas.filter((p) => p.tipo === 'put' && p.quantidade < 0).reduce((t, p) => t - p.quantidade, 0);
  return {
    linhas,
    resumo: {
      ordenhaBruta, custos, ordenhaLiquida: ordenhaBruta - custos, dias, rentabilidadeMensal, ordenhaMediaMensal: Math.round(ordenhaBruta / meses),
      riscoPut: spot === null ? null : Math.round(putsVendidas * spot),
      callsAbertas: pernas.filter((p) => p.tipo === 'call').reduce((t, p) => t + Math.abs(p.quantidade), 0),
      putsAbertas: pernas.filter((p) => p.tipo === 'put').reduce((t, p) => t + Math.abs(p.quantidade), 0),
      pernas, serie, operacoes: ordem.length, ultimaOperacao: ordem.length ? (ordem[ordem.length - 1] as OperacaoDaVaca).data : null,
    },
  };
}

// ---------- Planilha antiga (Google Sheets / Excel) ----------
// Aba de vaca: rótulos "Data da Compra" e "Margem" com o valor ao lado, e o quadro com
// "Data da Operação", "Operação", "Tipo", "Quantidade", "Ticker", "Strike", "Em Custódia",
// "Vencimento", "Preço". Datas vêm como número de série do Excel ou dd/mm/aaaa.

export type CelulaDaPlanilha = { linha: number; coluna: number; texto: string };
export type VacaDaPlanilha = { nome: string; dataInicio: string; margem: number; quantidade: number | null; operacoes: Omit<OperacaoDaVaca, 'id' | 'custos' | 'origem' | 'execucaoId'>[] };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export function dataDaPlanilha(t: string): string | null {
  const s = t.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${(br[2] as string).padStart(2, '0')}-${(br[1] as string).padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
  return null;
}
function numero(t: string): number | null {
  const s = t.replace(/R\$\s*/i, '').trim();
  if (!s) return null;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : null;
}

export function vacaDaPlanilha(nome: string, celulas: readonly CelulaDaPlanilha[]): VacaDaPlanilha | null {
  const grade = new Map<number, Map<number, string>>();
  for (const c of celulas) { if (!grade.has(c.linha)) grade.set(c.linha, new Map()); (grade.get(c.linha) as Map<number, string>).set(c.coluna, c.texto.trim()); }
  const linhas = [...grade.entries()].sort((a, b) => a[0] - b[0]);
  const cab = linhas.find(([, l]) => [...l.values()].some((t) => norm(t) === 'DATA DA OPERACAO') && [...l.values()].some((t) => norm(t) === 'TICKER'));
  if (!cab) return null;
  const col: Record<string, number> = {};
  const nomes: [string, RegExp][] = [['data', /^DATA DA OPERACAO$/], ['lado', /^OPERACAO$/], ['tipo', /^TIPO$/], ['prazo', /^PRAZO$/], ['qtd', /^QUANTIDADE$/], ['ticker', /^TICKER$/], ['strike', /^STRIKE$/], ['venc', /^VENCIMENTO$/], ['preco', /^PRECO$/]];
  for (const [c, t] of cab[1]) for (const [k, re] of nomes) if (re.test(norm(t)) && col[k] === undefined) col[k] = c;
  if (['data', 'lado', 'tipo', 'qtd', 'ticker', 'preco'].some((k) => col[k] === undefined)) return null;
  const aoLado = (re: RegExp) => {
    for (const [, l] of linhas) {
      if (cab && l === cab[1]) break;
      for (const [c, t] of l) if (re.test(norm(t))) { const v = [...l.entries()].filter(([cc]) => cc > c).sort((a, b) => a[0] - b[0])[0]; if (v) return v[1]; }
    }
    return null;
  };
  const operacoes: VacaDaPlanilha['operacoes'] = [];
  let dataAnterior: string | null = null;
  for (const [n, l] of linhas) {
    if (n <= cab[0]) continue;
    const v = (k: string) => (col[k] === undefined ? '' : l.get(col[k] as number) ?? '');
    const data: string | null = dataDaPlanilha(v('data')) ?? dataAnterior; // linha sem data: mesma data da anterior
    if (data) dataAnterior = data;
    const lado = norm(v('lado'));
    const tipo = norm(v('tipo'));
    const qtd = numero(v('qtd'));
    const preco = numero(v('preco'));
    const ticker = v('ticker').replace(/\s+/g, '');
    if (!data || !/^(COMPRA|VENDA)$/.test(lado) || !/^(CALL|PUT)$/.test(tipo) || !qtd || qtd <= 0 || preco === null || preco < 0 || !ticker) continue;
    const strike = numero(v('strike'));
    const prazo = norm(v('prazo'));
    operacoes.push({
      data, lado: lado === 'COMPRA' ? 'compra' : 'venda', tipo: tipo === 'CALL' ? 'call' : 'put', prazo: prazo === 'CURTA' || prazo === 'LONGA' ? prazo : null,
      quantidade: Math.round(qtd), ticker: ticker.slice(0, 16), strike: strike && strike > 0 ? Math.round(strike * 100) : null,
      vencimento: dataDaPlanilha(v('venc')), preco: Math.round(preco * 1_000_000) / 10_000, // centavos, com a fração do preço médio
    });
  }
  if (!operacoes.length) return null;
  const dataInicio = dataDaPlanilha(aoLado(/^DATA DA COMPRA$/) ?? '') ?? (operacoes.map((o) => o.data).sort()[0] as string);
  const margem = Math.round((numero(aoLado(/^MARGEM$/) ?? '') ?? 0) * 100);
  // Tamanho da perna: o mais comum entre as 10 últimas operações.
  const cont = new Map<number, number>();
  for (const o of operacoes.slice(-10)) cont.set(o.quantidade, (cont.get(o.quantidade) ?? 0) + 1);
  const quantidade = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { nome: nome.trim().slice(0, 40), dataInicio, margem: Math.max(0, margem), quantidade, operacoes };
}

// Mesma operação (para não duplicar planilha × nota): dia, lado, tipo, quantidade e preço.
export const chaveDaOperacao = (o: Pick<OperacaoDaVaca, 'data' | 'lado' | 'tipo' | 'quantidade' | 'preco'>) => `${o.data}|${o.lado}|${o.tipo}|${o.quantidade}|${o.preco}`;
