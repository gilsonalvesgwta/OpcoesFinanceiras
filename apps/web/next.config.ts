import type { NextConfig } from 'next';

// A interface fala com a api pelo mesmo endereço: /api/* é repassado ao serviço
// da api na rede interna da stack (API_INTERNA), então só a interface fica exposta.
const API_INTERNA = process.env.API_INTERNA ?? 'http://api:3001';

const config: NextConfig = {
  output: 'standalone',
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
