# Implantação

Padrão decidido em 16/10/2026: **Docker Swarm pelo Portainer, atrás do Traefik já existente** (instalação SetupOrion), igual às outras stacks do usuário. Não usa EasyPanel.

## Antes de instalar (sem mexer em nada)

Conferir na VPS, só lendo:

```bash
nproc; free -h; df -h /
docker version --format '{{.Server.Version}}'
docker network ls --filter driver=overlay
docker service ls
```

- Memória mínima recomendada livre para esta stack: 1,5 GB (estimativa: web 150 MB, api 120 MB, worker 120 MB, PostgreSQL 300 MB, Redis 50 MB, folga). Medir de verdade na Fase 9.
- Anotar o nome da rede do Traefik (ex.: `WtatechNet`), o entrypoint (`websecure`) e o resolvedor de certificado (`letsencryptresolver`).
- Não reiniciar nem alterar serviços existentes; não mexer no firewall.

## Stack (`infra/portainer-stack.yml`, Fase 9)

Serviços com prefixo `wtaopt_`:

| Serviço | Imagem | Rede | Observação |
| --- | --- | --- | --- |
| `web` | `ghcr.io/gilsonalvesgwta/<repo>-web` | Traefik + interna | Rótulos do Traefik em `deploy.labels` |
| `api` | `ghcr.io/gilsonalvesgwta/<repo>-api` | Traefik + interna | Rota `/api` |
| `worker` | `ghcr.io/gilsonalvesgwta/<repo>-api` (comando `worker`) | interna | Sem porta |
| `db` | `postgres:17` | interna | Volume persistente, sem porta publicada |
| `redis` | `redis:7` | interna | `maxmemory` e sem persistência obrigatória |
| `migracoes` | imagem da `api` | interna | Aplica migrações e termina |
| `copias` | imagem da `api` | interna | Cópia diária com retenção |

Todos com `healthcheck`, `restart_policy`, limites de CPU e memória e logs rotacionados (`max-size`, `max-file`). `node.role == manager`.

## Variáveis

Ver `.env.example`. Obrigatórias: `DOMINIO`, `REDE_TRAEFIK`, `SENHA_DO_BANCO`, `SEGREDO_DA_SESSAO`, `SUPERADMIN_EMAIL`, `SUPERADMIN_SENHA_INICIAL`. Opcionais: `BRAPI_API_KEY`, `BRAPI_PLANO` (`gratuito`, `startup`, `pro`), `TELEGRAM_BOT_TOKEN`, `SMTP_*`, `HORA_DA_COPIA`, `MANTER_DIAS`.

## Passo a passo

1. DNS: apontar o domínio escolhido para o IP da VPS.
2. Portainer → Stacks → Add stack → nome `wtaopt` → colar `infra/portainer-stack.yml` → preencher as variáveis → Deploy.
3. Conferir: `migracoes` em 0/1 (terminou), demais em 1/1.
4. Abrir `https://<domínio>`, entrar com `SUPERADMIN_EMAIL` e a senha inicial, trocar a senha.
5. Página de diagnóstico: provedor, banco, Redis, fila do outbox.

Atualizar: colar a stack nova e "Update the stack" com "Re-pull image".

## Cópias e restauração

- Cópia diária (`pg_dump` em formato custom) no volume `wtaopt_copias`, retenção de 14 dias.
- Restaurar: parar `api` e `worker` (escala 0), `pg_restore --clean` a partir da cópia, subir de novo. O procedimento é testado no CI.

## Desfazer (rollback)

Cada imagem publicada tem também a etiqueta do commit. Para voltar: trocar `:main` pela etiqueta anterior na stack e atualizar. Migrações são só para frente e compatíveis com a versão anterior da aplicação por pelo menos uma versão.
