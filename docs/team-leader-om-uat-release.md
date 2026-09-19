# Operations Manager and Team Leader UAT Release

This release candidate completes the approved Operations Manager and Team Leader
browser workflows for the Multi-Line Production Operations Platform.

## Shift timing contract

Day-shift timing is driven by recorded Shift data rather than a hard-coded chart
range.

- Monday to Friday default: **06:45–18:00**
- Saturday and Sunday default: **07:00–18:00**
- Operations Manager staff can edit the recorded start and end times for the
  selected operational date and shift.
- Team Leader and Operations Manager production timelines use the same recorded
  shift window.
- Weekday timelines include the exact **06:45–07:00** first segment.
- Production blocks, downtime markers, hourly loss buckets and current
  ahead/behind calculations use minute-based positioning.

## Team Leader UAT scope

Verify the five approved workspace pages:

1. **My lines** — one to three assigned lines, RAG position, downtime, dynamic
   production timeline, progress, priority suggestion and contextual quick
   actions.
2. **Daily plan** — approved product sequence, hourly rate, quantities and two
   40-minute break windows per assigned line.
3. **Materials** — simple readiness table, Add item, real status update and
   selected-material escalation.
4. **Break & Recovery** — Team Leader-controlled Fault → Break → Returned →
   Checks → Running workflow with protected break time and recovery evidence.
5. **Handover** — unresolved escalation carry-over, outgoing/incoming
   responsibility and explicit receiver acceptance.

## Cross-role acceptance

The browser acceptance suite verifies that:

- a Team Leader Red line update becomes visible to Operations Manager line
  control and risk briefing;
- a material escalation raised from the Team Leader workspace appears in
  Operations Manager open actions;
- role permissions remain enforced by the API;
- the configured operational date remains the shared context;
- responsive Team Leader and Operations Manager shells remain usable on desktop,
  tablet and phone layouts.

## Automated release gate

A release is acceptable only when the repository CI completes successfully:

- Ruff format and lint;
- Django system, deployment and migration checks;
- OpenAPI validation;
- backend pytest coverage gate;
- frontend TypeScript typecheck;
- frontend unit/component tests;
- production frontend build;
- Docker and staging configuration validation;
- container image builds;
- Playwright critical-flow tests;
- responsive and reference screenshot generation.

## Manual UAT boundary

Passing automated tests means the software implementation is ready for controlled
UAT. It does not replace factory approval, food-safety, quality, engineering,
health-and-safety, HR or IT sign-off. Operational safety procedures remain
authoritative if the application or network is unavailable.
