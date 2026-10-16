import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--fonte', display: 'swap' });
const plexCondensada = IBM_Plex_Sans_Condensed({ subsets: ['latin'], weight: ['500', '600'], variable: '--fonte-condensada', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'WTA Options Intelligence', template: '%s · WTA Options' },
  description: 'Análise, monitoramento e gestão de operações com opções da B3.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#10171D',
};

// Aplica o tema guardado antes da primeira pintura, para a tela não piscar.
const TEMA = `try{var t=localStorage.getItem('wtaopt_tema');if(t==='claro'||t==='escuro'||t==='sistema')document.documentElement.dataset.theme=t}catch(e){}`;

export default function Raiz({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="escuro" className={`${plex.variable} ${plexCondensada.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
