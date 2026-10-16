import { defineConfig, devices } from '@playwright/test';

// Roda contra a interface já no ar (no CI: next start + api + PostgreSQL).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  // Falhas (foto da tela e contexto) vão junto com as fotos publicadas no ramo ci-fotos.
  outputDir: '../../fotos/falhas',
  use: {
    baseURL: process.env.URL_DA_INTERFACE ?? 'http://127.0.0.1:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
