# Requisitos do produto

## Objetivo

Plataforma de inteligência operacional para quem opera opções na B3: monitorar ativos e cadeias, criar alertas sem programar, registrar e analisar posições de várias pernas, comparar rolagens e receber avisos e sugestões pelo Telegram. Não envia ordens.

## Usuários

- Hoje: o próprio responsável, como superadministrador (`alves.gilson@yahoo.com.br`).
- Depois: outras pessoas convidadas, cada uma com os próprios dados isolados.

## Princípios

1. Separar sempre **dado observado**, **cálculo**, **estimativa**, **sinal técnico** e **sugestão**. Cada número na tela diz de qual tipo é.
2. Nenhuma sugestão é apresentada como garantia nem como recomendação de investimento.
3. A qualidade e a idade do dado aparecem no painel e em cada alerta. Dado ruim bloqueia o que depende dele.
4. Histórico não é apagado nem editado em silêncio.
5. Números no padrão brasileiro (R$ 1.234,56; 12,5%; 16/10/2026), com a precisão de cada instrumento. Cor nunca é o único indicador: sempre há texto ou ícone.

## Módulos e critérios de aceitação

| Módulo | Aceito quando |
| --- | --- |
| Acesso | Superadministrador convida, suspende e reativa; usuário entra, sai, recupera a senha; sessão expira e é revogável; tentativas limitadas; nenhum dado de um usuário aparece para outro (testado) |
| Painel | Mostra mercado aberto/fechado, estado e idade dos dados, ativos acompanhados, alertas ativos e recentes, posições abertas, próximos vencimentos, risco de exercício, sugestões pendentes e notificações com falha; distingue real, histórico e simulado |
| Ativos e cadeia | Busca e favoritos; ativo com último preço válido, variação, fonte, horário e qualidade; cadeia com filtros (vencimento, tipo, strike, liquidez, distância do preço) e só os campos que o provedor fornece |
| Alertas | Regra criada pelo editor visual, com condições E/OU, operadores de comparação, cruzamento, faixa e variação; janela de horário; rearme; limite diário; sem disparo repetido; sem disparo com dado velho; histórico de disparos com os valores observados |
| Telegram | Vínculo por código; comandos `/start`, `/help`, `/status`, `/ativos`, `/alertas`, `/pausar`, `/retomar`, `/silenciar`, `/resumo`; silêncio por horário; fila com nova tentativa; sugestões só com consentimento |
| Posições | Execuções com várias pernas e custos; posição recalculada das execuções; realizado e não realizado separados; payoff, equilíbrio, lucro e perda máximos, risco ilimitado avisado; exposição por ativo e vencimento |
| Rolagens | Simulação com fluxo, realizado, antes e depois e avisos; comparador de alternativas sem eleger a melhor; confirmação grava execuções ligadas sem apagar a original |
| Cenários | Payoff por preço no vencimento; com modelo e dados suficientes, cenários de volatilidade e tempo, com premissas visíveis |
| Histórico e auditoria | Regras, disparos, sugestões, posições, rolagens, simulações, notificações, falhas e ações administrativas, com filtros e exportação CSV do que o usuário pode ver |
| Diagnóstico | Página só de administradores: provedor, cota, idade das cotações, fila do outbox, erros, banco, Redis, CPU, memória e disco |

## Limitação de dados assumida (16/10/2026)

Decisão do responsável: começar só com fontes gratuitas. Ações com cerca de 30 minutos de atraso (brapi gratuita); opções, cadeia, rolagens e sugestões com o fechamento do último pregão (arquivo oficial da B3); gregas e volatilidade implícita calculadas pelo sistema, com premissas; contratos em aberto indisponíveis. Tudo isso aparece na interface. Fontes pagas podem entrar depois como adaptador novo (ver `DATA_SOURCES.md`).

## Fora do escopo desta versão

Envio de ordens, integração com corretoras, cadastro aberto, aplicativo nativo, WhatsApp.
