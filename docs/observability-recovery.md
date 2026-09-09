# Observability, Backup and Recovery

This toolkit is a pilot-safe contract for inspecting service health and recovering
the PostgreSQL data volume. It does not provision cloud monitoring, send alerts,
or approve a production restore.

## Observability endpoint

An authenticated management staff user can request:

```
GET /api/observability/summary/
Authorization: Bearer <access-token>
```

The response reports application, PostgreSQL, Redis, and reminder-worker status.
A `ready` response means the application dependencies respond; a `degraded`
response requires investigation before pilot use. The endpoint is read-only and
does not expose credentials or database contents. Non-staff users receive
`403 Forbidden`.

Use `/api/health/live/` for process uptime and `/api/health/ready/` for
load-balancer dependency readiness. Connect these endpoints to the approved
uptime/error monitoring provider outside this repository.

## Backup

Set `DATABASE_URL` in the approved environment and validate the command first:

```sh
sh scripts/backup_postgres.sh --dry-run backups/pilot.dump
sh scripts/backup_postgres.sh backups/pilot.dump
```

Backups use PostgreSQL custom format, are created with mode 0600 through the
process umask, and never overwrite an existing file. Store the resulting file in
an encrypted, access-controlled backup location and record its UTC timestamp,
commit/release SHA, and checksum.

Recommended pilot target:

- RPO: 24 hours maximum until an approved managed backup schedule exists.
- Keep at least seven daily and four weekly encrypted copies.
- Test one restore every month in an isolated database.

## Restore

A restore replaces database contents and is intentionally fail-closed:

```sh
sh scripts/restore_postgres.sh --dry-run backups/pilot.dump
CONFIRM_RESTORE=YES sh scripts/restore_postgres.sh backups/pilot.dump
```

Before restoring, stop application writers, verify the target `DATABASE_URL`,
confirm the backup checksum, and capture the current release and database
snapshot. Never restore production data into a developer or UAT environment.
After restoring, run migrations only when the release requires them, check
`/api/health/ready/`, sign in with a staff account, and verify a representative
read-only dashboard query.

Target RTO for the pilot is 4 hours, subject to the approved host, storage, and
operator access. If readiness or data verification fails, stop traffic and use
the previously recorded immutable application release; do not reverse migrations
automatically.

## Alert contract

The approved external monitor should alert on:

1. liveness failure for two consecutive checks;
2. readiness failure for five minutes;
3. observability status `degraded`;
4. reminder-worker status `attention` or `not_started`;
5. backup age older than the agreed RPO;
6. restore verification failure.

Alert routing, escalation, retention, and maintenance windows must be configured
by the pilot owner in the approved monitoring system. No provider credentials
belong in this repository.
