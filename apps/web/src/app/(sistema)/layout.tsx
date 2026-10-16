'use client';

import type { ReactNode } from 'react';
import { Casca } from '../../componentes/Casca.tsx';
import { ProvedorDeSessao } from '../../componentes/Sessao.tsx';

export default function LayoutDoSistema({ children }: { children: ReactNode }) {
  return (
    <ProvedorDeSessao>
      <Casca>{children}</Casca>
    </ProvedorDeSessao>
  );
}
