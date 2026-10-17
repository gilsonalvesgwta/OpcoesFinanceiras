#!/usr/bin/env bash
# Restaura uma cópia feita por copiar.sh. APAGA o conteúdo atual do banco de destino.
# Recomendado: parar a api, o worker e a interface (no Portainer, escala 0). Mesmo que fiquem
# ligados, o script bloqueia o login da aplicação e derruba as conexões dela durante a
# restauração, e religa no fim (com SENHA_APP e SENHA_COLETA, obrigatórias para restaurar).
# Uso: restaurar.sh <arquivo.dump> [--sim]
#   --sim  confirma que pode apagar o banco atual (sem isso, só confere o arquivo e para).
# Depois de restaurar, aplica as migrações mais novas (se a cópia for de uma versão anterior)
# e religa as senhas dos papéis da aplicação (SENHA_APP e SENHA_COLETA, se definidas).
set -euo pipefail
ARQ="${1:-}"
[[ -n "$ARQ" && -f "$ARQ" ]] || { echo "uso: restaurar.sh <arquivo.dump> [--sim]" >&2; exit 2; }
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$ARQ.sha256" ]]; then
  (cd "$(dirname "$ARQ")" && sha256sum -c "$(basename "$ARQ").sha256") || { echo "o arquivo não confere com o .sha256: cópia corrompida no caminho?" >&2; exit 3; }
else
  echo "aviso: sem arquivo .sha256 ao lado; seguindo sem conferir a integridade"
fi
pg_restore --list "$ARQ" > /dev/null || { echo "o arquivo não é uma cópia válida" >&2; exit 3; }
BANCO="${PGDATABASE:-wtaopt}"
if [[ "${2:-}" != "--sim" ]]; then
  echo "arquivo conferido. Para APAGAR o banco \"$BANCO\" e restaurar esta cópia, rode de novo com --sim"
  exit 0
fi
[[ -n "${SENHA_APP:-}" && -n "${SENHA_COLETA:-}" ]] || { echo "defina SENHA_APP e SENHA_COLETA (as mesmas da stack) para restaurar" >&2; exit 2; }
echo "restaurando $ARQ em \"$BANCO\"..."
# Os papéis da aplicação não vão dentro da cópia do banco: numa VPS nova, cria antes (sem login;
# o aplicar.sh liga o login com as senhas da stack no fim).
psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'wtaopt_app') then create role wtaopt_app nologin nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'wtaopt_coleta') then create role wtaopt_coleta nologin nobypassrls; end if;
end $$;
SQL
# Ninguém da aplicação grava durante a restauração (evita travas cruzadas e dados misturados).
religar() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -v app="$SENHA_APP" -v coleta="$SENHA_COLETA" <<'SQL'
alter role wtaopt_app login password :'app';
alter role wtaopt_coleta login password :'coleta';
SQL
}
trap religar EXIT
psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" <<'SQL'
alter role wtaopt_app nologin;
alter role wtaopt_coleta nologin;
select count(pg_terminate_backend(pid)) as conexoes_encerradas from pg_stat_activity
 where usename in ('wtaopt_app', 'wtaopt_coleta') and pid <> pg_backend_pid();
SQL
pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -d "$BANCO" "$ARQ"
# Migrações mais novas que a cópia e senhas de login dos papéis (os papéis não vão na cópia do banco).
PGDATABASE="$BANCO" "$AQUI/../../db/aplicar.sh"
echo "restauração concluída. Religue a api, o worker e a interface."
