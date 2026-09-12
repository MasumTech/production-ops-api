# Factory UAT Checklist

This checklist is for a controlled, non-production pilot review of the
Multi-Line Production Operations platform. It is evidence-led: every scenario
must record the test account, operational date, expected result, actual result,
screenshot or API evidence, defect reference, and owner.

## Safety boundary

- Use approved non-production accounts and dummy data only.
- Do not enter real employee, customer, food-safety, quality, traceability, or
  production records.
- This checklist does not replace approved safety, quality, engineering, HR,
  production-control, or escalation procedures.
- A failed scenario blocks pilot sign-off until the named owner records a
  decision.

## Test preparation

- [ ] Confirm the approved staging URL and release SHA.
- [ ] Confirm the test date and reset the deterministic demo dataset.
- [ ] Confirm Team Leader, Operations Manager, Support, and staff-admin accounts.
- [ ] Record browser, device, viewport, operating system, and network condition.
- [ ] Confirm that no real secrets or production data are present.
- [ ] Capture the release commit and CI run in the evidence register.

## Scenario matrix

| ID | Persona | Scenario | Expected evidence | Result |
|---|---|---|---|---|
| UAT-01 | Team Leader | Sign in and open My Lines | Assigned lines only; no unassigned line data | [ ] |
| UAT-02 | Team Leader | Record GREEN, AMBER, and RED hourly updates | Update appears with owner, time, and next-update deadline | [ ] |
| UAT-03 | Team Leader | Raise an operational issue | Issue creates a scoped escalation with priority and response owner | [ ] |
| UAT-04 | Team Leader | Review material readiness | Ready, In Process, Short, and Held states are visible | [ ] |
| UAT-05 | Team Leader | Plan, accept, start, and recover a break | Lifecycle and audit evidence are preserved | [ ] |
| UAT-06 | Team Leader | Create and accept shift handover | Incoming/outgoing context and acceptance timestamp are shown | [ ] |
| UAT-07 | Operations Manager | Open Overview and Team Leaders | Three Team Leaders, two assigned lines each, reference-style KPIs and RAG status are visible | [ ] |
| UAT-08 | Operations Manager | Review Actions & Materials | Open, overdue, unassigned, and material-risk evidence is visible | [ ] |
| UAT-09 | Operations Manager | Open Risk Briefing | Deterministic factors, confidence, and missing-data warnings are shown | [ ] |
| UAT-10 | Operations Manager | Open Loss Analytics | Recorded downtime/loss and asset evidence is shown without prediction claims | [ ] |
| UAT-11 | Operations Manager | Open Pilot Admin | Worker freshness, notification health, and backlog are visible | [ ] |
| UAT-12 | Staff admin | Assign and revoke Support/Team Leader access | Change is permission-gated and creates an audit event | [ ] |
| UAT-13 | Support | Open My Actions and acknowledge an assigned alert | Only own scoped actions appear; acknowledgement is recorded once | [ ] |
| UAT-14 | Support | Review Line Status and Material Risks | Related line/material context is visible but unrelated data is hidden | [ ] |
| UAT-15 | All roles | Open notification centre and mark an item read | Read evidence is user-specific and does not resolve the action | [ ] |
| UAT-16 | All roles | Lose network, queue a safe action, reconnect | Outbox retries idempotently; duplicate state change is not created | [ ] |
| UAT-17 | Unauthorised user | Request another workspace's endpoint | API returns the expected permission response and no data leak | [ ] |
| UAT-18 | All roles | Resize to mobile, tablet, and desktop | Navigation and critical actions remain usable at each viewport | [ ] |
| UAT-19 | Operations Manager | Review hourly downtime for every line | Each 07:00–18:00 bucket shows recorded minutes and a short reason, or an explicit no-loss state | [ ] |

## Defect and sign-off record

For each failed scenario record:

- scenario ID and release SHA
- exact steps to reproduce
- expected versus actual result
- screenshot, response, or log evidence
- severity and operational impact
- owner and target decision date

Pilot sign-off requires named approval from Operations, Quality/Safety,
Engineering/IT, and the product owner. A technical pass alone is not approval
for factory use.
