#!/usr/bin/env bash
# Backup → encrypt → restore → verify drill for the PostgreSQL database (ADR 0017).
#
#   SRC_DB=ghayarly scripts/ops/db-backup-restore-drill.sh
#
# 1. pg_dump (custom format) streamed straight into `age` — the backup never touches disk in clear;
# 2. the encrypted file is checked for leaked plaintext (a known synthetic e-mail);
# 3. it is decrypted and restored into a fresh scratch database;
# 4. row counts of every table, RLS flags, policies, functions and the migration ledger of the
#    restored copy are compared with the source;
# 5. the scratch database and the files are destroyed; durations are reported (RTO evidence).
# Run it on development or staging data. In production the same steps run in the hosting
# provider's backup tooling (point-in-time recovery) with the age private key held offline.
# PGRUN says how to run PostgreSQL client tools as a role allowed to create databases.
set -euo pipefail
SRC_DB="${SRC_DB:-ghayarly}"
PGRUN="${PGRUN:-runuser -u postgres --}"
PROBE="${PROBE:-patient.demo@demo.ghayarly.test}"
DRILL_DB="dmw_restore_drill_$(date +%s)"
WORK="$(mktemp -d)"
cleanup() {
  $PGRUN dropdb --if-exists "$DRILL_DB" >/dev/null 2>&1 || true
  find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
chmod 700 "$WORK"
psqlq() { $PGRUN psql -X -v ON_ERROR_STOP=1 -d "$1" -At "${@:2}"; }

age-keygen -o "$WORK/drill-key.txt" 2>/dev/null
RECIPIENT="$(age-keygen -y "$WORK/drill-key.txt")"

t0=$(date +%s.%N)
$PGRUN pg_dump -Fc "$SRC_DB" | age -r "$RECIPIENT" -o "$WORK/backup.dump.age"
t1=$(date +%s.%N)
size=$(stat -c %s "$WORK/backup.dump.age")
echo "backup: $(numfmt --to=iec "$size") encrypted (age X25519), $(printf '%.1f' "$(echo "$t1 - $t0" | bc)") s"
fail=0
if grep -qa "$PROBE" "$WORK/backup.dump.age"; then echo "✗ plaintext visible in the encrypted backup"; fail=1; else echo "✓ no plaintext in the encrypted backup"; fi

$PGRUN createdb -T template0 "$DRILL_DB"
t2=$(date +%s.%N)
age -d -i "$WORK/drill-key.txt" "$WORK/backup.dump.age" | $PGRUN pg_restore --exit-on-error -d "$DRILL_DB"
t3=$(date +%s.%N)
echo "restore into $DRILL_DB: $(printf '%.1f' "$(echo "$t3 - $t2" | bc)") s"

# Fingerprints of the source and the restored copy.
snapshot() {
  local db="$1"
  {
    psqlq "$db" -c "select format('select %L || ''|'' || count(*) from %I.%I;', n.nspname || '.' || c.relname, n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('app','auth','meta','public') order by 1" | psqlq "$db"
    psqlq "$db" -c "select 'rls|' || n.nspname || '.' || c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('app','auth') order by 1"
    psqlq "$db" -c "select 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || cmd || '|' || md5(coalesce(qual,'') || coalesce(with_check,'')) from pg_policies order by 1"
    psqlq "$db" -c "select 'function|' || n.nspname || '.' || p.proname || '|' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','auth','meta') and p.prokind in ('f','p') order by 1"
    psqlq "$db" -c "select 'migration|' || version || '|' || checksum from meta.schema_migrations order by 1"
  } | sort
}
snapshot "$SRC_DB" > "$WORK/source.txt"
snapshot "$DRILL_DB" > "$WORK/restored.txt"
tables=$(grep -vc '^\(rls\|policy\|function\|migration\)|' "$WORK/source.txt")
rows=$(grep -v '^\(rls\|policy\|function\|migration\)|' "$WORK/source.txt" | awk -F'|' '{s+=$2} END {print s}')
policies=$(grep -c '^policy|' "$WORK/source.txt")
functions=$(grep -c '^function|' "$WORK/source.txt")
migrations=$(grep -c '^migration|' "$WORK/source.txt")
if diff -q "$WORK/source.txt" "$WORK/restored.txt" >/dev/null; then
  echo "✓ restored copy identical: $tables tables / $rows rows, RLS flags, $policies policies, $functions functions, $migrations migrations"
else
  echo "✗ restored copy differs:"; diff "$WORK/source.txt" "$WORK/restored.txt" | head -20; fail=1
fi
# Row-level security still holds in the copy: the application role sees nothing without a user context.
leak=$(psqlq "$DRILL_DB" -c "set role ghayarly_app; select count(*) from app.patients;" 2>/dev/null | tail -1 || echo "error")
if [ "$leak" = "0" ]; then echo "✓ RLS enforced in the restored copy (application role without user context sees 0 patients)"; else echo "✗ application role read $leak patients without a user context"; fail=1; fi

echo "total drill time: $(printf '%.1f' "$(echo "$(date +%s.%N) - $t0" | bc)") s"
[ "$fail" -eq 0 ] && echo "DRILL PASSED" || echo "DRILL FAILED"
exit "$fail"
