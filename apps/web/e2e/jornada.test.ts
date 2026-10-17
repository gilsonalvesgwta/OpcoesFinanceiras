// Jornada completa pela interface real, ligada à api e ao PostgreSQL.
// Ordem importa: o primeiro teste faz a instalação virar uma conta de verdade.

import { test, expect, type Page, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const EMAIL = process.env.SUPERADMIN_EMAIL ?? 'chefe@exemplo.test';
const SENHA_INICIAL = process.env.SUPERADMIN_SENHA_INICIAL ?? 'senha inicial do teste';
const SENHA = 'senha nova do chefe 1';
const FOTOS = new URL('../../../fotos/', import.meta.url).pathname;
mkdirSync(FOTOS, { recursive: true });

async function foto(page: Page, nome: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${FOTOS}${nome}.png`, fullPage: true });
}

async function semViolacoes(page: Page, onde: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const resumo = r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(resumo, `acessibilidade em ${onde}`).toEqual([]);
}

async function entrar(page: Page, email: string, senha: string) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

// Entra e espera o painel abrir (a sessão já está gravada quando ele aparece).
async function entrarNoPainel(page: Page, email: string, senha: string) {
  await entrar(page, email, senha);
  await expect(page.getByRole('heading', { name: 'Painel', level: 1 })).toBeVisible();
}

test.describe.serial('jornada', () => {
  let linkDoConvite = '';

  test('sem sessão, qualquer tela do sistema leva para Entrar', async ({ page }) => {
    await page.goto('/ativos');
    await expect(page).toHaveURL(/\/entrar\?voltar=%2Fativos/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await semViolacoes(page, 'entrar');
    await foto(page, 'entrar');
  });

  test('senha errada mostra a mensagem certa', async ({ page }) => {
    await entrar(page, EMAIL, 'senha errada qualquer');
    await expect(page.locator('.alerta')).toContainText('E-mail ou senha incorretos');
  });

  test('primeiro acesso: senha inicial obriga a troca e leva ao painel', async ({ page }) => {
    await entrar(page, EMAIL, SENHA_INICIAL);
    await expect(page).toHaveURL(/\/trocar-senha$/);
    await semViolacoes(page, 'trocar senha');
    await page.getByLabel('Senha atual').fill(SENHA_INICIAL);
    await page.getByLabel('Senha nova').fill('curta');
    await page.getByLabel('Repita a senha').fill('curta');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.locator('.alerta')).toContainText('pelo menos 12 caracteres');
    await page.getByLabel('Senha nova').fill(SENHA);
    await page.getByLabel('Repita a senha').fill(SENHA);
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Painel', level: 1 })).toBeVisible();
    await expect(page.getByRole('img', { name: /Linha do pregão das 10:00 às 17:00/ })).toBeVisible();
    await expect(page.getByText('Você ainda não acompanha nenhum ativo')).toBeVisible();
  });

  test('ativos: adicionar, recusar código inválido e ver no painel', async ({ page }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Ativos' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ativos', level: 1 })).toBeVisible();
    for (const codigo of ['petr4', 'VALE3', 'BOVA11']) {
      await page.getByLabel('Código de negociação').fill(codigo);
      await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: `${codigo.toUpperCase()} adicionado` })).toBeVisible();
    }
    await page.getByLabel('Código de negociação').fill('PE;R4');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.locator('.alerta')).toContainText('código de negociação');
    await page.getByRole('button', { name: 'Remover VALE3' }).click();
    await page.getByRole('button', { name: 'Confirmar remoção' }).click();
    await expect(page.getByRole('row', { name: /VALE3/ })).toHaveCount(0);
    await semViolacoes(page, 'ativos');
    await foto(page, 'ativos');
    await page.getByRole('link', { name: 'Painel' }).first().click();
    await expect(page.getByRole('rowheader', { name: 'PETR4' })).toBeVisible();
    await expect(page.getByText('Sem cotação ainda').first()).toBeVisible();
    await semViolacoes(page, 'painel');
    await foto(page, 'painel-escuro');
  });

  test('superadmin convida uma pessoa e recebe o link', async ({ page }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Usuários' }).click();
    await page.getByLabel('E-mail').fill('ana@exemplo.test');
    await page.getByRole('button', { name: 'Criar convite' }).click();
    await expect(page.getByText('Convite criado para ana@exemplo.test')).toBeVisible();
    linkDoConvite = await page.getByLabel('Link do convite').inputValue();
    expect(linkDoConvite).toMatch(/\/convite#[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole('row', { name: /ana@exemplo.test.*Convite pendente/ })).toBeVisible();
    await semViolacoes(page, 'usuários');
    await foto(page, 'usuarios');
  });

  test('a pessoa convidada cria o acesso e não vê nada de outra conta', async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const page = await ctx.newPage();
    await page.goto(new URL(linkDoConvite).hash ? `/convite${new URL(linkDoConvite).hash}` : linkDoConvite);
    await expect(page.getByText('Convite para ana@exemplo.test')).toBeVisible();
    await expect(page).toHaveURL(/\/convite$/); // o token sai da barra de endereço
    await semViolacoes(page, 'convite');
    await page.getByLabel('Seu nome').fill('Ana Teste');
    await page.getByLabel('Crie uma senha').fill('senha da ana teste 1');
    await page.getByLabel('Repita a senha').fill('senha da ana teste 1');
    await page.getByRole('button', { name: 'Criar acesso' }).click();
    await expect(page.getByRole('heading', { name: 'Painel', level: 1 })).toBeVisible();
    await expect(page.getByText('Você ainda não acompanha nenhum ativo')).toBeVisible(); // não vê PETR4 do chefe
    await foto(page, 'painel-celular');
    await page.getByRole('button', { name: 'Abrir o menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Ativos' })).toBeVisible();
    await expect(page.getByText('Administração')).toHaveCount(0); // usuário comum não vê a área de administração
    await foto(page, 'menu-celular');
    await page.goto('/usuarios');
    await expect(page.getByText('Esta área é só para administradores.')).toBeVisible();
    await ctx.close();
  });

  test('tema claro fica salvo para a conta', async ({ page }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.goto('/preferencias');
    await page.getByLabel('Seu nome').fill('Gilson Alves');
    await page.getByRole('button', { name: 'Salvar nome' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nome salvo.' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Gilson Alves');
    await semViolacoes(page, 'preferências');
    await foto(page, 'preferencias');
    await page.getByLabel(/Claro/).check();
    await expect(page.getByRole('status').filter({ hasText: 'Tema salvo.' })).toBeVisible();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
    await semViolacoes(page, 'painel claro');
    await foto(page, 'painel-claro');
    await page.goto('/preferencias');
    await page.getByLabel(/Escuro/).check();
    await expect(page.getByRole('status').filter({ hasText: 'Tema salvo.' })).toBeVisible();
  });

  test('superadmin suspende a pessoa; ela não entra mais', async ({ page, browser }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.goto('/usuarios');
    await page.getByRole('row', { name: /Ana Teste/ }).getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByRole('row', { name: /Ana Teste.*Suspenso/ })).toBeVisible();
    const ctx = await browser.newContext();
    const outra = await ctx.newPage();
    await entrar(outra, 'ana@exemplo.test', 'senha da ana teste 1');
    await expect(outra.locator('.alerta')).toContainText('E-mail ou senha incorretos');
    await ctx.close();
  });

  test('ponte MT5: cria a chave, o robô envia e o painel mostra tempo real e posições', async ({ page, request }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.goto('/preferencias#metatrader');
    await expect(page.getByRole('heading', { name: 'MetaTrader 5 da corretora' })).toBeVisible();
    await page.getByLabel('Nome para reconhecer esta ponte').fill('Genial na VPS');
    await page.getByRole('button', { name: 'Criar chave da ponte' }).click();
    const campo = page.getByLabel('Chave da ponte');
    await expect(campo).toBeVisible();
    const chave = await campo.inputValue();
    expect(chave).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(page.getByText('Aguardando o primeiro sinal')).toBeVisible();
    await expect(page.getByText('1 de 3 chaves em uso')).toBeVisible();
    await semViolacoes(page, 'preferências com chave nova');
    await foto(page, 'preferencias-mt5');

    // O robô: só a chave, sem cookie.
    const instante = Date.now() - 1000;
    const r = await request.post('/api/ponte/dados', {
      headers: { authorization: `Bearer ${chave}` },
      data: {
        versao: '1.0.0',
        conta: { login: 123456, servidor: 'GenialInvestimentos-PRD', corretora: 'Genial Investimentos' },
        cotacoes: [
          { codigo: 'PETR4', ultimo: 38.47, bid: 38.46, ask: 38.48, fechamento_anterior: 38.0, volume: 1000, instante },
          { codigo: 'PETRK380', ultimo: 0.93, bid: 0.92, ask: 0.95, fechamento_anterior: 0.72, volume: 300, instante },
        ],
        posicoes: [
          { codigo: 'PETR4', lado: 'compra', quantidade: 300, preco_medio: 36.555 },
          { codigo: 'PETRK380', lado: 'venda', quantidade: 300, preco_medio: 0.72 },
        ],
      },
    });
    expect(r.status(), await r.text()).toBe(200);
    await expect(page.getByText(/^Conectada/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Conta 123456 · GenialInvestimentos-PRD · Genial Investimentos')).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Painel', level: 1 })).toBeVisible();
    const petr = page.getByRole('row', { name: /PETR4/ }).first();
    await expect(petr).toContainText('R$ 38,47');
    await expect(petr).toContainText('38,46');
    await expect(petr).toContainText('+1,24%');
    await expect(petr.getByText(/^(Tempo real|Histórico)$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Posições na corretora' })).toBeVisible();
    const vendida = page.getByRole('row', { name: /PETRK380/ }).last();
    await expect(vendida).toContainText('Vendido');
    await expect(vendida).toContainText('−R$ 69,00');
    await expect(page.getByRole('row', { name: /PETR4/ }).last()).toContainText('+R$ 571,50');
    await expect(page.getByRole('link', { name: 'MetaTrader 5 conectado' })).toBeVisible();
    await semViolacoes(page, 'painel com a ponte');
    await foto(page, 'painel-mt5');

    const robo = await request.get('/ponte/WTA_Ponte.mq5');
    expect(robo.ok()).toBe(true);
    expect(await robo.text()).toContain('Só leitura');
  });

  test('calendário e diagnóstico: superadmin cadastra e remove um dia sem pregão e vê a situação das fontes', async ({ page }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Calendário' }).first().click();
    await expect(page.getByRole('heading', { name: 'Calendário da B3', level: 1 })).toBeVisible();
    await expect(page.getByText('Dia Nacional de Zumbi e da Consciência Negra')).toBeVisible();
    await page.getByLabel('Ano').selectOption('2027');
    await page.locator('#feriado-dia').fill('2027-01-01');
    await page.locator('#feriado-motivo').fill('Confraternização Universal');
    await page.getByRole('button', { name: 'Adicionar' }).first().click();
    await expect(page.getByText('01/01/2027 agora é dia sem pregão.')).toBeVisible();
    await expect(page.getByText('sex, 01/01/2027')).toBeVisible();
    await semViolacoes(page, 'calendário');
    await foto(page, 'calendario');
    await page.getByRole('button', { name: 'Remover 01/01/2027' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('01/01/2027 voltou a ser dia de pregão.')).toBeVisible();

    await page.getByRole('link', { name: 'Diagnóstico' }).first().click();
    await expect(page.getByRole('heading', { name: 'Diagnóstico', level: 1 })).toBeVisible();
    // No teste não há worker rodando: a tela diz isso, sem inventar números.
    await expect(page.getByText('Ainda não ligada')).toBeVisible();
    await expect(page.getByText('Nenhum arquivo ainda')).toBeVisible();
    await expect(page.getByText('Desligada')).toBeVisible();
    await semViolacoes(page, 'diagnóstico');
    await foto(page, 'diagnostico');
  });

  test('telas das próximas fases explicam o que vem, e sair encerra a sessão', async ({ page }) => {
    await entrarNoPainel(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Cadeia de opções' }).click();
    await expect(page.getByText('Chega na Fase 5')).toBeVisible();
    await foto(page, 'em-breve');
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/entrar/);
  });
});
