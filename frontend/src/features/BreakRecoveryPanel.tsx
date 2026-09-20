import { useMemo, useState } from "react";

import { OfflineQueuedError, postJson } from "../api";
import { AppIcon } from "../AppIcon";
import { EmptyState, ErrorBanner } from "../components";
import { formatScheduleClock } from "../shiftTiming";
import type {
  Assignment,
  BreakOpportunity,
  BreakOpportunityStatus,
} from "../types";

type BreakView = "current" | "history";

type TimelinePoint = {
  label: string;
  time: string;
  tone: "fault" | "break" | "process" | "running";
  projected: boolean;
};

const ACTIVE_STATUSES = new Set<BreakOpportunityStatus>([
  "suggested",
  "confirmed",
  "returned",
  "checks_complete",
]);

function lineLabel(code: string): string {
  const match = code.match(/(\d+)$/);
  return match ? `Line ${Number(match[1])}` : code;
}

function clock(value: string | null | undefined): string {
  if (!value) return "—";
  return formatScheduleClock(value);
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function minutesBetween(start: string, end: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) / 60_000,
    ),
  );
}

function breakDuration(item: BreakOpportunity): number {
  const start = item.confirmed_at ?? item.suggested_start_at;
  return minutesBetween(start, item.expected_return_at);
}

function currentPriority(status: BreakOpportunityStatus): number {
  return {
    checks_complete: 4,
    returned: 3,
    confirmed: 2,
    suggested: 1,
    recovered: 0,
    declined: 0,
  }[status];
}

function timeline(item: BreakOpportunity): TimelinePoint[] {
  const expectedChecks = addMinutes(item.expected_return_at, 2);
  const expectedRunning = addMinutes(item.expected_return_at, 10);

  return [
    {
      label: "Fault",
      time: item.fault_at,
      tone: "fault",
      projected: false,
    },
    {
      label: "Break",
      time: item.confirmed_at ?? item.suggested_start_at,
      tone: "break",
      projected: !item.confirmed_at,
    },
    {
      label: "Returned",
      time: item.returned_at ?? item.expected_return_at,
      tone: "process",
      projected: !item.returned_at,
    },
    {
      label: "Checks",
      time: item.checks_completed_at ?? expectedChecks,
      tone: "process",
      projected: !item.checks_completed_at,
    },
    {
      label: "Running",
      time: item.run_resumed_at ?? expectedRunning,
      tone: "running",
      projected: !item.run_resumed_at,
    },
  ];
}

function statusLabel(status: BreakOpportunityStatus): string {
  return {
    suggested: "Review required",
    confirmed: "Break confirmed",
    returned: "Return recorded",
    checks_complete: "Checks complete",
    recovered: "Recovered",
    declined: "Declined",
  }[status];
}

function overlapWarning(item: BreakOpportunity): string {
  const plannedStart = item.planned_break_start_at;
  const engineeringEta = item.source_next_update_due_at;
  if (!plannedStart || !engineeringEta) {
    return "Review the suggested protected break window before confirming.";
  }
  if (new Date(engineeringEta) >= new Date(plannedStart)) {
    return `Consider moving Break ${item.break_number} earlier because the repair ETA overlaps the planned break.`;
  }
  return "The repair ETA is before the planned break; confirm only if the approved conditions remain satisfied.";
}

function absorbedDowntime(item: BreakOpportunity): number {
  const eta = item.source_next_update_due_at;
  if (!eta) return 0;
  const etaTime = new Date(eta).getTime();
  const startTime = new Date(item.suggested_start_at).getTime();
  const returnTime = new Date(item.expected_return_at).getTime();
  if (etaTime <= startTime) return 0;
  return Math.min(
    breakDuration(item),
    Math.max(0, Math.round((Math.min(etaTime, returnTime) - startTime) / 60_000)),
  );
}

export function BreakRecoveryPanel({
  assignments,
  opportunities,
  onSaved,
}: {
  assignments: Assignment[];
  opportunities: BreakOpportunity[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [activeView, setActiveView] = useState<BreakView>("current");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [declineOpenId, setDeclineOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const assignmentIds = useMemo(
    () => new Set(assignments.slice(0, 3).map((item) => item.id)),
    [assignments],
  );
  const relevant = useMemo(
    () =>
      opportunities.filter((item) => assignmentIds.has(item.assignment)),
    [assignmentIds, opportunities],
  );
  const current = useMemo(
    () =>
      relevant
        .filter((item) => ACTIVE_STATUSES.has(item.status))
        .sort(
          (left, right) =>
            currentPriority(right.status) - currentPriority(left.status) ||
            new Date(right.fault_at).getTime() -
              new Date(left.fault_at).getTime(),
        )[0] ?? null,
    [relevant],
  );
  const history = useMemo(
    () =>
      relevant
        .filter(
          (item) =>
            item.status === "recovered" || item.status === "declined",
        )
        .sort(
          (left, right) =>
            new Date(right.fault_at).getTime() -
            new Date(left.fault_at).getTime(),
        ),
    [relevant],
  );

  const transition = async (
    item: BreakOpportunity,
    path: "confirm" | "decline" | "return" | "complete-checks" | "resume",
  ) => {
    const note = notes[item.id]?.trim() ?? "";
    if ((path === "decline" || path === "resume") && !note) {
      setError(
        path === "decline"
          ? "Add a reason before declining this opportunity."
          : "Add recovery notes before resuming the line.",
      );
      return;
    }

    setBusyId(item.id);
    setError("");
    try {
      const body =
        path === "decline"
          ? { decline_reason: note }
          : path === "resume"
            ? { recovery_notes: note }
            : undefined;
      await postJson<BreakOpportunity>(
        `/break-opportunities/${item.id}/${path}/`,
        body,
      );
      const messages = {
        confirm:
          "Break confirmed. The full 40-minute return time is protected.",
        decline: "Break opportunity declined with a recorded reason.",
        return:
          "Return recorded. Complete every required check before restart.",
        "complete-checks":
          "Safety, quality and technical checks recorded as complete.",
        resume: "Line recovery completed and run resumed.",
      };
      setNotes((currentNotes) => ({
        ...currentNotes,
        [item.id]: "",
      }));
      setDeclineOpenId(null);
      await onSaved(messages[path]);
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not update the recovery timeline.",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const approvalChecks = current
    ? [
        {
          label: "Product controlled and line safe",
          complete:
            /safe|controlled/i.test(current.source_action_taken ?? ""),
        },
        {
          label: "Full uninterrupted 40-minute break",
          complete: breakDuration(current) === 40,
        },
        {
          label: "Team away from workstation",
          complete:
            current.status !== "suggested" ||
            Boolean(current.confirmed_at),
        },
        {
          label: "Coverage and restart owner confirmed",
          complete: Boolean(current.source_support_required?.trim()),
        },
        {
          label: "Team Leader / Operations approval",
          complete: Boolean(current.confirmed_at),
        },
      ]
    : [];

  const points = current ? timeline(current) : [];

  return (
    <section className="break-recovery-v2">
      <header className="break-recovery-v2__hero">
        <div>
          <h1>Break & Recovery</h1>
          <p>
            Preserve the full approved break and prepare a controlled restart
          </p>
        </div>
        {current ? (
          <span className="break-recovery-v2__review">
            <i aria-hidden="true">!</i>
            {statusLabel(current.status)}
          </span>
        ) : null}
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="break-recovery-v2__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "current"}
          className={activeView === "current" ? "is-active" : ""}
          onClick={() => setActiveView("current")}
        >
          Current opportunity
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "history"}
          className={activeView === "history" ? "is-active" : ""}
          onClick={() => setActiveView("history")}
        >
          Recovery history
        </button>
      </div>

      {activeView === "history" ? (
        history.length ? (
          <div className="break-recovery-v2__history">
            {history.map((item) => (
              <article key={item.id}>
                <header>
                  <div>
                    <strong>
                      {lineLabel(item.production_line_code)} · Break{" "}
                      {item.break_number}
                    </strong>
                    <span>{item.issue_summary}</span>
                  </div>
                  <span className={`is-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </header>
                <div>
                  <span>Fault {clock(item.fault_at)}</span>
                  <span>
                    {item.run_resumed_at
                      ? `Running ${clock(item.run_resumed_at)}`
                      : item.declined_at
                        ? `Declined ${clock(item.declined_at)}`
                        : "Closed"}
                  </span>
                  <span>
                    {item.recovery_notes ||
                      item.decline_reason ||
                      "No additional note recorded."}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No recovery history"
            body="Recovered and declined break opportunities will appear here."
          />
        )
      ) : current ? (
        <>
          <div className="break-recovery-v2__top-grid">
            <article className="break-recovery-v2__event">
              <h2>
                Current event · {lineLabel(current.production_line_code)}
              </h2>
              <dl>
                <div>
                  <dt>Fault raised</dt>
                  <dd>
                    {clock(current.fault_at)} · {current.issue_summary}
                  </dd>
                </div>
                <div>
                  <dt>Line state</dt>
                  <dd>
                    {/safe/i.test(current.source_action_taken ?? "")
                      ? "Stopped safely"
                      : "Stopped — confirm safe state"}
                  </dd>
                </div>
                <div>
                  <dt>Engineering ETA</dt>
                  <dd>{clock(current.source_next_update_due_at)}</dd>
                </div>
                <div>
                  <dt>Planned Break {current.break_number}</dt>
                  <dd>
                    {clock(current.planned_break_start_at)}–
                    {clock(current.planned_break_end_at)}
                  </dd>
                </div>
                <div>
                  <dt>Suggested window</dt>
                  <dd>
                    {clock(current.suggested_start_at)}–
                    {clock(current.expected_return_at)}
                  </dd>
                </div>
              </dl>
              <p className="break-recovery-v2__advice">
                <span aria-hidden="true">!</span>
                {overlapWarning(current)}
              </p>
            </article>

            <article className="break-recovery-v2__checks">
              <h2>Approval checks</h2>
              <ul>
                {approvalChecks.map((check, index) => (
                  <li
                    className={check.complete ? "is-complete" : ""}
                    key={check.label}
                  >
                    <span aria-hidden="true">
                      {check.complete ? "✓" : ""}
                    </span>
                    <strong>{check.label}</strong>
                    {index === 4 && !check.complete ? (
                      <small>Required before recovery proceeds</small>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <ol
            className="break-recovery-v2__timeline"
            aria-label={`${current.production_line_code} recovery timeline`}
          >
            {points.map((point) => (
              <li
                className={`is-${point.tone} ${point.projected ? "is-projected" : ""}`}
                key={point.label}
              >
                <span className="break-recovery-v2__timeline-dot" />
                <strong>{clock(point.time)}</strong>
                <span>{point.label}</span>
                {point.projected ? <small>planned</small> : null}
              </li>
            ))}
          </ol>

          <div className="break-recovery-v2__metrics">
            <article>
              <span className="break-recovery-v2__metric-icon">
                <AppIcon name="clock" size={24} />
              </span>
              <div>
                <strong>{absorbedDowntime(current)} min</strong>
                <span>Downtime absorbed</span>
              </div>
            </article>
            <article>
              <span className="break-recovery-v2__metric-icon">☕</span>
              <div>
                <strong>{breakDuration(current)} min</strong>
                <span>
                  {current.returned_at
                    ? "Break completed"
                    : "Break protected"}
                </span>
              </div>
            </article>
            <article>
              <span className="break-recovery-v2__metric-icon">
                <AppIcon name="chart" size={24} />
              </span>
              <div>
                <strong>Approved speed</strong>
                <span>Recovery rule</span>
              </div>
            </article>
          </div>

          <div className="break-recovery-v2__safety" role="note">
            <span aria-hidden="true">!</span>
            <p>
              Never recall people early, reduce approved rest, bypass checks or
              exceed the approved safe line speed.
            </p>
          </div>

          {declineOpenId === current.id ? (
            <label className="break-recovery-v2__note">
              Reason for declining
              <input
                autoFocus
                value={notes[current.id] ?? ""}
                onChange={(event) =>
                  setNotes((currentNotes) => ({
                    ...currentNotes,
                    [current.id]: event.target.value,
                  }))
                }
                placeholder="Record the operational reason"
              />
            </label>
          ) : null}

          {current.status === "checks_complete" ? (
            <label className="break-recovery-v2__note">
              Recovery notes before restart
              <input
                value={notes[current.id] ?? ""}
                onChange={(event) =>
                  setNotes((currentNotes) => ({
                    ...currentNotes,
                    [current.id]: event.target.value,
                  }))
                }
                placeholder="Record checks and approved restart condition"
              />
            </label>
          ) : null}

          <footer className="break-recovery-v2__actions">
            {current.status === "suggested" ? (
              <>
                {declineOpenId === current.id ? (
                  <button
                    type="button"
                    className="break-recovery-v2__outline"
                    disabled={busyId === current.id}
                    onClick={() => void transition(current, "decline")}
                  >
                    Confirm decline
                  </button>
                ) : (
                  <button
                    type="button"
                    className="break-recovery-v2__outline"
                    onClick={() => setDeclineOpenId(current.id)}
                  >
                    Decline with reason
                  </button>
                )}
                <button
                  type="button"
                  className="break-recovery-v2__primary"
                  disabled={
                    busyId === current.id ||
                    approvalChecks.slice(0, 4).some((item) => !item.complete)
                  }
                  onClick={() => void transition(current, "confirm")}
                >
                  Confirm opportunity
                </button>
                <button
                  type="button"
                  className="break-recovery-v2__disabled"
                  disabled
                >
                  Resume line
                  <small>Complete checks first</small>
                </button>
              </>
            ) : null}

            {current.status === "confirmed" ? (
              <>
                <button
                  type="button"
                  className="break-recovery-v2__primary"
                  disabled={busyId === current.id}
                  onClick={() => void transition(current, "return")}
                >
                  Record return
                </button>
                <button
                  type="button"
                  className="break-recovery-v2__disabled"
                  disabled
                >
                  Resume line
                  <small>Complete checks first</small>
                </button>
              </>
            ) : null}

            {current.status === "returned" ? (
              <>
                <button
                  type="button"
                  className="break-recovery-v2__primary"
                  disabled={busyId === current.id}
                  onClick={() => void transition(current, "complete-checks")}
                >
                  Confirm checks complete
                </button>
                <button
                  type="button"
                  className="break-recovery-v2__disabled"
                  disabled
                >
                  Resume line
                  <small>Complete checks first</small>
                </button>
              </>
            ) : null}

            {current.status === "checks_complete" ? (
              <button
                type="button"
                className="break-recovery-v2__primary"
                disabled={busyId === current.id}
                onClick={() => void transition(current, "resume")}
              >
                Resume line
              </button>
            ) : null}
          </footer>
        </>
      ) : (
        <EmptyState
          title="No current break opportunity"
          body="A current opportunity appears only for an assigned Red line stop close to an approved break."
        />
      )}
    </section>
  );
}
