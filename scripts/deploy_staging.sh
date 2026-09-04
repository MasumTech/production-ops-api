#!/usr/bin/env sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_root"

release_env=${1:-}
if [ -z "$release_env" ] || [ ! -f "$release_env" ]; then
    echo "Usage: scripts/deploy_staging.sh /secure/path/release.env" >&2
    exit 2
fi

case "$release_env" in
    /*) ;;
    *) release_env="$repository_root/$release_env" ;;
esac

compose() {
    docker compose --env-file "$release_env" -f compose.staging.yml "$@"
}

compose config --quiet

mkdir -p .deploy
chmod 700 .deploy
umask 077
if [ -f .deploy/active.env ]; then
    cp .deploy/active.env .deploy/previous.env
fi

compose pull
compose --profile tools run --rm migrate python manage.py check --deploy --fail-level WARNING
compose --profile tools run --rm migrate python manage.py check_deployment_readiness
compose --profile tools run --rm migrate
compose up -d --remove-orphans db redis web reminders frontend gateway

attempt=1
while [ "$attempt" -le 12 ]; do
    if compose exec -T web python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/ready/', timeout=5).close()"; then
        cp "$release_env" .deploy/active.env
        echo "Staging release is ready."
        compose ps
        exit 0
    fi

    attempt=$((attempt + 1))
    sleep 5
done

echo "Staging readiness check failed; inspect logs before rollback." >&2
exit 1
