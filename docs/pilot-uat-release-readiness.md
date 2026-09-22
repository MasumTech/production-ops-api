# Pilot UAT Release Readiness Pack

This pack defines the final evidence and human approvals required to take the
Multi-Line Production Operations Platform into a controlled, non-production
factory pilot. It does not authorise production use.

## Release candidate identity

Record these values before testing:

| Evidence | Required value |
|---|---|
| Release commit | Exact full Git SHA from `main` |
| Pull-request CI | Successful run for the release commit |
| Main-branch CI | Successful push run for the same commit |
| Backend image | Immutable `ghcr.io/...-web:<full-sha>` tag |
| Frontend image | Immutable `ghcr.io/...-frontend:<full-sha>` tag |
| UAT date | Agreed operational date |
| Evidence owner | Named person responsible for the evidence register |

A release candidate is invalid if any Git SHA differs between the approved
source, CI evidence, published images, and deployed environment.

## Implemented acceptance scope

### Team Leader workspace

- shared Operations Control Board layout on desktop, tablet, and phone
- My Lines with one-to-three assigned lines and Green/Amber/Red priority order
- Daily Plan with shift-derived production timeline and two protected
  40-minute breaks
- Materials with Ready, In Process, Short, and Held workflows
- Break & Recovery with the protected Fault → Break → Returned → Checks →
  Running lifecycle
- Shift Handover with open-item ownership and receiver acceptance
- Raise Issue with Describe → Support → Follow-up, protected evidence, draft,
  support-request, and escalation actions

### Operations Manager workspace

- before-shift and live overview
- Team Leaders and line control
- Daily plans
- Materials and actions
- Break recovery and loss history
- explainable daily risk briefing

### Cross-role contract

A Team Leader operational or material escalation must persist exactly once and
surface to Operations Manager views for the same operational date. Permissions,
idempotency, notifications, refresh fallback, and live-event delivery remain
part of the automated and manual acceptance boundary.

## Shift-time contract

| Operational date | Default day shift |
|---|---|
| Monday–Friday | 06:45–18:00 |
| Saturday–Sunday | 07:00–18:00 |

An effective Operations Manager override is authoritative. Timeline blocks,
downtime buckets, plan progress, demo timestamps, and headers must use the same
resolved shift window. The weekday 06:45–07:00 interval is a real 15-minute
segment and must not be discarded or stretched to a full hour.

## Prepare deterministic demo data

Use local development or an explicitly approved non-production environment
only.

```bash
python manage.py migrate
python manage.py seed_demo_data \
  --date 2026-09-04 \
  --password "Choose-A-Local-Demo-Password" \
  --reset
```

Default personas:

| Role | Username |
|---|---|
| Operations Manager | `demo.manager` |
| Team Leader — Lines 1 and 2 | `demo.leader` |
| Team Leader — Lines 3 and 4 | `demo.leader.two` |
| Team Leader — Lines 5 and 6 | `demo.leader.three` |
| Operational Support | `demo.support` |

Demo credentials and data must never be used in staging or production.

## Automated release gate

The release candidate must pass the complete CI workflow:

- Ruff formatting and linting
- Django system and deployment checks
- migration-drift detection
- OpenAPI validation
- PostgreSQL-backed backend tests and coverage gate
- TypeScript check, frontend tests, and production build
- local and staging Compose validation
- backend, reminder-worker, and frontend image builds
- deterministic demo seeding
- Playwright functional, responsive, cross-role, and final UAT smoke suites
- retained `responsive-ui-preview` screenshot evidence

The manual staging-publish workflow must then verify a successful completed
push-triggered CI run for its exact `GITHUB_SHA`. Missing, pending, cancelled,
or failed CI blocks publication.

## Manual UAT sequence

Run and evidence every scenario in
[the factory UAT checklist](factory-uat-checklist.md). At minimum:

1. Sign in as each approved persona and confirm role routing.
2. Verify weekday 06:45 and weekend 07:00 day-shift resolution.
3. Complete Team Leader My Lines, Daily Plan, Materials, Break & Recovery,
   Shift Handover, and Raise Issue workflows.
4. Raise one Red operational issue and one material issue.
5. Confirm both actions appear in the Operations Manager workspace for the same
   date without duplication.
6. Verify responsive navigation and critical actions at desktop, tablet, and
   phone widths.
7. Confirm unauthorised users cannot read or mutate another workspace's data.
8. Record screenshots, API evidence, defects, owners, and decisions.

## Required human sign-off

| Review function | Named approver | Decision | Evidence/notes |
|---|---|---|---|
| Operations |  | Pending |  |
| Quality/Safety |  | Pending |  |
| Engineering/IT |  | Pending |  |
| Product Owner |  | Pending |  |

Valid decisions are **Approved**, **Changes requested**, or **Rejected**.
Technical CI success alone is not factory approval.

## Known boundaries

Before any real production rollout, the organisation must separately provide
and approve:

- hosting, DNS, TLS, secrets, and access administration
- off-host database backups and tested restore evidence
- central log retention, uptime monitoring, and incident ownership
- notification-provider credentials and delivery monitoring
- data-protection, retention, traceability, HR, and security review
- approved real-user onboarding and support arrangements
- factory safety, food-safety, quality, engineering, and operational procedures

The risk briefing is deterministic and advisory. The platform records
visibility, evidence, and ownership; it does not replace approved procedures or
human authority.

## Release and rollback decision

Follow [the secure staging deployment runbook](staging-deployment.md). Publish
only full-SHA images from the verified release workflow. After deployment,
record health checks, smoke-test evidence, and the active image SHAs.

If application behaviour is unacceptable and the database remains compatible,
use the documented application rollback to restore the previous immutable
images. Database reversal or restore is a separate incident-managed action
requiring a verified backup and explicit approval.

Final pilot outcomes are:

- **Go** — all required evidence and named approvals are complete
- **Conditional go** — only explicitly accepted, owned, time-bounded actions
  remain
- **No go** — a safety, security, data-integrity, operational, or acceptance
  blocker remains
