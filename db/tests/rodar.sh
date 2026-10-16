#!/usr/bin/env bash
# Recria o banco "wtaopt_teste", aplica as migrações e roda os testes do banco.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres db/tests/rodar.sh   (nunca em produção)
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql -X -q -d postgres -c "drop database if exists wtaopt_teste" -c "create database wtaopt_teste"
PGDATABASE=wtaopt_teste "$AQUI/../aplicar.sh"
for t in "$AQUI"/*.sql; do
  echo "== $(basename "$t") =="
  if ! psql -X -q -v ON_ERROR_STOP=1 -d wtaopt_teste -f "$t" >"/tmp/wtaopt_$$.txt" 2>&1; then
    grep -E "ok - |FALHOU|ERROR" "/tmp/wtaopt_$$.txt" || cat "/tmp/wtaopt_$$.txt"; exit 1
  fi
  grep -cE "ok - " "/tmp/wtaopt_$$.txt" | sed 's/^/verificações: /'
  grep -E "TODOS|todos os testes" "/tmp/wtaopt_$$.txt" || true
done
