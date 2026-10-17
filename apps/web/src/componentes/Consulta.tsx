'use client';

// Consulta a api de tempos em tempos, só com a aba visível. Erro de rede não apaga
// o último dado bom: quem decide se ele ainda vale é a qualidade que vem da api.

import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar, ErroDaApi } from '../lib/api.ts';

export function useConsultaPeriodica<T>(caminho: string, intervaloMs: number): { dados: T | null; erro: string | null; recarregar: () => Promise<void> } {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);

  const recarregar = useCallback(async () => {
    try {
      const r = await chamar<T>('GET', caminho);
      if (!vivo.current) return;
      setDados(r);
      setErro(null);
    } catch (e) {
      if (vivo.current) setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível carregar agora.');
    }
  }, [caminho]);

  useEffect(() => {
    vivo.current = true;
    void recarregar();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void recarregar();
    }, intervaloMs);
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void recarregar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      vivo.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [recarregar, intervaloMs]);

  return { dados, erro, recarregar };
}
