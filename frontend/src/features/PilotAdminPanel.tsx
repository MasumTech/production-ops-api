import { useEffect, useState } from "react";

import { ApiError, apiList, apiRequest, postJson } from "../api";
import { ErrorBanner, StatusPill } from "../components";
import { formatDateTime, localDate } from "../format";
import type { PilotEvidence, PilotStatus, PilotTrial, ProductionLine, UserSummary } from "../types";

function dateAfter(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function PilotAdminPanel() {
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [trials, setTrials] = useState<PilotTrial[]>([]);
  const [selectedTrialId, setSelectedTrialId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<PilotEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<number | null>(null);
  const [busyTrial, setBusyTrial] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [trialDraft, setTrialDraft] = useState({
    name: "Four-week line control pilot",
    objective: "Check update speed, escalation acknowledgement and handover clarity with dummy data.",
    start_date: localDate(),
    end_date: dateAfter(27),
    selected_line_ids: [] as number[],
  });
  const [observationDraft, setObservationDraft] = useState({
    observed_on: localDate(),
    production_line: "",
    shift_type: "day" as "day" | "night",
    line_status: "green" as "green" | "amber" | "red",
    update_duration_seconds: "0",
    escalation_ack_seconds: "",
    missed_actions: "0",
    status_was_accurate: true,
    used_paper_fallback: false,
    notes: "",
  });
  const [decisionNote, setDecisionNote] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextUsers, nextLines, nextTrials] = await Promise.all([
        apiRequest<PilotStatus>("/pilot/status/"),
        apiRequest<UserSummary[]>("/workspace-roles/"),
        apiList<ProductionLine>("/production-lines/?status=active&ordering=code"),
        apiList<PilotTrial>("/pilot-trials/?ordering=-created_at"),
      ]);
      setStatus(nextStatus);
      setUsers(nextUsers);
      setLines(nextLines);
      setTrials(nextTrials);
      setSelectedTrialId((current) =>
        current && nextTrials.some((trial) => trial.id === current)
          ? current
          : nextTrials[0]?.id ?? null,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Pilot controls are unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const selected = trials.find((trial) => trial.id === selectedTrialId);
    if (!selected) {
      setEvidence(null);
      return;
    }
    setObservationDraft((current) => ({
      ...current,
      production_line: current.production_line || String(selected.selected_lines[0]?.id ?? ""),
    }));
    void apiRequest<PilotEvidence>(`/pilot-trials/${selected.id}/evidence/`)
      .then(setEvidence)
      .catch((caught) => {
        setError(caught instanceof ApiError ? caught.message : "Evidence is unavailable.");
      });
  }, [selectedTrialId, trials]);

  const changeRole = async (user: UserSummary) => {
    const workspace = user.workspace === "support" ? "team_leader" : "support";
    setBusyUser(user.id);
    setError("");
    try {
      const updated = await postJson<UserSummary>("/workspace-roles/", {
        user: user.id,
        workspace,
      });
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setStatus(await apiRequest<PilotStatus>("/pilot/status/"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update this role.");
    } finally {
      setBusyUser(null);
    }
  };

  const createTrial = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trialDraft.selected_line_ids.length) {
      setError("Select at least one active line for the trial.");
      return;
    }
    setError("");
    try {
      const created = await postJson<PilotTrial>("/pilot-trials/", trialDraft);
      setTrials((current) => [created, ...current]);
      setSelectedTrialId(created.id);
      setTrialDraft((current) => ({ ...current, selected_line_ids: [] }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the trial.");
    }
  };

  const startTrial = async (trial: PilotTrial) => {
    setBusyTrial(trial.id);
    setError("");
    try {
      const updated = await postJson<PilotTrial>(`/pilot-trials/${trial.id}/start/`, {});
      setTrials((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not start the trial.");
    } finally {
      setBusyTrial(null);
    }
  };

  const saveObservation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTrialId) return;
    setBusyTrial(selectedTrialId);
    setError("");
    try {
      await postJson("/pilot-observations/", {
        trial: selectedTrialId,
        ...observationDraft,
        production_line: Number(observationDraft.production_line),
        update_duration_seconds: Number(observationDraft.update_duration_seconds),
        escalation_ack_seconds: observationDraft.escalation_ack_seconds
          ? Number(observationDraft.escalation_ack_seconds)
          : null,
        missed_actions: Number(observationDraft.missed_actions),
      });
      const refreshed = await apiRequest<PilotEvidence>(`/pilot-trials/${selectedTrialId}/evidence/`);
      setEvidence(refreshed);
      setObservationDraft((current) => ({ ...current, notes: "", missed_actions: "0" }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the observation.");
    } finally {
      setBusyTrial(null);
    }
  };

  const decideTrial = async (decision: "completed" | "stopped") => {
    if (!selectedTrialId || !decisionNote.trim()) {
      setError("Add a decision note before recording the outcome.");
      return;
    }
    setBusyTrial(selectedTrialId);
    setError("");
    try {
      const updated = await postJson<PilotTrial>(`/pilot-trials/${selectedTrialId}/decide/`, {
        decision,
        decision_note: decisionNote.trim(),
      });
      setTrials((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDecisionNote("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not record the trial outcome.");
    } finally {
      setBusyTrial(null);
    }
  };

  return (
    <section className="pilot-admin" aria-labelledby="pilot-admin-title">
      <div className="manager-section-heading">
        <div>
          <span className="eyebrow">Controlled rollout</span>
          <h1 id="pilot-admin-title">Pilot readiness</h1>
          <p>Monitor notification delivery and reminder-worker freshness, then manage approved support access.</p>
        </div>
        <button className="button button--ghost" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {status ? (
        <>
          <div className="pilot-status-banner">
            <StatusPill value={status.status} />
            <div>
              <strong>{status.status === "ready" ? "Pilot services reporting normally" : "Pilot attention required"}</strong>
              <span>Generated {formatDateTime(status.generated_at)}</span>
            </div>
          </div>
          <div className="pilot-kpis" aria-label="Pilot monitoring summary">
            <article><span>Active users</span><strong>{status.active_users}</strong></article>
            <article><span>Support users</span><strong>{status.support_users}</strong></article>
            <article><span>Events last hour</span><strong>{status.events_last_hour}</strong></article>
            <article><span>Unread alerts</span><strong>{status.unread_notifications}</strong></article>
            <article><span>Open actions</span><strong>{status.open_actions}</strong><small>{status.overdue_actions} overdue</small></article>
            <article><span>Unassigned actions</span><strong>{status.unassigned_actions}</strong></article>
          </div>
          <article className="pilot-worker-card">
            <div>
              <span className="eyebrow">Background monitoring</span>
              <h2>Reminder worker</h2>
            </div>
            <StatusPill value={status.reminder_worker.status} />
            <dl>
              <div><dt>Last completed</dt><dd>{formatDateTime(status.reminder_worker.last_completed_at)}</dd></div>
              <div><dt>Published last scan</dt><dd>{status.reminder_worker.published_count}</dd></div>
              <div><dt>Last error</dt><dd>{status.reminder_worker.last_error || "None"}</dd></div>
            </dl>
          </article>
        </>
      ) : null}

      <section className="pilot-trial-admin" aria-labelledby="pilot-trial-title">
        <div className="manager-section-heading">
          <div>
            <span className="eyebrow">Plan-aligned evidence</span>
            <h2 id="pilot-trial-title">Four-week trial evidence</h2>
            <p>Record dummy-data observations before any approved software or process rollout.</p>
          </div>
        </div>

        <form className="form-card pilot-trial-create" onSubmit={(event) => void createTrial(event)}>
          <div className="form-grid">
            <label>
              Trial name
              <input
                value={trialDraft.name}
                onChange={(event) => setTrialDraft({ ...trialDraft, name: event.target.value })}
                required
              />
            </label>
            <label>
              Objective
              <input
                value={trialDraft.objective}
                onChange={(event) => setTrialDraft({ ...trialDraft, objective: event.target.value })}
                required
              />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={trialDraft.start_date}
                onChange={(event) => setTrialDraft({ ...trialDraft, start_date: event.target.value })}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={trialDraft.end_date}
                onChange={(event) => setTrialDraft({ ...trialDraft, end_date: event.target.value })}
                required
              />
            </label>
            <fieldset className="checkbox-group span-2">
              <legend>Selected active lines</legend>
              {lines.length ? lines.map((line) => (
                <label className="checkbox-row" key={line.id}>
                  <input
                    type="checkbox"
                    checked={trialDraft.selected_line_ids.includes(line.id)}
                    onChange={(event) => setTrialDraft({
                      ...trialDraft,
                      selected_line_ids: event.target.checked
                        ? [...trialDraft.selected_line_ids, line.id]
                        : trialDraft.selected_line_ids.filter((id) => id !== line.id),
                    })}
                  />
                  <span>{line.code} · {line.name}</span>
                </label>
              )) : <p>No active production lines are available.</p>}
            </fieldset>
            <div className="form-actions span-2">
              <button className="button button--primary" disabled={loading || !lines.length}>
                Create planned trial
              </button>
            </div>
          </div>
        </form>

        {trials.length ? (
          <div className="pilot-trial-list" aria-label="Pilot trials">
            {trials.map((trial) => (
              <article
                className={selectedTrialId === trial.id ? "pilot-trial-card is-selected" : "pilot-trial-card"}
                key={trial.id}
              >
                <div>
                  <strong>{trial.name}</strong>
                  <span>{trial.start_date} → {trial.end_date}</span>
                  <small>{trial.selected_lines.map((line) => line.code).join(", ")}</small>
                </div>
                <StatusPill value={trial.status} />
                <div className="pilot-trial-card__actions">
                  <button type="button" className="button button--ghost" onClick={() => setSelectedTrialId(trial.id)}>
                    View evidence
                  </button>
                  {trial.status === "planned" ? (
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busyTrial === trial.id}
                      onClick={() => void startTrial(trial)}
                    >
                      {busyTrial === trial.id ? "Starting…" : "Start trial"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><strong>No trial created yet</strong><p>Create a planned trial with one or more active lines to begin collecting evidence.</p></div>}

        {evidence && selectedTrialId ? (
          <article className="pilot-evidence-card" aria-labelledby="pilot-evidence-title">
            <div className="manager-section-heading manager-section-heading--compact">
              <div>
                <span className="eyebrow">{evidence.trial.status} trial</span>
                <h3 id="pilot-evidence-title">{evidence.trial.name}</h3>
              </div>
              <StatusPill value={evidence.trial.status} />
            </div>
            <div className="pilot-kpis" aria-label="Trial evidence summary">
              <article><span>Observations</span><strong>{evidence.summary.observation_count}</strong></article>
              <article><span>Avg update seconds</span><strong>{evidence.summary.average_update_duration_seconds ?? "—"}</strong></article>
              <article><span>Avg acknowledgement seconds</span><strong>{evidence.summary.average_escalation_ack_seconds ?? "—"}</strong></article>
              <article><span>Missed actions</span><strong>{evidence.summary.missed_actions}</strong></article>
              <article><span>Accurate updates</span><strong>{evidence.summary.accurate_updates}</strong></article>
              <article><span>Paper fallback</span><strong>{evidence.summary.paper_fallback_count}</strong></article>
            </div>

            {evidence.trial.status === "active" ? (
              <>
                <form className="form-card" onSubmit={(event) => void saveObservation(event)}>
                  <div className="form-grid">
                    <label>
                      Observation date
                      <input type="date" value={observationDraft.observed_on} onChange={(event) => setObservationDraft({ ...observationDraft, observed_on: event.target.value })} required />
                    </label>
                    <label>
                      Line
                      <select value={observationDraft.production_line} onChange={(event) => setObservationDraft({ ...observationDraft, production_line: event.target.value })} required>
                        <option value="">Select a line</option>
                        {evidence.trial.selected_lines.map((line) => <option key={line.id} value={line.id}>{line.code}</option>)}
                      </select>
                    </label>
                    <label>
                      Shift
                      <select value={observationDraft.shift_type} onChange={(event) => setObservationDraft({ ...observationDraft, shift_type: event.target.value as "day" | "night" })}>
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                      </select>
                    </label>
                    <label>
                      GREEN / AMBER / RED
                      <select value={observationDraft.line_status} onChange={(event) => setObservationDraft({ ...observationDraft, line_status: event.target.value as "green" | "amber" | "red" })}>
                        <option value="green">Green</option>
                        <option value="amber">Amber</option>
                        <option value="red">Red</option>
                      </select>
                    </label>
                    <label>
                      Update duration (seconds)
                      <input type="number" min="0" value={observationDraft.update_duration_seconds} onChange={(event) => setObservationDraft({ ...observationDraft, update_duration_seconds: event.target.value })} required />
                    </label>
                    <label>
                      Escalation acknowledgement (seconds)
                      <input type="number" min="0" value={observationDraft.escalation_ack_seconds} onChange={(event) => setObservationDraft({ ...observationDraft, escalation_ack_seconds: event.target.value })} />
                    </label>
                    <label>
                      Missed actions
                      <input type="number" min="0" value={observationDraft.missed_actions} onChange={(event) => setObservationDraft({ ...observationDraft, missed_actions: event.target.value })} required />
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={observationDraft.status_was_accurate} onChange={(event) => setObservationDraft({ ...observationDraft, status_was_accurate: event.target.checked })} />
                      <span>Status was accurate</span>
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={observationDraft.used_paper_fallback} onChange={(event) => setObservationDraft({ ...observationDraft, used_paper_fallback: event.target.checked })} />
                      <span>Paper/communication fallback used</span>
                    </label>
                    <label className="span-2">
                      Notes
                      <textarea value={observationDraft.notes} onChange={(event) => setObservationDraft({ ...observationDraft, notes: event.target.value })} />
                    </label>
                    <div className="form-actions span-2">
                      <button className="button button--primary" disabled={busyTrial === selectedTrialId}>Save observation</button>
                    </div>
                  </div>
                </form>
                <div className="pilot-decision-card">
                  <label>
                    Continue / stop review note
                    <textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Record the management review outcome and evidence." />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="button button--ghost" disabled={busyTrial === selectedTrialId} onClick={() => void decideTrial("stopped")}>Stop trial</button>
                    <button type="button" className="button button--primary" disabled={busyTrial === selectedTrialId} onClick={() => void decideTrial("completed")}>Complete review</button>
                  </div>
                </div>
              </>
            ) : (
              <p className="pilot-boundary">Decision: {evidence.trial.decision_note || "No decision note recorded."}</p>
            )}
            {evidence.observations.length ? (
              <div className="responsive-table">
                <table>
                  <thead><tr><th>Date</th><th>Line</th><th>Status</th><th>Update</th><th>Ack</th><th>Missed</th><th>Fallback</th></tr></thead>
                  <tbody>{evidence.observations.map((item) => (
                    <tr key={item.id}><td>{item.observed_on}</td><td>{item.production_line_code}</td><td>{item.line_status}</td><td>{item.update_duration_seconds}s</td><td>{item.escalation_ack_seconds === null ? "—" : `${item.escalation_ack_seconds}s`}</td><td>{item.missed_actions}</td><td>{item.used_paper_fallback ? "Yes" : "No"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}
          </article>
        ) : null}
      </section>

      <section className="pilot-role-admin" aria-labelledby="role-admin-title">
        <span className="eyebrow">Approved access</span>
        <h2 id="role-admin-title">Workspace roles</h2>
        <p>Assign Operational Support only after the approved identity and access process is complete.</p>
        <div className="pilot-role-list">
          {users.map((user) => (
            <article key={user.id}>
              <div>
                <strong>{user.display_name}</strong>
                <span>{user.username}</span>
              </div>
              <StatusPill value={user.workspace} />
              {user.workspace !== "manager" ? (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busyUser === user.id}
                  onClick={() => void changeRole(user)}
                >
                  {busyUser === user.id
                    ? "Saving…"
                    : user.workspace === "support"
                      ? "Set as Team Leader"
                      : "Grant Support access"}
                </button>
              ) : <span className="pilot-managed-elsewhere">Managed in Django Admin</span>}
            </article>
          ))}
        </div>
        <p className="pilot-boundary">
          Role changes are audited as operational events. Staff status remains managed separately.
        </p>
      </section>
    </section>
  );
}
