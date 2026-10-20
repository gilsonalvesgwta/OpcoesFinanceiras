// Fontes gratuitas (B3, Banco Central), calendário e diagnóstico: tipos das respostas
// da api e os textos que as telas mostram. Sem dado, o texto diz que não há; nunca inventa.

import type { NomeDoIcone } from '../componentes/Icone.tsx';

export type SituacaoDoMercado = {
  agora: string;
  mercado: { aberto: boolean; motivo: 'pregao' | 'antes' | 'depois' | 'sem_pregao'; sessao: { abertura: string; fechamento: string } | null };
  fechamento: { ultimoImportado: string | null; series: number; esperado: string };
  selic: { dia: string; valor: number } | null;
};

export type Importacao = {
  id: number; fonte: 'b3-cotahist' | 'bcb-selic'; referencia: string | null; situacao: 'ok' | 'sem_arquivo' | 'erro';
  registros: number | null; recusados: number | null; detalhe: string | null; iniciadaEm: string | null; terminadaEm: string | null;
};

export type Diagnostico = {
  agora: string;
  coleta: { nome: string; versao: string | null; vistoEm: string | null }[];
  cotahist: { ultimoImportado: string | null; esperado: string };
  banco: { fechamentosUltimos30Dias: number; seriesVigentes: number };
  brapi: { configurada: boolean; consultasNoMes?: number; limiteMensal?: number; ultimaCotacaoEm?: string | null; ativosHoje?: number; ultimaFalha?: string | null };
  importacoes: Importacao[];
};

export type Feriado = { dia: string; descricao: string };
export type SessaoEspecial = { dia: string; abertura: string; fechamento: string; descricao: string };
export type Calendario = { feriados: Feriado[]; sessoesEspeciais: SessaoEspecial[]; sessaoPadrao: { abertura: string; fechamento: string } };

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDiaMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

// "2026-11-20" -> "20/11/2026"; com semana: "sex, 20/11/2026"; curto: "20/11".
export function dataBr(dia: string, comSemana = false): string {
  const [a, m, d] = dia.split('-') as [string, string, string];
  const texto = `${d}/${m}/${a}`;
  if (!comSemana) return texto;
  return `${SEMANA[new Date(Date.UTC(Number(a), Number(m) - 1, Number(d))).getUTCDay()]}, ${texto}`;
}
export function diaMes(dia: string): string {
  const [, m, d] = dia.split('-') as [string, string, string];
  return `${d}/${m}`;
}
// "16/10 20:10" no horário de Brasília.
export function quandoCurto(iso: string): string {
  const d = new Date(iso);
  return `${fmtDiaMes.format(d)} ${fmtHora.format(d)}`;
}
export function minutosDesde(iso: string, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - Date.parse(iso)) / 60_000));
}
function haMinutos(min: number): string {
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  return `há ${d} dias`;
}

export const numero = (n: number) => n.toLocaleString('pt-BR');
export const percentual = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% ao ano`;

export type Cartao = { nome: string; estado: string; classe: string; icone: NomeDoIcone; preenchido?: boolean; texto: string };

// A coleta roda a cada 10 minutos: mais de 25 minutos sem sinal é parada.
export function cartaoDaColeta(d: Diagnostico, agora: Date): Cartao {
  const ultimo = d.coleta.map((c) => c.vistoEm).filter((x): x is string => Boolean(x)).sort().pop();
  if (!ultimo) return { nome: 'Coleta automática', estado: 'Ainda não ligada', classe: 'selo-neutro', icone: 'indisponivel', texto: 'O serviço de coleta ainda não rodou neste servidor.' };
  const min = minutosDesde(ultimo, agora);
  if (min > 25) return { nome: 'Coleta automática', estado: 'Parada', classe: 'selo-atencao', icone: 'aviso', texto: `Último sinal ${haMinutos(min)}. Confira se o serviço "worker" está rodando no servidor.` };
  return { nome: 'Coleta automática', estado: 'Funcionando', classe: 'selo-alta', icone: 'certo', texto: `Último sinal ${haMinutos(min)}. Confere as fontes a cada 10 minutos.` };
}

export function cartaoDoFechamento(d: Diagnostico): Cartao {
  const { ultimoImportado: ultimo, esperado } = d.cotahist;
  if (!ultimo) return { nome: 'Fechamento da B3', estado: 'Nenhum arquivo ainda', classe: 'selo-neutro', icone: 'indisponivel', texto: 'O primeiro arquivo chega depois das 20h de um dia de pregão.' };
  const quando = d.importacoes.find((i) => i.fonte === 'b3-cotahist' && i.situacao === 'ok' && i.referencia === ultimo)?.terminadaEm;
  const importado = quando ? `, importado em ${quandoCurto(quando)}` : '';
  if (ultimo >= esperado) return { nome: 'Fechamento da B3', estado: `Em dia: ${diaMes(ultimo)}`, classe: 'selo-alta', icone: 'certo', texto: `Arquivo oficial do pregão de ${dataBr(ultimo, true)}${importado}.` };
  return { nome: 'Fechamento da B3', estado: 'Atrasado', classe: 'selo-atencao', icone: 'aviso', texto: `Último arquivo: ${dataBr(ultimo)}${importado}. Esperado: ${dataBr(esperado)} (a B3 costuma publicar depois das 20h).` };
}

export function cartaoDaSelic(s: SituacaoDoMercado | null): Cartao {
  if (!s?.selic) return { nome: 'Selic (Banco Central)', estado: 'Sem dado ainda', classe: 'selo-neutro', icone: 'indisponivel', texto: 'É buscada uma vez por dia, depois das 9h.' };
  return { nome: 'Selic (Banco Central)', estado: percentual(s.selic.valor), classe: 'selo-alta', icone: 'certo', texto: `Taxa de ${diaMes(s.selic.dia)}. Usada como premissa no cálculo das gregas.` };
}

export function cartaoDaBrapi(d: Diagnostico): Cartao {
  if (d.brapi.configurada) {
    const uso = `${numero(d.brapi.consultasNoMes ?? 0)} de ${numero(d.brapi.limiteMensal ?? 14000)} consultas no mês.`;
    if (d.brapi.ultimaCotacaoEm) {
      return { nome: 'brapi (ações a cada 30 min)', estado: 'Funcionando', classe: 'selo-alta', icone: 'certo',
        texto: `${numero(d.brapi.ativosHoje ?? 0)} ações atualizadas; última em ${quandoCurto(d.brapi.ultimaCotacaoEm)}. Preços com cerca de 30 min de atraso. ${uso}` };
    }
    return { nome: 'brapi (ações a cada 30 min)', estado: 'Ligada', classe: 'selo-periodica', icone: 'relogio',
      texto: `Chave configurada. As consultas começam no próximo pregão, para as ações dos seus alertas, estratégias e favoritos.${d.brapi.ultimaFalha ? ` Última falha: ${d.brapi.ultimaFalha}.` : ''} ${uso}` };
  }
  return { nome: 'brapi (ações a cada 30 min)', estado: 'Desligada', classe: 'selo-neutro', icone: 'indisponivel', texto: 'Falta a chave gratuita da brapi. Quando você criar, ela entra na configuração do servidor.' };
}

const ERROS: Record<string, string> = {
  resposta_nao_e_zip: 'A B3 ainda não tinha publicado o arquivo.',
  http_404: 'A B3 ainda não tinha publicado o arquivo.',
  arquivo_de_outro_dia: 'O arquivo baixado era de outro pregão.',
  arquivo_sem_registros: 'O arquivo veio sem nenhuma cotação.',
  zip_corrompido: 'O arquivo veio corrompido.',
  zip_truncado: 'O download veio incompleto.',
  arquivo_grande_demais: 'O arquivo passou do tamanho máximo aceito.',
  resposta_sgs_invalida: 'O Banco Central respondeu num formato inesperado.',
  serie_vazia: 'O Banco Central respondeu sem nenhum valor.',
};

function motivo(detalhe: string | null): string {
  if (!detalhe) return 'Erro sem detalhe.';
  if (ERROS[detalhe]) return ERROS[detalhe] as string;
  const http = /^http_(\d{3})$/.exec(detalhe);
  if (http) return `A fonte respondeu com erro ${http[1]}.`;
  if (/timeout|aborted/i.test(detalhe)) return 'A fonte não respondeu a tempo.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(detalhe)) return 'Sem conexão com a fonte.';
  return `Erro: ${detalhe}`;
}

export type LinhaDaTentativa = { quando: string; fonte: string; pregao: string; resultado: string; classe: string; detalhe: string };

export function linhaDaTentativa(i: Importacao): LinhaDaTentativa {
  const b3 = i.fonte === 'b3-cotahist';
  const NOMES: Record<string, string> = { 'b3-cotahist': 'B3 (COTAHIST)', 'b3-cotahist-mensal': 'B3 (histórico mensal)', 'bcb-selic': 'Banco Central', brapi: 'brapi' };
  const base = { quando: i.terminadaEm ? quandoCurto(i.terminadaEm) : '—', fonte: NOMES[i.fonte] ?? i.fonte, pregao: (b3 || i.fonte === 'brapi') && i.referencia ? dataBr(i.referencia) : '—' };
  if (i.fonte === 'brapi') {
    return { ...base, resultado: i.situacao === 'ok' ? 'Importado' : 'Erro', classe: i.situacao === 'ok' ? 'selo-alta' : 'selo-baixa',
      detalhe: `${numero(i.registros ?? 0)} ações atualizadas${i.recusados ? `, ${numero(i.recusados)} sem resposta` : ''}${i.detalhe ? ` · ${i.detalhe}` : ''}` };
  }
  if (i.fonte === 'b3-cotahist-mensal' && i.situacao === 'ok') {
    return { ...base, pregao: i.referencia ? dataBr(i.referencia).slice(3) : '—', resultado: 'Importado', classe: 'selo-alta', detalhe: `${numero(i.registros ?? 0)} registros${i.detalhe ? `, ${i.detalhe}` : ''}` };
  }
  if (i.situacao === 'ok') {
    const detalhe = b3
      ? [`${numero(i.registros ?? 0)} ações e opções`, i.detalhe ?? null, (i.recusados ?? 0) === 0 ? 'nenhuma linha recusada' : `${numero(i.recusados ?? 0)} linhas recusadas`].filter(Boolean).join(', ')
      : `${numero(i.registros ?? 0)} dias da Selic`;
    return { ...base, resultado: 'Importado', classe: 'selo-alta', detalhe };
  }
  if (i.situacao === 'sem_arquivo') return { ...base, resultado: 'Ainda não saiu', classe: 'selo-atencao', detalhe: `${motivo(i.detalhe)} Nova tentativa em 1 hora.` };
  return { ...base, resultado: 'Erro', classe: 'selo-baixa', detalhe: motivo(i.detalhe) };
}

// Quadro de fontes do painel (prévia aprovada em 17/10/2026).
export type CartaoDeFonte = { titulo: string; texto: string; classe: string; icone: NomeDoIcone };

export function cartaoDaCadeia(s: SituacaoDoMercado | null): CartaoDeFonte {
  const f = s?.fechamento;
  if (!f?.ultimoImportado) {
    return { titulo: 'Cadeia de opções: sem arquivo da B3 ainda', texto: 'O fechamento oficial chega depois das 20h de cada pregão.', classe: 'selo-neutro', icone: 'calendario' };
  }
  if (f.ultimoImportado < f.esperado) {
    return {
      titulo: `Fechamento de ${diaMes(f.esperado)} ainda não chegou`,
      texto: `A B3 costuma publicar depois das 20h. A cadeia completa mostra o fechamento de ${diaMes(f.ultimoImportado)} até lá.`,
      classe: 'selo-atencao', icone: 'aviso',
    };
  }
  const selic = s?.selic ? `Selic de ${percentual(s.selic.valor)} (Banco Central), premissa das gregas calculadas.` : 'Arquivo oficial da B3.';
  return { titulo: `Cadeia de opções: ${numero(f.series)} séries de ${diaMes(f.ultimoImportado)}`, texto: selic, classe: 'selo-historico', icone: 'calendario' };
}

// Feriados de um ano, do mais próximo ao mais distante; os que já passaram vão para o fim.
export function feriadosDoAno<T extends { dia: string }>(lista: T[], ano: string, hoje: string): (T & { passou: boolean })[] {
  const doAno = lista.filter((f) => f.dia.startsWith(`${ano}-`)).map((f) => ({ ...f, passou: f.dia < hoje }));
  return [...doAno.filter((f) => !f.passou).sort((a, b) => a.dia.localeCompare(b.dia)), ...doAno.filter((f) => f.passou).sort((a, b) => b.dia.localeCompare(a.dia))];
}

// Ano seguinte sem nenhum feriado cadastrado: a partir de outubro vale avisar.
export function faltaCalendarioDe(lista: { dia: string }[], hoje: string): string | null {
  const proximo = String(Number(hoje.slice(0, 4)) + 1);
  if (hoje.slice(5, 7) < '10') return null;
  return lista.some((f) => f.dia.startsWith(`${proximo}-`)) ? null : proximo;
}
