#!/usr/bin/env bash
# Aplica as migrações pendentes, em ordem, uma transação por arquivo.
# Uso: PGHOST=... PGUSER=<dono> PGPASSWORD=... PGDATABASE=... SENHA_APP=... db/aplicar.sh
# SENHA_APP (opcional) liga o login do papel wtaopt_app com essa senha.
# SENHA_COLETA (opcional) liga o login do papel wtaopt_coleta (worker de coleta).
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P=(psql -X -q -v ON_ERROR_STOP=1)

"${P[@]}" -c "create schema if not exists controle;
  create table if not exists controle.migracoes (nome text primary key, aplicada_em timestamptz not null default now());"

for arquivo in "$AQUI"/migrations/*.sql; do
  nome="$(basename "$arquivo")"
  if [[ "$("${P[@]}" -At -c "select 1 from controle.migracoes where nome = '$nome'")" == "1" ]]; then
    continue
  fi
  echo "aplicando $nome"
  # -1: o arquivo e o registro da migração numa transação só.
  "${P[@]}" -1 -f "$arquivo" -c "insert into controle.migracoes (nome) values ('$nome')"
done

if [[ -n "${SENHA_APP:-}" ]]; then
  "${P[@]}" -v senha="$SENHA_APP" <<'SQL'
alter role wtaopt_app login password :'senha';
SQL
fi
if [[ -n "${SENHA_COLETA:-}" ]]; then
  "${P[@]}" -v senha="$SENHA_COLETA" <<'SQL'
alter role wtaopt_coleta login password :'senha';
SQL
fi
echo "migrações em dia"
