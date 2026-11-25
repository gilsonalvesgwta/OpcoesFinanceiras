// Minha carteira: tipos da api, leitura dos PDFs para enviar e textos da prévia das notas.

export type ItemDaCarteira = {
  codigo: string; tipo: 'call' | 'put' | 'ativo'; strike: number | null; vencimento: string | null; vencida: boolean;
  quantidade: number; precoMedio: number; precoMedioComCustos: number; custoDaPosicao: number;
  preco: number | null; origemDoPreco: 'ultimo' | 'bid' | 'ask' | null; qualidade: string | null; provedor: string | null;
  valorDeMercado: number | null; resultado: number | null; resultadoFracao: number | null; realizadoLiquido: number; diasAteVencimento: number | null;
  lotes?: LoteDaCarteira[];
};
export type SugestaoDoLote = {
  codigo: string; strike: number; vencimento: string; dias: number; premio: number | null; origemDoPremio: 'bid' | 'ultimo' | null; qualidade: string | null;
  receita: number | null; premioFracao: number | null; seExercido: number | null; seExercidoFracao: number | null;
};
export type LoteDaCarteira = {
  instante: string; data: string; quantidadeOriginal: number; quantidade: number; preco: number; precoComCustos: number; custo: number;
  resultado: number | null; resultadoFracao: number | null; sugestao: SugestaoDoLote | null;
};
export type GrupoDaCarteira = {
  ativoObjeto: string;
  cotacao: { ultimo: number | null; bid: number | null; ask: number | null; fechamentoAnterior: number | null; qualidade: string; provedor: string; instanteDaFonte: string | null } | null;
  itens: ItemDaCarteira[];
  cobertura: { acoes: number; callsVendidas: number; callsCompradas: number; descobertas: number };
  valorDeMercado: number | null; resultado: number | null; custo: number;
};
export type ClasseDoAtivo = 'acoes' | 'fiis' | 'etfs' | 'renda_fixa' | 'bdrs';
export const NOME_DA_CLASSE: Record<ClasseDoAtivo, string> = {
  acoes: 'Ações', fiis: 'Fundos imobiliários e Fiagro', etfs: 'ETFs de renda variável', renda_fixa: 'Renda fixa', bdrs: 'BDRs (exterior)',
};
export const ORDEM_DAS_CLASSES: ClasseDoAtivo[] = ['acoes', 'fiis', 'etfs', 'renda_fixa', 'bdrs'];
export type SerieDeOpcao = {
  codigo: string; tipo: 'call' | 'put'; strike: number; vencimento: string; vencida: boolean; lado: 'vendida' | 'comprada'; ativoObjeto: string | null;
  quantidadeNegociada: number; quantidadeAberta: number; base: number; custos: number; realizadoLiquido: number;
  precoAgora: number | null; emAberto: number | null; resultado: number; fracao: number | null; encerrada: boolean; primeira: string; ultima: string;
};
export type SomaDasOpcoes = { series: number; resultado: number; base: number; fracao: number | null; ganhos: number; perdas: number };
export type Carteira = {
  agora: string; hoje: string; mercadoAberto: boolean; grupos: (GrupoDaCarteira & { classe: ClasseDoAtivo })[];
  opcoes: { series: SerieDeOpcao[]; encerradas: SomaDasOpcoes; abertas: SomaDasOpcoes; todas: SomaDasOpcoes };
  totais: { semPreco?: string[]; valorDeMercado: number | null; resultadoEmAberto: number | null; realizadoLiquido: number; realizadoBruto: number; custosPagos: number };
  premissas: string[];
};

export type NegocioDaPrevia = {
  lado: 'compra' | 'venda'; mercado: string; codigo: string | null; tipo: 'call' | 'put' | 'ativo' | null;
  strike: number | null; vencimento: string | null; ativoObjeto: string | null; vencimentoEstimado: boolean;
  quantidade: number; preco: number; valor: number; custos: number; observacao: string; falta: string[]; alertas: string[];
};
export type NotaDaPrevia = {
  arquivo: string; erro?: string;
  corretora?: string; numero?: string; dataPregao?: string; custos?: Record<string, number>; custoTotal?: number; irrf?: number;
  liquido?: number | null; conferida?: boolean; avisos?: string[]; jaImportada?: boolean; negocios?: NegocioDaPrevia[];
};

export const ERRO_DA_NOTA: Record<string, string> = {
  nao_e_pdf: 'O arquivo não é PDF nem planilha XLS (Excel 97-2003).',
  nao_e_xls: 'O arquivo não é uma planilha XLS (Excel 97-2003).',
  xls_corrompido: 'Não consegui abrir esta planilha XLS (arquivo corrompido?).',
  xls_sem_planilha: 'A planilha XLS não tem dados.',
  xls_grande_demais: 'A planilha passa de 5 MB.',
  pdf_protegido: 'O PDF está protegido por senha. Baixe a nota sem senha (ou abra e salve uma cópia) e envie de novo.',
  pdf_grande_demais: 'O PDF passa de 5 MB.',
  nao_e_nota_de_corretagem: 'Não parece uma nota de corretagem (ou é um PDF escaneado, em imagem, que o sistema não lê).',
  nota_de_futuros_nao_tratada: 'Nota de futuros (BM&F) ainda não é lida: só ações e opções.',
  cabecalho_ilegivel: 'Não achei o número e a data da nota.',
  sem_negocios: 'Não achei os negócios da nota.',
  pdf_ilegivel: 'Não consegui ler este PDF.',
};

export const ALERTA_DO_NEGOCIO: Record<string, string> = {
  exercicio: 'Exercício de opção: entra como compra/venda da ação ao preço de exercício. Encerre a opção exercida na estratégia (Vencer).',
  strike_da_nota_difere_do_cadastro: 'O strike da nota é diferente do cadastro da B3 (série ajustada por provento?). Usei o da nota.',
  parece_encerrar_venda_anterior: 'Parece uma rolagem: esta compra encerra uma venda feita antes, que não está no sistema. Lance essa venda em "Posição inicial" (data e preço da venda) para o resultado ficar certo.',
  preco_com_fracao_de_centavo: 'Preço com mais de 2 casas: arredondado ao centavo.',
};

export const NOME_DO_CUSTO: Record<string, string> = {
  liquidacao: 'Taxa de liquidação', registro: 'Taxa de registro', termoOpcoes: 'Taxa de termo/opções', ana: 'Taxa A.N.A.',
  emolumentos: 'Emolumentos', transferencia: 'Transferência de ativos', corretagem: 'Corretagem', execucao: 'Execução',
  execucaoCasa: 'Execução casa', iss: 'ISS', outras: 'Outras',
};

// Arquivo → base64 (sem o prefixo "data:...").
export function arquivoParaBase64(f: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(f);
  });
}

// Uma nota pode ser importada quando foi lida, não está importada e nada falta.
export function notaPronta(n: NotaDaPrevia): boolean {
  return !n.erro && !n.jaImportada && Boolean(n.negocios?.length) && (n.negocios ?? []).every((x) => x.falta.length === 0 && x.codigo && x.tipo && x.ativoObjeto);
}

export const pctBr = (f: number | null) => (f === null ? '—' : `${f > 0 ? '+' : f < 0 ? '−' : ''}${Math.abs(f * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

// Mensagem do erro ao ler ou importar notas: diz o que houve, em qual nota e com qual
// código, em vez do genérico "não conseguiu concluir".
export function textoDoErroDasNotas(x: unknown, padrao: string): string {
  if (!(x instanceof Error)) return padrao;
  const e = x as Error & { codigo?: string; status?: number; extra?: Record<string, unknown> };
  const extra = e.extra ?? {};
  const notas = Array.isArray(extra.notas) && extra.notas.length ? ` (nota${extra.notas.length > 1 ? 's' : ''} ${(extra.notas as string[]).join(', ')})` : typeof extra.nota === 'string' ? ` (nota ${extra.nota})` : '';
  const cod = typeof extra.codigo === 'string' ? extra.codigo : '';
  const real = (c: unknown) => (typeof c === 'number' ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—');
  const data = (v: unknown) => (typeof v === 'string' ? v.split('-').reverse().join('/') : '—');
  switch (e.codigo) {
    case 'codigo_com_dados_diferentes': {
      const versoes = Array.isArray(extra.versoes) ? (extra.versoes as { strike: number | null; vencimento: string | null }[]).map((v) => `strike ${real(v.strike)} e vencimento ${data(v.vencimento)}`).join(' / ') : '';
      return `A opção ${cod} aparece com strike ou vencimento diferentes${notas}${versoes ? `: ${versoes}` : ''}. Deixe iguais na prévia (o certo é o da B3) ou, se ela já estava na carteira com dados errados, zere a carteira e importe de novo.`;
    }
    case 'opcao_sem_strike_ou_vencimento': return `Falta o strike ou o vencimento de ${cod || 'uma opção'}${notas}.`;
    case 'entrada_invalida': return 'Algum campo da prévia está fora do formato (strike, vencimento ou ativo). Confira e tente de novo.';
    case 'corpo_grande_demais': return 'Arquivos grandes demais para enviar de uma vez. Envie as notas em grupos menores.';
    case 'sem_conexao': return 'Sem conexão com o sistema. Confira a internet e tente de novo.';
    case 'extrato_nao_e_planilha': return 'O arquivo não é uma planilha do Excel (.xlsx ou .xls). Na B3, exporte o extrato em Excel.';
    case 'nao_e_extrato_da_b3': return 'A planilha não parece o extrato de negociação da B3 (faltam as colunas "Data do Negócio" e "Código de Negociação").';
    case 'extrato_ilegivel': return 'Não consegui abrir esta planilha.';
    case 'vaca_ja_existe': return 'Já existe uma vaca com esse nome.';
    case 'fazenda_nao_e_planilha': return 'O arquivo não é uma planilha .xlsx. No Google Sheets: Arquivo → Fazer download → Microsoft Excel (.xlsx).';
    case 'fazenda_planilha_ilegivel': return 'Não consegui abrir esta planilha.';
    case 'fazenda_sem_vacas': return 'Não achei nenhuma aba de vaca (com "Data da Operação", "Operação", "Tipo", "Quantidade", "Ticker" e "Preço").';
    case 'data_no_futuro': return `Há um negócio com data no futuro${cod ? ` (${cod})` : ''}.`;
    default:
      return e.codigo && e.codigo !== 'erro_interno' ? `${e.message} (código: ${e.codigo}${notas ? `,${notas.replace(/[()]/g, '')}` : ''}${cod ? `, ${cod}` : ''})` : `${e.message}${e.status ? ` (resposta ${e.status})` : ''}`;
  }
}
