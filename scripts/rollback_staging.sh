#!/usr/bin/env sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_root"

previous_env="$repository_root/.deploy/previous.env"
if [ ! -f "$previous_env" ]; then
    echo "No previous immutable release is recorded in .deploy/previous.env." >&2
    exit 2
fi

compose() {
    docker compose --env-file "$previous_env" -f compose.staging.yml "$@"
}

compose config --quiet
compose pull
compose up -d --remove-orphans web reminders frontend gateway

attempt=1
while [ "$attempt" -le 12 ]; do
    if compose exec -T web python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/ready/', timeout=5).close()"; then
        if [ -f .deploy/active.env ]; then
            cp .deploy/active.env .deploy/failed.env
        fi
        cp "$previous_env" .deploy/active.env
        echo "Previous application images restored."
        echo "Database migrations were not reversed."
        compose ps
        exit 0
    fi

    attempt=$((attempt + 1))
    sleep 5
done

echo "Rollback images started, but readiness did not recover." >&2
exit 1
