// Alertas na tela: conversão entre o formulário (valores como a pessoa digita) e a
// regra da api (preços em centavos), e textos da situação dos avisos.

import type { Comparacao, Condicao, PoliticaDeRearme } from '@wta/domain';

export type CampoDaTela =
  | 'ultimo' | 'bid' | 'ask' | 'variacao_dia_pct' | 'volume'
  | 'dist_media_20_pct' | 'dist_media_50_pct' | 'dist_media_200_pct' | 'rsi_14' | 'dist_maxima_20_pct' | 'dist_minima_20_pct' | 'variacao_em_atr' | 'volume_relativo_20';
export type OperadorDaTela = Comparacao['operador'];

type Unidade = 'reais' | 'percentual' | 'quantidade' | 'numero' | 'vezes';
export const CAMPOS: { valor: CampoDaTela; nome: string; unidade: Unidade; grupo: 'preco' | 'indicador'; dica?: string }[] = [
  { valor: 'ultimo', nome: 'Último preço', unidade: 'reais', grupo: 'preco' },
  { valor: 'bid', nome: 'Melhor oferta de compra', unidade: 'reais', grupo: 'preco' },
  { valor: 'ask', nome: 'Melhor oferta de venda', unidade: 'reais', grupo: 'preco' },
  { valor: 'variacao_dia_pct', nome: 'Variação do dia (%)', unidade: 'percentual', grupo: 'preco' },
  { valor: 'volume', nome: 'Volume do dia', unidade: 'quantidade', grupo: 'preco' },
  { valor: 'dist_maxima_20_pct', nome: 'Distância da máxima de 20 pregões (%)', unidade: 'percentual', grupo: 'indicador', dica: 'Cruzar para cima de 0 = romper a máxima dos últimos 20 pregões.' },
  { valor: 'dist_minima_20_pct', nome: 'Distância da mínima de 20 pregões (%)', unidade: 'percentual', grupo: 'indicador', dica: 'Cruzar para baixo de 0 = perder a mínima dos últimos 20 pregões.' },
  { valor: 'dist_media_20_pct', nome: 'Distância da média de 20 dias (%)', unidade: 'percentual', grupo: 'indicador', dica: 'Cruzar para cima de 0 = o preço passar para cima da média.' },
  { valor: 'dist_media_50_pct', nome: 'Distância da média de 50 dias (%)', unidade: 'percentual', grupo: 'indicador', dica: 'Cruzar para cima de 0 = o preço passar para cima da média.' },
  { valor: 'dist_media_200_pct', nome: 'Distância da média de 200 dias (%)', unidade: 'percentual', grupo: 'indicador', dica: 'Cruzar para cima de 0 = o preço passar para cima da média.' },
  { valor: 'rsi_14', nome: 'RSI de 14 dias', unidade: 'numero', grupo: 'indicador', dica: 'De 0 a 100. Abaixo de 30 costuma ser lido como sobrevendido; acima de 70, sobrecomprado.' },
  { valor: 'variacao_em_atr', nome: 'Movimento do dia em ATRs', unidade: 'numero', grupo: 'indicador', dica: 'Quanto o preço andou desde o fechamento de ontem, em múltiplos do ATR de 14 dias.' },
  { valor: 'volume_relativo_20', nome: 'Volume em relação à média de 20 pregões', unidade: 'vezes', grupo: 'indicador', dica: '2 = o dobro do volume médio.' },
];

export const OPERADORES: { valor: OperadorDaTela; nome: string }[] = [
  { valor: 'cruza_acima', nome: 'cruzar para cima de' },
  { valor: 'cruza_abaixo', nome: 'cruzar para baixo de' },
  { valor: '>', nome: 'ficar acima de' },
  { valor: '<', nome: 'ficar abaixo de' },
  { valor: '>=', nome: 'ficar igual ou acima de' },
  { valor: '<=', nome: 'ficar igual ou abaixo de' },
  { valor: 'dentro', nome: 'ficar entre' },
  { valor: 'fora', nome: 'sair da faixa entre' },
];

export type LinhaDaCondicao = { campo: CampoDaTela; operador: OperadorDaTela; valor: string; valor2: string };
export type FormularioDaRegra = {
  nome: string;
  codigo: string;
  juncao: 'e' | 'ou';
  linhas: LinhaDaCondicao[];
  rearme: 'uma_vez' | 'ao_desfazer' | 'intervalo';
  minutos: string;
  limitePorDia: string;
  aceitarPeriodica: boolean;
  usarJanela: boolean;
  janelaInicio: string;
  janelaFim: string;
};

export const FORMULARIO_VAZIO: FormularioDaRegra = {
  nome: '', codigo: '', juncao: 'e', linhas: [{ campo: 'ultimo', operador: 'cruza_acima', valor: '', valor2: '' }],
  rearme: 'ao_desfazer', minutos: '30', limitePorDia: '5', aceitarPeriodica: true, usarJanela: false, janelaInicio: '10:15', janelaFim: '16:55',
};

const unidade = (campo: CampoDaTela) => CAMPOS.find((c) => c.valor === campo)?.unidade ?? 'quantidade';

// "38,50", "38.5", "1.234,56" -> número; vazio ou inválido -> null.
export function lerNumero(texto: string): number | null {
  let t = texto.trim().replace(/\s|R\$|%/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function valorParaRegra(campo: CampoDaTela, texto: string): number | null {
  const n = lerNumero(texto);
  if (n === null) return null;
  if (unidade(campo) === 'reais') return Math.round(n * 100);
  return n;
}

function valorParaTela(campo: CampoDaTela, v: number): string {
  if (unidade(campo) === 'reais') return (v / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 4, useGrouping: false });
}

export type RegraParaApi = {
  nome: string; codigo: string; condicao: Condicao; rearme: PoliticaDeRearme; limitePorDia: number; aceitarPeriodica: boolean;
  janela: { inicio: string; fim: string } | null;
};

export function regraDoFormulario(f: FormularioDaRegra): { ok: true; regra: RegraParaApi } | { ok: false; erro: string } {
  const nome = f.nome.trim();
  if (!nome) return { ok: false, erro: 'Dê um nome à regra.' };
  const codigo = f.codigo.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(codigo)) return { ok: false, erro: 'Escreva o código do ativo, como PETR4 ou BOVA11.' };
  if (f.linhas.length === 0) return { ok: false, erro: 'Inclua pelo menos uma condição.' };
  const comparacoes: Comparacao[] = [];
  for (const [i, l] of f.linhas.entries()) {
    const valor = valorParaRegra(l.campo, l.valor);
    if (valor === null) return { ok: false, erro: `Condição ${i + 1}: preencha o valor.` };
    const c: Comparacao = { tipo: 'comparacao', campo: l.campo, operador: l.operador, valor };
    if (l.operador === 'dentro' || l.operador === 'fora') {
      const v2 = valorParaRegra(l.campo, l.valor2);
      if (v2 === null || v2 <= valor) return { ok: false, erro: `Condição ${i + 1}: o segundo valor precisa ser maior que o primeiro.` };
      c.valor2 = v2;
    }
    comparacoes.push(c);
  }
  const condicao: Condicao = comparacoes.length === 1 ? (comparacoes[0] as Comparacao) : { tipo: f.juncao, filhos: comparacoes };
  let rearme: PoliticaDeRearme;
  if (f.rearme === 'intervalo') {
    const m = Number(f.minutos);
    if (!Number.isInteger(m) || m < 1 || m > 1440) return { ok: false, erro: 'O intervalo precisa ser de 1 a 1440 minutos.' };
    rearme = { tipo: 'intervalo', minutos: m };
  } else rearme = { tipo: f.rearme };
  const limite = Number(f.limitePorDia);
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) return { ok: false, erro: 'O limite por dia precisa ser de 1 a 50 avisos.' };
  if (f.usarJanela && !(f.janelaInicio < f.janelaFim)) return { ok: false, erro: 'O horário final precisa ser depois do inicial.' };
  return {
    ok: true,
    regra: { nome, codigo, condicao, rearme, limitePorDia: limite, aceitarPeriodica: f.aceitarPeriodica, janela: f.usarJanela ? { inicio: f.janelaInicio, fim: f.janelaFim } : null },
  };
}

// Regra da api -> formulário (as regras desta tela têm no máximo um grupo E/OU).
export function formularioDaRegra(r: RegraParaApi): FormularioDaRegra | null {
  const filhos = r.condicao.tipo === 'comparacao' ? [r.condicao] : r.condicao.filhos;
  if (filhos.some((c) => c.tipo !== 'comparacao')) return null;
  const linhas = (filhos as Comparacao[]).map((c) => ({
    campo: c.campo as CampoDaTela, operador: c.operador, valor: valorParaTela(c.campo as CampoDaTela, c.valor),
    valor2: c.valor2 === undefined ? '' : valorParaTela(c.campo as CampoDaTela, c.valor2),
  }));
  return {
    nome: r.nome, codigo: r.codigo, juncao: r.condicao.tipo === 'ou' ? 'ou' : 'e', linhas,
    rearme: r.rearme.tipo, minutos: r.rearme.tipo === 'intervalo' ? String(r.rearme.minutos) : '30',
    limitePorDia: String(r.limitePorDia), aceitarPeriodica: r.aceitarPeriodica,
    usarJanela: r.janela !== null, janelaInicio: r.janela?.inicio ?? '10:15', janelaFim: r.janela?.fim ?? '16:55',
  };
}

export const SITUACAO_DO_AVISO: Record<string, { texto: string; classe: string }> = {
  enviado: { texto: 'Enviado no Telegram', classe: 'selo-alta' },
  pendente: { texto: 'Aguardando envio', classe: 'selo-periodica' },
  silenciado: { texto: 'Em silêncio', classe: 'selo-neutro' },
  sem_destino: { texto: 'Telegram não ligado', classe: 'selo-atencao' },
  falhou: { texto: 'Não enviado', classe: 'selo-baixa' },
};

export const TEXTO_DA_QUALIDADE: Record<string, string> = {
  tempo_real: 'tempo real', periodica: 'atualização periódica', historico: 'fechamento', atrasada: 'atrasado',
};
