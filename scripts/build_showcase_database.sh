#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
showcase_db=${1:-"${repo_root}/showcase-production-ops.sqlite3"}
showcase_date=${2:-"2026-09-04"}

if [[ -z "${DEMO_SEED_PASSWORD:-}" ]]; then
    echo "Set DEMO_SEED_PASSWORD to a local-only password with at least 8 characters." >&2
    exit 1
fi

if [[ $(basename "${showcase_db}") != *showcase*.sqlite3 ]]; then
    echo "The output filename must contain 'showcase' and end in .sqlite3." >&2
    exit 1
fi

mkdir -p "$(dirname "${showcase_db}")"

export DATABASE_URL="sqlite:///${showcase_db}"
export DJANGO_DEBUG="true"
export DJANGO_SECRET_KEY="local-showcase-build-only-not-for-deployment"
export DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1"
export REDIS_URL=""

cd "${repo_root}"
python manage.py migrate --noinput
python manage.py seed_demo_data \
    --date "${showcase_date}" \
    --password "${DEMO_SEED_PASSWORD}" \
    --full-reset \
    --confirm-full-reset DELETE-ALL-LOCAL-DATA
python manage.py verify_demo_data --date "${showcase_date}"

echo "Showcase database: ${showcase_db}"
echo "Operational date: ${showcase_date}"
echo "Use the password supplied through DEMO_SEED_PASSWORD."
