#!/usr/bin/env sh
set -eu

usage() {
    echo "Usage: scripts/backup_postgres.sh [--dry-run] [output-file]" >&2
    exit 2
}

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
    dry_run=true
    shift
fi
if [ "${1:-}" = "--help" ] || [ "${2:-}" != "" ]; then usage; fi

output_file=${1:-"${BACKUP_DIR:-backups}/production_ops-$(date -u +%Y%m%dT%H%M%SZ).dump"}
database_url=${DATABASE_URL:-}
if [ -z "$database_url" ]; then
    echo "DATABASE_URL must be set." >&2
    exit 2
fi
if ! command -v pg_dump >/dev/null 2>&1; then
    echo "pg_dump is required." >&2
    exit 2
fi

case "$output_file" in
    /|""|*/..|*/../*) echo "Refusing unsafe backup path: $output_file" >&2; exit 2 ;;
esac

if [ "$dry_run" = true ]; then
    echo "Backup validation passed: $output_file"
    exit 0
fi

if [ -e "$output_file" ]; then
    echo "Refusing to overwrite existing backup: $output_file" >&2
    exit 2
fi

parent_dir=${output_file%/*}
if [ "$parent_dir" = "$output_file" ]; then parent_dir="."; fi
mkdir -p "$parent_dir"
umask 077
pg_dump --format=custom --no-owner --file="$output_file" "$database_url"
echo "PostgreSQL backup written to $output_file"
