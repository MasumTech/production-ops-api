import { useState } from "react";

import { OfflineQueuedError, postJson } from "../api";
import { EmptyState, ErrorBanner, PageIntro, StatusPill } from "../components";
import { formatDateTime } from "../format";
import type { Assignment, BreakOpportunity } from "../types";

const TIMELINE_STEPS: Array<{
  key: keyof Pick<
    BreakOpportunity,
    "fault_at" | "confirmed_at" | "returned_at" | "checks_completed_at" | "run_resumed_at"
  >;
  label: string;
}> = [
  { key: "fault_at", label: "Fault" },
  { key: "confirmed_at", label: "Break" },
  { key: "returned_at", label: "Returned" },
  { key: "checks_completed_at", label: "Checks" },
  { key: "run_resumed_at", label: "Running" },
];

export function BreakRecoveryPanel({
  assignments,
  opportunities,
  onSaved,
}: {
  assignments: Assignment[];
  opportunities: BreakOpportunity[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const visibleAssignmentIds = new Set(assignments.slice(0, 2).map((item) => item.id));
  const visible = opportunities.filter((item) => visibleAssignmentIds.has(item.assignment));

  const transition = async (
    item: BreakOpportunity,
    path: "confirm" | "decline" | "return" | "complete-checks" | "resume",
  ) => {
    const note = notes[item.id]?.trim() ?? "";
    if ((path === "decline" || path === "resume") && !note) {
      setError(
        path === "decline"
          ? "Add a reason before declining."
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
      await postJson<BreakOpportunity>(`/break-opportunities/${item.id}/${path}/`, body);
      const messages = {
        confirm: "Break confirmed. The full 40-minute return time is protected.",
        decline: "Break opportunity declined with a reason.",
        return: "Return recorded. Complete all required checks before restart.",
        "complete-checks": "Safety, quality and technical checks recorded.",
        resume: "Line recovery completed and run resumed.",
      };
      await onSaved(messages[path]);
      setNotes((current) => ({ ...current, [item.id]: "" }));
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
      } else {
        setError(
          caught instanceof Error ? caught.message : "Could not update the recovery timeline.",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <PageIntro
        eyebrow="Decision support"
        title="Break & Recovery"
        body="When a Red stop is close to an approved break, review the opportunity and capture the complete fault-to-restart timeline."
      />
      {error ? <ErrorBanner message={error} /> : null}

      <div className="break-policy-banner">
        <strong>Team Leader confirms every decision.</strong>
        <span>
          The system never shortens the 40-minute break or bypasses safety, food-safety, QA or
          engineering checks.
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No break opportunities"
          body="A suggestion appears only when a Red line stop is within 60 minutes of an approved break window."
        />
      ) : (
        <div className="card-list">
          {visible.map((item) => (
            <article
              className={
                item.status === "suggested"
                  ? "workflow-card workflow-card--attention"
                  : "workflow-card"
              }
              key={item.id}
            >
              <header className="workflow-card__header">
                <div>
                  <span className="eyebrow">
                    {item.production_line_code} · Break {item.break_number}
                  </span>
                  <h3>{item.issue_summary}</h3>
                  <p className="break-suggestion-copy">
                    Suggested {formatDateTime(item.suggested_start_at)} · protected return{" "}
                    {formatDateTime(item.expected_return_at)}
                  </p>
                </div>
                <StatusPill value={item.status} />
              </header>

              <ol
                className="recovery-timeline"
                aria-label={`${item.production_line_code} recovery timeline`}
              >
                {TIMELINE_STEPS.map((step) => {
                  const value = item[step.key];
                  return (
                    <li className={value ? "is-complete" : ""} key={step.key}>
                      <span className="recovery-timeline__marker" aria-hidden="true" />
                      <strong>{step.label}</strong>
                      <span>{value ? formatDateTime(value) : "Pending"}</span>
                    </li>
                  );
                })}
              </ol>

              {item.recovery_notes ? (
                <p className="recovery-note">
                  <strong>Recovery:</strong> {item.recovery_notes}
                </p>
              ) : null}
              {item.decline_reason ? (
                <p className="recovery-note">
                  <strong>Declined:</strong> {item.decline_reason}
                </p>
              ) : null}

              {item.status === "suggested" || item.status === "checks_complete" ? (
                <label className="break-action-note">
                  {item.status === "suggested"
                    ? "Reason if declining"
                    : "Recovery notes before restart"}
                  <input
                    value={notes[item.id] ?? ""}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              <div className="workflow-actions">
                {item.status === "suggested" ? (
                  <>
                    <button
                      className="button button--primary"
                      disabled={busyId === item.id}
                      onClick={() => void transition(item, "confirm")}
                    >
                      Confirm full break
                    </button>
                    <button
                      className="button button--ghost"
                      disabled={busyId === item.id}
                      onClick={() => void transition(item, "decline")}
                    >
                      Decline with reason
                    </button>
                  </>
                ) : null}
                {item.status === "confirmed" ? (
                  <button
                    className="button button--primary"
                    disabled={busyId === item.id}
                    onClick={() => void transition(item, "return")}
                  >
                    Record return
                  </button>
                ) : null}
                {item.status === "returned" ? (
                  <button
                    className="button button--primary"
                    disabled={busyId === item.id}
                    onClick={() => void transition(item, "complete-checks")}
                  >
                    Confirm checks complete
                  </button>
                ) : null}
                {item.status === "checks_complete" ? (
                  <button
                    className="button button--primary"
                    disabled={busyId === item.id}
                    onClick={() => void transition(item, "resume")}
                  >
                    Resume line
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
