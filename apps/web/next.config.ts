import type { NextConfig } from 'next';
import { resolve } from 'node:path';

// A interface fala com a api pelo mesmo endereço: /api/* é repassado ao serviço
// da api na rede interna da stack (API_INTERNA), então só a interface fica exposta.
// "wtaopt-api" e não "api": a interface também está na rede do Traefik, onde outra stack
// pode ter um serviço "api" (na VPS de produção, o CRM tem).
const API_INTERNA = process.env.API_INTERNA ?? 'http://wtaopt-api:3001';

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: o pacote do domínio fica fora de apps/web; o build roda dentro de apps/web.
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@wta/domain'],
  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API_INTERNA}/api/:caminho*` }];
  },
  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        ],
      },
    ];
  },
};

export default config;
