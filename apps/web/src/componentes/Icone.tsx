// Ícones de traço, desenhados à mão (sem biblioteca), sempre decorativos:
// o texto ao lado é o que dá o sentido.

const CAMINHOS = {
  painel: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  ativos: 'M3 17l5-6 4 3 6-8 3 3',
  cadeia: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  alertas: 'M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0',
  posicoes: 'M4 8h16v11H4zM9 8V5h6v3',
  rolagens: 'M4 12a8 8 0 0114-5l2-2v6h-6l2-2a5 5 0 00-9 3M20 12a8 8 0 01-14 5l-2 2v-6h6l-2 2a5 5 0 009-3',
  historico: 'M12 7v5l3 2M3 12a9 9 0 109-9 9 9 0 00-7 3M3 4v4h4',
  usuarios: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-4-5.6',
  diagnostico: 'M3 12h4l3-7 4 14 3-7h4',
  relogio: 'M12 7v5l3 2M12 21a9 9 0 110-18 9 9 0 010 18z',
  calendario: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  aviso: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  certo: 'M5 12l5 5L20 7',
  pausa: 'M10 4v16M14 4v16',
  envelope: 'M4 6h16v12H4zM4 7l8 6 8-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  fechar: 'M6 6l12 12M18 6L6 18',
  mais: 'M12 5v14M5 12h14',
  lixeira: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3',
  indisponivel: 'M12 21a9 9 0 110-18 9 9 0 010 18zM6 18L18 6',
  ponto: 'M12 12m-6 0a6 6 0 1012 0 6 6 0 10-12 0',
} as const;

export type NomeDoIcone = keyof typeof CAMINHOS;

export function Icone({ nome, tamanho = 20, preenchido = false }: { nome: NomeDoIcone; tamanho?: number; preenchido?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" width={tamanho} height={tamanho} aria-hidden="true" focusable="false"
      fill={preenchido ? 'currentColor' : 'none'} stroke={preenchido ? 'none' : 'currentColor'}
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d={CAMINHOS[nome]} />
    </svg>
  );
}

// Setas de alta e baixa: sempre junto do sinal (+/−) no texto.
export function Seta({ sobe }: { sobe: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width={10} height={10} aria-hidden="true" focusable="false" style={{ marginRight: 4 }}>
      <path d={sobe ? 'M6 1l5 9H1z' : 'M6 11L1 2h10z'} fill="currentColor" />
    </svg>
  );
}
