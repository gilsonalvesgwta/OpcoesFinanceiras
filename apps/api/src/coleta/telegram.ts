// Telegram: envio dos avisos (outbox) e comandos do bot. Roda no worker com o papel
// wtaopt_coleta, que não lê as tabelas de avisos e vínculos: usa só as funções
// app.avisos_para_enviar, app.marcar_aviso, app.vincular_telegram e app.comando_telegram.
//
// Comandos: /start CODIGO (vincula), /silencio [30m|2h] (padrão 1 hora), /ativar,
// /status, /sair (desvincula). Só conversas privadas.

import { createHash } from 'node:crypto';
import { emTransacao, type Pool } from '../banco.ts';
import type { Buscar } from './coleta.ts';

export type RespostaTelegram = { ok: boolean; status: number; corpo: { ok?: boolean; result?: unknown; description?: string; parameters?: { retry_after?: number } } };
export type Telegram = { chamar(metodo: string, corpo: Record<string, unknown>, tempoMs?: number): Promise<RespostaTelegram> };

export function telegramReal(token: string, buscar: Buscar): Telegram {
  return {
    async chamar(metodo, corpo, tempoMs = 15_000) {
      const r = await buscar(`https://api.telegram.org/bot${token}/${metodo}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(tempoMs),
      });
      let j: RespostaTelegram['corpo'] = {};
      try { j = (await r.json()) as RespostaTelegram['corpo']; } catch { /* corpo vazio */ }
      return { ok: r.ok && j.ok === true, status: r.status, corpo: j };
    },
  };
}

const AVISO_VENCIDO_MIN = 30; // alerta de preço velho não serve: não envia
const MAXIMO_DE_TENTATIVAS = 5;

export type ResultadoDoEnvio = Record<'enviado' | 'falhou' | 'sem_destino' | 'silenciado' | 'adiado', number>;

export async function enviarAvisos(pool: Pool, tg: Telegram, agora: () => Date = () => new Date()): Promise<ResultadoDoEnvio> {
  const res: ResultadoDoEnvio = { enviado: 0, falhou: 0, sem_destino: 0, silenciado: 0, adiado: 0 };
  const lista = (await emTransacao(pool, null, (c) => c.query<{ id: string; chat_id: string | null; texto: string; silenciado: boolean; tentativas: number; criado_em: Date }>(
    'select * from app.avisos_para_enviar(20)',
  ))).rows;
  const marcar = (id: string, situacao: string, erro: string | null = null, tentarEmSeg: number | null = null) =>
    emTransacao(pool, null, (c) => c.query('select app.marcar_aviso($1, $2, $3, $4::interval)', [id, situacao, erro, tentarEmSeg === null ? null : `${tentarEmSeg} seconds`]));
  for (const a of lista) {
    if (agora().getTime() - new Date(a.criado_em).getTime() > AVISO_VENCIDO_MIN * 60_000) { await marcar(a.id, 'falhou', 'vencido: mais de 30 minutos sem conseguir enviar'); res.falhou += 1; continue; }
    if (!a.chat_id) { await marcar(a.id, 'sem_destino', 'Telegram não vinculado'); res.sem_destino += 1; continue; }
    if (a.silenciado) { await marcar(a.id, 'silenciado'); res.silenciado += 1; continue; }
    let r: RespostaTelegram;
    try {
      r = await tg.chamar('sendMessage', { chat_id: Number(a.chat_id), text: a.texto, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
      r = { ok: false, status: 0, corpo: { description: e instanceof Error ? e.message : String(e) } };
    }
    if (r.ok) { await marcar(a.id, 'enviado'); res.enviado += 1; continue; }
    const transitorio = r.status === 0 || r.status === 429 || r.status >= 500;
    if (transitorio && a.tentativas < MAXIMO_DE_TENTATIVAS) {
      await marcar(a.id, 'pendente', r.corpo.description ?? `http_${r.status}`, r.corpo.parameters?.retry_after ?? 15 * a.tentativas);
      res.adiado += 1;
    } else {
      // 403: a pessoa bloqueou o bot; 400: chat inválido. Não adianta insistir.
      await marcar(a.id, 'falhou', r.corpo.description ?? `http_${r.status}`);
      res.falhou += 1;
    }
  }
  return res;
}

export function hashDoCodigo(codigo: string): Buffer {
  return createHash('sha256').update(codigo.trim().toUpperCase(), 'utf8').digest();
}

// "30m", "2h", "90" (minutos). Sem argumento: 60 minutos.
export function minutosDoSilencio(arg: string | undefined): number | null {
  if (!arg) return 60;
  const m = /^(\d{1,4})\s*(m|min|h|d)?$/i.exec(arg.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const un = (m[2] ?? 'm').toLowerCase();
  const total = un === 'h' ? n * 60 : un === 'd' ? n * 1440 : n;
  return total >= 1 && total <= 10_080 ? total : null;
}

const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const AJUDA = [
  'Comandos:',
  '/silencio — pausa os avisos por 1 hora (ou /silencio 30m, /silencio 2h)',
  '/ativar — volta a avisar',
  '/status — mostra se está ligado',
  '/sair — desliga este chat da sua conta',
].join('\n');

type Mensagem = { message?: { chat?: { id?: number; type?: string }; text?: string; from?: { first_name?: string; username?: string } }; update_id: number };

export async function processarAtualizacoes(pool: Pool, tg: Telegram, esperaSeg = 20): Promise<number> {
  const offset = (await emTransacao(pool, null, (c) => c.query<{ valor: string }>("select valor from controle_telegram where chave = 'offset'"))).rows[0]?.valor;
  const r = await tg.chamar('getUpdates', { offset: offset ? Number(offset) : undefined, timeout: esperaSeg, allowed_updates: ['message'] }, (esperaSeg + 10) * 1000);
  if (!r.ok || !Array.isArray(r.corpo.result)) throw new Error(`getUpdates: ${r.corpo.description ?? `http_${r.status}`}`);
  const atualizacoes = r.corpo.result as Mensagem[];
  for (const u of atualizacoes) {
    const chat = u.message?.chat;
    const texto = u.message?.text?.trim() ?? '';
    if (chat?.id && chat.type === 'private' && texto.startsWith('/')) {
      const resposta = await responder(pool, chat.id, texto, u.message?.from?.username ?? u.message?.from?.first_name ?? '');
      await tg.chamar('sendMessage', { chat_id: chat.id, text: resposta, disable_web_page_preview: true }).catch(() => undefined);
    }
    // Avança a posição a cada mensagem: reiniciar o worker não repete comandos.
    await emTransacao(pool, null, (c) => c.query(
      "insert into controle_telegram (chave, valor) values ('offset', $1) on conflict (chave) do update set valor = excluded.valor", [u.update_id + 1],
    ));
  }
  return atualizacoes.length;
}

async function responder(pool: Pool, chatId: number, texto: string, nome: string): Promise<string> {
  const [comandoBruto, arg] = texto.split(/\s+/, 2);
  const comando = (comandoBruto ?? '').split('@')[0]?.toLowerCase();
  if (comando === '/start') {
    if (!arg) return 'Olá! Para ligar este chat à sua conta do WTA Options, gere um código em Preferências › Telegram e envie aqui: /start CODIGO';
    const ok = (await emTransacao(pool, null, (c) => c.query<{ ok: boolean }>('select app.vincular_telegram($1, $2, $3) as ok', [hashDoCodigo(arg), chatId, nome]))).rows[0]?.ok;
    return ok
      ? `Pronto! Este chat vai receber os seus alertas do WTA Options.\n\n${AJUDA}`
      : 'Código inválido ou vencido. Gere outro em Preferências › Telegram (vale por 15 minutos).';
  }
  const executar = async (acao: string, minutos: number | null = null) =>
    (await emTransacao(pool, null, (c) => c.query<{ ok: boolean; silencio_ate: Date | null; regras_ativas: string }>(
      'select * from app.comando_telegram($1, $2, $3)', [chatId, acao, minutos],
    ))).rows[0];
  const naoVinculado = 'Este chat não está ligado a nenhuma conta. Gere um código em Preferências › Telegram e envie /start CODIGO.';
  if (comando === '/silencio') {
    const min = minutosDoSilencio(arg);
    if (min === null) return 'Não entendi o tempo. Exemplos: /silencio 30m, /silencio 2h.';
    const r = await executar('silenciar', min);
    if (!r?.ok) return naoVinculado;
    return `Alertas em silêncio até ${hora.format(new Date(r.silencio_ate as Date))}. Para voltar antes: /ativar`;
  }
  if (comando === '/ativar') {
    const r = await executar('ativar');
    return r?.ok ? 'Alertas ligados de novo.' : naoVinculado;
  }
  if (comando === '/status') {
    const r = await executar('status');
    if (!r?.ok) return naoVinculado;
    const silencio = r.silencio_ate && new Date(r.silencio_ate) > new Date() ? `Em silêncio até ${hora.format(new Date(r.silencio_ate))}.` : 'Avisando normalmente.';
    return `Chat ligado à sua conta. ${silencio} Regras ativas: ${r.regras_ativas}.`;
  }
  if (comando === '/sair') {
    const r = await executar('desvincular');
    return r?.ok ? 'Este chat foi desligado da sua conta. Não vai receber mais alertas.' : naoVinculado;
  }
  return AJUDA;
}
