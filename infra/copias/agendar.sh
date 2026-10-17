#!/usr/bin/env bash
# Serviço "copias" da stack: faz uma cópia por dia no horário $HORA_DA_COPIA (HH:MM,
# horário de Brasília) e fica esperando. Uma cópia também é feita ao ligar, se a
# mais recente tiver mais de 24 horas.
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HORA="${HORA_DA_COPIA:-03:30}"
PASTA="${PASTA_DAS_COPIAS:-/copias}"
[[ "$HORA" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "HORA_DA_COPIA inválida: $HORA" >&2; exit 2; }
echo "cópias diárias às $HORA em $PASTA, mantendo ${MANTER_DIAS:-14} dias"
mkdir -p "$PASTA"
# Ao ligar, o banco pode ainda estar subindo: tenta a cópia inicial por até 10 minutos.
if [[ -z "$(find "$PASTA" -maxdepth 1 -name 'wtaopt-*.dump' -mmin -1440 2>/dev/null)" ]]; then
  for tentativa in $(seq 1 10); do
    "$AQUI/copiar.sh" diaria && break
    echo "a cópia inicial falhou (tentativa $tentativa de 10); nova tentativa em 1 minuto"
    sleep 60
  done
fi
while true; do
  agora=$(date +%s)
  alvo=$(date -d "$(date +%Y-%m-%d) $HORA" +%s 2>/dev/null || date -d "$HORA" +%s)
  (( alvo <= agora )) && alvo=$(( alvo + 86400 ))
  sleep $(( alvo - agora ))
  "$AQUI/copiar.sh" diaria || echo "a cópia de $(date +%F) falhou"
done
