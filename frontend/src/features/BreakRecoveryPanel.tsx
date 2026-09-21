import { useEffect, useMemo, useState } from "react";

import { apiList, OfflineQueuedError, postJson } from "../api";
import { AppIcon } from "../AppIcon";
import { EmptyState, ErrorBanner } from "../components";
import { formatScheduleClock } from "../shiftTiming";
import type {
  Assignment,
  BreakOpportunity,
  BreakOpportunityStatus,
} from "../types";

type BreakView = "current" | "history";
type HistoryRange = 7 | 30;

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

function startDate(endDate: string, days: HistoryRange): string {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

function historyDate(item: BreakOpportunity): string {
  if (!item.assignment_date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${item.assignment_date}T00:00:00Z`));
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
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    number | null
  >(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>(7);
  const [historyItems, setHistoryItems] = useState<BreakOpportunity[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const assignmentIds = useMemo(
    () => new Set(assignments.map((item) => item.id)),
    [assignments],
  );
  const productionLineIds = useMemo(
    () => new Set(assignments.map((item) => item.production_line)),
    [assignments],
  );
  const relevant = useMemo(
    () =>
      opportunities.filter((item) => assignmentIds.has(item.assignment)),
    [assignmentIds, opportunities],
  );
  const active = useMemo(
    () =>
      relevant
        .filter((item) => ACTIVE_STATUSES.has(item.status))
        .sort(
          (left, right) =>
            currentPriority(right.status) - currentPriority(left.status) ||
            new Date(right.fault_at).getTime() -
              new Date(left.fault_at).getTime(),
        ),
    [relevant],
  );
  const current =
    active.find((item) => item.id === selectedOpportunityId) ?? active[0] ?? null;
  const operationalDate = assignments[0]?.date;

  useEffect(() => {
    if (activeView !== "history" || !operationalDate) return;

    let cancelled = false;
    const query = new URLSearchParams({
      date_from: startDate(operationalDate, historyRange),
      date_to: operationalDate,
    });

    setHistoryLoading(true);
    setHistoryError("");
    void apiList<BreakOpportunity>(
      `/break-opportunities/?${query.toString()}`,
    )
      .then((items) => {
        if (cancelled) return;
        setHistoryItems(
          items
            .filter(
              (item) =>
                productionLineIds.has(item.production_line) &&
                (item.status === "recovered" || item.status === "declined"),
            )
            .sort(
              (left, right) =>
                new Date(right.fault_at).getTime() -
                new Date(left.fault_at).getTime(),
            ),
        );
      })
      .catch((caught) => {
        if (cancelled) return;
        setHistoryError(
          caught instanceof Error
            ? caught.message
            : "Could not load recovery history.",
        );
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, historyRange, operationalDate, productionLineIds]);

  useEffect(() => {
    if (
      selectedOpportunityId !== null &&
      !active.some((item) => item.id === selectedOpportunityId)
    ) {
      setSelectedOpportunityId(null);
    }
  }, [active, selectedOpportunityId]);

  const history = historyItems;

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
            /stopped|safe/i.test(current.source_action_taken ?? "") ||
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
        <>
          <div className="break-recovery-v2__filters">
            <label>
              History range
              <select
                value={historyRange}
                onChange={(event) =>
                  setHistoryRange(Number(event.target.value) as HistoryRange)
                }
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
            {historyLoading ? (
              <span role="status">Loading recovery history…</span>
            ) : (
              <span>{history.length} completed records</span>
            )}
          </div>
          {historyError ? <ErrorBanner message={historyError} /> : null}
          {!historyLoading && !historyError && history.length ? (
            <div className="break-recovery-v2__history">
              {history.map((item) => (
                <article key={item.id}>
                  <header>
                    <div>
                      <strong>
                        {lineLabel(item.production_line_code)} · Break{" "}
                        {item.break_number}
                      </strong>
                      <span>
                        {historyDate(item) ? `${historyDate(item)} · ` : ""}
                        {item.issue_summary}
                      </span>
                    </div>
                    <span className={`is-${item.status}`}>
                      {statusLabel(item.status)}
                    </span>
                  </header>
                  <div>
                    <span>
                      Fault {clock(item.fault_at)}
                    </span>
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
          ) : !historyLoading && !historyError ? (
            <EmptyState
              title="No recovery history"
              body={`No recovered or declined opportunities in the last ${historyRange} days.`}
            />
          ) : null}
        </>
      ) : current ? (
        <>
          <label className="break-recovery-v2__selector">
            Current line
            <select
              aria-label="Select break recovery line"
              value={current.id}
              onChange={(event) => {
                setSelectedOpportunityId(Number(event.target.value));
                setDeclineOpenId(null);
                setError("");
              }}
            >
              {active.map((item) => (
                <option key={item.id} value={item.id}>
                  {lineLabel(item.production_line_code)} · {item.issue_summary} ·{" "}
                  {statusLabel(item.status)}
                </option>
              ))}
            </select>
          </label>
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
              </>
            ) : null}

            {current.status === "confirmed" ? (
              <button
                type="button"
                className="break-recovery-v2__primary"
                disabled={busyId === current.id}
                onClick={() => void transition(current, "return")}
              >
                Record return
              </button>
            ) : null}

            {current.status === "returned" ? (
              <button
                type="button"
                className="break-recovery-v2__primary"
                disabled={busyId === current.id}
                onClick={() => void transition(current, "complete-checks")}
              >
                Confirm checks complete
              </button>
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
