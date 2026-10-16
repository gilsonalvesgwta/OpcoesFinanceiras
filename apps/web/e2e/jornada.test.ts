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
    await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
  });

  test('primeiro acesso: senha inicial obriga a troca e leva ao painel', async ({ page }) => {
    await entrar(page, EMAIL, SENHA_INICIAL);
    await expect(page).toHaveURL(/\/trocar-senha$/);
    await semViolacoes(page, 'trocar senha');
    await page.getByLabel('Senha atual').fill(SENHA_INICIAL);
    await page.getByLabel('Senha nova').fill('curta');
    await page.getByLabel('Repita a senha').fill('curta');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.getByRole('alert')).toContainText('pelo menos 12 caracteres');
    await page.getByLabel('Senha nova').fill(SENHA);
    await page.getByLabel('Repita a senha').fill(SENHA);
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Painel', level: 1 })).toBeVisible();
    await expect(page.getByRole('img', { name: /Linha do pregão das 10:00 às 17:00/ })).toBeVisible();
    await expect(page.getByText('Você ainda não acompanha nenhum ativo')).toBeVisible();
  });

  test('ativos: adicionar, recusar código inválido e ver no painel', async ({ page }) => {
    await entrar(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Ativos' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ativos', level: 1 })).toBeVisible();
    for (const codigo of ['petr4', 'VALE3', 'BOVA11']) {
      await page.getByLabel('Código de negociação').fill(codigo);
      await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: `${codigo.toUpperCase()} adicionado` })).toBeVisible();
    }
    await page.getByLabel('Código de negociação').fill('PE;R4');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('código de negociação');
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
    await entrar(page, EMAIL, SENHA);
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
    await entrar(page, EMAIL, SENHA);
    await page.goto('/preferencias');
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
    await entrar(page, EMAIL, SENHA);
    await page.goto('/usuarios');
    await page.getByRole('row', { name: /Ana Teste/ }).getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByRole('row', { name: /Ana Teste.*Suspenso/ })).toBeVisible();
    const ctx = await browser.newContext();
    const outra = await ctx.newPage();
    await entrar(outra, 'ana@exemplo.test', 'senha da ana teste 1');
    await expect(outra.getByRole('alert')).toContainText('E-mail ou senha incorretos');
    await ctx.close();
  });

  test('telas das próximas fases explicam o que vem, e sair encerra a sessão', async ({ page }) => {
    await entrar(page, EMAIL, SENHA);
    await page.getByRole('link', { name: 'Cadeia de opções' }).click();
    await expect(page.getByText('Chega na Fase 5')).toBeVisible();
    await foto(page, 'em-breve');
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/entrar/);
  });
});
