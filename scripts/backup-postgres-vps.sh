#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${VD_STORE_BACKUP_DIR:-/var/backups/vd-store-postgres}"
DATABASE="${VD_STORE_DATABASE:-vdstore}"
RETENTION_DAYS="${VD_STORE_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/${DATABASE}-${STAMP}.dump"

install -d -o postgres -g postgres -m 700 "$BACKUP_DIR"
runuser -u postgres -- pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$TARGET" \
  "$DATABASE"

runuser -u postgres -- pg_restore --list "$TARGET" >/dev/null
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DATABASE}-*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "PostgreSQL backup created: $TARGET"
