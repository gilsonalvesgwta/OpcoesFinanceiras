#!/usr/bin/env bash
# Faz uma cópia completa do banco (pg_dump, formato custom) em $PASTA_DAS_COPIAS
# e apaga as cópias com mais de $MANTER_DIAS dias. Junto vai um .sha256 para conferir
# o arquivo depois de copiá-lo para outra máquina.
# Usa as variáveis padrão do PostgreSQL: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
# Uso: copiar.sh [rótulo]   (o rótulo opcional entra no nome do arquivo, ex.: antes-de-atualizar)
set -euo pipefail
PASTA="${PASTA_DAS_COPIAS:-/copias}"
MANTER="${MANTER_DIAS:-14}"
ROTULO="${1:-diaria}"
[[ "$ROTULO" =~ ^[a-z0-9-]{1,40}$ ]] || { echo "rótulo inválido: use letras minúsculas, números e hífen" >&2; exit 2; }
mkdir -p "$PASTA"
NOME="wtaopt-$(date +%Y%m%d-%H%M%S)-$ROTULO.dump"
TEMP="$PASTA/.$NOME.parcial"
trap 'rm -f "$TEMP"' EXIT
pg_dump --format=custom --compress=6 --no-owner --file="$TEMP" "${PGDATABASE:-wtaopt}"
# Confere que o arquivo abre antes de considerá-lo uma cópia válida.
pg_restore --list "$TEMP" > /dev/null
mv "$TEMP" "$PASTA/$NOME"
(cd "$PASTA" && sha256sum "$NOME" > "$NOME.sha256")
echo "cópia criada: $PASTA/$NOME ($(du -h "$PASTA/$NOME" | cut -f1))"
# Retenção: só as cópias automáticas (rótulo "diaria") são apagadas sozinhas.
find "$PASTA" -maxdepth 1 -name 'wtaopt-*-diaria.dump' -mtime +"$MANTER" -print -delete | sed 's/^/apagada (antiga): /'
find "$PASTA" -maxdepth 1 -name 'wtaopt-*-diaria.dump.sha256' -mtime +"$MANTER" -delete
