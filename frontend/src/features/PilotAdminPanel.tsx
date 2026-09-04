import { useEffect, useState } from "react";

import { ApiError, apiRequest, postJson } from "../api";
import { ErrorBanner, StatusPill } from "../components";
import { formatDateTime } from "../format";
import type { PilotStatus, UserSummary } from "../types";

export function PilotAdminPanel() {
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextUsers] = await Promise.all([
        apiRequest<PilotStatus>("/pilot/status/"),
        apiRequest<UserSummary[]>("/workspace-roles/"),
      ]);
      setStatus(nextStatus);
      setUsers(nextUsers);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Pilot controls are unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
