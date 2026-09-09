#!/usr/bin/env sh
set -eu

usage() {
    echo "Usage: scripts/restore_postgres.sh [--dry-run] backup-file" >&2
    exit 2
}

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
    dry_run=true
    shift
fi
if [ "${1:-}" = "" ] || [ "${2:-}" != "" ]; then usage; fi

input_file=$1
database_url=${DATABASE_URL:-}
if [ -z "$database_url" ]; then
    echo "DATABASE_URL must be set." >&2
    exit 2
fi
if [ ! -f "$input_file" ]; then
    echo "Backup file does not exist: $input_file" >&2
    exit 2
fi
if ! command -v pg_restore >/dev/null 2>&1; then
    echo "pg_restore is required." >&2
    exit 2
fi

if [ "$dry_run" = true ]; then
    echo "Restore validation passed: $input_file"
    exit 0
fi

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
    echo "Set CONFIRM_RESTORE=YES to replace database contents." >&2
    exit 2
fi

pg_restore --clean --if-exists --no-owner --dbname="$database_url" "$input_file"
echo "PostgreSQL restore completed from $input_file"
