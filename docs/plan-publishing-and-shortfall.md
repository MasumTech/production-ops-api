# Plan publishing and product shortfall workflow

## Operational rules

- A line assignment created through the Manager API starts with a draft plan.
- Draft blocks are visible to the assigned Team Leader but remain read-only.
- Hourly production cannot be recorded until the Manager publishes the plan.
- A Team Leader can request publication once. Repeated requests are idempotent.
- The Manager publishes and approves the complete line plan with one action.
- Published plan structure remains read-only for Team Leaders.
- Managers may amend a published block with a recorded change reason.
- New blocks append to the next available time and receive their sequence automatically.
- A planned break remains exactly 40 minutes.

## Product completion evidence

Closing or changing over a production block records:

- planned target;
- completed quantity;
- calculated short quantity;
- completion/changeover reason;
- completion time and user;
- optional handover note and replacement block; and
- linked material-readiness evidence for material-related shortfalls.

The server calculates `short_units` as:

```text
max(planned_units - actual_units, 0)
```

A positive short quantity cannot be saved without a reason. Material unavailable
or delayed creates or updates the material-readiness record for the product and
preserves the original planned target.

## API actions

| Action | Method and path | Role |
|---|---|---|
| Request publication | `POST /api/team-leader-assignments/{id}/request-publication/` | Assigned Team Leader |
| Publish and approve | `POST /api/team-leader-assignments/{id}/publish/` | Manager |
| Check next available time | `GET /api/daily-plan-blocks/availability/?assignment={id}` | Manager or assigned Team Leader |
| Complete product/changeover | `POST /api/daily-plan-blocks/{id}/complete/` | Manager or assigned Team Leader |

Example completion payload:

```json
{
  "actual_units": 3850,
  "short_reason": "material_unavailable",
  "short_note": "Packaging trays were unavailable; changed to the next product."
}
```

## Audit and notifications

The workflow emits operational events for:

- publication requested;
- plan published;
- published plan amended; and
- product completed or changed over.

Publication records the Manager and timestamp. Published amendments increment
the plan version and notify the assigned Team Leader. Product completion keeps
the original target even when the line changes product early.
