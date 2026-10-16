# Fontes de dados de mercado

Avaliação feita em 16/10/2026 na documentação pública de cada fornecedor. Refazer a conferência antes de mudar de plano: limites e preços mudam.

## Conclusão

**Não há, hoje, fonte gratuita ou barata com cotação de opções da B3 durante o pregão que possa ser usada num sistema multiusuário.**

- **brapi** (escolhida para começar): ações com atualização a cada 5 minutos no plano Pro (15 no Startup, 30 no gratuito); **opções só de fim de dia**, com os dados do pregão entrando por volta das 21h. Uso comercial permitido.
- **OpLab PRO**: cotações de ações e opções em tempo real, com API. A API é de **uso exclusivamente pessoal e não comercial**; como o sistema é multiusuário, fica fora. Pode valer só se o sistema tiver um único usuário, conferindo os termos.
- **Cedro (Market Data Cloud)**: distribuidora autorizada pela B3, cotações e livro de ofertas de ações e opções em tempo real por REST, WebSocket ou socket. Preço sob proposta. É o caminho licenciado quando o tempo real for necessário.

Consequência no produto, dita na interface:
- alertas de preço de **ações** funcionam com atraso de 5 a 30 minutos, marcados "atualização periódica";
- análise de **opções**, cadeia, rolagens e sugestões usam o **fechamento do pregão anterior**, marcados "histórico";
- nenhuma tela chama de "tempo real" o que vem da brapi.

## Matriz comparativa

| Item | brapi Gratuito | brapi Startup | brapi Pro | OpLab PRO | Cedro |
| --- | --- | --- | --- | --- | --- |
| Preço | R$ 0 | R$ 99,99/mês (anual) | R$ 116,66/mês (anual; R$ 1.399,90/ano) | R$ 1.850/ano (página consultada) | Sob proposta |
| Ações | Sim, 1 por requisição | Sim, 10 por requisição | Sim, 20 por requisição | Sim | Sim |
| Atualização das ações | 30 min | 15 min | 5 min | Tempo real | Tempo real |
| Opções | Só tickers de teste (PETR) | Não | Fim de dia, histórico desde 2009 | Tempo real | Tempo real |
| Cadeia completa | — | — | Sim, por vencimento | Sim | Sim |
| Vencimentos e strikes | — | — | Sim | Sim | Sim |
| Bid e ask das opções | — | — | Sim (do fechamento) | Sim | Sim, com livro |
| Último negócio, volume, negócios | — | — | Sim (diário) | Sim | Sim |
| Contratos em aberto | — | — | Sim | A confirmar | A confirmar |
| Volatilidade implícita e gregas | — | — | Sim, por pregão | Sim | A confirmar |
| Histórico intradiário | Não | Não | 1 a 90 min | Sim | Sim |
| Histórico diário | 3 meses | 1 ano | 10+ anos | Sim | Sim |
| Horário da fonte | Sim (`regularMarketTime`) | Sim | Sim; opções com a data do pregão | A confirmar | Sim |
| Limite | 15 mil/mês, 1 simultânea | 150 mil/mês, 4 simultâneas | 500 mil/mês, 16 simultâneas | Por plano | Por contrato |
| Autenticação | Bearer | Bearer | Bearer | Token | Contrato |
| Uso comercial / multiusuário | Teste | Sim | Sim | **Não** (pessoal) | Sim, licenciado |
| Falha | HTTP 429 com `Retry-After`; cota mensal esgotada interrompe até o ciclo seguinte | idem | idem | — | — |

Fontes: brapi.dev/docs, brapi.dev/docs/opcoes, brapi.dev/docs/opcoes/series, brapi.dev/pricing, brapi.dev/docs/authentication; oplab.com.br; cedrotech.com (Market Data Cloud).

## Orçamento de requisições (brapi)

Pregão de cerca de 7 horas e 21 dias por mês.

| Plano | Ciclo | Ativos | Requisições por ciclo | Por mês |
| --- | --- | --- | --- | --- |
| Gratuito | 30 min | 10 ações | 10 | ≈ 2.940 |
| Pro | 5 min | 40 ações | 2 | ≈ 3.530 |
| Pro | 1×/dia após 21h | 10 ativos × 3 vencimentos (cadeia + gregas) | 60 | ≈ 1.260 |

Consultar mais vezes do que o provedor atualiza não traz dado novo: o `worker` consulta no ritmo declarado do plano, nunca abaixo dele, e mostra a cota restante na página de diagnóstico.

## Como o sistema trata cada dado

- Cada cotação guarda: instrumento, provedor, último, bid, ask, referência, volume, negócios, instante da fonte, instante de recebimento e qualidade.
- Ausente fica `null`. Zero só quando a fonte diz zero; a brapi devolve `bid: 0` e `ask: 0` em séries sem oferta, e o sistema trata zero em bid/ask como "sem oferta", não como preço.
- O preço para estimar o encerramento é o lado executável (bid para quem está comprado, ask para quem está vendido). Último negócio e ponto médio só entram se o usuário escolher, sempre marcados como estimativa.
- Qualidade possível: tempo real, atualização periódica, atrasado, desconectado, indisponível, histórico, simulado. Ver `qualidadeDaCotacao` em `packages/domain/src/cotacoes.ts`.
- Alertas que dependem de preço do momento não disparam com dado atrasado, desconectado ou histórico; a regra pode exigir tempo real.

## O código de uma opção

`{RAIZ}{LETRA}{SÉRIE}`: letras A a L são calls de janeiro a dezembro; M a X são puts na mesma ordem. O número da série não é o strike. Strike, vencimento exato, estilo de exercício e lote vêm sempre do cadastro do provedor, nunca do código.

## Adaptadores

Interface `MarketDataProvider` em `packages/domain/src/provedor.ts`. Cada adaptador declara suas `capacidades`; a interface do sistema só oferece o que o adaptador declara.

| Adaptador | Situação |
| --- | --- |
| `ProvedorSimulado` | Pronto. Determinístico, só para testes; recusado em produção. |
| `brapi` | Próxima etapa (Fase 3). Endpoints: `/api/v2/stocks/quote`, `/api/v2/options/expirations`, `/api/v2/options/chain`, `/api/v2/options/analytics`, `/api/v2/options/positions`. |
| `cedro` | Quando houver contrato. |

## Proibido

Raspagem de páginas de corretora; burlar autenticação, limites ou licenças; redistribuir dados além do que o plano permite.
