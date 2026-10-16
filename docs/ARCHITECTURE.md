# Arquitetura

WTA Options Intelligence: plataforma de análise, monitoramento e gestão de operações com opções da B3. Execução de ordens fica fora do sistema (o usuário executa na corretora e registra aqui).

## Visão geral

```
                 Traefik (HTTPS, já existente na VPS)
                         │
            ┌────────────┴─────────────┐
            │                          │
         web (Next.js)  ──REST/SSE──►  api (Fastify)
                                        │     │
                                        │     └──► Redis (cache, pub/sub do painel, limites)
                                        ▼
                                   PostgreSQL  ◄── fonte da verdade
                                        ▲
                                        │
                                     worker ──► provedor de dados (brapi; depois Cedro)
                                        │
                                        └──► Telegram Bot API
```

| Serviço | Papel | Exposto à internet |
| --- | --- | --- |
| `web` | Interface (Next.js + React + TypeScript + Tailwind). Fala só com a `api`. | Sim, pelo Traefik |
| `api` | REST documentado (OpenAPI), autenticação, autorização, regras de negócio, SSE para o painel. | Sim, pelo Traefik, em `/api` |
| `worker` | Processo contínuo: coleta de cotações, avaliação das regras de alerta, sugestões, despacho do outbox (Telegram), leitura dos comandos do bot, limpeza e retenção. | Não |
| `db` | PostgreSQL. Tudo que importa mora aqui. | Não |
| `redis` | Cache de cotações, pub/sub para o painel ao vivo, contadores de limite de requisição. Se cair, o sistema continua (sem painel ao vivo e com cache frio). | Não |
| `copias` | Cópia de segurança diária do banco, com retenção. | Não |

## Pacotes do repositório

```
packages/domain   cálculo financeiro puro, sem dependências (payoff, rolagens, posições,
                  modelo de preço, qualidade de cotação, núcleo dos alertas, calendário,
                  contrato dos provedores)
apps/api          servidor HTTP (Fastify)
apps/worker       processos contínuos
apps/web          interface
infra/            stack do Portainer (Docker Swarm), Dockerfiles, cópias de segurança
docs/             esta documentação
```

O `packages/domain` é o coração e não importa banco, rede nem framework. Tudo o que é número financeiro sai dele e tem teste de referência. A `api` e o `worker` só orquestram: leem do banco, chamam o domínio, gravam o resultado.

## Fluxos principais

### Cotação → alerta → Telegram

1. O `worker` consulta o provedor no ritmo permitido pelo plano (ver `DATA_SOURCES.md`) e só durante o pregão, segundo o calendário configurado.
2. Cada cotação é validada (`problemasDaCotacao`), recebe uma qualidade (`qualidadeDaCotacao`) e é gravada em `quote_snapshots` com o instante da fonte e o de recebimento.
3. Para cada regra ativa que usa aquele ativo, o `worker` chama `avaliar(regra, estado, observação)` do domínio.
4. Numa única transação: grava o novo estado da regra, o evento de alerta (com os valores observados e a qualidade) e a notificação no `notification_outbox`, usando a chave de deduplicação do disparo como chave única.
5. O despachante do outbox pega notificações pendentes com `FOR UPDATE SKIP LOCKED`, envia ao Telegram, registra cada tentativa em `notification_attempts` e reagenda com espera crescente quando falha.

Se o processo cair no meio, nada se perde nem se repete: o estado da regra e o evento foram gravados juntos, e a notificação tem chave única.

### Registro de operação e rolagem

1. O usuário registra execuções (compra, venda) numa estratégia. A posição é sempre recalculada a partir das execuções (`montarCarteira`); nada é editado no lugar.
2. Na rolagem, a tela monta o pedido (encerrar estas pernas, abrir aquelas), a `api` chama `simularRolagem` e mostra fluxo, realizado, payoff antes e depois e os avisos.
3. Ao confirmar, a `api` grava as execuções novas ligadas a um `roll_event`, numa transação. A posição original continua no histórico.

### Painel ao vivo

A `api` assina os canais do Redis (cotações e alertas do usuário) e repassa por Server-Sent Events. Se o Redis estiver fora, o painel volta a consultar periodicamente.

## Decisões

| Decisão | Motivo |
| --- | --- |
| Monorepo com workspaces do npm | Um só lugar para versão, testes e CI; o domínio é compartilhado entre `api` e `worker`. |
| Fastify na `api` | Rápido, validação por esquema embutida, gera OpenAPI. |
| Next.js só como interface | A regra de negócio fica na `api`, com autorização num lugar só. |
| PostgreSQL com segurança por linha (RLS) além da checagem na `api` | Duas barreiras para o isolamento entre usuários. |
| Outbox no PostgreSQL, não fila no Redis | A notificação nasce na mesma transação do evento; o Redis pode cair sem perder nada. |
| Valores em centavos inteiros | Sem erro de arredondamento em fluxo de caixa. |
| Sem n8n e sem Evolution API na primeira versão | O motor de regras precisa ser contínuo e testável; o canal é o Telegram. |
| Docker Swarm pelo Portainer, atrás do Traefik existente | Mesmo padrão das outras stacks do usuário (decisão de 16/10/2026). |

## Fora desta versão

Envio de ordens; integração com corretoras; cadastro público aberto; aplicativo nativo.
