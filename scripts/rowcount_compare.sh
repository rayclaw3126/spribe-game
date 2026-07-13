#!/usr/bin/env bash
# newly-authored 2026-07-13 (this session). Pure-ASCII on purpose (runs against LATIN1 too).
# Per-table row-count diff between two databases on the same server.
# Usage: rowcount_compare.sh <host> <port> <user> <db_old> <db_new> [schema]
#   Reads password from $PGPASSWORD. Exits 0 iff every table count is equal.
set -euo pipefail

HOST=${1:?host}; PORT=${2:?port}; USER=${3:?user}
DB_OLD=${4:?db_old}; DB_NEW=${5:?db_new}; SCHEMA=${6:-public}

q() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -tAc "$2"; }

# Table list from the OLD db (source of truth for what must be preserved).
TABLES=$(q "$DB_OLD" "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='${SCHEMA}' AND table_type='BASE TABLE'
  ORDER BY table_name;")

# Guardrail: 0 tables in the schema => wrong/empty schema. Abort with non-zero instead
# of walking an empty table list and printing a bogus 0-vs-0 "all equal" green.
# (Empty check first -- do NOT put a failing `grep -c` in an assignment; set -e would
#  kill the script silently before this message ever prints.)
if [ -z "$TABLES" ]; then
  echo "ERROR: schema '${SCHEMA}' has 0 BASE TABLE in db '${DB_OLD}' -- wrong schema name?" >&2
  echo "       refusing empty compare (would falsely report equal). exit 2." >&2
  exit 2
fi
n_tables=$(printf '%s\n' "$TABLES" | grep -c . || true)
echo "(schema '${SCHEMA}': ${n_tables} tables to compare)"

printf '%-24s %12s %12s  %s\n' "TABLE" "$DB_OLD" "$DB_NEW" "STATUS"
printf '%s\n' "------------------------------------------------------------------"
fail=0; total_old=0; total_new=0
while IFS= read -r t; do
  [ -z "$t" ] && continue
  c_old=$(q "$DB_OLD" "SELECT count(*) FROM \"${SCHEMA}\".\"${t}\";")
  c_new=$(q "$DB_NEW" "SELECT count(*) FROM \"${SCHEMA}\".\"${t}\";")
  total_old=$((total_old + c_old)); total_new=$((total_new + c_new))
  if [ "$c_old" = "$c_new" ]; then st="OK"; else st="MISMATCH"; fail=1; fi
  printf '%-24s %12s %12s  %s\n' "$t" "$c_old" "$c_new" "$st"
done <<< "$TABLES"
printf '%s\n' "------------------------------------------------------------------"
printf '%-24s %12s %12s  %s\n' "TOTAL" "$total_old" "$total_new" \
  "$([ "$total_old" = "$total_new" ] && echo OK || echo MISMATCH)"

if [ "$fail" -ne 0 ]; then
  echo "RESULT: MISMATCH -- do NOT switch, roll back." >&2
  exit 1
fi
echo "RESULT: all tables equal."
