import { useState } from "react";

import { OfflineQueuedError, postJson } from "../api";
import {
  AssignmentSelect,
  EmptyState,
  ErrorBanner,
  PageIntro,
  StatusPill,
  SubmitButton,
  UserSelect,
} from "../components";
import { formatDateTime, toIso } from "../format";
import type { Assignment, BreakRecovery, UserChoice, UserSummary } from "../types";

export function BreakRecoveryPanel({
  profile,
  assignments,
  breaks,
  users,
  onSaved,
}: {
  profile: UserSummary;
  assignments: Assignment[];
  breaks: BreakRecovery[];
  users: UserChoice[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [assignment, setAssignment] = useState("");
  const [coverUser, setCoverUser] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [coverageNotes, setCoverageNotes] = useState("");
  const [actionNotes, setActionNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");
  const ownAssignmentIds = new Set(assignments.map((item) => item.id));

  const planBreak = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyId("new");
    setError("");
    try {
      await postJson<BreakRecovery>("/break-recoveries/", {
        assignment: Number(assignment),
        cover_user: Number(coverUser),
        planned_start_at: toIso(plannedStart),
        expected_return_at: toIso(expectedReturn),
        coverage_notes: coverageNotes.trim(),
      });
      await onSaved("Break plan created. Cover acceptance is now required.");
      setShowForm(false);
      setCoverageNotes("");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        setShowForm(false);
        setCoverageNotes("");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not create the break plan.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const action = async (
    item: BreakRecovery,
    path: "accept-coverage" | "start" | "recover" | "cancel",
  ) => {
    const note = actionNotes[item.id]?.trim();
    if ((path === "recover" || path === "cancel") && !note) {
      setError(path === "recover" ? "Recovery notes are required." : "A cancellation reason is required.");
      return;
    }

    setBusyId(item.id);
    setError("");
    try {
      const body =
        path === "recover"
          ? { recovery_notes: note }
          : path === "cancel"
            ? { cancellation_reason: note }
            : undefined;
      await postJson<BreakRecovery>(`/break-recoveries/${item.id}/${path}/`, body);
      await onSaved(
        path === "accept-coverage"
          ? "Coverage accepted."
          : path === "start"
            ? "Break started under accepted cover."
            : path === "recover"
              ? "Line control recovered."
              : "Break plan cancelled.",
      );
      setActionNotes((current) => ({ ...current, [item.id]: "" }));
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        setActionNotes((current) => ({ ...current, [item.id]: "" }));
      } else {
        setError(caught instanceof Error ? caught.message : "Could not update the break record.");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <PageIntro
        eyebrow="Temporary ownership"
        title="Break & Recovery"
        body="Plan cover, capture acceptance, start only after acceptance, and confirm line-control recovery."
        action={
          <button className="button button--primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? "Close form" : "Plan break"}
          </button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <form className="form-card form-grid form-card--spaced" onSubmit={planBreak}>
          <label className="span-2">
            Assigned line
            <AssignmentSelect
              assignments={assignments}
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
              required
            />
          </label>
          <label>
            Nominated cover
            <UserSelect
              users={users}
              currentUserId={profile.id}
              includeBlank={false}
              value={coverUser}
              onChange={(event) => setCoverUser(event.target.value)}
              required
            />
          </label>
          <label>
            Planned start
            <input
              type="datetime-local"
              value={plannedStart}
              onChange={(event) => setPlannedStart(event.target.value)}
              required
            />
          </label>
          <label>
            Expected return
            <input
              type="datetime-local"
              value={expectedReturn}
              onChange={(event) => setExpectedReturn(event.target.value)}
              required
            />
          </label>
          <label>
            Coverage notes
            <input value={coverageNotes} onChange={(event) => setCoverageNotes(event.target.value)} />
          </label>
          <div className="form-actions span-2">
            <SubmitButton busy={busyId === "new"}>Create break plan</SubmitButton>
          </div>
        </form>
      ) : null}

      {breaks.length === 0 ? (
        <EmptyState
          title="No break records visible"
          body="New plans and breaks where you are the nominated cover will appear here."
        />
      ) : (
        <div className="card-list">
          {breaks.map((item) => {
            const ownsAssignment = ownAssignmentIds.has(item.assignment) || profile.is_staff;
            const isCover = item.cover_user === profile.id;
            const needsNotes =
              (item.status === "active" && ownsAssignment) ||
              (["planned", "coverage_accepted"].includes(item.status) && ownsAssignment);

            return (
              <article className={item.needs_attention ? "workflow-card workflow-card--attention" : "workflow-card"} key={item.id}>
                <div className="workflow-card__header">
                  <div>
                    <span className="eyebrow">{item.production_line_code}</span>
                    <h3>{item.team_leader_username} → {item.cover_user_username}</h3>
                  </div>
                  <StatusPill value={item.status} />
                </div>
                <div className="timeline-pair">
                  <span>Start <strong>{formatDateTime(item.planned_start_at)}</strong></span>
                  <span>Return <strong>{formatDateTime(item.expected_return_at)}</strong></span>
                </div>
                {item.needs_attention ? <p className="attention-copy">Attention required: planned or expected time has passed.</p> : null}
                {needsNotes ? (
                  <label>
                    {item.status === "active" ? "Recovery notes" : "Cancellation reason"}
                    <input
                      value={actionNotes[item.id] ?? ""}
                      onChange={(event) =>
                        setActionNotes((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  </label>
                ) : null}
                <div className="workflow-actions">
                  {item.status === "planned" && isCover ? (
                    <button className="button button--primary" disabled={busyId === item.id} onClick={() => void action(item, "accept-coverage")}>Accept coverage</button>
                  ) : null}
                  {item.status === "coverage_accepted" && ownsAssignment ? (
                    <button className="button button--primary" disabled={busyId === item.id} onClick={() => void action(item, "start")}>Start break</button>
                  ) : null}
                  {item.status === "active" && ownsAssignment ? (
                    <button className="button button--primary" disabled={busyId === item.id} onClick={() => void action(item, "recover")}>Confirm recovery</button>
                  ) : null}
                  {["planned", "coverage_accepted"].includes(item.status) && ownsAssignment ? (
                    <button className="button button--danger" disabled={busyId === item.id} onClick={() => void action(item, "cancel")}>Cancel plan</button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
