#!/usr/bin/env bash
# Instala o MetaTrader 5 numa VPS Linux x86 (Ubuntu 24.04) para a ponte do
# WTA Options rodar 24 horas, sem depender do computador ligado.
#
# Baixar e rodar (comandos sem símbolos especiais, para funcionar até no
# console do navegador da Hetzner):
#   curl -L -o vps.sh opcoes.wtatech.com.br/ponte/vps.sh
#   bash vps.sh
#
# Outros usos:
#   bash vps.sh robo     copia (ou atualiza) o robô WTA_Ponte.mq5 dentro do MT5
#   bash vps.sh fechar   tira a tela do MT5 da internet (depois de configurado)
#   bash vps.sh abrir    volta a abrir a tela do MT5 na porta 3001 (com senha)
#   bash vps.sh estado   mostra se o MT5 está rodando e quanto usa de memória
#   bash vps.sh corrigir troca para o Wine que não tem o defeito do "debugger"
#   bash vps.sh wine     monta o MT5 com o Wine Staging (corrige o "debugger")
#   bash vps.sh testar   abre o MetaTrader à mão e mostra o erro, se ele fechar
#
# Nenhuma senha fica neste arquivo: a senha da tela é pedida na hora e fica
# só na VPS, em /opt/mt5/.env (legível apenas pelo root).
set -euo pipefail

PASTA=/opt/mt5
SITE=https://opcoes.wtatech.com.br
EXPERTS="$PASTA/config/.wine/drive_c/Program Files/MetaTrader 5/MQL5/Experts"

falar() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
erro() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "rode como root (digite sudo su antes)."

escrever_compose() {
  local porta="$1" # 0.0.0.0 (aberta, com senha) ou 127.0.0.1 (fechada)
  cat > "$PASTA/compose.yaml" <<EOF
services:
  mt5:
    image: $(imagem)$( [ -f "$PASTA/Dockerfile" ] && printf '\n    build: .' )
    container_name: mt5
    restart: unless-stopped
    env_file: .env
    environment:
      - TZ=America/Sao_Paulo
    volumes:
      - ./config:/config
    ports:
      - "$porta:3001:3001"
    shm_size: 1gb
    mem_limit: 2500m
    cpus: 1.8
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
EOF
}

# Imagem do MT5. A "latest" traz o Wine 10, que tem um defeito conhecido: o MT5
# acusa "A debugger has been found running in your system" e fecha. A 1.0 usa um
# Wine anterior a esse defeito (bash vps.sh corrigir troca para ela).
imagem() { cat "$PASTA/imagem" 2>/dev/null || echo gmag11/metatrader5_vnc:1.0; }

subir() { (cd "$PASTA" && docker compose up -d --remove-orphans); }

ip_publico() { curl -4 -s --max-time 5 https://api.ipify.org || hostname -I | cut -d' ' -f1; }

instalar() {
  [ "$(uname -m)" = "x86_64" ] || erro "esta VPS não é x86_64 (Intel/AMD). O MT5 não roda bem em ARM."

  falar "Ajustando fuso horário para São Paulo"
  timedatectl set-timezone America/Sao_Paulo || true

  if ! swapon --show | grep -q .; then
    falar "Criando 2 GB de memória extra (swap)"
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    falar "Instalando o Docker (alguns minutos)"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq docker.io docker-compose-v2 curl >/dev/null
    systemctl enable --now docker
  fi

  mkdir -p "$PASTA/config"
  chmod 700 "$PASTA"

  if [ ! -s "$PASTA/.env" ]; then
    falar "Crie a senha da tela do MT5"
    echo "Use só letras e números, com pelo menos 10 caracteres."
    echo "(Os símbolos podem sair trocados no console da Hetzner.) A senha não aparece enquanto você digita."
    while true; do
      read -r -s -p "Senha: " s1; echo
      read -r -s -p "Repita a senha: " s2; echo
      if [ "$s1" != "$s2" ]; then echo "As senhas não conferem. Tente de novo."; continue; fi
      if ! [[ "$s1" =~ ^[A-Za-z0-9]{10,}$ ]]; then echo "Use só letras e números, 10 ou mais. Tente de novo."; continue; fi
      break
    done
    umask 077
    printf 'CUSTOM_USER=wta\nPASSWORD=%s\n' "$s1" > "$PASTA/.env"
    unset s1 s2
  fi

  escrever_compose 0.0.0.0
  # Já instala com o Wine Staging + Windows 11 (o Wine 10 da imagem faz o MT5
  # acusar "A debugger has been found" e fechar).
  wine_novo

  local ip; ip="$(ip_publico)"
  falar "Pronto. O MT5 está sendo instalado dentro do container."
  cat <<EOF

  Daqui a uns 10 minutos, abra no navegador do seu computador:

      https://$ip:3001

  - O navegador vai avisar que a conexão não é particular: clique em
    "Avançado" e depois em "Continuar para $ip".
  - Usuário: wta    Senha: a que você acabou de criar.

  Depois rode:  bash vps.sh robo   (para colocar o robô dentro do MT5)
EOF
}

robo() {
  [ -f "$PASTA/compose.yaml" ] || erro "o MT5 ainda não foi instalado. Rode primeiro: bash vps.sh"
  falar "Esperando o MT5 terminar de instalar (pode levar alguns minutos)"
  local n=0
  until [ -d "$EXPERTS" ]; do
    n=$((n + 1))
    [ "$n" -le 90 ] || erro "o MT5 ainda não terminou de instalar. Abra a tela no navegador, espere ele aparecer e rode de novo: bash vps.sh robo"
    printf '.'; sleep 10
  done
  echo
  curl -fsSL -o "$EXPERTS/WTA_Ponte.mq5" "$SITE/ponte/WTA_Ponte.mq5" || erro "não consegui baixar o robô do site."
  chown --reference="$EXPERTS" "$EXPERTS/WTA_Ponte.mq5"
  local versao; versao="$(grep -m1 -o 'define VERSAO *"[^"]*"' "$EXPERTS/WTA_Ponte.mq5" | grep -o '[0-9][0-9.]*' || true)"
  falar "Robô copiado (versão $versao) para a pasta Experts do MT5."
  echo "  No MT5: Navegador > Expert Advisors > botão direito > Atualizar. Depois abra o WTA_Ponte no MetaEditor e compile (F7)."
}

fechar() {
  [ -f "$PASTA/compose.yaml" ] || erro "o MT5 ainda não foi instalado."
  escrever_compose 127.0.0.1
  subir
  falar "A tela do MT5 saiu da internet. O MT5 e o robô continuam rodando normalmente."
  echo "  Para abrir de novo quando precisar mexer: bash vps.sh abrir"
}

abrir() {
  [ -f "$PASTA/compose.yaml" ] || erro "o MT5 ainda não foi instalado."
  escrever_compose 0.0.0.0
  subir
  falar "Tela aberta em https://$(ip_publico):3001 (usuário wta e a sua senha)."
  echo "  Quando terminar: bash vps.sh fechar"
}

estado() {
  docker ps --filter name=mt5 --format 'Container: {{.Names}}  |  {{.Status}}  |  porta {{.Ports}}' || true
  docker stats --no-stream --format 'Memória: {{.MemUsage}}  |  CPU: {{.CPUPerc}}' mt5 2>/dev/null || true
  free -h | head -2
  echo "--- etapas da instalação (do registro do container):"
  docker logs mt5 2>&1 | grep -E '^\[[0-9]/[0-9]\]|rror|ailed|not found' | grep -v -E 'pip|dependency|mt5linux|8001' | tail -15 || true
  echo "--- MetaTrader instalado?"
  if [ -f "$PASTA/config/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe" ]; then
    echo "sim (terminal64.exe existe)"
  else
    echo "NAO: terminal64.exe ainda não existe"
    ls "$PASTA/config/.wine/drive_c/Program Files" 2>/dev/null || echo "(pasta Program Files ainda não existe)"
  fi
  echo "--- MetaTrader rodando?"
  docker exec mt5 sh -c 'ps -eo rss,args | grep -i -E "terminal64|mt5setup" | grep -v grep' 2>/dev/null || echo "NAO há processo do MetaTrader rodando"
  [ -f "$EXPERTS/WTA_Ponte.mq5" ] && echo "Robô presente na pasta Experts." || echo "Robô ainda não copiado (bash vps.sh robo)."
}

testar() {
  # Abre o MetaTrader à mão dentro do container e mostra por que ele fecha.
  local exe='/config/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe'
  falar "Versão do Wine e do Windows simulado"
  docker exec -u abc -e HOME=/config -e WINEPREFIX=/config/.wine mt5 wine --version || true
  docker exec -u abc -e HOME=/config -e WINEPREFIX=/config/.wine mt5 sh -c 'wine reg query "HKCU\\Software\\Wine" /v Version 2>/dev/null | grep -i version' || echo "(versão do Windows padrão)"
  falar "Abrindo o MetaTrader por 60 segundos (olhe a tela no navegador)"
  docker exec -u abc -e HOME=/config -e WINEPREFIX=/config/.wine -e DISPLAY=:1 mt5 \
    sh -c "timeout 60 wine \"$exe\" > /tmp/mt5-teste.log 2>&1; echo saiu com codigo \$? >> /tmp/mt5-teste.log" || true
  falar "Últimas linhas do que o MetaTrader/Wine disse"
  docker exec mt5 sh -c 'grep -v -E "^$|fixme:" /tmp/mt5-teste.log | tail -25' || true
}

corrigir() {
  [ -f "$PASTA/compose.yaml" ] || erro "o MT5 ainda não foi instalado. Rode: bash vps.sh"
  falar "Trocando para a imagem com o Wine anterior ao defeito do 'debugger'"
  (cd "$PASTA" && docker compose down) || true
  echo gmag11/metatrader5_vnc:1.0 > "$PASTA/imagem"
  rm -rf "$PASTA/config"
  mkdir -p "$PASTA/config"
  if grep -q '127.0.0.1:3001' "$PASTA/compose.yaml"; then escrever_compose 127.0.0.1; else escrever_compose 0.0.0.0; fi
  subir
  docker image rm gmag11/metatrader5_vnc:latest >/dev/null 2>&1 || true
  falar "Pronto. O MT5 está sendo reinstalado (de 5 a 15 minutos). A senha da tela continua a mesma."
}

wine_novo() {
  # O Wine 10 (e o mais antigo da imagem 1.0) faz o MT5 acusar "A debugger has
  # been found" (defeito do Wine 58043). O Wine Staging traz a correção; junto
  # com o Windows simulado como 11, o MT5 volta a abrir.
  [ -f "$PASTA/compose.yaml" ] || erro "o MT5 ainda não foi instalado. Rode: bash vps.sh"
  falar "Montando o MT5 com o Wine Staging mais novo (de 5 a 10 minutos)"
  cat > "$PASTA/Dockerfile" <<'EOF2'
FROM gmag11/metatrader5_vnc:latest
USER root
RUN set -eux; . /etc/os-release; \
    rm -f /etc/apt/sources.list.d/winehq*; \
    apt-get update; apt-get install -y --no-install-recommends ca-certificates wget gnupg; \
    mkdir -pm755 /etc/apt/keyrings; \
    wget -qO /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key; \
    wget -qNP /etc/apt/sources.list.d/ "https://dl.winehq.org/wine-builds/debian/dists/${VERSION_CODENAME}/winehq-${VERSION_CODENAME}.sources"; \
    dpkg --add-architecture i386; apt-get update; \
    apt-get install -y --install-recommends winehq-staging; \
    rm -rf /var/lib/apt/lists/*; \
    wine --version
EOF2
  echo wta-mt5:wine-staging > "$PASTA/imagem"
  (cd "$PASTA" && docker compose down) || true
  rm -rf "$PASTA/config"
  mkdir -p "$PASTA/config"
  if grep -q '127.0.0.1:3001' "$PASTA/compose.yaml"; then escrever_compose 127.0.0.1; else escrever_compose 0.0.0.0; fi
  (cd "$PASTA" && docker compose build --pull) || erro "não consegui montar a imagem com o Wine novo. Me mande o print."
  subir
  falar "Esperando o Windows simulado ficar pronto para trocar para Windows 11"
  local n=0
  until docker exec mt5 test -f /config/.wine/user.reg 2>/dev/null; do
    n=$((n + 1)); [ "$n" -le 60 ] || break; printf '.'; sleep 10
  done
  echo
  docker exec -u abc -e HOME=/config -e WINEPREFIX=/config/.wine mt5 wine reg add 'HKCU\Software\Wine' /v Version /d win11 /f || true
  docker exec -u abc -e HOME=/config -e WINEPREFIX=/config/.wine mt5 wine --version || true
  falar "Pronto. O MT5 está sendo instalado com o Wine novo (de 5 a 15 minutos). Depois aperte F5 no navegador."
  echo "  Se a mensagem do 'debugger' voltar a aparecer, rode: docker restart mt5"
}

case "${1:-instalar}" in
  instalar) instalar ;;
  robo) robo ;;
  fechar) fechar ;;
  abrir) abrir ;;
  estado) estado ;;
  testar) testar ;;
  corrigir) corrigir ;;
  wine) wine_novo ;;
  *) erro "opção desconhecida: $1 (use: instalar, robo, fechar, abrir, estado)" ;;
esac
