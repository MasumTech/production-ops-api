# Pilot trial evidence toolkit

The pilot evidence workspace supports the four-week validation route described in the
multi-line Team Leader proposal. It is deliberately limited to dummy/non-company data and
does not replace approved safety, quality, engineering, HR or production records.

## Safe sequence

1. Agree the selected lines, roles, update method and fallback with Operations, QA, Health and
   Safety, Engineering, HR and IT.
2. Create a planned trial with a bounded date window in Manager Console → Pilot Admin.
3. Start the trial only after the process and access review is complete.
4. Record one observation per check: line status, update duration, escalation acknowledgement,
   missed actions, status accuracy and whether paper/radio fallback was used.
5. Review the evidence and record a continue or stop decision with a human-written note.

## API boundary

- `GET/POST /api/pilot-trials/` — staff-only trial records.
- `POST /api/pilot-trials/{id}/start/` — start a planned trial.
- `POST /api/pilot-trials/{id}/decide/` — complete or stop an active trial with a decision note.
- `GET /api/pilot-trials/{id}/evidence/` — evidence rows and deterministic aggregates.
- `GET/POST /api/pilot-observations/` — staff-only, immutable observation rows.

Observations are accepted only while a trial is active, within its date window, and for a line
selected for that trial. The server computes the evidence summary; it does not infer approval,
production readiness or a go-live decision.

## What to measure

The summary intentionally mirrors the proposal's practical questions:

- how long a normal update takes;
- how quickly an escalation is acknowledged;
- how many actions were missed;
- whether the shared status was accurate; and
- how often the paper/communication fallback was needed.

Management should review the evidence with the relevant functions before changing the process or
starting a controlled software pilot.
