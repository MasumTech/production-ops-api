# Release Candidate Evidence — 30 September 2026

This record freezes the automated evidence for the showcase release merged by
pull request [#126](https://github.com/MasumTech/production-ops-api/pull/126).
It supports controlled, non-production UAT only. It does not authorise a
factory pilot, staging deployment, or production use.

## Candidate identity

| Evidence | Recorded value |
|---|---|
| Source branch | `main` |
| Release commit | `9c2b65303c84fba3a228c668d49a916ed317086f` |
| Merged pull request | [#126 — Add complete showcase demo database](https://github.com/MasumTech/production-ops-api/pull/126) |
| Main-branch CI | [Run #363 — successful](https://github.com/MasumTech/production-ops-api/actions/runs/36665417909) |
| CI duration | 6 minutes 13 seconds |
| Screenshot artifact | `responsive-ui-preview`, 13.2 MB |
| Artifact digest | `sha256:50fc941fce0e1f9b18e2d6440a8c0248239460dd032c57e0ef85b653f16716d2` |
| Deterministic operational date | `2026-09-04` |

The source SHA above is the commit tested by the successful push-triggered CI
run. No staging image or deployment is recorded in this evidence file.

## Automated evidence accepted

The successful main-branch gate completed:

- Ruff formatting and lint checks;
- Django system, deployment, migration-drift, and OpenAPI checks;
- 241 PostgreSQL/Redis-backed backend tests with the coverage gate satisfied;
- 70 frontend tests, TypeScript checking, and the production build;
- local and staging Compose validation;
- backend, reminder-worker, and frontend container builds;
- deterministic demo seeding;
- 45 Playwright functional, cross-role, responsive, and final-UAT browser
  checks; and
- upload of the responsive screenshot artifact identified above.

An independent local showcase build applied all migrations to a new dedicated
SQLite database and passed all 23 dataset-contract checks. The fixture contains
fictional, local-only evidence for five personas, six lines, hourly production,
materials, downtime, break recovery, escalation, handover, notifications,
offline idempotency, reminder-worker health, and pilot lifecycle records.

## Human acceptance status

Automated coverage does not complete the checkbox or sign-off fields in the
[Factory UAT Checklist](factory-uat-checklist.md). The current status is:

| Gate | Status | Required next evidence |
|---|---|---|
| UAT-01 through UAT-22 | Pending human execution | Tester, account, device/browser, actual result, screenshot/API evidence, and defect reference |
| Operations approval | Pending | Named approver and decision |
| Quality/Safety approval | Pending | Named approver and decision |
| Engineering/IT approval | Pending | Named approver and decision |
| Product Owner approval | Pending | Named approver and decision |
| Staging release images | Not published | Successful approved `Publish staging release` run for the selected full SHA |
| Staging deployment | Not started | Approved host, DNS, TLS, secrets, access, backups, monitoring, and incident ownership |
| Factory pilot decision | **No go — evidence incomplete** | All required UAT evidence and named approvals |

Do not use real employee, customer, food-safety, quality, traceability, or
production data while these gates remain open. Demo accounts and the showcase
database must never be deployed to staging or production.

## Next controlled sequence

1. Nominate the evidence owner and the four human approvers.
2. Provision the approved non-production staging boundary without demo users or
   real factory data.
3. Publish immutable images for the exact approved full SHA.
4. Deploy by following the
   [Secure Staging Deployment Runbook](staging-deployment.md).
5. Execute and evidence UAT-01 through UAT-22 at desktop, tablet, and phone
   widths using approved non-production accounts.
6. Record defects and repeat affected scenarios after fixes.
7. Record all four human decisions and make the explicit Go, Conditional go,
   or No go pilot decision.

