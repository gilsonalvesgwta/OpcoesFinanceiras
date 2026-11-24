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
    image: gmag11/metatrader5_vnc:latest
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
  falar "Baixando e iniciando o MetaTrader 5 (a primeira vez demora de 5 a 15 minutos)"
  subir

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

case "${1:-instalar}" in
  instalar) instalar ;;
  robo) robo ;;
  fechar) fechar ;;
  abrir) abrir ;;
  estado) estado ;;
  *) erro "opção desconhecida: $1 (use: instalar, robo, fechar, abrir, estado)" ;;
esac
