# Secure Staging Deployment Runbook

This runbook deploys one approved, immutable application release to a single
staging host. It does not provision infrastructure or grant permission to use
real employee or production data.

## Architecture and trust boundary

Only Caddy publishes host ports 80 and 443. Caddy obtains and renews the TLS
certificate, then forwards requests to the frontend container. Nginx serves the
PWA and proxies same-origin API and WebSocket traffic to Django. PostgreSQL,
Redis, Django, and the reminder worker stay on an internal Docker network.

Redis requires a password even on the private network. Django trusts the
`X-Forwarded-Proto` header only when the explicit staging setting enables it.
The deployment validator rejects DEBUG mode, wildcard hosts, HTTP CSRF origins,
SQLite, unauthenticated Redis, insecure cookies, insufficient HSTS, and a
missing trusted-proxy boundary.

## Required approvals and resources

Before deployment, obtain:

- an approved Linux host with current Docker Engine and Docker Compose
- a dedicated staging hostname with DNS pointing to the host
- inbound TCP 80/443 and UDP 443 access for Caddy
- a monitored operations email address for ACME certificate notices
- a GitHub `staging-release` Environment with required reviewers
- a GitHub token on the host with read-only access to the two GHCR packages
- unique Django, PostgreSQL, and Redis secrets from an approved secret store
- a tested PostgreSQL backup destination and named incident owner

Do not use demo users, the demo password, `seed_demo_data`, or real factory
records until the data owner approves the staging dataset.

## Publish an immutable release

1. Merge a fully green pull request into `main`.
2. Open **Actions → Publish staging release → Run workflow** on `main`.
3. Complete the GitHub Environment approval.
4. Copy the exact backend and frontend SHA-tagged image names from the workflow
   summary. Never replace them with `latest`.

The workflow builds from the selected `main` commit and publishes:

- `ghcr.io/masumtech/production-ops-api-web:<full-commit-sha>`
- `ghcr.io/masumtech/production-ops-api-frontend:<full-commit-sha>`

## Prepare the staging host

Clone the repository and authenticate Docker to GHCR. Copy
`.env.staging.example` to a root-owned location outside the repository, then
replace every example value. Keep the file mode at `0600`.

The following values must agree:

| Setting | Required value |
|---|---|
| `APP_DOMAIN` | Approved DNS hostname |
| `DJANGO_ALLOWED_HOSTS` | The same hostname |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://` plus the same hostname |
| `WEB_IMAGE` | Exact backend SHA tag from the release workflow |
| `FRONTEND_IMAGE` | Exact frontend SHA tag from the release workflow |
| `DATABASE_URL` | Password must match `POSTGRES_PASSWORD` |
| `REDIS_URL` | Password must match `REDIS_PASSWORD` |

Generate secrets with an approved password manager. Do not paste secrets into
GitHub issues, pull requests, Actions logs, screenshots, shell history, or this
repository.

## Deploy

From the repository root on the staging host:

```bash
scripts/deploy_staging.sh /secure/path/release.env
```

The script validates Compose, pulls the immutable images, runs Django's
deployment checks, applies migrations explicitly, starts the services, and
waits for PostgreSQL and Redis readiness. Only a successful release becomes
`.deploy/active.env`; the preceding successful release is retained locally as
`.deploy/previous.env`.

## Verify

Check the public and internal boundaries:

```bash
curl --fail --silent --show-error https://your-staging-host/api/health/live/
curl --fail --silent --show-error https://your-staging-host/api/health/ready/
docker compose --env-file /secure/path/release.env -f compose.staging.yml ps
docker compose --env-file /secure/path/release.env -f compose.staging.yml logs --tail=100 web reminders gateway
```

Then verify login, Team Leader line updates, Manager Console views, Support
acknowledgement, notification delivery, and the Pilot Admin heartbeat using
approved non-production accounts.

## Application rollback

If the new application images fail but the database remains compatible:

```bash
scripts/rollback_staging.sh
```

Rollback restores the previously recorded backend and frontend images. It does
not reverse migrations, delete containers, delete volumes, or restore a
database. Review every migration for backward compatibility before release.
Database reversal or restore is an incident-managed action requiring a verified
backup and explicit approval.

Never run `docker compose down --volumes` during deployment or rollback.

## Remaining production boundary

This staging foundation does not provide a server, DNS, off-host backups,
central log retention, external uptime alerts, SSO, notification-provider
credentials, or factory UAT approval. Those controls must be completed and
owned before a production rollout.
