# Instalação, atualização, cópias e mudança de VPS

Guia passo a passo para instalar o WTA Options Intelligence em **qualquer VPS** com Docker Swarm, Portainer e Traefik (o padrão SetupOrion, o mesmo do CRM). Nada aqui altera outras stacks da VPS: o sistema tem banco, rede interna e volumes próprios, e só a interface é ligada ao Traefik.

Este roteiro inteiro roda automaticamente no CI a cada mudança (workflow "Instalação"): a stack sobe num Swarm, a interface responde passando pela api até o banco, uma cópia é feita e restaurada.

## O que você vai precisar

- VPS com Portainer e Traefik funcionando (como a do CRM).
- O subdomínio `opcoes.wtatech.com.br` apontando para o IP da VPS (registro A no DNS).
- Memória livre: cerca de **1,5 GB** para o sistema; mais **1 GB** se for ligar o MetaTrader 5 na mesma VPS.

## 1. Conferir a VPS (só leitura, não muda nada)

No terminal da VPS (SSH), rode e anote os resultados:

```bash
free -h                                        # memória livre ("available")
df -h /                                        # espaço em disco (deixe pelo menos 5 GB livres)
docker network ls --filter driver=overlay      # anote o nome da rede do Traefik (ex.: a que o CRM usa)
docker service ls                              # o que já está rodando (nada disso será alterado)
```

Para saber o "entrypoint" e o "certresolver" do Traefik: no Portainer, abra um serviço que já funciona com HTTPS (o do CRM), veja as **labels** `traefik.http.routers.….entrypoints` e `….tls.certresolver` e use os mesmos valores. No SetupOrion costumam ser `websecure` e `letsencryptresolver` (já são o padrão).

## 2. Gerar as senhas

Três senhas só com letras e números (elas entram em endereços de conexão). No terminal:

```bash
openssl rand -hex 24   # rode 3 vezes: SENHA_DO_BANCO, SENHA_APP, SENHA_COLETA
```

E uma senha inicial para o seu primeiro acesso (`SUPERADMIN_SENHA_INICIAL`, 12 caracteres ou mais; você troca no primeiro login).

**Guarde as quatro num lugar seguro** (gerenciador de senhas).

## 3. Criar a stack no Portainer

1. Portainer → **Stacks** → **Add stack**. Nome: `wtaopt`.
2. Em "Build method", escolha **Repository**:
   - Repository URL: `https://github.com/gilsonalvesgwta/OpcoesFinanceiras`
   - Repository reference: `refs/heads/main`
   - Compose path: `infra/portainer-stack.yml`
   (Assim as atualizações vêm do GitHub com um clique. Alternativa: "Web editor" e colar o conteúdo do arquivo.)
3. Em **Environment variables**, clique em "Advanced mode" e cole o conteúdo de `infra/variaveis.exemplo`, preenchendo:
   - `REDE_TRAEFIK`: o nome anotado no passo 1;
   - as três senhas e a senha inicial do passo 2;
   - `ENTRYPOINT_TRAEFIK` e `CERTRESOLVER_TRAEFIK` se forem diferentes do padrão.
4. **Deploy the stack**.

## 4. Conferir

- Portainer → Stacks → `wtaopt`: `migracoes` termina sozinho (0/1, "complete"); `db`, `api`, `worker`, `web` e `copias` ficam em 1/1.
- Abra `https://opcoes.wtatech.com.br`, entre com `SUPERADMIN_EMAIL` e a senha inicial e crie a sua senha definitiva.
- Em **Diagnóstico**, a "Coleta automática" deve aparecer como "Funcionando" em poucos minutos. O primeiro arquivo da B3 chega depois das 20h de um dia de pregão.

## Atualizar para uma versão nova

1. Faça uma cópia manual antes (ver abaixo), com o rótulo `antes-de-atualizar`.
2. Portainer → Stacks → `wtaopt` → **Pull and redeploy** (marque "Re-pull image").
3. As migrações novas são aplicadas sozinhas. Se algo der errado: troque `VERSAO=main` pela etiqueta da versão anterior (aparece no GitHub, em Packages) e atualize de novo, ou restaure a cópia.

## Cópias do banco (backup)

- **Automáticas**: todo dia às `HORA_DA_COPIA` (padrão 03:30), guardadas por `MANTER_DIAS` (padrão 14) no volume `wtaopt_copias`. Cada cópia vem com um arquivo `.sha256` para conferir a integridade.
- Na VPS, ficam em: `/var/lib/docker/volumes/wtaopt_copias/_data/`
- **Cópia manual** (antes de atualizar, antes de mudar de VPS):
  ```bash
  docker exec $(docker ps -q -f name=wtaopt_copias) /app/infra/copias/copiar.sh manual
  ```
  (ou Portainer → Containers → `wtaopt_copias…` → Console → `/app/infra/copias/copiar.sh manual`)
- **Guarde cópias fora da VPS** de vez em quando: se a VPS for perdida, as cópias que estão nela vão junto. Do seu computador:
  ```bash
  scp root@IP_DA_VPS:/var/lib/docker/volumes/wtaopt_copias/_data/wtaopt-AAAAMMDD-HHMMSS-manual.dump* .
  ```
  (Copia o `.dump` e o `.sha256`. As cópias manuais não são apagadas sozinhas.)

## Restaurar uma cópia (na mesma VPS)

1. Portainer → Services: coloque `wtaopt_web`, `wtaopt_api` e `wtaopt_worker` com **0** réplicas (ninguém gravando durante a restauração).
2. Confira o arquivo (não apaga nada):
   ```bash
   docker exec $(docker ps -q -f name=wtaopt_copias) /app/infra/copias/restaurar.sh /copias/NOME-DO-ARQUIVO.dump
   ```
3. Restaure (APAGA o conteúdo atual e põe o da cópia):
   ```bash
   docker exec $(docker ps -q -f name=wtaopt_copias) /app/infra/copias/restaurar.sh /copias/NOME-DO-ARQUIVO.dump --sim
   ```
4. Volte os três serviços para **1** réplica.

A restauração também aplica migrações mais novas que a cópia e religa as senhas da aplicação.

## Mudar de VPS (ou reinstalar do zero)

1. **Na VPS antiga**: faça uma cópia manual com o rótulo `mudanca` e baixe o `.dump` e o `.sha256` para o seu computador.
2. **Na VPS nova**: siga os passos 1 a 4 deste guia (pode usar senhas novas: a restauração ajusta as senhas da aplicação).
3. Envie os dois arquivos para a nova:
   ```bash
   scp wtaopt-*-mudanca.dump* root@IP_DA_VPS_NOVA:/var/lib/docker/volumes/wtaopt_copias/_data/
   ```
4. Restaure como na seção anterior (escala 0, conferir, `--sim`, escala 1).
5. Aponte o DNS de `opcoes.wtatech.com.br` para o IP da VPS nova.
6. Entre com o **seu usuário e senha de sempre** (eles vêm na cópia). Desligue a stack da VPS antiga só depois de conferir tudo.

O que vem na cópia: usuários, preferências, favoritos, chaves da ponte do MetaTrader 5, cotações e posições recebidas, calendário, dados de mercado e auditoria. O que **não** vem: a instalação do MetaTrader 5 (reinstale e entre na conta de novo; a chave da ponte continua valendo).

## MetaTrader 5 (opcional, stack separada)

1. DNS: um subdomínio para a tela do MT5, por exemplo `mt5.opcoes.wtatech.com.br`.
2. Portainer → Add stack → nome `wtaopt-mt5` → Repository, Compose path `infra/mt5-stack.yml`.
3. Variáveis: `REDE_TRAEFIK`, `DOMINIO_MT5`, `USUARIO_MT5` e `SENHA_MT5` (usuário e senha para abrir a tela do MT5 no navegador; use uma senha forte).
4. Abra `https://DOMINIO_MT5`, entre com esse usuário e senha, instale o MT5 se ele pedir, entre na sua conta da Genial e siga `ponte-mt5/LEIAME.md`.

## Se algo der errado

| Sintoma | O que ver |
| --- | --- |
| Site não abre / certificado inválido | DNS apontando para a VPS? `REDE_TRAEFIK`, `ENTRYPOINT_TRAEFIK` e `CERTRESOLVER_TRAEFIK` iguais aos do CRM? |
| `migracoes` reiniciando sem parar | Registros do serviço no Portainer; quase sempre senha com caractere especial (use só letras e números) |
| Diagnóstico: "Coleta parada" | Registros de `wtaopt_worker`; a VPS precisa de saída para a internet (B3 e Banco Central) |
| Esqueceu a senha | "Esqueci a senha" na tela de entrar (o e-mail ainda não está ligado: peça ao Claude o caminho pelo terminal) |
