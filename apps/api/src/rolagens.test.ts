// Testes das rolagens de ponta a ponta: simular e comparar alternativas, sugestões por
// critérios, confirmar (execuções ligadas à rolagem), desfazer e isolamento.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { construirApp } from './app.ts';
import { criarPool } from './banco.ts';
import type { Config } from './config.ts';
import { CorreioDeTeste } from './correio.ts';
import { gerarHashDeSenha } from './seguranca.ts';

const URL_APP = process.env.DATABASE_URL;
const URL_DONO = process.env.DATABASE_URL_DONO;
const pular = !URL_APP || !URL_DONO;
if (pular && process.env.EXIGIR_BANCO === '1') throw new Error('EXIGIR_BANCO=1, mas faltam as URLs do banco');

describe('rolagens de ponta a ponta', { skip: pular ? 'sem as URLs do banco' : false }, () => {
  let app: FastifyInstance;
  let dono: pg.Pool;
  const pool = pular ? (null as unknown as pg.Pool) : criarPool(URL_APP as string);
  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha forte de teste 1';
  const agora = new Date('2026-10-16T17:00:00Z'); // sexta, 14:00 em Brasília
  const config: Config = {
    producao: false, porta: 0, bancoUrl: URL_APP ?? '', urlPublica: 'https://opcoes.exemplo.test',
    cookie: { nome: 'wtaopt_sessao', seguro: false }, sessao: { idadeMaxima: '30 days', inatividade: '12 hours' },
    convite: { validade: '7 days' }, recuperacao: { validade: '30 minutes' }, superadmin: null,
  };
  const sessoes: Record<string, { cookie: string; csrf: string }> = {};
  let estrategiaId = '';

  async function pedir(quem: string, metodo: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
    const s = sessoes[quem];
    const headers: Record<string, string> = s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {};
    const r = await app.inject({ method: metodo, url, headers, remoteAddress: '203.0.113.92', ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, corpo: r.json() };
  }
  const estrategia = async (quem = 'ana') => (await pedir(quem, 'GET', '/api/posicoes')).corpo.estrategias.find((x: { id: string }) => x.id === estrategiaId);

  before(async () => {
    dono = new pg.Pool({ connectionString: URL_DONO });
    const hash = await gerarHashDeSenha(SENHA);
    const org = (await dono.query('insert into organizations (nome) values ($1) returning id', [`Rolagens ${sufixo}`])).rows[0].id;
    for (const quem of ['ana', 'beto']) {
      await dono.query("insert into users (organization_id, email, nome, papel, senha_hash) values ($1, $2, $3, 'usuario', $4)", [org, `${quem}.rolagens.${sufixo}@exemplo.test`, quem, hash]);
    }
    // Ativo fictício ROLA3 e suas calls no fechamento da B3 de 15/10.
    await dono.query(
      `insert into fechamentos (dia, codigo, tipo_mercado, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume) values
         ('2026-10-15', 'ROLA3', 10, 3950, 3949, 3951, 1000, 100000, 395000000),
         ('2026-10-15', 'ROLAK400', 70, 125, 120, 130, 80, 8000, 1000000),
         ('2026-10-15', 'ROLAL400', 70, 185, 180, 190, 60, 6000, 1100000),
         ('2026-10-15', 'ROLAL420', 70, 100, 95, 105, 40, 4000, 400000),
         ('2026-10-15', 'ROLAL440', 70, 50, null, null, 2, 200, 10000)
       on conflict do nothing`,
    );
    await dono.query(
      `insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
         ('ROLAK400', '2026-11-23', 'ROLA3', 'call', 4000, '2026-10-15', '2026-10-15'),
         ('ROLAL400', '2026-12-18', 'ROLA3', 'call', 4000, '2026-10-15', '2026-10-15'),
         ('ROLAL420', '2026-12-18', 'ROLA3', 'call', 4200, '2026-10-15', '2026-10-15'),
         ('ROLAL440', '2026-12-18', 'ROLA3', 'call', 4400, '2026-10-15', '2026-10-15')
       on conflict do nothing`,
    );
    await dono.query(
      `insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, vol_implicita, delta) values
         ('2026-10-15', 'ROLAL420', '2026-12-18', 'ROLA3', 0.3, 0.35)
       on conflict do nothing`,
    );
    app = await construirApp({ config, pool, correio: new CorreioDeTeste(), relogio: () => agora });
    for (const quem of ['ana', 'beto']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', remoteAddress: '203.0.113.92', payload: { email: `${quem}.rolagens.${sufixo}@exemplo.test`, senha: SENHA } });
      assert.equal(r.statusCode, 200, r.body);
      sessoes[quem] = { cookie: `wtaopt_sessao=${r.cookies.find((c) => c.name === 'wtaopt_sessao')?.value}`, csrf: r.json().csrf };
    }
    // Venda coberta: 100 ROLA3 a 38,00 e 100 calls 40,00 de novembro vendidas a 0,80.
    const r = await pedir('ana', 'POST', '/api/posicoes', {
      nome: 'Venda coberta ROLA3', ativoObjeto: 'ROLA3',
      execucoes: [
        { codigo: 'ROLA3', tipo: 'ativo', lado: 'compra', quantidade: 100, preco: 3800, instante: '2026-10-01T11:00:00-03:00' },
        { codigo: 'ROLAK400', tipo: 'call', strike: 4000, vencimento: '2026-11-23', lado: 'venda', quantidade: 100, preco: 80, instante: '2026-10-01T11:01:00-03:00' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    estrategiaId = r.corpo.id;
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await dono?.end();
  });

  test('simula e compara alternativas, na ordem em que vieram', async () => {
    const r = await pedir('ana', 'POST', '/api/rolagens/simular', {
      estrategiaId,
      alternativas: [
        { nome: 'Dezembro, mesmo strike', encerrar: [{ codigo: 'ROLAK400', quantidade: 100 }], abrir: [{ codigo: 'rolal400', lado: 'venda', quantidade: 100 }] },
        { nome: 'Dezembro, para cima', encerrar: [{ codigo: 'ROLAK400', quantidade: 100 }], abrir: [{ codigo: 'ROLAL420', lado: 'venda', quantidade: 100 }] },
        { nome: 'Errada', encerrar: [{ codigo: 'ROLAX999', quantidade: 100 }], abrir: [] },
        { nome: 'Sem preço', encerrar: [], abrir: [{ codigo: 'ROLAL999', tipo: 'call', strike: 4600, vencimento: '2026-12-18', lado: 'venda', quantidade: 100 }] },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const [a, b, c, d] = r.corpo.alternativas;
    assert.deepEqual(r.corpo.alternativas.map((x: { nome: string }) => x.nome), ['Dezembro, mesmo strike', 'Dezembro, para cima', 'Errada', 'Sem preço']);
    // Recompra pelo melhor vendedor (1,30) e venda nova pelo melhor comprador (1,80).
    assert.deepEqual(a.precos.map((p: Record<string, unknown>) => [p.codigo, p.acao, p.lado, p.preco, p.origem, p.qualidade]),
      [['ROLAK400', 'encerrar', 'compra', 130, 'ask', 'historico'], ['ROLAL400', 'abrir', 'venda', 180, 'bid', 'historico']]);
    assert.deepEqual(a.fluxo, { encerramento: -13000, abertura: 18000, custos: 0, liquido: 5000, natureza: 'credito' });
    assert.equal(a.realizadoNoEncerramento, -5000, 'vendeu a 0,80 e recomprou a 1,30');
    assert.deepEqual(a.payoff.antes.pontosDeEquilibrio, [37.2]);
    assert.deepEqual(a.payoff.depois.pontosDeEquilibrio, [36.7]);
    assert.deepEqual(a.payoff.depois.lucroMaximo, { tipo: 'limitado', valor: 33000, emPreco: 4000 });
    assert.deepEqual(a.avisos.map((x: { codigo: string }) => x.codigo).sort(), ['credito_nao_e_lucro', 'prazo_prolongado']);
    assert.match(a.avisos.find((x: { codigo: string }) => x.codigo === 'credito_nao_e_lucro').texto, /não é lucro/);
    assert.equal(a.curvas.antes.length, a.curvas.depois.length, 'antes e depois na mesma faixa');
    assert.deepEqual(a.ultimoVencimento, { antes: '2026-11-23', depois: '2026-12-18' });
    assert.deepEqual([b.fluxo.liquido, b.fluxo.natureza], [-3500, 'debito']);
    assert.deepEqual([c.ok, c.erro, c.codigo], [false, 'nada_aberto', 'ROLAX999']);
    assert.deepEqual([d.ok, d.erro, d.codigo], [false, 'sem_preco', 'ROLAL999'], 'sem preço: alternativa recusada, nada de zero');
  });

  test('sugestões: critérios atendidos, não atendidos e sem dado, sem eleger a melhor', async () => {
    const q = new URLSearchParams({ estrategiaId, codigo: 'ROLAK400', diasMin: '30', creditoMinimo: '0', deltaMax: '0.4', strike: 'acima' });
    const r = await pedir('ana', 'GET', `/api/rolagens/sugestoes?${q}`);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.dia, '2026-10-15');
    assert.deepEqual(r.corpo.perna.precoDeSaida, { valor: 130, origem: 'ask', estimativa: false });
    assert.deepEqual(r.corpo.candidatos.map((x: { codigo: string }) => x.codigo), ['ROLAL400', 'ROLAL420', 'ROLAL440'], 'ordem de vencimento e strike');
    const por = Object.fromEntries(r.corpo.candidatos.map((x: { codigo: string }) => [x.codigo, x]));
    const sit = (codigo: string) => Object.fromEntries(por[codigo].criterios.map((k: { criterio: string; situacao: string }) => [k.criterio, k.situacao]));
    assert.deepEqual(sit('ROLAL420'), { dias: 'atendido', delta: 'atendido', creditoMinimo: 'nao_atendido', strike: 'atendido' });
    assert.deepEqual(sit('ROLAL400'), { dias: 'atendido', delta: 'sem_dado', creditoMinimo: 'atendido', strike: 'nao_atendido' });
    assert.equal(por.ROLAL420.liquido, -3500);
    assert.equal(por.ROLAL400.dias, 63);
    assert.deepEqual(por.ROLAL440.precoDeEntrada, { valor: 50, origem: 'ultimo', estimativa: true });
    assert.ok(por.ROLAL440.avisos.includes('usa_preco_estimado'));
    assert.ok(r.corpo.premissas.some((p: string) => /Nenhum candidato é recomendado/.test(p)));
    assert.equal((await pedir('ana', 'GET', `/api/rolagens/sugestoes?estrategiaId=${estrategiaId}&codigo=ROLA3`)).corpo.erro, 'so_opcao_rola');
    assert.equal((await pedir('ana', 'GET', `/api/rolagens/sugestoes?estrategiaId=${estrategiaId}&codigo=ROLAL400`)).status, 404);
  });

  let rolagemId = '';

  test('confirmar exige o preço feito e grava execuções ligadas à rolagem', async () => {
    const base = { estrategiaId, instante: '2026-10-16T13:50:00-03:00', observacao: 'rolei para dezembro' };
    const semPreco = await pedir('ana', 'POST', '/api/rolagens', { ...base, encerrar: [{ codigo: 'ROLAK400', quantidade: 100 }], abrir: [] });
    assert.deepEqual([semPreco.status, semPreco.corpo.erro, semPreco.corpo.codigo], [400, 'preco_obrigatorio', 'ROLAK400']);
    assert.equal((await pedir('ana', 'POST', '/api/rolagens', { ...base, instante: '2026-10-17T10:00:00-03:00', encerrar: [{ codigo: 'ROLAK400', quantidade: 100, preco: 128 }], abrir: [] })).corpo.erro, 'instante_no_futuro');
    const demais = await pedir('ana', 'POST', '/api/rolagens', { ...base, encerrar: [{ codigo: 'ROLAK400', quantidade: 300, preco: 128 }], abrir: [] });
    assert.deepEqual([demais.status, demais.corpo.erro], [400, 'quantidade_a_encerrar_invalida']);
    assert.equal((await pedir('ana', 'POST', '/api/rolagens', { ...base, encerrar: [], abrir: [] })).corpo.erro, 'rolagem_vazia');

    const r = await pedir('ana', 'POST', '/api/rolagens', {
      ...base,
      encerrar: [{ codigo: 'ROLAK400', quantidade: 100, preco: 128, custos: 300 }],
      abrir: [{ codigo: 'ROLAL400', lado: 'venda', quantidade: 100, preco: 182, custos: 300 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    rolagemId = r.corpo.id;
    assert.deepEqual(r.corpo.resumo.fluxo, { encerramento: -12800, abertura: 18200, custos: 600, liquido: 4800, natureza: 'credito' });
    const e = await estrategia();
    assert.equal(e.rolagens.length, 1);
    assert.equal(e.rolagens[0].observacao, 'rolei para dezembro');
    assert.equal(e.execucoes.filter((x: { rolagemId: string | null }) => x.rolagemId === rolagemId).length, 2);
    const nova = e.execucoes.find((x: { codigo: string }) => x.codigo === 'ROLAL400');
    assert.deepEqual([nova.strike, nova.vencimento, nova.lado], [4000, '2026-12-18', 'venda'], 'série completada pelo cadastro');
    const g = (await pedir('ana', 'GET', '/api/posicoes')).corpo;
    assert.equal(g.liquidoPorCodigo.ROLAL400, -100);
    assert.equal(g.liquidoPorCodigo.ROLAK400, undefined, 'a call de novembro saiu');
    assert.equal(e.resultado.realizadoBruto, -4800, 'vendeu a 0,80, recomprou a 1,28');
    const parte = await pedir('ana', 'DELETE', `/api/posicoes/${estrategiaId}/execucoes/${nova.id}`);
    assert.deepEqual([parte.status, parte.corpo.erro], [409, 'faz_parte_de_rolagem']);
  });

  test('outro usuário não simula, não vê nem desfaz', async () => {
    assert.equal((await pedir('beto', 'POST', '/api/rolagens/simular', { estrategiaId, alternativas: [{ nome: 'x', encerrar: [{ codigo: 'ROLAL400', quantidade: 1 }], abrir: [] }] })).status, 404);
    assert.equal((await pedir('beto', 'GET', `/api/rolagens/sugestoes?estrategiaId=${estrategiaId}&codigo=ROLAL400`)).status, 404);
    assert.equal((await pedir('beto', 'DELETE', `/api/rolagens/${rolagemId}`)).status, 404);
    assert.equal((await pedir('beto', 'POST', '/api/rolagens', { estrategiaId, instante: '2026-10-16T13:50:00-03:00', encerrar: [{ codigo: 'ROLAL400', quantidade: 1, preco: 1 }], abrir: [] })).status, 404);
  });

  test('desfazer a rolagem volta a posição de antes', async () => {
    const r = await pedir('ana', 'DELETE', `/api/rolagens/${rolagemId}`);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const e = await estrategia();
    assert.equal(e.rolagens.length, 0);
    assert.equal(e.execucoes.length, 2);
    const g = (await pedir('ana', 'GET', '/api/posicoes')).corpo;
    assert.equal(g.liquidoPorCodigo.ROLAK400, -100);
    const a = await dono.query(
      `select acao, count(*)::int as n from audit_logs a join users u on u.id = a.ator_id
       where u.email = $1 and acao like 'rolagem.%' group by acao order by acao`, [`ana.rolagens.${sufixo}@exemplo.test`],
    );
    assert.deepEqual(a.rows, [{ acao: 'rolagem.confirmada', n: 1 }, { acao: 'rolagem.desfeita', n: 1 }]);
  });
});
