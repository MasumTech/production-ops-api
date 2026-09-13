import { useMemo, useState } from "react";
import { DailyRiskBriefingPanel } from "./DailyRiskBriefingPanel";
import { LossAnalyticsPanel } from "./LossAnalyticsPanel";
import { EmptyState, ErrorBanner, StatusPill } from "../components";
import { formatDateTime, localDate, titleCase } from "../format";
import { escalationRole } from "../operationalRoles";
import { NotificationCentre } from "../NotificationCentre";
import { AppIcon, type AppIconName } from "../AppIcon";
import type { LiveConnectionState } from "../realtime";
import {
  WorkspaceBottomNavigation,
  WorkspaceSidebar,
} from "../WorkspaceNavigation";
import type {
  Assignment,
  DowntimeEvent,
  Escalation,
  LineUpdate,
  ManagerWorkspaceData,
  MaterialReadiness,
  ShiftRecord,
  UserSummary,
} from "../types";

type AttentionLevel = "urgent" | "warning" | "stable";
type BoardFilter = "all" | "attention" | "red" | "late" | "materials";
type ManagerWorkspaceView =
  | "overview"
  | "lines"
  | "plans"
  | "actions"
  | "briefing"
  | "recovery";

const MANAGER_NAV_ITEMS: Array<{
  id: ManagerWorkspaceView;
  label: string;
  shortLabel: string;
  icon: AppIconName;
}> = [
  { id: "overview", label: "Overview", shortLabel: "Overview", icon: "home" },
  { id: "lines", label: "Team Leaders", shortLabel: "Teams", icon: "users" },
  { id: "plans", label: "Daily plans", shortLabel: "Plans", icon: "calendar" },
  { id: "actions", label: "Materials", shortLabel: "Materials", icon: "package" },
  { id: "recovery", label: "Break recovery", shortLabel: "Recovery", icon: "coffee" },
  { id: "briefing", label: "Risk briefing", shortLabel: "Risks", icon: "warning" },
];

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
    .filter((assignment) => assignment.shift_type === "day")
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

function planPercent(shift: ShiftRecord | null): number | null {
  if (!shift || !shift.planned_output) return null;
  return Math.round((shift.actual_output / shift.planned_output) * 100);
}

function displayLine(code: string): string {
  const number = Number(code.split("-").at(-1));
  return Number.isFinite(number) ? `Line ${number}` : code;
}

function buildHierarchyGroups(assignments: Assignment[]) {
  const groups = new Map<number, Assignment[]>();
  assignments.forEach((assignment) => {
    const current = groups.get(assignment.team_leader) ?? [];
    current.push(assignment);
    groups.set(assignment.team_leader, current);
  });
  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([teamLeaderId, lines]) => ({ teamLeaderId, lines }));
}

function lineDowntime(events: DowntimeEvent[], productionLine: number): number {
  return events
    .filter((event) => event.production_line === productionLine)
    .reduce((total, event) => total + event.duration_minutes, 0);
}

function shortTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function controlBoardDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function hourlyDowntime(events: DowntimeEvent[], operationalDate: string) {
  return Array.from({ length: 11 }, (_, offset) => {
    const hour = 7 + offset;
    const bucketStart = new Date(`${operationalDate}T${String(hour).padStart(2, "0")}:00:00`);
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
    const matching = events.filter((event) => {
      const start = new Date(event.started_at);
      const end = new Date(event.ended_at ?? Date.now());
      return start < bucketEnd && end > bucketStart;
    });
    const minutes = matching.reduce((total, event) => {
      const start = Math.max(new Date(event.started_at).getTime(), bucketStart.getTime());
      const end = Math.min(
        new Date(event.ended_at ?? Date.now()).getTime(),
        bucketEnd.getTime(),
      );
      return total + Math.max(0, Math.round((end - start) / 60_000));
    }, 0);
    return {
      label: `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`,
      minutes,
      description: matching.length
        ? [...new Set(matching.map((event) => event.description))].join(" · ")
        : "No recorded loss",
    };
  });
}

function ManagerViewIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <header className="manager-view-intro">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{body}</p>
    </header>
  );
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
  const [view, setView] = useState<ManagerWorkspaceView>("overview");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [selectedDowntimeLine, setSelectedDowntimeLine] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const rows = useMemo(() => buildManagerRows(data), [data]);
  const isHistorical = operationalDate !== localDate();
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesFilter(row, filter)),
    [filter, rows],
  );
  const selectedLine = rows.find((row) => row.assignment.id === selectedLineId) ?? null;
  const openActions = data.escalations
    .filter((item) => item.status !== "resolved")
    .sort((left, right) => Number(right.needs_attention) - Number(left.needs_attention));
  const materialRisks = data.materials.filter((item) =>
    ["short", "held"].includes(item.status),
  );
  const summary = data.summary ?? EMPTY_SUMMARY;
  const hierarchyGroups = useMemo(
    () => buildHierarchyGroups(rows.map((row) => row.assignment)),
    [rows],
  );
  const effectiveDowntimeLine = selectedDowntimeLine ?? rows[0]?.assignment.production_line ?? null;
  const selectedDowntimeEvents = data.downtimeEvents.filter(
    (event) => event.production_line === effectiveDowntimeLine,
  );
  const downtimeHours = hourlyDowntime(selectedDowntimeEvents, operationalDate);
  const planCompletion = summary.overall_performance_percentage ?? 0;
  const downtimeRisk = Math.min(100, Math.round((summary.total_downtime_minutes / 66) * 100));
  const materialRisk = Math.min(100, materialRisks.length * 21);
  const highestRiskLine = rows.find((row) => row.update?.status === "red") ?? rows[0];
  const criticalRows = rows.filter((row) => row.update?.status === "red" || row.attentionLevel === "urgent");
  const stableLineLabels = rows
    .filter((row) => row.update?.status === "green")
    .map((row) => displayLine(row.assignment.production_line_code))
    .join(", ");

  return (
    <div className="manager-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: this snapshot remains visible, but refresh needs a connection.
        </div>
      ) : null}

      <header className="manager-topbar">
        <strong className="manager-brand">OPERATIONS CONTROL BOARD</strong>
        <div className="manager-header-meta">
          <label className="manager-header-date">
            <AppIcon name="clock" size={25} />
            <span>{controlBoardDate(operationalDate)}</span>
            <input
              aria-label="Operational date"
              type="date"
              value={operationalDate}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <span className="manager-header-divider" aria-hidden="true" />
          <span>Shift&nbsp; 07:00 – 18:00</span>
          <span className="manager-header-divider" aria-hidden="true" />
          <NotificationCentre refreshToken={lastUpdatedAt} iconOnly />
        </div>
      </header>

      <div className="manager-layout">
        <WorkspaceSidebar
          ariaLabel="Operations Manager workspace"
          navigationLabel="Manager sections"
          className="manager-sidebar"
          items={MANAGER_NAV_ITEMS}
          activeItem={view}
          onSelect={setView}
          summary={
            <>
              <span className="manager-live-dot" aria-hidden="true" />
              <strong>{liveState === "live" ? "Live data" : "Snapshot data"}</strong>
              <span>{rows.length} lines scheduled</span>
            </>
          }
          boundary={
            <div className="manager-sidebar-footer">
              <p>Keep production<br />moving safely</p>
              <button type="button" onClick={onRefresh} disabled={busy}>
                {busy ? "Refreshing…" : "Refresh data"}
              </button>
              <button type="button" onClick={onSignOut}>Sign out {profile.display_name}</button>
            </div>
          }
        />

        <main className="manager-workspace">
          {error ? <ErrorBanner message={error} /> : null}

          {view === "overview" ? (
            <>
              <section className="manager-hero" aria-labelledby="manager-title">
                <div>
                  <h1 id="manager-title">Before-shift and live overview</h1>
                  <p>Shift 07:00 – 18:00&nbsp;&nbsp; | &nbsp;&nbsp;{liveState === "live" ? "Live data" : "Snapshot data"}</p>
                  {isHistorical ? <span className="historical-badge">Historical view</span> : null}
                </div>
              </section>

              <section className="manager-kpis" aria-label="Operational summary">
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--blue"><AppIcon name="factory" size={31} /></span>
                  <div><strong>{rows.length}</strong><span>lines</span><small>All lines scheduled</small></div>
                </article>
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--blue"><AppIcon name="users" size={31} /></span>
                  <div><strong>{hierarchyGroups.length}</strong><span>Team Leaders</span><small>2 lines each</small></div>
                </article>
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--green"><AppIcon name="chart" size={31} /></span>
                  <div><strong>{Math.round(planCompletion)}%</strong><span>plan complete</span><small>Across all lines</small></div>
                </article>
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--orange"><AppIcon name="clock" size={31} /></span>
                  <div><strong>{NUMBER.format(summary.total_downtime_minutes)} min</strong><span>downtime</span><small>Total today</small></div>
                </article>
              </section>

              <section className="manager-attention-strip" aria-label="Attention summary">
                <button type="button" className="attention-action attention-action--critical" onClick={() => setView("lines")}>
                  <strong>{criticalRows.length} critical issue{criticalRows.length === 1 ? "" : "s"}</strong>
                  <span>Open line control</span>
                </button>
                <button type="button" className="attention-action attention-action--material" onClick={() => setView("actions")}>
                  <strong>{materialRisks.length} material risk{materialRisks.length === 1 ? "" : "s"}</strong>
                  <span>Review materials</span>
                </button>
                <button type="button" className="attention-action" onClick={() => setView("actions")}>
                  <strong>{openActions.length} open action{openActions.length === 1 ? "" : "s"}</strong>
                  <span>Open action centre</span>
                </button>
              </section>

              <section className="manager-overview-board" aria-labelledby="coverage-board-title">
                <div className="manager-section-heading">
                  <div>
                    <h2 id="coverage-board-title">Team Leaders and production lines</h2>
                    <p>Live status, plan progress and next check for each line</p>
                  </div>
                </div>
                <div className="manager-leader-grid">
                  {hierarchyGroups.map(({ teamLeaderId, lines }, leaderIndex) => (
                    <article className="leader-card" key={teamLeaderId}>
                      <header className="leader-card__header">
                        <div>
                          <span className="leader-card__icon">
                            <AppIcon
                              name={(["users", "settings", "shield"] as AppIconName[])[leaderIndex] ?? "users"}
                              size={24}
                            />
                          </span>
                          <div>
                            <strong>Team Leader {leaderIndex + 1}</strong>
                            <span>{lines.map((line) => displayLine(line.production_line_code)).join(" and ")}</span>
                          </div>
                        </div>
                        <span className="hierarchy-badge">
                          {(["Operations", "Engineering", "QA"] as const)[leaderIndex] ?? "Operations"}
                        </span>
                      </header>
                      <div className="leader-card__columns">
                        <span>Line</span><span>Product</span><span>Status</span><span>Plan</span><span>Downtime</span><span>Next check</span>
                      </div>
                      {lines.map((line) => {
                        const row = rows.find((item) => item.assignment.id === line.id);
                        const percent = planPercent(row?.shift ?? null);
                        return <div className="leader-line" key={line.id}>
                          <strong>{displayLine(line.production_line_code)}</strong>
                          <span>{row?.update?.current_product || "Planned production"}</span>
                          <span className={`status-dot status-text status-dot--${row?.update?.status || "missing"}`} aria-label={`Status: ${row?.update?.status || "missing"}`}>{titleCase(row?.update?.status || "missing")}</span>
                          <span>{percent === null ? "—" : `${percent}%`}</span>
                          <button
                            type="button"
                            className="downtime-link"
                            onClick={() => setSelectedDowntimeLine(line.production_line)}
                          >
                            {lineDowntime(data.downtimeEvents, line.production_line)} min
                          </button>
                          <span>{shortTime(row?.update?.next_update_due_at ?? null)}</span>
                        </div>;
                      })}
                    </article>
                  ))}
                </div>
              </section>

              <section className="manager-overview-risk" aria-labelledby="overview-risk-title">
                <header className="risk-overview-heading">
                  <span className="risk-overview-icon"><AppIcon name="lightbulb" size={28} /></span>
                  <div><h2 id="overview-risk-title">AI daily risk briefing</h2><p>Key risks for today based on current data</p></div>
                </header>
                <div className="risk-overview-layout">
                  <div className="risk-metric-grid">
                    <article><span>Plan completion</span><strong>{Math.round(planCompletion)}%</strong><i className="risk-signal risk-signal--green" /><small>On track</small></article>
                    <article><span>Downtime risk</span><strong>{downtimeRisk}%</strong><i className="risk-signal risk-signal--red" /><small>{downtimeRisk >= 50 ? "Higher than normal" : "Controlled"}</small></article>
                    <article><span>Material delay risk</span><strong>{materialRisk}%</strong><i className="risk-signal risk-signal--amber" /><small>{materialRisk ? "Moderate risk" : "No current delay"}</small></article>
                  </div>
                  <div className="risk-priorities">
                    <h3>Suggested priorities (advisory only)</h3>
                    <ol>
                      <li><button type="button" onClick={() => setView("lines")}><span>1</span>Focus on {highestRiskLine ? displayLine(highestRiskLine.assignment.production_line_code) : "the highest-risk line"} – investigate downtime and restore output.</button></li>
                      <li><button type="button" onClick={() => setView("actions")}><span>2</span>{materialRisks[0] ? `Check material supply for ${materialRisks[0].product_name}.` : "Maintain confirmed material availability."}</button></li>
                      <li><button type="button" onClick={() => setView("lines")}><span>3</span>{stableLineLabels ? `Maintain current performance on ${stableLineLabels}.` : "Confirm the next hourly line updates."}</button></li>
                    </ol>
                    <p className="advisory-note"><AppIcon name="info" size={20} />AI suggestions are advisory only. Operational decisions remain with you.</p>
                  </div>
                </div>
              </section>

              <section className="hourly-downtime" aria-labelledby="hourly-downtime-title">
                <div className="manager-section-heading">
                  <div>
                    <h2 id="hourly-downtime-title">Hourly downtime by line</h2>
                    <p>Planned breaks are excluded. Select a line to review each hour and the recorded reason.</p>
                  </div>
                  <strong>{selectedDowntimeEvents.reduce((total, event) => total + event.duration_minutes, 0)} min</strong>
                </div>
                <div className="downtime-line-tabs" role="tablist" aria-label="Production lines">
                  {rows.map((row) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={effectiveDowntimeLine === row.assignment.production_line}
                      className={effectiveDowntimeLine === row.assignment.production_line ? "is-active" : ""}
                      key={row.assignment.production_line}
                      onClick={() => setSelectedDowntimeLine(row.assignment.production_line)}
                    >
                      {displayLine(row.assignment.production_line_code)}
                    </button>
                  ))}
                </div>
                <div className="hourly-downtime-grid">
                  {downtimeHours.map((hour) => (
                    <article className={hour.minutes ? "has-loss" : ""} key={hour.label}>
                      <span>{hour.label}</span><strong>{hour.minutes} min</strong><small>{hour.description}</small>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {view === "lines" ? (
            <>
              <ManagerViewIntro
                eyebrow="Live line control"
                title="Line Control"
                body="Review every active assignment in priority order and focus the board by operational condition."
              />
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
                        tabIndex={0}
                        aria-label={`Open details for ${row.assignment.production_line_code}`}
                        onClick={() => setSelectedLineId(row.assignment.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedLineId(row.assignment.id);
                          }
                        }}
                      >
                        <td data-label="Line">
                          <span className={`priority-flag priority-flag--${row.attentionLevel}`}>
                            {titleCase(row.attentionLevel)}
                          </span>
                          <strong>{row.assignment.production_line_code}</strong>
                          <span>
                            {row.assignment.production_line_name} · {titleCase(row.assignment.shift_type)}
                          </span>
                          <span>Owner: Team Leader</span>
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

              {selectedLine ? (
                <aside className="line-detail-drawer" aria-label={`${displayLine(selectedLine.assignment.production_line_code)} details`}>
                  <header>
                    <div>
                      <span className="eyebrow">Selected line</span>
                      <h2>{displayLine(selectedLine.assignment.production_line_code)}</h2>
                      <p>{selectedLine.assignment.production_line_name}</p>
                    </div>
                    <button type="button" className="drawer-close" aria-label="Close line details" onClick={() => setSelectedLineId(null)}>×</button>
                  </header>
                  <div className="drawer-status-card">
                    <StatusPill value={selectedLine.update?.status ?? "missing"} />
                    <strong>{selectedLine.update?.current_product || "No current product"}</strong>
                    <span>{selectedLine.shift?.downtime_minutes ?? 0} min recorded downtime</span>
                  </div>
                  <section>
                    <h3>Issue severity & next action</h3>
                    <dl className="drawer-facts">
                      <div><dt>Severity</dt><dd>{selectedLine.openActions[0]?.priority ? titleCase(selectedLine.openActions[0].priority) : "No open issue"}</dd></div>
                      <div><dt>Issue</dt><dd>{selectedLine.update?.issue_summary || selectedLine.openActions[0]?.summary || "No issue recorded"}</dd></div>
                      <div><dt>Next action</dt><dd>{selectedLine.openActions[0]?.immediate_action || "Continue scheduled monitoring"}</dd></div>
                    </dl>
                  </section>
                  <section>
                    <h3>Event history</h3>
                    <ol className="drawer-event-history">
                      {data.downtimeEvents.filter((event) => event.production_line === selectedLine.assignment.production_line).slice(-4).map((event) => (
                        <li key={event.id}><strong>{formatDateTime(event.started_at)}</strong><span>{event.description || event.reason_category}</span><small>{event.duration_minutes} min · {titleCase(event.status)}</small></li>
                      ))}
                      {selectedLine.update ? <li><strong>{formatDateTime(selectedLine.update.recorded_at)}</strong><span>Latest status: {titleCase(selectedLine.update.status)}</span><small>{selectedLine.update.action_taken || "Status recorded"}</small></li> : null}
                    </ol>
                  </section>
                  <div className="drawer-actions">
                    <button type="button" className="button button--primary" onClick={() => { setSelectedLineId(null); setView("plans"); }}>View daily plan</button>
                    <button type="button" className="button button--ghost" onClick={() => { setSelectedLineId(null); setView("actions"); }}>View issues</button>
                  </div>
                </aside>
              ) : null}
            </>
          ) : null}

          {view === "plans" ? (
            <>
              <ManagerViewIntro
                eyebrow="Today&apos;s schedule"
                title="Daily plans"
                body="Compare the approved schedule with recorded output. Production blocks are blue; planned breaks are grey."
              />
              <section className="daily-plan-summary" aria-label="Daily production plans">
                {rows.map((row) => (
                  <article key={row.assignment.id}>
                    <span>{displayLine(row.assignment.production_line_code)}</span>
                    <strong>{row.update?.current_product || "Planned production"}</strong>
                    <div><span>{NUMBER.format(row.shift?.actual_output ?? 0)} actual</span><span>{NUMBER.format(row.shift?.planned_output ?? 0)} planned</span></div>
                    <progress value={planPercent(row.shift) ?? 0} max="100" />
                    <small>{planPercent(row.shift) ?? 0}% complete</small>
                  </article>
                ))}
              </section>
              <section className="daily-plan-timeline-board" aria-label="Daily schedule timeline">
                <header className="daily-plan-timeline-header">
                  <div><strong>Shift schedule</strong><span>07:00 – 18:00</span></div>
                  <div className="daily-plan-legend"><span className="legend-production">Production</span><span className="legend-break">Planned break</span></div>
                </header>
                <div className="daily-plan-axis" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index}>{String(7 + index).padStart(2, "0")}:00</span>)}</div>
                <div className="daily-plan-rows">
                  {rows.map((row) => {
                    const blocks = (data.planBlocks ?? []).filter((block) => block.assignment === row.assignment.id).sort((left, right) => left.sequence_number - right.sequence_number);
                    return <article className="daily-plan-row" key={row.assignment.id}>
                      <div className="daily-plan-row-label"><strong>{displayLine(row.assignment.production_line_code)}</strong><span>{row.update?.current_product || "Planned production"}</span></div>
                      <div className="daily-plan-track">
                        {blocks.length ? blocks.map((block) => {
                          const hours = Math.max(1, Math.round((new Date(block.planned_end_at).getTime() - new Date(block.planned_start_at).getTime()) / 3600000));
                          const materials = data.materials.filter((item) => item.assignment === block.assignment && item.sequence_number === block.sequence_number);
                          return <details className={`daily-plan-block daily-plan-block--${block.block_type}`} style={{ gridColumn: `span ${hours}` }} key={block.id}>
                            <summary><strong>{block.block_type === "break" ? `Break ${block.break_number ?? ""}` : block.product_name}</strong><span>{shortTime(block.planned_start_at)} – {shortTime(block.planned_end_at)}</span></summary>
                            <div><span>Target: {block.target_units_per_hour ?? "—"} units/hour</span><span>Planned quantity: {NUMBER.format(block.planned_units)}</span><span>Materials: {materials.length ? materials.map((item) => item.product_name).join(", ") : "No material record"}</span></div>
                          </details>;
                        }) : <span className="daily-plan-empty">No plan blocks recorded</span>}
                      </div>
                    </article>;
                  })}
                </div>
              </section>
              <section className="daily-plan-output-table" aria-label="Daily plan output table">
                <h2>Output by line</h2>
                <div className="responsive-table"><table><thead><tr><th>Line</th><th>Planned</th><th>Actual</th><th>Completion</th></tr></thead><tbody>{rows.map((row) => <tr key={row.assignment.id}><td>{displayLine(row.assignment.production_line_code)}</td><td>{NUMBER.format(row.shift?.planned_output ?? 0)}</td><td>{NUMBER.format(row.shift?.actual_output ?? 0)}</td><td>{planPercent(row.shift) ?? 0}%</td></tr>)}</tbody></table></div>
              </section>
            </>
          ) : null}

          {view === "actions" ? (
            <>
              <ManagerViewIntro
                eyebrow="Response workspace"
                title="Actions and materials"
                body="Track unresolved ownership and supply constraints without losing the current operational context."
              />
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
                        Responsible: {escalationRole(item.category)} · Due {formatDateTime(item.response_due_at)}
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
                        {item.product_name} · Responsible: Materials
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
            </>
          ) : null}

          {view === "briefing" ? (
            <>
              <ManagerViewIntro
                eyebrow="Explainable evidence"
                title="AI Daily Risk Briefing"
                body="Review deterministic line risk, confidence, ranked source evidence, and missing-data warnings."
              />
              <DailyRiskBriefingPanel operationalDate={operationalDate} />
            </>
          ) : null}

          {view === "recovery" ? (
            <>
              <ManagerViewIntro
                eyebrow="Recorded recovery evidence"
                title="Break recovery and loss history"
                body="Review confirmed downtime, recovered production time and recurring mapped-asset evidence."
              />
              <LossAnalyticsPanel assignments={data.assignments} />
            </>
          ) : null}

        </main>
      </div>

      <WorkspaceBottomNavigation
        ariaLabel="Operations Manager mobile workspace"
        items={MANAGER_NAV_ITEMS}
        activeItem={view}
        onSelect={setView}
      />
    </div>
  );
}
