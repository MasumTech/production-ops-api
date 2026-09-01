import { useMemo, useState } from "react";
import { LossAnalyticsPanel } from "./LossAnalyticsPanel";
import { EmptyState, ErrorBanner, StatusPill } from "../components";
import { formatDateTime, titleCase } from "../format";
import type { LiveConnectionState } from "../realtime";
import type {
  Assignment,
  Escalation,
  LineUpdate,
  ManagerWorkspaceData,
  MaterialReadiness,
  ShiftRecord,
  UserSummary,
} from "../types";

type AttentionLevel = "urgent" | "warning" | "stable";
type BoardFilter = "all" | "attention" | "red" | "late" | "materials";

export interface ManagerLineRow {
  assignment: Assignment;
  update: LineUpdate | null;
  shift: ShiftRecord | null;
  openActions: Escalation[];
  materialRisks: MaterialReadiness[];
  isLate: boolean;
  attentionLevel: AttentionLevel;
}

const EMPTY_SUMMARY = {
  total_shifts: 0,
  total_planned_output: 0,
  total_actual_output: 0,
  overall_performance_percentage: null,
  total_downtime_minutes: 0,
  open_incidents: 0,
  critical_incidents: 0,
};

const NUMBER = new Intl.NumberFormat();

function assignmentKey(assignment: Assignment): string {
  return `${assignment.production_line}:${assignment.shift_type}`;
}

function shiftKey(shift: ShiftRecord): string {
  return `${shift.production_line}:${shift.shift_type}`;
}

export function buildManagerRows(
  data: ManagerWorkspaceData,
  now = Date.now(),
): ManagerLineRow[] {
  const updateByAssignment = new Map(data.updates.map((item) => [item.assignment, item]));
  const shiftByLine = new Map(data.shifts.map((item) => [shiftKey(item), item]));

  return data.assignments
    .map((assignment) => {
      const update = updateByAssignment.get(assignment.id) ?? null;
      const openActions = data.escalations.filter(
        (item) => item.assignment === assignment.id && item.status !== "resolved",
      );
      const materialRisks = data.materials.filter(
        (item) =>
          item.assignment === assignment.id && ["short", "held"].includes(item.status),
      );
      const isLate = Boolean(
        update?.next_update_due_at && new Date(update.next_update_due_at).getTime() < now,
      );
      const urgent =
        update?.status === "red" ||
        openActions.some((item) => item.is_overdue || item.priority === "critical");
      const warning =
        !update ||
        isLate ||
        update.status === "amber" ||
        openActions.length > 0 ||
        materialRisks.length > 0;

      return {
        assignment,
        update,
        shift: shiftByLine.get(assignmentKey(assignment)) ?? null,
        openActions,
        materialRisks,
        isLate,
        attentionLevel: urgent ? "urgent" : warning ? "warning" : "stable",
      } satisfies ManagerLineRow;
    })
    .sort((left, right) => {
      const rank: Record<AttentionLevel, number> = { urgent: 0, warning: 1, stable: 2 };
      return (
        rank[left.attentionLevel] - rank[right.attentionLevel] ||
        left.assignment.production_line_code.localeCompare(
          right.assignment.production_line_code,
        )
      );
    });
}

function matchesFilter(row: ManagerLineRow, filter: BoardFilter): boolean {
  if (filter === "attention") return row.attentionLevel !== "stable";
  if (filter === "red") return row.update?.status === "red";
  if (filter === "late") return row.isLate || !row.update;
  if (filter === "materials") return row.materialRisks.length > 0;
  return true;
}

function outputCopy(shift: ShiftRecord | null): string {
  if (!shift) return "No shift output recorded";
  return `${NUMBER.format(shift.actual_output)} / ${NUMBER.format(shift.planned_output)}`;
}

function performanceCopy(shift: ShiftRecord | null): string {
  if (!shift || shift.performance_percentage === null) return "—";
  return `${shift.performance_percentage.toFixed(1)}%`;
}

export function ManagerConsole({
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
}: {
  profile: UserSummary;
  data: ManagerWorkspaceData;
  operationalDate: string;
  lastUpdatedAt: string | null;
  online: boolean;
  liveState: LiveConnectionState;
  busy: boolean;
  error: string;
  onDateChange: (value: string) => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const rows = useMemo(() => buildManagerRows(data), [data]);
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesFilter(row, filter)),
    [filter, rows],
  );
  const openActions = data.escalations
    .filter((item) => item.status !== "resolved")
    .sort((left, right) => Number(right.needs_attention) - Number(left.needs_attention));
  const materialRisks = data.materials.filter((item) =>
    ["short", "held"].includes(item.status),
  );
  const lateCount = rows.filter((row) => row.isLate || !row.update).length;
  const attentionCount = rows.filter((row) => row.attentionLevel !== "stable").length;
  const summary = data.summary ?? EMPTY_SUMMARY;

  return (
    <div className="manager-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: this snapshot remains visible, but refresh needs a connection.
        </div>
      ) : null}

      <header className="manager-topbar">
        <div className="topbar__brand">
          <div className="brand-mark brand-mark--small" aria-hidden="true">
            ML
          </div>
          <div>
            <strong>Operations Manager Console</strong>
            <span>
              Live Floor · {liveState === "live" ? "Event stream connected" : "Snapshot fallback"}
            </span>
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
          <button className="button button--ghost" onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
          <button className="button button--ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="manager-workspace">
        {error ? <ErrorBanner message={error} /> : null}
        <section className="manager-hero" aria-labelledby="manager-title">
          <div>
            <span className="eyebrow">Management oversight</span>
            <h1 id="manager-title">Live Floor priority board</h1>
            <p>
              Critical lines rise first. Review late updates, open actions, output position, and
              current material risk before contacting the floor.
            </p>
          </div>
          <div className="snapshot-copy">
            <span>Last refreshed</span>
            <strong>{lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "Not refreshed"}</strong>
          </div>
        </section>

        <section className="manager-kpis" aria-label="Operational summary">
          <article className="kpi-card">
            <span>Active line assignments</span>
            <strong>{rows.length}</strong>
            <small>{attentionCount} need attention</small>
          </article>
          <article className="kpi-card kpi-card--danger">
            <span>Open actions</span>
            <strong>{openActions.length}</strong>
            <small>{openActions.filter((item) => item.is_overdue).length} overdue</small>
          </article>
          <article className="kpi-card kpi-card--warning">
            <span>Late or missing updates</span>
            <strong>{lateCount}</strong>
            <small>Follow up with the line owner</small>
          </article>
          <article className="kpi-card kpi-card--warning">
            <span>Material risks</span>
            <strong>{materialRisks.length}</strong>
            <small>Short or held products</small>
          </article>
          <article className="kpi-card">
            <span>Output position</span>
            <strong>
              {NUMBER.format(summary.total_actual_output)} / {NUMBER.format(summary.total_planned_output)}
            </strong>
            <small>
              {summary.overall_performance_percentage === null
                ? "No performance yet"
                : `${summary.overall_performance_percentage.toFixed(1)}% overall`}
            </small>
          </article>
          <article className="kpi-card">
            <span>Downtime</span>
            <strong>{NUMBER.format(summary.total_downtime_minutes)} min</strong>
            <small>{summary.open_incidents} open quality incidents</small>
          </article>
        </section>

        <section className="manager-board" aria-labelledby="priority-board-title">
          <div className="manager-section-heading">
            <div>
              <span className="eyebrow">Priority order</span>
              <h2 id="priority-board-title">All-line control view</h2>
            </div>
            <div className="manager-filters" aria-label="Filter priority board">
              {(
                [
                  ["all", "All"],
                  ["attention", "Attention"],
                  ["red", "Red"],
                  ["late", "Late"],
                  ["materials", "Materials"],
                ] as Array<[BoardFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visibleRows.length ? (
            <div className="table-card manager-table-card">
              <div className="responsive-table">
                <table>
                  <thead>
                    <tr>
                      <th>Priority / line</th>
                      <th>Latest position</th>
                      <th>Update control</th>
                      <th>Output</th>
                      <th>Open actions</th>
                      <th>Materials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr
                        key={row.assignment.id}
                        className={`manager-row manager-row--${row.attentionLevel}`}
                      >
                        <td data-label="Line">
                          <span className={`priority-flag priority-flag--${row.attentionLevel}`}>
                            {titleCase(row.attentionLevel)}
                          </span>
                          <strong>{row.assignment.production_line_code}</strong>
                          <span>
                            {row.assignment.production_line_name} · {titleCase(row.assignment.shift_type)}
                          </span>
                          <span>Lead: {row.assignment.team_leader_username}</span>
                        </td>
                        <td data-label="Status">
                          {row.update ? <StatusPill value={row.update.status} /> : <StatusPill value="missing" />}
                          <strong>{row.update?.current_product || "No product update"}</strong>
                          <span>{row.update?.issue_summary || "No issue recorded"}</span>
                        </td>
                        <td data-label="Update">
                          <strong>
                            {!row.update ? "Missing" : row.isLate ? "Late" : "Current"}
                          </strong>
                          <span>
                            {row.update ? `Recorded ${formatDateTime(row.update.recorded_at)}` : "No status received"}
                          </span>
                          <span>
                            Due {row.update ? formatDateTime(row.update.next_update_due_at) : "now"}
                          </span>
                        </td>
                        <td data-label="Output">
                          <strong>{outputCopy(row.shift)}</strong>
                          <span>{performanceCopy(row.shift)} performance</span>
                          <span>{row.shift?.downtime_minutes ?? 0} min downtime</span>
                        </td>
                        <td data-label="Actions">
                          <strong>{row.openActions.length}</strong>
                          <span>
                            {row.openActions.filter((item) => item.is_overdue).length} overdue
                          </span>
                          <span>
                            {row.openActions[0]?.summary || "No unresolved escalation"}
                          </span>
                        </td>
                        <td data-label="Materials">
                          <strong>{row.materialRisks.length}</strong>
                          <span>
                            {row.materialRisks[0]
                              ? `${row.materialRisks[0].product_code} · ${titleCase(row.materialRisks[0].status)}`
                              : "No short or held material"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No lines match this filter"
              body="Choose another priority filter or confirm assignments exist for this operational date."
            />
          )}
        </section>

        <div className="manager-detail-grid">
          <section className="manager-detail-card" aria-labelledby="actions-title">
            <div className="manager-section-heading manager-section-heading--compact">
              <div>
                <span className="eyebrow">Response ownership</span>
                <h2 id="actions-title">Open actions</h2>
              </div>
              <strong>{openActions.length}</strong>
            </div>
            {openActions.length ? (
              <ul className="manager-risk-list">
                {openActions.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <StatusPill value={item.priority} />
                    <div>
                      <strong>{item.production_line_code} · {item.summary}</strong>
                      <span>
                        Owner: {item.owner_username || "Unassigned"} · Due {formatDateTime(item.response_due_at)}
                      </span>
                    </div>
                    {item.is_overdue ? <span className="risk-label">Overdue</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No open actions" body="No unresolved escalation is visible for this date." />
            )}
          </section>

          <section className="manager-detail-card" aria-labelledby="materials-title">
            <div className="manager-section-heading manager-section-heading--compact">
              <div>
                <span className="eyebrow">Supply position</span>
                <h2 id="materials-title">Material risks</h2>
              </div>
              <strong>{materialRisks.length}</strong>
            </div>
            {materialRisks.length ? (
              <ul className="manager-risk-list">
                {materialRisks.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <StatusPill value={item.status} />
                    <div>
                      <strong>{item.production_line_code} · {item.product_code}</strong>
                      <span>
                        {item.product_name} · Owner {item.owner_username || "Unassigned"}
                      </span>
                    </div>
                    <span className="risk-label">
                      {item.shortage_quantity ? `${NUMBER.format(item.shortage_quantity)} short` : titleCase(item.status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No material risk" body="No short or held product is visible for this date." />
            )}
          </section>
        </div>

        <p className="manager-boundary">
          Live visibility and prioritisation aid only. Confirm urgent conditions through approved
          verbal, safety, quality, engineering, and production-control procedures. Missed event
          cursors trigger an authoritative API re-sync; they do not replace official records.
        </p>
      </main>
    </div>
  );
  <LossAnalyticsPanel assignments={data.assignments} />
}
