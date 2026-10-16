// Configuração lida do ambiente, validada na partida: variável errada derruba o
// processo com mensagem clara, em vez de rodar com valor padrão perigoso.

export type Config = {
  producao: boolean;
  porta: number;
  bancoUrl: string;
  urlPublica: string; // https://opcoes.wtatech.com.br — base dos links de convite e recuperação
  cookie: { nome: string; seguro: boolean };
  sessao: { idadeMaxima: string; inatividade: string }; // intervalos do PostgreSQL
  convite: { validade: string };
  recuperacao: { validade: string };
  superadmin: { email: string; senhaInicial: string } | null;
};

function obrigatoria(env: NodeJS.ProcessEnv, nome: string): string {
  const v = env[nome]?.trim();
  if (!v) throw new Error(`variável ${nome} não definida`);
  return v;
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const producao = env.NODE_ENV === 'production';
  const urlPublica = obrigatoria(env, 'URL_PUBLICA').replace(/\/+$/, '');
  if (producao && !urlPublica.startsWith('https://')) throw new Error('URL_PUBLICA precisa ser https em produção');
  const porta = Number(env.PORTA ?? '3001');
  if (!Number.isInteger(porta) || porta <= 0) throw new Error('PORTA inválida');
  const email = env.SUPERADMIN_EMAIL?.trim();
  const senha = env.SUPERADMIN_SENHA_INICIAL ?? '';
  if (email && senha.length < 12) throw new Error('SUPERADMIN_SENHA_INICIAL precisa de 12 caracteres ou mais');
  const seguro = producao || urlPublica.startsWith('https://');
  return {
    producao,
    porta,
    bancoUrl: obrigatoria(env, 'DATABASE_URL'),
    urlPublica,
    // O prefixo __Host- obriga o navegador a só aceitar o cookie em https, no próprio domínio.
    cookie: { nome: seguro ? '__Host-wtaopt_sessao' : 'wtaopt_sessao', seguro },
    sessao: { idadeMaxima: env.SESSAO_IDADE_MAXIMA ?? '30 days', inatividade: env.SESSAO_INATIVIDADE ?? '12 hours' },
    convite: { validade: '7 days' },
    recuperacao: { validade: '30 minutes' },
    superadmin: email ? { email, senhaInicial: senha } : null,
  };
}
