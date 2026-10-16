# WTA Options Intelligence

Plataforma de análise, monitoramento e gestão de operações com opções da B3: cadeias de opções, alertas personalizáveis com aviso pelo Telegram, posições de várias pernas, comparação de rolagens e sugestões com premissas declaradas. Não envia ordens: o usuário executa na corretora e registra aqui.

## Situação (16/10/2026)

| Parte | Situação |
| --- | --- |
| Documentação da Fase 1 (`docs/`) | Feita |
| Motor de cálculo (`packages/domain`) | Feito, 65 testes de referência passando |
| Banco, acesso e API | Próxima etapa |
| Interface, dados de mercado, alertas, Telegram, posições, rolagens, produção | Nas fases seguintes (ver `docs/IMPLEMENTATION_PLAN.md`) |

**Dados só de fontes gratuitas:** ações com cerca de 30 minutos de atraso (brapi gratuita) e opções com o fechamento do último pregão (arquivo oficial COTAHIST da B3). Detalhes em `docs/DATA_SOURCES.md`.

## Rodar os testes do motor

Precisa só do Node 22.18 ou mais novo; o motor não tem dependências.

```bash
cd packages/domain
npm test
```

Na raiz, `npm install` seguido de `npm test` e `npm run typecheck` roda tudo (é o que o CI faz).

## Documentação

| Documento | Conteúdo |
| --- | --- |
| `docs/ARCHITECTURE.md` | Serviços, fluxos e decisões |
| `docs/PRODUCT_REQUIREMENTS.md` | Módulos e critérios de aceitação |
| `docs/DATA_SOURCES.md` | Avaliação de provedores (brapi, OpLab, Cedro) e tratamento dos dados |
| `docs/OPTIONS_ENGINE.md` | Payoff, resultado, exposição, modelo de preço e premissas |
| `docs/ROLL_STRATEGIES.md` | Rolagens, avisos e sugestões |
| `docs/SECURITY.md` | Papéis, sessões, isolamento, segredos, Telegram |
| `docs/DEPLOYMENT.md` | Stack no Portainer (Docker Swarm + Traefik) |
| `docs/TEST_PLAN.md` | O que é testado e onde |
| `docs/IMPLEMENTATION_PLAN.md` | Fases e pendências |

## Aviso

O sistema calcula e organiza informações; não é recomendação de investimento. Toda sugestão mostra os dados usados, a qualidade deles e as limitações da análise.
