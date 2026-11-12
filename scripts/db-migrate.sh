#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SPARKLEWASH_MIGRATION_DATABASE_URL:-}" ]]; then
  echo "Set SPARKLEWASH_MIGRATION_DATABASE_URL to a protected PostgreSQL connection string." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to apply Car Spa database migrations." >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to safely prepare the temporary libpq password file." >&2
  exit 2
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/sparklewash-migrate.XXXXXX")
chmod 700 "$work_dir"
trap 'rm -rf "$work_dir"' EXIT

# Parse the URL into libpq environment settings and a mode-0600 pgpass file so
# the database password does not appear in psql's process arguments.
export SPARKLEWASH_MIGRATION_WORK_DIR="$work_dir"
python3 <<'PY'
import os
import pathlib
import shlex
import urllib.parse

raw = os.environ.pop("SPARKLEWASH_MIGRATION_DATABASE_URL")
url = urllib.parse.urlsplit(raw)
if url.scheme not in ("postgres", "postgresql") or not url.hostname or not url.username or not url.password:
    raise SystemExit("Migration URL must include a PostgreSQL host and login credentials.")
query = dict(urllib.parse.parse_qsl(url.query, keep_blank_values=True))
host = url.hostname
port = str(url.port or 5432)
database = urllib.parse.unquote(url.path.lstrip("/"))
user = urllib.parse.unquote(url.username)
password = urllib.parse.unquote(url.password)
if not database:
    raise SystemExit("Migration URL must include a database name.")

def pgpass_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")

work = pathlib.Path(os.environ["SPARKLEWASH_MIGRATION_WORK_DIR"])
passfile = work / "pgpass"
passfile.write_text(":".join(map(pgpass_escape, (host, port, database, user, password))) + "\n")
passfile.chmod(0o600)

settings = {
    "PGHOST": host,
    "PGPORT": port,
    "PGDATABASE": database,
    "PGUSER": user,
    "PGPASSFILE": str(passfile),
    "PGSSLMODE": query.get("sslmode", "verify-full"),
    "PGCHANNELBINDING": query.get("channel_binding", "prefer"),
}
if settings["PGSSLMODE"] == "verify-full":
    settings["PGSSLROOTCERT"] = query.get("sslrootcert", "system")

envfile = work / "connection.env"
envfile.write_text("".join(f"export {key}={shlex.quote(value)}\n" for key, value in settings.items()))
envfile.chmod(0o600)
PY
source "$work_dir/connection.env"
unset SPARKLEWASH_MIGRATION_DATABASE_URL SPARKLEWASH_MIGRATION_WORK_DIR

psql --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS sparklewash;
CREATE TABLE IF NOT EXISTS sparklewash.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in "$root"/backend/db/migrations/*.sql; do
  [[ -f "$migration" ]] || continue
  version=$(basename "$migration" .sql)
  applied=$(psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --variable=version="$version" <<'SQL'
SELECT 1 FROM sparklewash.schema_migrations WHERE version = :'version';
SQL
  )
  if [[ "$applied" == "1" ]]; then
    printf 'Already applied: %s\n' "$version"
    continue
  fi
  printf 'Applying: %s\n' "$version"
  psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 \
    --variable=version="$version" \
    --file="$migration"
done
