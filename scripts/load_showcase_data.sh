#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
project_name=${SHOWCASE_PROJECT_NAME:-production-ops-showcase}
showcase_date=${SHOWCASE_DATE:-2026-09-04}
build_images=true
stop_uat=false

usage() {
    cat <<'USAGE'
Usage: scripts/load_showcase_data.sh [options]

Build an isolated Docker showcase stack, migrate it, replace its local data,
and run every showcase verification check.

Options:
  --date YYYY-MM-DD      Operational date (default: 2026-09-04)
  --project-name NAME    Docker Compose project (must contain "showcase")
  --no-build             Start existing images without rebuilding
  --stop-uat             Stop production-ops-uat first, without deleting data
  -h, --help             Show this help

Password:
  Export DEMO_UAT_PASSWORD (or DEMO_SEED_PASSWORD), or run interactively and
  enter the local-only password when prompted.

Example:
  export DEMO_UAT_PASSWORD='Showcase-Only-2026!'
  ./scripts/load_showcase_data.sh
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --date)
            [[ $# -ge 2 ]] || { echo "--date requires a value." >&2; exit 2; }
            showcase_date=$2
            shift 2
            ;;
        --project-name)
            [[ $# -ge 2 ]] || { echo "--project-name requires a value." >&2; exit 2; }
            project_name=$2
            shift 2
            ;;
        --no-build)
            build_images=false
            shift
            ;;
        --stop-uat)
            stop_uat=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ ! "$showcase_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "The showcase date must use YYYY-MM-DD." >&2
    exit 2
fi

if [[ "$project_name" != *showcase* ]]; then
    echo "Refusing full reset: the Docker project name must contain 'showcase'." >&2
    exit 2
fi

command -v docker >/dev/null 2>&1 || {
    echo "Docker is required." >&2
    exit 2
}
docker compose version >/dev/null 2>&1 || {
    echo "Docker Compose v2 is required (docker compose)." >&2
    exit 2
}

cd "$repository_root"

if [[ ! -f .env.docker ]]; then
    if [[ ! -f .env.docker.example ]]; then
        echo ".env.docker.example is missing." >&2
        exit 2
    fi
    cp .env.docker.example .env.docker
    echo "Created .env.docker from .env.docker.example."
    echo "Review its local passwords before using this stack."
fi

debug_value=$(sed -n 's/^DJANGO_DEBUG=//p' .env.docker | tail -n 1 | tr '[:upper:]' '[:lower:]')
database_url=$(sed -n 's/^DATABASE_URL=//p' .env.docker | tail -n 1)
if [[ "$debug_value" != "true" && "$debug_value" != "1" && "$debug_value" != "yes" ]]; then
    echo "Refusing full reset: .env.docker must set DJANGO_DEBUG=True." >&2
    exit 2
fi
if [[ "$database_url" != postgresql://*@db:*/* ]]; then
    echo "Refusing full reset: .env.docker DATABASE_URL must use the Compose db service." >&2
    exit 2
fi

demo_password=${DEMO_UAT_PASSWORD:-${DEMO_SEED_PASSWORD:-}}
if [[ -z "$demo_password" ]]; then
    if [[ -t 0 ]]; then
        read -r -s -p "Local showcase password: " demo_password
        echo
    else
        echo "Set DEMO_UAT_PASSWORD to a local-only password." >&2
        exit 2
    fi
fi
if [[ ${#demo_password} -lt 8 ]]; then
    echo "The local showcase password must contain at least 8 characters." >&2
    exit 2
fi

compose() {
    docker compose --project-name "$project_name" "$@"
}

failure_report() {
    status=$?
    echo >&2
    echo "Showcase loading failed. Recent web logs:" >&2
    compose logs --tail=100 web >&2 || true
    exit "$status"
}
trap failure_report ERR

docker compose config --quiet

if [[ "$stop_uat" == true ]]; then
    echo "Stopping production-ops-uat without deleting its database volume..."
    docker compose --project-name production-ops-uat down
fi

echo "Starting isolated Docker project: $project_name"
if [[ "$build_images" == true ]]; then
    compose up --build --detach
else
    compose up --detach
fi

echo "Waiting for the web service to become ready..."
ready=false
for _attempt in {1..30}; do
    if compose exec -T web python -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/', timeout=5).close()" \
        >/dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 2
done
if [[ "$ready" != true ]]; then
    echo "The web service did not become ready within 60 seconds." >&2
    exit 1
fi

echo "Applying database migrations..."
compose exec -T web python manage.py migrate --noinput

echo "Checking that no model migration is missing..."
compose exec -T web python manage.py makemigrations --check --dry-run

echo "Replacing records in the isolated showcase database..."
compose exec -T \
    -e DEMO_SEED_PASSWORD="$demo_password" \
    web python manage.py seed_demo_data \
    --date "$showcase_date" \
    --full-reset \
    --confirm-full-reset DELETE-ALL-LOCAL-DATA

echo "Verifying the complete showcase contract..."
compose exec -T web python manage.py verify_demo_data --date "$showcase_date"

trap - ERR

echo
echo "Showcase is ready."
echo "  Project: $project_name"
echo "  Date:    $showcase_date"
echo "  App:     http://localhost:3000/"
echo "  Health:  http://localhost:8000/api/health/"
echo "  Swagger: http://localhost:8000/api/docs/"
echo "  Admin:   http://localhost:8000/admin/"
echo
echo "Accounts (all use the password you supplied):"
echo "  demo.manager"
echo "  demo.leader       (Lines 1 and 2)"
echo "  demo.leader.two   (Lines 3 and 4)"
echo "  demo.leader.three (Lines 5 and 6)"
echo "  demo.support"
echo
echo "Select date $showcase_date and the Day shift after login."
compose ps
