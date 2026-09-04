import { useMemo, useState } from "react";

import { ApiError, OfflineQueuedError, postJson } from "../api";
import { ErrorBanner, StatusPill } from "../components";
import { formatDateTime } from "../format";
import { NotificationCentre } from "../NotificationCentre";
import type {
  Escalation,
  SupportCompanionData,
  UserSummary,
} from "../types";
import {
  WorkspaceBottomNavigation,
  WorkspaceSidebar,
} from "../WorkspaceNavigation";

type SupportTab = "overview" | "actions" | "lines" | "materials" | "guide";

const NAV_ITEMS: Array<{
  id: SupportTab;
  label: string;
  shortLabel: string;
}> = [
  { id: "overview", label: "Support Overview", shortLabel: "Overview" },
  { id: "actions", label: "My Actions", shortLabel: "Actions" },
  { id: "lines", label: "Line Status", shortLabel: "Lines" },
  { id: "materials", label: "Material Risks", shortLabel: "Materials" },
  { id: "guide", label: "Response Guide", shortLabel: "Guide" },
];

function ActionCard({
  escalation,
  busy,
  onAcknowledge,
}: {
  escalation: Escalation;
  busy: boolean;
  onAcknowledge: (escalation: Escalation) => void;
}) {
  return (
    <article
      className={`support-action support-action--${escalation.priority}`}
      aria-label={`${escalation.priority} action for ${escalation.production_line_code}`}
    >
      <div className="support-action__heading">
        <div>
          <span className="eyebrow">{escalation.production_line_code}</span>
          <h3>{escalation.summary}</h3>
        </div>
        <div className="support-action__signals">
          <StatusPill value={escalation.priority} />
          {escalation.is_overdue ? <span className="signal signal--danger">Overdue</span> : null}
        </div>
      </div>
      <dl className="support-action__details">
        <div>
          <dt>Category</dt>
          <dd>{escalation.category}</dd>
        </div>
        <div>
          <dt>Response due</dt>
          <dd>{escalation.response_due_at ? formatDateTime(escalation.response_due_at) : "Not set"}</dd>
        </div>
        <div>
          <dt>Immediate action</dt>
          <dd>{escalation.immediate_action || "Follow the approved response procedure."}</dd>
        </div>
      </dl>
      {escalation.status === "open" ? (
        <button
          className="button button--primary button--full"
          type="button"
          disabled={busy}
          onClick={() => onAcknowledge(escalation)}
        >
          {busy ? "Acknowledging…" : "Acknowledge action"}
        </button>
      ) : (
        <div className="support-action__acknowledged" role="status">
          Acknowledged · response in progress
        </div>
      )}
    </article>
  );
}

export function SupportCompanion({
  profile,
  data,
  operationalDate,
  lastUpdatedAt,
  online,
  liveState,
  busy,
  error,
  onDateChange,
  onRefresh,
  onSignOut,
  onSaved,
}: {
  profile: UserSummary;
  data: SupportCompanionData;
  operationalDate: string;
  lastUpdatedAt: string | null;
  online: boolean;
  liveState: string;
  busy: boolean;
  error: string;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<SupportTab>("overview");
  const [acknowledging, setAcknowledging] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const openActions = data.escalations.filter((item) => item.status === "open");
  const overdueCount = data.escalations.filter((item) => item.is_overdue).length;
  const criticalCount = data.escalations.filter((item) => item.priority === "critical").length;
  const updateByAssignment = useMemo(
    () => new Map(data.updates.map((item) => [item.assignment, item])),
    [data.updates],
  );

  const acknowledge = async (escalation: Escalation) => {
    setAcknowledging(escalation.id);
    setActionError("");
    try {
      await postJson(`/operational-escalations/${escalation.id}/acknowledge/`);
      await onSaved("Action acknowledged. The Team Leader can see your response.");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved("Acknowledgement queued securely and will sync when online.");
      } else {
        setActionError(
          caught instanceof ApiError ? caught.message : "Could not acknowledge this action.",
        );
      }
    } finally {
      setAcknowledging(null);
    }
  };

  const actions = tab === "overview" ? data.escalations.slice(0, 3) : data.escalations;

  return (
    <div className="app-shell support-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: acknowledgements are queued securely until the connection returns.
        </div>
      ) : null}
      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-mark brand-mark--small" aria-hidden="true">SC</div>
          <div>
            <strong>Mobile Support Companion</strong>
            <span>{liveState === "live" ? "Live alerts connected" : "Snapshot mode"}</span>
          </div>
        </div>
        <div className="topbar__actions">
          <label className="date-control">
            <span>Operational date</span>
            <input
              aria-label="Operational date"
              type="date"
              value={operationalDate}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <span className="user-chip">{profile.display_name}</span>
          <NotificationCentre refreshToken={lastUpdatedAt} />
          <button className="button button--ghost" onClick={onRefresh} disabled={busy}>Refresh</button>
          <button className="button button--ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <WorkspaceSidebar
        ariaLabel="Operational Support workspace"
        navigationLabel="Operational Support sections"
        items={NAV_ITEMS}
        activeItem={tab}
        onSelect={setTab}
        summary={
          <>
            <span className="eyebrow">Assigned response</span>
            <strong>{data.escalations.length} active actions</strong>
            <span>{overdueCount} overdue · {criticalCount} critical</span>
          </>
        }
        boundary={<>Visibility and acknowledgement only. Follow approved safety and response procedures.</>}
      />

      <main className="workspace support-workspace">
        {error ? <ErrorBanner message={error} /> : null}
        {actionError ? <ErrorBanner message={actionError} /> : null}

        {tab === "overview" ? (
          <>
            <section className="support-hero">
              <span className="eyebrow">Operational support</span>
              <h1>My response queue</h1>
              <p>Critical and overdue actions are shown first, with the line context needed to respond.</p>
              <span className="support-hero__updated">
                {lastUpdatedAt ? `Updated ${formatDateTime(lastUpdatedAt)}` : "Waiting for first refresh"}
              </span>
            </section>
            <section className="support-metrics" aria-label="Support response summary">
              <article><span>Open</span><strong>{openActions.length}</strong></article>
              <article className="support-metric--danger"><span>Overdue</span><strong>{overdueCount}</strong></article>
              <article><span>Critical</span><strong>{criticalCount}</strong></article>
              <article><span>Material risks</span><strong>{data.materials.length}</strong></article>
            </section>
          </>
        ) : null}

        {tab === "overview" || tab === "actions" ? (
          <section aria-labelledby="support-actions-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Priority response</span>
                <h2 id="support-actions-title">{tab === "overview" ? "Respond now" : "My actions"}</h2>
              </div>
            </div>
            <div className="support-action-grid">
              {actions.map((item) => (
                <ActionCard
                  key={item.id}
                  escalation={item}
                  busy={acknowledging === item.id}
                  onAcknowledge={(target) => void acknowledge(target)}
                />
              ))}
              {!actions.length ? <p className="empty-state">No active actions assigned for this date.</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "lines" ? (
          <section aria-labelledby="support-lines-title">
            <span className="eyebrow">Related operations</span>
            <h1 id="support-lines-title">Line status</h1>
            <div className="support-context-grid">
              {data.assignments.map((assignment) => {
                const update = updateByAssignment.get(assignment.id);
                return (
                  <article className="support-context-card" key={assignment.id}>
                    <div className="support-context-card__heading">
                      <div><h3>{assignment.production_line_code}</h3><p>{assignment.production_line_name}</p></div>
                      {update ? <StatusPill value={update.status} /> : <StatusPill value="missing" />}
                    </div>
                    <dl>
                      <div><dt>Current product</dt><dd>{update?.current_product || "Not reported"}</dd></div>
                      <div><dt>Latest issue</dt><dd>{update?.issue_summary || "No status received"}</dd></div>
                      <div><dt>Team Leader</dt><dd>{assignment.team_leader_username}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {tab === "materials" ? (
          <section aria-labelledby="support-materials-title">
            <span className="eyebrow">Supply position</span>
            <h1 id="support-materials-title">Material risks</h1>
            <div className="support-context-grid">
              {data.materials.map((material) => (
                <article className="support-context-card" key={material.id}>
                  <div className="support-context-card__heading">
                    <div><span className="eyebrow">{material.production_line_code}</span><h3>{material.product_code}</h3></div>
                    <StatusPill value={material.status} />
                  </div>
                  <p>{material.product_name}</p>
                  <dl>
                    {material.status === "short" ? <div><dt>Shortage</dt><dd>{material.shortage_quantity.toLocaleString()}</dd></div> : null}
                    <div><dt>Owner</dt><dd>{material.owner_username || "Not assigned"}</dd></div>
                    <div><dt>Context</dt><dd>{material.hold_reason || material.notes || "Follow the material response plan."}</dd></div>
                  </dl>
                </article>
              ))}
              {!data.materials.length ? <p className="empty-state">No short or held materials on your assigned lines.</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "guide" ? (
          <section aria-labelledby="support-guide-title">
            <span className="eyebrow">Safe response</span>
            <h1 id="support-guide-title">Response guide</h1>
            <div className="support-guide">
              <article><strong>1. Make the area safe</strong><p>Follow the approved safety, quality and line-stop procedure before updating software.</p></article>
              <article><strong>2. Acknowledge ownership</strong><p>Use acknowledgement to confirm you are responding; it does not record a completed repair.</p></article>
              <article><strong>3. Keep the Team Leader informed</strong><p>Use approved verbal communication for urgent conditions and record formal evidence in the authorised system.</p></article>
            </div>
          </section>
        ) : null}
      </main>

      <WorkspaceBottomNavigation
        ariaLabel="Operational Support mobile workspace"
        items={NAV_ITEMS}
        activeItem={tab}
        onSelect={setTab}
      />
    </div>
  );
}
