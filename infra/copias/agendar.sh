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
if [[ -z "$(find "$PASTA" -maxdepth 1 -name 'wtaopt-*.dump' -mmin -1440 2>/dev/null)" ]]; then
  "$AQUI/copiar.sh" diaria || echo "a cópia inicial falhou; nova tentativa no horário marcado"
fi
while true; do
  agora=$(date +%s)
  alvo=$(date -d "$(date +%Y-%m-%d) $HORA" +%s 2>/dev/null || date -d "$HORA" +%s)
  (( alvo <= agora )) && alvo=$(( alvo + 86400 ))
  sleep $(( alvo - agora ))
  "$AQUI/copiar.sh" diaria || echo "a cópia de $(date +%F) falhou"
done
