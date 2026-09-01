import { useEffect, useMemo, useState } from "react";

import { apiRequest, OfflineQueuedError, postJson } from "../api";
import {
  AssignmentSelect,
  EmptyState,
  ErrorBanner,
  PageIntro,
  StatusPill,
  SubmitButton,
} from "../components";
import { formatDateTime, titleCase } from "../format";
import type { Assignment, Escalation, ShiftHandover, UserSummary } from "../types";

export function HandoversPanel({
  profile,
  assignments,
  handovers,
  escalations,
  onSaved,
}: {
  profile: UserSummary;
  assignments: Assignment[];
  handovers: ShiftHandover[];
  escalations: Escalation[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const [options, setOptions] = useState<Assignment[]>([]);
  const [selectedEscalations, setSelectedEscalations] = useState<number[]>([]);
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");

  const eligibleEscalations = useMemo(
    () =>
      escalations.filter(
        (item) => item.assignment === Number(outgoing) && item.status !== "resolved",
      ),
    [escalations, outgoing],
  );

  useEffect(() => {
    setIncoming("");
    setSelectedEscalations([]);
    if (!outgoing) {
      setOptions([]);
      return;
    }

    let active = true;
    apiRequest<Assignment[]>(
      `/team-leader-assignments/${outgoing}/handover-options/`,
    )
      .then((payload) => {
        if (active) setOptions(payload);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load incoming assignments.");
      });
    return () => {
      active = false;
    };
  }, [outgoing]);

  const createHandover = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedEscalations.length === 0) {
      setError("Select at least one unresolved escalation to carry into the handover.");
      return;
    }

    setBusy("new");
    setError("");
    try {
      await postJson<ShiftHandover>("/shift-handovers/", {
        outgoing_assignment: Number(outgoing),
        incoming_assignment: Number(incoming),
        escalation_ids: selectedEscalations,
        operational_summary: summary.trim(),
        notes: notes.trim(),
      });
      await onSaved("Handover created and awaiting receiver acceptance.");
      setShowForm(false);
      setSummary("");
      setNotes("");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        setShowForm(false);
        setSummary("");
        setNotes("");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not create the handover.");
      }
    } finally {
      setBusy(null);
    }
  };

  const accept = async (handover: ShiftHandover) => {
    setBusy(handover.id);
    setError("");
    try {
      await postJson<ShiftHandover>(`/shift-handovers/${handover.id}/accept/`);
      await onSaved("Handover accepted. Resolved carry-over items were removed automatically.");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not accept the handover.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <PageIntro
        eyebrow="Responsibility transfer"
        title="Shift handover"
        body="Carry unresolved escalations to the next assignment and capture explicit receiver acceptance."
        action={
          <button className="button button--primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? "Close form" : "Create handover"}
          </button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <form className="form-card form-grid form-card--spaced" onSubmit={createHandover}>
          <label>
            Outgoing assignment
            <AssignmentSelect
              assignments={assignments}
              value={outgoing}
              onChange={(event) => setOutgoing(event.target.value)}
              required
            />
          </label>
          <label>
            Incoming assignment
            <select value={incoming} onChange={(event) => setIncoming(event.target.value)} required>
              <option value="">Select the next assignment</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.production_line_code} · {option.date} · {titleCase(option.shift_type)} · {option.team_leader_username}
                </option>
              ))}
            </select>
            {outgoing && options.length === 0 ? (
              <small>No later same-line assignment is currently available.</small>
            ) : null}
          </label>
          <fieldset className="span-2 checkbox-group">
            <legend>Unresolved escalations to carry</legend>
            {eligibleEscalations.length === 0 ? (
              <p>No unresolved escalation belongs to this outgoing assignment.</p>
            ) : (
              eligibleEscalations.map((item) => (
                <label className="checkbox-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedEscalations.includes(item.id)}
                    onChange={(event) =>
                      setSelectedEscalations((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.production_line_code} · {titleCase(item.priority)}</strong>
                    {item.summary}
                  </span>
                </label>
              ))
            )}
          </fieldset>
          <label className="span-2">
            Operational summary
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} required />
          </label>
          <label className="span-2">
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
          <div className="form-actions span-2">
            <SubmitButton busy={busy === "new"}>Create handover</SubmitButton>
          </div>
        </form>
      ) : null}

      {handovers.length === 0 ? (
        <EmptyState
          title="No handovers visible"
          body="Outgoing and incoming records involving your assignments will appear here."
        />
      ) : (
        <div className="card-list">
          {handovers.map((handover) => {
            const canAccept =
              handover.status === "pending" &&
              (profile.is_staff || handover.incoming_team_leader_username === profile.username);

            return (
              <article className="workflow-card" key={handover.id}>
                <div className="workflow-card__header">
                  <div>
                    <span className="eyebrow">{handover.production_line_code}</span>
                    <h3>{handover.outgoing_team_leader_username} → {handover.incoming_team_leader_username}</h3>
                  </div>
                  <StatusPill value={handover.status} />
                </div>
                <p className="handover-summary">{handover.operational_summary}</p>
                <div className="timeline-pair">
                  <span>Created <strong>{formatDateTime(handover.handed_over_at)}</strong></span>
                  <span>Carry-over <strong>{handover.escalations.length} items</strong></span>
                </div>
                {handover.escalations.length ? (
                  <ul className="compact-list">
                    {handover.escalations.map((item) => (
                      <li key={item.id}>
                        <StatusPill value={item.priority} /> {item.summary}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canAccept ? (
                  <div className="workflow-actions">
                    <button
                      className="button button--primary"
                      disabled={busy === handover.id}
                      onClick={() => void accept(handover)}
                    >
                      {busy === handover.id ? "Accepting…" : "Accept handover"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
