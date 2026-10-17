#!/usr/bin/env bash
# Restaura uma cópia feita por copiar.sh. APAGA o conteúdo atual do banco de destino.
# Antes: pare a api, o worker e a interface (no Portainer, escala 0) para ninguém gravar durante a restauração.
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
echo "restaurando $ARQ em \"$BANCO\"..."
# Os papéis da aplicação não vão dentro da cópia do banco: numa VPS nova, cria antes (sem login;
# o aplicar.sh liga o login com as senhas da stack no fim).
psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'wtaopt_app') then create role wtaopt_app nologin nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'wtaopt_coleta') then create role wtaopt_coleta nologin nobypassrls; end if;
end $$;
SQL
pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -d "$BANCO" "$ARQ"
# Migrações mais novas que a cópia e senhas de login dos papéis (os papéis não vão na cópia do banco).
PGDATABASE="$BANCO" "$AQUI/../../db/aplicar.sh"
echo "restauração concluída. Religue a api, o worker e a interface."
