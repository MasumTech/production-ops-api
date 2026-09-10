# Pilot Feedback and Cross-Functional Sign-off

The feedback register extends the bounded trial evidence toolkit. It records what
people observed and whether the named review functions are ready for the next
human decision; it never approves a production rollout automatically.

## Required review functions

Every planned trial receives one pending review record for each function:

- Operations
- Quality/Safety
- Engineering/IT
- Product Owner

Each reviewer records `approved`, `changes_requested`, or leaves the review
`pending`. An approved decision requires a named staff actor and a human-written
note. A planned trial cannot start until all four functions are explicitly
approved.

## Feedback notes

After a trial starts, management staff can record immutable feedback under one of
the following categories:

- Usability
- Workflow
- Safety/Quality
- Technical

Each note includes the reviewer function, sentiment, and the observation or
recommendation. Notes remain available after a trial is completed or stopped so
the continue/change/stop decision can be reviewed later.

## API

- `GET /api/pilot-trials/{id}/evidence/` returns observations, deterministic
  metrics, approvals, feedback, and review readiness counts.
- `GET/POST /api/pilot-trials/{id}/approvals/` reads or records a review decision.
- `GET/POST /api/pilot-feedback/` reads or records immutable staff feedback.
- `POST /api/pilot-trials/{id}/start/` rejects a trial until all required reviews
  are approved.

All endpoints are staff-only. The register is for dummy/non-company pilot data
and does not replace approved safety, quality, engineering, HR, traceability, or
production records. Paper, radio, and existing approved procedures remain the
fallback throughout the pilot.
