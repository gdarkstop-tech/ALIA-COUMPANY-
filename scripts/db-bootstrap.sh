#!/usr/bin/env bash
# Creates the three PostgreSQL roles and the dev/test databases.
#
#   ghayarly_owner : owns schemas/tables; used ONLY by migrations & seed scripts.
#   ghayarly_app   : domain API connection. Not owner, NOBYPASSRLS → Row Level Security applies.
#   ghayarly_auth  : Better Auth connection. Privileges limited to the `auth` schema.
#
# Usage (native Postgres):  PSQL="sudo -u postgres psql" bash scripts/db-bootstrap.sh
#        (docker compose):  executed automatically from infra/postgres/init.
set -euo pipefail

PSQL="${PSQL:-psql -U postgres}"
OWNER_PW="${GHAYARLY_OWNER_PASSWORD:-ghayarly_owner_dev}"
APP_PW="${GHAYARLY_APP_PASSWORD:-ghayarly_app_dev}"
AUTH_PW="${GHAYARLY_AUTH_PASSWORD:-ghayarly_auth_dev}"
DATABASES="${GHAYARLY_DATABASES:-ghayarly ghayarly_test}"

$PSQL -v ON_ERROR_STOP=1 -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ghayarly_owner') THEN
    CREATE ROLE ghayarly_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${OWNER_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ghayarly_app') THEN
    CREATE ROLE ghayarly_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '${APP_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ghayarly_auth') THEN
    CREATE ROLE ghayarly_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '${AUTH_PW}';
  END IF;
END
\$\$;
ALTER ROLE ghayarly_app SET search_path = app, public;
ALTER ROLE ghayarly_auth SET search_path = auth;
SQL

for db in $DATABASES; do
  if ! $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" -d postgres | grep -q 1; then
    $PSQL -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE ${db} OWNER ghayarly_owner ENCODING 'UTF8' TEMPLATE template0"
  fi
  $PSQL -v ON_ERROR_STOP=1 -d "$db" <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${db} TO ghayarly_app, ghayarly_auth;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
  echo "✓ database ${db} ready"
done
