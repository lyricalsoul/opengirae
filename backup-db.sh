#!/bin/sh
set -e
OUT="$HOME/Downloads/girae-backup-$(date +%Y%m%d-%H%M%S).dump"
/Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump "postgres://opengirae:amywinehouse@dev.db.girae.tailwhip:5432/girae" -Fc -v --exclude-schema=dbos -f "$OUT"
echo "done: $OUT"
