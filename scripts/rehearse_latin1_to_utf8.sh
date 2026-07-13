#!/usr/bin/env bash
# newly-authored 2026-07-13 (this session).
# LOCAL rehearsal of the path-A LATIN1 -> UTF8 migration. ZERO prod, ZERO touch of the
# machine's real 5432 cluster: spins up a throwaway private PG cluster in a scratch dir
# (initdb -> we are its superuser), on a nonstandard port, and rm -rf's it at the end.
#
# Mirrors prod build: server/sql/*.sql (11 files, no 009) + seed_demo.mjs into a LATIN1 db,
# then pg_dump -> createdb UTF8 -> restore -> rowcount_compare -> Chinese INSERT/SELECT.
set -euo pipefail

REPO=/home/userray/spribe-game
SQLDIR=$REPO/server/sql
PGBIN=/usr/lib/postgresql/16/bin
SCRATCH=${SCRATCH:-/tmp/claude-1000/-home-userray-spribe-game/4a5ba050-2e13-46be-b7e0-fea7be991614/scratchpad}
PORT=59432
CLUSTER=$SCRATCH/pgcluster
SOCK=/tmp/pgr$PORT   # short path: 107-byte unix-socket limit; clients use TCP anyway
LOG=$SCRATCH/pg.log
DUMP=$SCRATCH/latin1.dump.sql
SCHEMA=spribe_dev
L1=spribe_latin1
UTF=spribe_utf8
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=$USER
PSQL="$PGBIN/../bin/psql"; command -v psql >/dev/null && PSQL=psql

ms() { date +%s%3N; }
dur() { echo "$(( $2 - $1 )) ms"; }
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

stop_cluster() {
  if [ -d "$CLUSTER" ]; then "$PGBIN/pg_ctl" -D "$CLUSTER" -m immediate stop >/dev/null 2>&1 || true; fi
}
trap 'rc=$?; stop_cluster; [ $rc -ne 0 ] && echo "FAILED (rc=$rc). data dir left at $CLUSTER for inspection; see $LOG"; exit $rc' EXIT

# ---------------------------------------------------------------- 0. fresh cluster
say "0. initdb throwaway cluster ($CLUSTER) + start on :$PORT"
rm -rf "$CLUSTER"; mkdir -p "$SOCK"
"$PGBIN/initdb" -D "$CLUSTER" --auth-local=trust --auth-host=trust -U "$USER" -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$CLUSTER" -l "$LOG" \
  -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" -w start >/dev/null
echo "cluster up, superuser=$USER"

# ---------------------------------------------------------------- 1. build LATIN1 "prod"
say "1. create LATIN1 db + load 11 SQL (client_encoding=LATIN1, search_path=$SCHEMA)"
createdb -h 127.0.0.1 -p "$PORT" -U "$USER" \
  --encoding=LATIN1 --template=template0 --lc-collate=C --lc-ctype=C "$L1"
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1" -qc "CREATE SCHEMA IF NOT EXISTS $SCHEMA;"
enc=$(psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1" -tAc "SHOW server_encoding;")
echo "  $L1 server_encoding = $enc"
t0=$(ms)
for f in 001_schema 002_seed 003_seed_multilevel 004_provably_fair 005_issues \
         006_issue_images 007_tenants 008_agents_tenant 010_risk_alerts \
         011_tenant_skin_codes 012_round_scheduler; do
  PGCLIENTENCODING=LATIN1 PGOPTIONS="-c search_path=$SCHEMA" \
    psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1" -v ON_ERROR_STOP=1 -q -f "$SQLDIR/$f.sql"
  echo "  loaded $f.sql"
done
t1=$(ms); echo "  [time] 11 SQL load: $(dur $t0 $t1)"

# latin1 high-byte probe (e-acute = byte 0xe9): proves real latin1->utf8, not just ASCII passthrough
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1" -qc \
  "CREATE TABLE $SCHEMA._enc_probe(id int primary key, s text);"
PGCLIENTENCODING=LATIN1 psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1" -qc \
  "INSERT INTO $SCHEMA._enc_probe(id,s) VALUES (1, E'caf\xe9');"
echo "  probe id=1 inserted (latin1 'cafe'+0xe9)"

say "1b. seed_demo.mjs into $L1 (all-ASCII data, via node pg)"
export DB_URL="postgres://$USER@127.0.0.1:$PORT/$L1?options=-c%20search_path%3D$SCHEMA"
t2=$(ms)
( cd "$REPO/server" && node scripts/seed_demo.mjs )
t3=$(ms); echo "  [time] seed_demo: $(dur $t2 $t3)"

# ---------------------------------------------------------------- 2. path A
say "2. A1 pg_dump $L1 (plain SQL)"
t4=$(ms)
pg_dump -h 127.0.0.1 -p "$PORT" -U "$USER" -Fp -f "$DUMP" "$L1"
t5=$(ms)
echo "  [time] pg_dump: $(dur $t4 $t5)"
echo "  [size] dump = $(du -h "$DUMP" | cut -f1) ($(stat -c %s "$DUMP") bytes)"
echo "  dump client_encoding line: $(grep -m1 -i 'client_encoding' "$DUMP")"

say "2. A2 create new UTF8 db $UTF"
createdb -h 127.0.0.1 -p "$PORT" -U "$USER" \
  --encoding=UTF8 --template=template0 --lc-collate=C --lc-ctype=C "$UTF"

say "2. A3 restore dump -> $UTF"
t6=$(ms)
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1 -q -d "$UTF" -f "$DUMP"
t7=$(ms)
echo "  [time] restore: $(dur $t6 $t7)"
echo "  $UTF server_encoding = $(psql -h 127.0.0.1 -p $PORT -U $USER -d $UTF -tAc 'SHOW server_encoding;')"

# ---------------------------------------------------------------- 3. hard metrics
say "3a. rowcount_compare $L1 vs $UTF (schema $SCHEMA)"
PGPASSWORD= bash "$REPO/scripts/rowcount_compare.sh" 127.0.0.1 "$PORT" "$USER" "$L1" "$UTF" "$SCHEMA"
rc_cmp=$?

say "3b. Chinese INSERT + SELECT read-back in UTF8 db"
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$UTF" -qc \
  "INSERT INTO $SCHEMA._enc_probe(id,s) VALUES (2, '中文测试roundtrip');"
echo "  read-back:"
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$UTF" -c \
  "SELECT id, s, length(s) AS chars, octet_length(s) AS bytes FROM $SCHEMA._enc_probe WHERE id=2;"
zh=$(psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$UTF" -tAc \
  "SELECT s FROM $SCHEMA._enc_probe WHERE id=2;")
[ "$zh" = "中文测试roundtrip" ] && echo "  CHINESE ROUNDTRIP: OK ('$zh')" || { echo "  CHINESE ROUNDTRIP: FAIL ('$zh')"; exit 3; }

say "3c. latin1 probe id=1 fidelity (café: bytes 4 in LATIN1 -> 5 in UTF8)"
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1"  -c \
  "SELECT 'LATIN1' db, s, length(s) chars, octet_length(s) bytes FROM $SCHEMA._enc_probe WHERE id=1;"
psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$UTF" -c \
  "SELECT 'UTF8'   db, s, length(s) chars, octet_length(s) bytes FROM $SCHEMA._enc_probe WHERE id=1;"
ob_l1=$(psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1"  -tAc "SELECT octet_length(s) FROM $SCHEMA._enc_probe WHERE id=1;")
ob_u8=$(psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$UTF" -tAc "SELECT octet_length(s) FROM $SCHEMA._enc_probe WHERE id=1;")
{ [ "$ob_l1" = 4 ] && [ "$ob_u8" = 5 ]; } && echo "  LATIN1->UTF8 CONVERSION: OK (4B -> 5B)" || echo "  LATIN1->UTF8 CONVERSION: unexpected (l1=$ob_l1 u8=$ob_u8)"

say "3d. control: same Chinese INSERT into the LATIN1 db must FAIL"
if PGCLIENTENCODING=UTF8 psql -h 127.0.0.1 -p "$PORT" -U "$USER" -d "$L1" -v ON_ERROR_STOP=1 -qc \
     "INSERT INTO $SCHEMA._enc_probe(id,s) VALUES (3, '中文');" 2>"$SCRATCH/l1err.txt"; then
  echo "  UNEXPECTED: Chinese insert into LATIN1 SUCCEEDED (should have failed)"
else
  echo "  as expected, LATIN1 rejected it. error verbatim:"
  sed 's/^/    /' "$SCRATCH/l1err.txt"
fi

# ---------------------------------------------------------------- 4. summary + cleanup
say "4. SUMMARY"
echo "  dump size            : $(du -h "$DUMP" | cut -f1) ($(stat -c %s "$DUMP") bytes)"
echo "  11-SQL load          : $(dur $t0 $t1)"
echo "  seed_demo            : $(dur $t2 $t3)"
echo "  pg_dump (A1)         : $(dur $t4 $t5)"
echo "  restore  (A3)        : $(dur $t6 $t7)"
echo "  dump+restore (window): $(( (t5-t4) + (t7-t6) )) ms"
echo "  rowcount compare rc  : $rc_cmp (0 = all tables equal)"

say "5. cleanup (stop cluster + rm scratch DB dir)"
stop_cluster
rm -rf "$CLUSTER" "$SOCK" "$DUMP" "$SCRATCH/l1err.txt"
trap - EXIT
echo "  removed $CLUSTER (throwaway). log kept at $LOG"
echo "DONE."
