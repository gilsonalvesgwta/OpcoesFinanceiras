# Fontes de dados de mercado

Avaliação feita em 16/10/2026 na documentação pública de cada fornecedor. Refazer a conferência antes de mudar de plano: limites e preços mudam.

## Decisão (16/10/2026): começar só com fontes gratuitas

O responsável decidiu não usar serviço pago no início, aceitando o atraso. A estrutura gratuita fica assim:

| Dado | Fonte gratuita | Frequência real | Qualidade mostrada |
| --- | --- | --- | --- |
| Cotação de **ações** durante o pregão | brapi, plano gratuito (chave gratuita, sem cartão) | Dado com cerca de **30 minutos** de atraso; o plano gratuito da brapi não tem 15 minutos (15 é o Startup, pago) | "Atualização periódica" ou "atrasado" |
| **Cadeia de opções** (todas as séries, strike, vencimento, último, máxima, mínima, melhor oferta de compra e de venda no fechamento, negócios, volume) | Arquivo oficial **COTAHIST** diário da B3, público e gratuito | Uma vez por dia, depois do pregão | "Histórico" (fechamento) |
| Histórico diário de ações (para médias, RSI, ATR, rompimentos) | O mesmo COTAHIST (diário e anual) | Diário | "Histórico" |
| Juros para o modelo de preço | Selic do Banco Central (API pública SGS) | Diária | Premissa declarada do cálculo |
| Volatilidade implícita e gregas | **Calculadas pelo sistema** (Black-Scholes) a partir do fechamento | Diária | "Calculado", com premissas |
| Estilo de exercício | Cadastro de instrumentos da B3 (arquivo público), a confirmar na Fase 3; até lá, "não informado" | Diária | — |
| Contratos em aberto | Não há fonte gratuita confirmada; o campo fica "indisponível" | — | "Indisponível" |

Consequências no produto, ditas na interface:
- alertas de preço de **ações** funcionam com cerca de 30 minutos de atraso;
- alertas sobre **opções**, cadeia, rolagens e sugestões usam o **fechamento do último pregão**;
- nenhuma tela chama de "tempo real" o que vem dessas fontes.

A camada de provedores é trocável: brapi Pro, OpLab ou Cedro entram depois só como adaptador novo, sem mexer no motor.

### MetaTrader 5 da conta do responsável (decisão de 16/10/2026)

O responsável tem conta na Genial com acesso ao MetaTrader 5. Um robô só leitura (`ponte-mt5/WTA_Ponte.mq5`), rodando num MT5 na VPS 24 h, envia as cotações dos favoritos e das posições, um pulso a cada 5 s e as posições abertas da conta.

- Sem custo além da conta que ele já tem; é a única fonte com chance de **tempo real** no início. A Genial não informa publicamente se o MT5 do cliente recebe o pregão sem atraso: conferir no primeiro pregão.
- Qualidade pelo **pulso** da ponte, não pela hora do último negócio: até 15 s sem pulso é "tempo real" com o pregão aberto; de 15 a 60 s, "atrasado"; mais de 60 s ou chave revogada, "desconectado"; pregão fechado, "histórico".
- Zero vindo do MT5 (livro vazio, sem negócio) vira "sem dado", nunca preço zero.
- Uso **pessoal**: o dado vem da conta dele na corretora. Tudo é gravado no nome do dono da chave e só ele lê (RLS); não alimenta telas de outros usuários. Para atender outros usuários com dado em tempo real, só fonte licenciada (ver fontes pagas).
- As posições da corretora ficam separadas das posições cadastradas no sistema (Fase 6), que poderão importá-las com confirmação.

### Histórico e indicadores (Fase 4c)

- Carga do histórico: o worker importa os arquivos mensais `COTAHIST_MmmAAAA.ZIP` dos últimos 12 meses (um por ciclo, quando não houve arquivo diário no ciclo), lendo o arquivo aos poucos e guardando só o mercado à vista. Não sobrescreve o que veio do arquivo diário.
- Limpeza: opções e cálculos com mais de 120 dias são apagados; o histórico das ações fica.
- Indicadores para alertas (`packages/domain/src/indicadores.ts`): distância das médias de 20, 50 e 200 dias, RSI(14) de Wilder, distância da máxima e da mínima de 20 pregões (rompimento), movimento do dia em ATRs (ATR 14) e volume relativo à média de 20 pregões. Usam os pregões anteriores e o preço do momento; sem histórico suficiente o indicador fica vazio e a regra não dispara.
- VWAP precisa dos negócios do dia, que as fontes gratuitas não dão: fica para quando houver fonte intradiária.

### Orçamento do plano gratuito da brapi

15 mil requisições por mês, 1 ativo por requisição, 1 requisição simultânea. Consultando a cada 30 minutos durante cerca de 7 horas de pregão e 21 pregões no mês: 14 × 21 = 294 requisições por ativo por mês. Cabem cerca de **45 ações acompanhadas**, com folga para buscas. O `worker` não consulta mais rápido que o atraso do plano (não traria dado novo) e mostra a cota restante no diagnóstico.

### Arquivo COTAHIST

Coleta (worker, a cada 10 minutos): depois das 20h de cada pregão baixa `COTAHIST_DddmmAAAA.ZIP`; confere até 10 dias para trás e recupera o que faltou (até 3 arquivos por ciclo), sem buscar fim de semana nem feriado cadastrado e esperando 1 hora antes de tentar de novo um arquivo que ainda não saiu. Guarda ações à vista (mercado 010) e opções (070 e 080); fracionário fica de fora. Toda tentativa fica em `importacoes` (diagnóstico). A Selic (SGS 1178) é buscada uma vez por dia, depois das 9h.

- Layout oficial: "SeriesHistoricas_Layout.pdf" da B3. Leitor pronto em `packages/domain/src/cotahist.ts`, com testes.
- Opções: tipo de mercado 070 (call) e 080 (put). Preços com duas casas implícitas (já em centavos).
- Melhor oferta zerada significa "sem oferta" e vira `null`.
- O arquivo não diz o ativo-objeto da opção: o sistema liga pela raiz de 4 letras e pela classe (ON, PN, UNT) entre as ações do mesmo arquivo; havendo dúvida, fica sem ativo-objeto em vez de adivinhar.
- Endereço do arquivo diário e horário de publicação: conferidos no primeiro teste real na VPS (o ambiente de desenvolvimento não acessa o site da B3).

## Fontes pagas avaliadas (para depois)

- **brapi Pro**: ações a cada 5 minutos, opções de fim de dia com gregas e contratos em aberto. R$ 1.399,90 por ano.
- **OpLab PRO**: ações e opções em tempo real, API só para uso pessoal e não comercial. Cerca de R$ 1.850 por ano.
- **Cedro (Market Data Cloud)**: distribuidora autorizada pela B3, tempo real, preço sob proposta.

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
| `b3-cotahist` | Leitor do arquivo pronto (`cotahist.ts`); download diário na Fase 3. Opções e histórico diário. |
| `brapi` (gratuito) | Fase 3. Endpoint `/api/v2/stocks/quote`, 1 ativo por chamada. Ações durante o pregão. |
| `bcb-selic` | Fase 3. Taxa Selic para o modelo de preço. |
| `brapi` Pro, `oplab`, `cedro` | Só se o responsável decidir pagar. |
| `cedro` | Quando houver contrato. |

## Proibido

Raspagem de páginas de corretora; burlar autenticação, limites ou licenças; redistribuir dados além do que o plano permite.
