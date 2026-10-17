# Plano de testes

## Camadas

| Camada | Ferramenta | Onde roda |
| --- | --- | --- |
| Domínio (cálculo puro) | `node --test` | Local e CI |
| Banco (migrações, RLS, restrições) | `psql` + scripts SQL em PostgreSQL descartável | Local e CI |
| API (rotas, autorização, isolamento) | `node --test` + Fastify `inject` + PostgreSQL real | CI |
| Worker (alertas, outbox, provedor) | `node --test` + PostgreSQL real + provedor simulado + Telegram falso | CI |
| Ponta a ponta | Playwright contra a stack em Docker | CI |
| Infraestrutura | Stack em Docker Swarm no CI: reinício, banco fora, Redis fora, cópia e restauração | CI |

O ambiente de desenvolvimento das sessões não baixa pacotes do npm; instalação, compilação e testes com dependências rodam no GitHub Actions. O domínio não tem dependências e roda em qualquer lugar.

## Situação

| Grupo | Situação |
| --- | --- |
| Domínio | **65 testes passando** (16/10/2026) |
| Banco (RLS e funções de acesso) | **72 verificações** |
| API de acesso | **15 testes** contra PostgreSQL 17, com varredura de todas as rotas |
| Interface | **4 testes** dos utilitários e **9 testes no navegador** (Playwright) contra api + PostgreSQL, com axe (WCAG 2.1 AA) em cada tela; fotos das telas no ramo `ci-fotos` |
| Demais | A construir nas fases seguintes |

## O que é obrigatório testar

**Acesso:** login certo e errado; espera depois de 8 erros; recuperação sem revelar se a conta existe; sessão expirada; revogação na suspensão; cada rota com a política certa; usuário B sem acesso a nada do usuário A em todas as rotas (teste gerado a partir da lista de rotas); `admin` sem ver dados financeiros; `admin` sem virar `superadmin`.

**Dados de mercado:** cotação válida, atrasada, ausente, com preço inválido, book cruzado; provedor desconectado e voltando; dados fora de ordem; HTTP 429 com `Retry-After`; cota esgotada; troca de provedor sem mexer no motor.

**Alertas:** cruzamento para cima e para baixo; primeira observação acima do nível não dispara; condição composta; deduplicação; rearme com histerese, por intervalo e uma vez; reinício do worker sem disparo repetido; dado atrasado não dispara e quebra o cruzamento; janela de horário; limite diário; falha do Telegram e recuperação da fila.

**Posições:** compradas e vendidas; várias pernas; custos; realizado; não realizado `null` sem preço; payoff, equilíbrio, lucro e perda máximos; risco ilimitado; multiplicador; vencimentos misturados recusados no payoff.

**Rolagens:** com crédito e com débito; mudança de vencimento, strike e quantidade; encerramento parcial; histórico preservado; avisos; comparador; preço ausente; preço estimado.

**Infraestrutura:** reinício de cada serviço com dados preservados; banco fora (api responde 503, worker espera e volta); Redis fora (painel cai para consulta periódica, alertas continuam); provedor fora (qualidade "desconectado", alertas suspensos); Telegram fora (fila acumula e esvazia depois); cópia e restauração.

## Casos de referência financeiros

Calculados à mão e conferidos linha a linha nos testes do domínio (ver tabela em `OPTIONS_ENGINE.md`). Os valores de Black-Scholes conferem com os exemplos de Hull.

## Modo sombra (Fase 9)

Antes de ligar as notificações de verdade, o worker roda uma semana em modo sombra: avalia as regras e grava os disparos sem enviar, e o resultado é comparado com o que o usuário esperava.

## Ponte com o MetaTrader 5

- Banco (`db/tests/ponte.sql`): só o dono vê pontes, cotações e posições; hash da chave ilegível; cotação só entra pela função da ponte; chave revogada ou dono suspenso é recusado; cotação fora de ordem não volta o preço; lista vazia de posições zera a conta, lote sem posições não mexe nelas.
- Domínio (`ponte.test.ts`): reais para centavos exatos (com os erros de ponto flutuante), zero do MT5 vira "sem dado", item ruim descartado sem derrubar o lote, horário fora do intervalo, livro cruzado, posições somadas ou recusadas (conta hedging), qualidade pelo pulso.
- Api (`ponte.test.ts`): políticas das rotas, chave mostrada uma vez, robô sem chave ou com chave errada, envio e leitura em centavos, isolamento entre usuários, limite de 3 pontes, revogação imediata, auditoria, bloqueio por IP.
- O robô MQL5 não roda no CI (precisa do terminal da corretora): o primeiro teste dele é no MT5 da VPS, conferindo a aba *Experts* e a hora das cotações contra o Book.
