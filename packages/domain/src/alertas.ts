// Núcleo do motor de alertas: avaliação pura, sem banco nem rede.
// O serviço chama `avaliar` a cada observação nova e grava o estado devolvido na
// mesma transação que grava o evento e a notificação (outbox). Como a função é
// determinística e o estado guarda o instante da última observação, reprocessar
// a mesma observação depois de uma reinicialização não gera disparo repetido.
//
// Garantias:
// - observação mais antiga ou igual à última já vista é ignorada (fora de ordem);
// - dado com qualidade insuficiente não dispara e QUEBRA a continuidade: um
//   cruzamento só vale entre duas observações boas e consecutivas;
// - depois de disparar, a regra fica desarmada até a política de rearme permitir:
//   o preço continuar acima do nível não gera alerta a cada minuto;
// - há limite de disparos por dia (proteção contra tempestade de notificações).

import { qualidadeAceitaParaAlerta, type Qualidade } from './cotacoes.ts';

export type Campo = 'ultimo' | 'bid' | 'ask' | 'volume' | 'variacao_dia_pct' | string;

export type Comparacao = {
  tipo: 'comparacao';
  campo: Campo;
  operador: '>' | '>=' | '<' | '<=' | 'igual' | 'cruza_acima' | 'cruza_abaixo' | 'dentro' | 'fora';
  valor: number;
  valor2?: number; // limite superior para 'dentro' e 'fora'
  tolerancia?: number; // para 'igual'
};

export type Grupo = { tipo: 'e' | 'ou'; filhos: Condicao[] };
export type Condicao = Comparacao | Grupo;

export type PoliticaDeRearme =
  | { tipo: 'uma_vez' } // dispara uma vez e a regra para
  | { tipo: 'ao_desfazer'; histerese?: number } // rearma quando a condição deixa de valer (com folga opcional, em unidades do campo)
  | { tipo: 'intervalo'; minutos: number }; // rearma depois de N minutos, se ainda valer

export type Regra = {
  id: string;
  versao: number;
  condicao: Condicao;
  rearme: PoliticaDeRearme;
  limitePorDia: number;
  aceitarAtualizacaoPeriodica: boolean; // false = só dispara com dado de tempo real
  janela?: { inicio: string; fim: string }; // "10:15" a "16:55", horário de Brasília
};

export type Observacao = {
  instante: string; // instante da FONTE (ISO 8601)
  qualidade: Qualidade;
  valores: Partial<Record<Campo, number | null>>;
};

export type EstadoDaRegra = {
  ultimoInstante: string | null;
  anteriores: Partial<Record<Campo, number>>; // última observação boa (base dos cruzamentos)
  armada: boolean;
  encerrada: boolean;
  disparos: number; // contador total: compõe a chave de deduplicação
  disparosNoDia: { dia: string; quantidade: number };
  ultimoDisparo: string | null;
};

export const ESTADO_INICIAL: EstadoDaRegra = Object.freeze({
  ultimoInstante: null,
  anteriores: {},
  armada: true,
  encerrada: false,
  disparos: 0,
  disparosNoDia: { dia: '', quantidade: 0 },
  ultimoDisparo: null,
}) as EstadoDaRegra;

export type MotivoIgnorado =
  | 'fora_de_ordem'
  | 'qualidade_insuficiente'
  | 'regra_encerrada'
  | 'fora_da_janela'
  | 'limite_diario'
  | 'desarmada'
  | 'sem_dado';

export type Disparo = {
  chave: string; // única por regra+versão+disparo: o outbox usa como chave de idempotência
  instante: string;
  valores: Partial<Record<Campo, number | null>>;
  qualidade: Qualidade;
};

export type Avaliacao = {
  estado: EstadoDaRegra;
  condicaoAtendida: boolean | null; // null = não avaliada
  disparo: Disparo | null;
  ignorado: MotivoIgnorado | null;
};

const fmtBrasilia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function partesEmBrasilia(instante: Date): { dia: string; hora: string } {
  const p: Record<string, string> = {};
  for (const x of fmtBrasilia.formatToParts(instante)) p[x.type] = x.value;
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

function camposDe(c: Condicao, acc = new Set<Campo>()): Set<Campo> {
  if (c.tipo === 'comparacao') acc.add(c.campo);
  else for (const f of c.filhos) camposDe(f, acc);
  return acc;
}

function avaliarCondicao(c: Condicao, atual: Observacao['valores'], anterior: EstadoDaRegra['anteriores']): boolean | null {
  if (c.tipo !== 'comparacao') {
    if (c.filhos.length === 0) return null;
    const r = c.filhos.map((f) => avaliarCondicao(f, atual, anterior));
    if (c.tipo === 'e') return r.includes(false) ? false : r.includes(null) ? null : true;
    return r.includes(true) ? true : r.includes(null) ? null : false;
  }
  const v = atual[c.campo];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const a = anterior[c.campo];
  switch (c.operador) {
    case '>': return v > c.valor;
    case '>=': return v >= c.valor;
    case '<': return v < c.valor;
    case '<=': return v <= c.valor;
    case 'igual': return Math.abs(v - c.valor) <= (c.tolerancia ?? 0);
    case 'cruza_acima': return a === undefined ? false : a < c.valor && v >= c.valor;
    case 'cruza_abaixo': return a === undefined ? false : a > c.valor && v <= c.valor;
    case 'dentro': return c.valor2 !== undefined && v >= c.valor && v <= c.valor2;
    case 'fora': return c.valor2 !== undefined && (v < c.valor || v > c.valor2);
  }
  return null;
}

// Para o rearme "ao desfazer" com histerese: a condição precisa ficar falsa com folga.
function desfeitaComFolga(c: Condicao, atual: Observacao['valores'], folga: number): boolean {
  if (c.tipo !== 'comparacao') {
    return c.tipo === 'e' ? c.filhos.some((f) => desfeitaComFolga(f, atual, folga)) : c.filhos.every((f) => desfeitaComFolga(f, atual, folga));
  }
  const v = atual[c.campo];
  if (v === null || v === undefined) return false;
  switch (c.operador) {
    case '>': case '>=': case 'cruza_acima': return v < c.valor - folga;
    case '<': case '<=': case 'cruza_abaixo': return v > c.valor + folga;
    case 'igual': return Math.abs(v - c.valor) > (c.tolerancia ?? 0) + folga;
    case 'dentro': return c.valor2 !== undefined && (v < c.valor - folga || v > c.valor2 + folga);
    case 'fora': return c.valor2 !== undefined && v >= c.valor + folga && v <= c.valor2 - folga;
  }
  return false;
}

export function validarRegra(r: Regra): string[] {
  const erros: string[] = [];
  const visitar = (c: Condicao) => {
    if (c.tipo !== 'comparacao') {
      if (c.filhos.length === 0) erros.push('grupo_vazio');
      c.filhos.forEach(visitar);
      return;
    }
    if (!Number.isFinite(c.valor)) erros.push('valor_invalido');
    if ((c.operador === 'dentro' || c.operador === 'fora') && (c.valor2 === undefined || !(c.valor2 > c.valor))) erros.push('faixa_invalida');
    if (c.tolerancia !== undefined && !(c.tolerancia >= 0)) erros.push('tolerancia_invalida');
  };
  visitar(r.condicao);
  if (!Number.isInteger(r.limitePorDia) || r.limitePorDia < 1) erros.push('limite_por_dia_invalido');
  if (r.rearme.tipo === 'intervalo' && !(Number.isInteger(r.rearme.minutos) && r.rearme.minutos >= 1)) erros.push('intervalo_invalido');
  if (r.janela && !(/^\d{2}:\d{2}$/.test(r.janela.inicio) && /^\d{2}:\d{2}$/.test(r.janela.fim) && r.janela.inicio < r.janela.fim)) erros.push('janela_invalida');
  return erros;
}

export function avaliar(regra: Regra, estadoAtual: EstadoDaRegra, obs: Observacao): Avaliacao {
  const sem = (estado: EstadoDaRegra, ignorado: MotivoIgnorado, condicaoAtendida: boolean | null = null): Avaliacao =>
    ({ estado, condicaoAtendida, disparo: null, ignorado });

  if (estadoAtual.encerrada) return sem(estadoAtual, 'regra_encerrada');
  const t = Date.parse(obs.instante);
  if (Number.isNaN(t)) return sem(estadoAtual, 'sem_dado');
  if (estadoAtual.ultimoInstante !== null && t <= Date.parse(estadoAtual.ultimoInstante)) return sem(estadoAtual, 'fora_de_ordem');

  // Daqui em diante a observação é nova: o instante avança mesmo se ela for descartada.
  const base: EstadoDaRegra = { ...estadoAtual, ultimoInstante: obs.instante, anteriores: { ...estadoAtual.anteriores } };

  if (!qualidadeAceitaParaAlerta(obs.qualidade, regra.aceitarAtualizacaoPeriodica)) {
    return sem({ ...base, anteriores: {} }, 'qualidade_insuficiente'); // quebra a continuidade
  }

  const atendida = avaliarCondicao(regra.condicao, obs.valores, estadoAtual.anteriores);
  // Guarda os valores bons desta observação como base do próximo cruzamento.
  for (const campo of camposDe(regra.condicao)) {
    const v = obs.valores[campo];
    if (v !== null && v !== undefined && Number.isFinite(v)) base.anteriores[campo] = v;
    else delete base.anteriores[campo];
  }
  if (atendida === null) return sem(base, 'sem_dado');

  // Rearme.
  if (!base.armada) {
    if (regra.rearme.tipo === 'ao_desfazer') {
      if (desfeitaComFolga(regra.condicao, obs.valores, regra.rearme.histerese ?? 0) || (!atendida && !regra.rearme.histerese)) base.armada = true;
    } else if (regra.rearme.tipo === 'intervalo' && base.ultimoDisparo) {
      if (t - Date.parse(base.ultimoDisparo) >= regra.rearme.minutos * 60_000) base.armada = true;
    }
  }

  if (!atendida) return { estado: base, condicaoAtendida: false, disparo: null, ignorado: null };

  if (!base.armada) return sem(base, 'desarmada', true);

  const { dia, hora } = partesEmBrasilia(new Date(t));
  if (regra.janela && (hora < regra.janela.inicio || hora > regra.janela.fim)) return sem(base, 'fora_da_janela', true);
  const noDia = base.disparosNoDia.dia === dia ? base.disparosNoDia.quantidade : 0;
  if (noDia >= regra.limitePorDia) return sem(base, 'limite_diario', true);

  const disparos = base.disparos + 1;
  const estado: EstadoDaRegra = {
    ...base,
    armada: false,
    encerrada: regra.rearme.tipo === 'uma_vez',
    disparos,
    disparosNoDia: { dia, quantidade: noDia + 1 },
    ultimoDisparo: obs.instante,
  };
  return {
    estado,
    condicaoAtendida: true,
    disparo: { chave: `${regra.id}:v${regra.versao}:${disparos}`, instante: obs.instante, valores: obs.valores, qualidade: obs.qualidade },
    ignorado: null,
  };
}
