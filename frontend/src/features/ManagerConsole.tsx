import { useEffect, useMemo, useState } from "react";
import { DailyRiskBriefingPanel } from "./DailyRiskBriefingPanel";
import { LossAnalyticsPanel } from "./LossAnalyticsPanel";
import { EmptyState, ErrorBanner, StatusPill } from "../components";
import { formatDateTime, localDate, titleCase } from "../format";
import { escalationRole } from "../operationalRoles";
import { NotificationCentre } from "../NotificationCentre";
import { AppIcon, type AppIconName } from "../AppIcon";
import { apiRequest } from "../api";
import type { LiveConnectionState } from "../realtime";
import {
  WorkspaceSidebar,
} from "../WorkspaceNavigation";
import type {
  Assignment,
  DailyPlanBlock,
  DowntimeEvent,
  Escalation,
  LineUpdate,
  ManagerWorkspaceData,
  MaterialReadiness,
  MaterialStatus,
  ShiftRecord,
  UserSummary,
} from "../types";

type AttentionLevel = "urgent" | "warning" | "stable";
type BoardFilter = "all" | "attention" | "red" | "materials";
type ManagerWorkspaceView =
  | "overview"
  | "lines"
  | "plans"
  | "actions"
  | "briefing"
  | "recovery";
type ManagerShiftPattern = "day" | "night";
type ManagerViewMode = "live" | "historical";

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
  if (filter === "materials") return row.materialRisks.length > 0;
  return true;
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

function shiftMinute(value: string): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function planBlockPosition(block: DailyPlanBlock) {
  const shiftStart = 7 * 60;
  const shiftMinutes = 11 * 60;
  const start = Math.max(0, shiftMinute(block.planned_start_at) - shiftStart);
  const duration = Math.max(1, shiftMinute(block.planned_end_at) - shiftMinute(block.planned_start_at));
  return {
    left: `${(start / shiftMinutes) * 100}%`,
    width: `${(Math.min(duration, shiftMinutes - start) / shiftMinutes) * 100}%`,
  };
}

function controlBoardDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function profileInitials(value: string): string {
  const initials = value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "OM";
}

function updatedTime(value: string | null): string {
  if (!value) return "Not updated";
  return `Updated ${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))}`;
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
      eventIds: matching.map((event) => event.id),
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
  const [shiftPattern, setShiftPattern] = useState<ManagerShiftPattern>("day");
  const [viewMode, setViewMode] = useState<ManagerViewMode>(
    operationalDate === localDate() ? "live" : "historical",
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [lineFilter, setLineFilter] = useState("all");
  const [planLineFilter, setPlanLineFilter] = useState("all");
  const [planLeaderFilter, setPlanLeaderFilter] = useState("all");
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [selectedPlanBlock, setSelectedPlanBlock] = useState<DailyPlanBlock | null>(null);
  const [materialsTab, setMaterialsTab] = useState<"materials" | "actions">("materials");
  const [materialStatusFilter, setMaterialStatusFilter] = useState<MaterialStatus | "all">("all");
  const [materialLineFilter, setMaterialLineFilter] = useState("all");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [materialForm, setMaterialForm] = useState<"status" | "issue" | null>(null);
  const [materialQuantity, setMaterialQuantity] = useState("");
  const [materialNote, setMaterialNote] = useState("");
  const [materialNextStatus, setMaterialNextStatus] = useState<MaterialStatus>("ready");
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialMessage, setMaterialMessage] = useState("");
  const [selectedDowntimeEventId, setSelectedDowntimeEventId] = useState<number | null>(null);
  const [downtimeEditorOpen, setDowntimeEditorOpen] = useState(false);
  const [downtimeDescription, setDowntimeDescription] = useState("");
  const [downtimeEndedAt, setDowntimeEndedAt] = useState("");
  const [managerComment, setManagerComment] = useState("");
  const [downtimeSaving, setDowntimeSaving] = useState(false);
  const [downtimeMessage, setDowntimeMessage] = useState("");
  const rows = useMemo(() => buildManagerRows(data), [data]);
  const isHistorical = operationalDate !== localDate();
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesFilter(row, filter) && (lineFilter === "all" || String(row.assignment.production_line) === lineFilter)),
    [filter, lineFilter, rows],
  );
  const selectedLine = rows.find((row) => row.assignment.id === selectedLineId) ?? null;
  const selectedMaterial = data.materials.find((item) => item.id === selectedMaterialId) ?? null;
  const visibleMaterials = data.materials.filter((item) =>
    (materialStatusFilter === "all" || item.status === materialStatusFilter) &&
    (materialLineFilter === "all" || String(item.production_line) === materialLineFilter) &&
    `${item.product_code} ${item.product_name}`.toLowerCase().includes(materialSearch.trim().toLowerCase()),
  );
  const planRows = rows.filter((row) =>
    (planLineFilter === "all" || String(row.assignment.production_line) === planLineFilter) &&
    (planLeaderFilter === "all" || String(row.assignment.team_leader) === planLeaderFilter),
  );
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
  const selectedDowntimeEvent = data.downtimeEvents.find(
    (event) => event.id === selectedDowntimeEventId,
  ) ?? selectedDowntimeEvents[0] ?? null;
  const planCompletion = summary.overall_performance_percentage ?? 0;
  const downtimeRisk = Math.min(100, Math.round((summary.total_downtime_minutes / 66) * 100));
  const materialRisk = Math.min(100, materialRisks.length * 21);
  const highestRiskLine = rows.find((row) => row.update?.status === "red") ?? rows[0];
  const criticalRows = rows.filter((row) => row.update?.status === "red" || row.attentionLevel === "urgent");
  const stableLineLabels = rows
    .filter((row) => row.update?.status === "green")
    .map((row) => displayLine(row.assignment.production_line_code))
    .join(", ");
  const shiftLabel = shiftPattern === "day" ? "07:00–18:00" : "23:00–07:00";
  const liveView = viewMode === "live" && !isHistorical;

  useEffect(() => {
    if (isHistorical) setViewMode("historical");
  }, [isHistorical]);

  const selectView = (nextView: ManagerWorkspaceView) => {
    setView(nextView);
    setNavigationOpen(false);
  };

  const selectLiveView = () => {
    if (isHistorical) onDateChange(localDate());
    setViewMode("live");
  };

  const openDowntimeEvent = (eventId: number) => {
    const event = data.downtimeEvents.find((item) => item.id === eventId);
    if (!event) return;
    setSelectedDowntimeEventId(event.id);
    setDowntimeDescription(event.description);
    setDowntimeEndedAt(event.ended_at ? event.ended_at.slice(0, 16) : "");
    setManagerComment(event.resolution_note);
    setDowntimeEditorOpen(false);
    setDowntimeMessage("");
  };

  const saveDowntimeEvent = async () => {
    if (!selectedDowntimeEvent || !downtimeDescription.trim()) return;
    setDowntimeSaving(true);
    setDowntimeMessage("");
    try {
      await apiRequest(`/downtime-events/${selectedDowntimeEvent.id}/`, {
        method: "PATCH",
        body: JSON.stringify({
          description: downtimeDescription.trim(),
          ended_at: downtimeEndedAt ? new Date(downtimeEndedAt).toISOString() : null,
          status: downtimeEndedAt ? "resolved" : "open",
          resolution_note: managerComment.trim(),
        }),
      });
      setDowntimeMessage("Downtime update saved.");
      setDowntimeEditorOpen(false);
      onRefresh();
    } catch (caught) {
      setDowntimeMessage(caught instanceof Error ? caught.message : "Could not save this update.");
    } finally {
      setDowntimeSaving(false);
    }
  };

  const saveMaterialStatus = async () => {
    if (!selectedMaterial || !materialNote.trim()) return;
    setMaterialSaving(true);
    setMaterialMessage("");
    try {
      await apiRequest(`/product-material-readiness/${selectedMaterial.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: materialNextStatus, shortage_quantity: Number(materialQuantity || 0), notes: materialNote.trim() }),
      });
      setMaterialMessage("Material status updated.");
      setMaterialForm(null);
      onRefresh();
    } catch (caught) {
      setMaterialMessage(caught instanceof Error ? caught.message : "Could not update material status.");
    } finally {
      setMaterialSaving(false);
    }
  };

  const raiseMaterialIssue = async () => {
    if (!selectedMaterial || !materialNote.trim()) return;
    setMaterialSaving(true);
    setMaterialMessage("");
    try {
      await apiRequest("/operational-escalations/", {
        method: "POST",
        body: JSON.stringify({ assignment: selectedMaterial.assignment, category: "material", priority: "high", summary: `${selectedMaterial.product_name} supply issue`, details: materialNote.trim(), immediate_action: "Confirm replenishment", status: "open" }),
      });
      setMaterialMessage("Material issue raised.");
      setMaterialForm(null);
      onRefresh();
    } catch (caught) {
      setMaterialMessage(caught instanceof Error ? caught.message : "Could not raise material issue.");
    } finally {
      setMaterialSaving(false);
    }
  };

  return (
    <div className="manager-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: this snapshot remains visible, but refresh needs a connection.
        </div>
      ) : null}

      <header className="manager-topbar">
        <div className="manager-topbar__brand">
          <button
            type="button"
            className="manager-menu-button"
            aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((current) => !current)}
          >
            <AppIcon name="menu" size={24} />
          </button>
          <div>
            <strong className="manager-brand">Operations Control Board</strong>
            <span>People&nbsp; · &nbsp;Product&nbsp; · &nbsp;Progress</span>
          </div>
        </div>
        <div className="manager-header-meta" aria-label="Workspace controls">
          <div className="manager-header-controls">
            <label className="manager-header-date">
            <AppIcon name="calendar" size={22} />
            <span>{controlBoardDate(operationalDate)}</span>
            <input
              aria-label="Operational date"
              type="date"
              value={operationalDate}
              onChange={(event) => {
                onDateChange(event.target.value);
                setViewMode(event.target.value === localDate() ? "live" : "historical");
              }}
            />
            </label>
            <span className="manager-header-divider" aria-hidden="true" />
            <label className="manager-shift-control">
            <AppIcon name="clock" size={22} />
            <span className="sr-only">Shift pattern</span>
            <select
              aria-label="Shift pattern"
              value={shiftPattern}
              onChange={(event) => setShiftPattern(event.target.value as ManagerShiftPattern)}
            >
              <option value="day">Day · 07:00–18:00</option>
              <option value="night">Night · 23:00–07:00</option>
            </select>
            </label>
            <span className="manager-header-divider" aria-hidden="true" />
            <div className="manager-view-mode" role="group" aria-label="Data view">
            <button
              type="button"
              className={liveView ? "is-active" : ""}
              aria-pressed={liveView}
              onClick={selectLiveView}
            >
              <span className="manager-live-dot" aria-hidden="true" />Live
            </button>
            <button
              type="button"
              className={!liveView ? "is-active" : ""}
              aria-pressed={!liveView}
              onClick={() => setViewMode("historical")}
            >
              Historical
            </button>
            </div>
            <button
              type="button"
              className="manager-refresh"
              onClick={onRefresh}
              disabled={busy}
              aria-label="Refresh"
            >
              <AppIcon name="refresh" size={22} />
              <span>{busy ? "Refreshing…" : "Refresh"}</span>
              <small>{updatedTime(lastUpdatedAt)}</small>
            </button>
          </div>
          <NotificationCentre refreshToken={lastUpdatedAt} iconOnly />
          <details className="manager-profile">
            <summary aria-label={`Open profile menu for ${profile.display_name}`}>
              <span className="manager-profile__avatar">{profileInitials(profile.display_name)}</span>
              <span className="manager-profile__name">{profile.display_name}</span>
            </summary>
            <div className="manager-profile__menu">
              <strong>{profile.display_name}</strong>
              <span>{profile.username}</span>
              <span>Operations Manager</span>
              <button type="button" onClick={onSignOut}>Sign out</button>
            </div>
          </details>
        </div>
      </header>

      <div className="manager-layout">
        <WorkspaceSidebar
          ariaLabel="Operations Manager workspace"
          navigationLabel="Manager sections"
          className={`manager-sidebar${navigationOpen ? " manager-sidebar--open" : ""}`}
          items={MANAGER_NAV_ITEMS}
          activeItem={view}
          onSelect={selectView}
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
              <span>Version 1.4.0</span>
            </div>
          }
        />

        {navigationOpen ? (
          <button
            type="button"
            className="manager-navigation-backdrop"
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
          />
        ) : null}

        <main className="manager-workspace">
          {error ? <ErrorBanner message={error} /> : null}

          {view === "overview" ? (
            <>
              <section className="manager-hero" aria-labelledby="manager-title">
                <div>
                  <h1 id="manager-title">Before-shift and live overview</h1>
                  <p>{shiftPattern === "day" ? "Day" : "Night"} shift {shiftLabel}&nbsp;&nbsp; | &nbsp;&nbsp;{liveView && liveState === "live" ? "Live data" : "Historical data"}</p>
                  {isHistorical ? <span className="historical-badge">Historical view</span> : null}
                </div>
              </section>

              <section className="manager-kpis" aria-label="Operational summary">
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--blue"><AppIcon name="factory" size={31} /></span>
                  <div><strong>{rows.length}</strong><span>Lines</span><small>Active in production</small></div>
                </article>
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--blue"><AppIcon name="users" size={31} /></span>
                  <div><strong>{hierarchyGroups.length}</strong><span>Team Leaders</span><small>On shift</small></div>
                </article>
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--blue control-kpi__target"><AppIcon name="chart" size={31} /></span>
                  <div><strong>{Math.round(planCompletion)}%</strong><span>Plan complete</span><small>{NUMBER.format(summary.total_actual_output)} / {NUMBER.format(summary.total_planned_output)} planned cases</small></div>
                </article>
                <article className="control-kpi control-kpi--downtime">
                  <span className="control-kpi__icon control-kpi__icon--red"><AppIcon name="clock" size={31} /></span>
                  <div><strong>{NUMBER.format(summary.total_downtime_minutes)} min</strong><span>Downtime</span><small>Total across all lines</small></div>
                </article>
              </section>

              <section className="manager-attention-strip" aria-label="Attention summary">
                <AppIcon name="warning" size={26} />
                <button type="button" onClick={() => setView("lines")}><strong>{criticalRows.length} critical issue{criticalRows.length === 1 ? "" : "s"}</strong></button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setView("actions")}><strong>{materialRisks.length} material risk{materialRisks.length === 1 ? "" : "s"}</strong></button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setView("actions")}><strong>{openActions.length} open action{openActions.length === 1 ? "" : "s"}</strong></button>
                <button className="attention-strip__open" type="button" aria-label="Open critical line control" onClick={() => setView("lines")}>›</button>
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
                            <span>{(["Operations", "Engineering", "QA"] as const)[leaderIndex] ?? "Operations"} &nbsp;·&nbsp; {lines.map((line) => displayLine(line.production_line_code)).join(", ")}</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => setView("lines")}>View details <span aria-hidden="true">→</span></button>
                      </header>
                      {lines.map((line) => {
                        const row = rows.find((item) => item.assignment.id === line.id);
                        const percent = planPercent(row?.shift ?? null);
                        const status = row?.update?.status ?? "missing";
                        const statusLabel = status === "green" ? "Running" : status === "amber" ? "Behind" : status === "red" ? "Stopped" : "No update";
                        return <div className={`leader-line leader-line--${status}`} key={line.id}>
                          <div className="leader-line__top">
                            <div><strong>{displayLine(line.production_line_code)}</strong><span>{row?.update?.current_product || "Planned production"}</span></div>
                            <span className={`status-dot status-text status-dot--${status}`} aria-label={`Status: ${statusLabel}`}>{statusLabel}</span>
                            <button type="button" className="downtime-link" aria-label={`${lineDowntime(data.downtimeEvents, line.production_line)} min downtime`} onClick={() => {
                              setSelectedDowntimeLine(line.production_line);
                              const target = document.getElementById("hourly-downtime-title");
                              if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth" });
                            }}>
                              <strong>{lineDowntime(data.downtimeEvents, line.production_line)} min</strong><span>downtime</span>
                            </button>
                          </div>
                          <progress value={percent ?? 0} max="100" />
                          <div className="leader-line__output"><span>{percent ?? 0}% complete</span><span>{NUMBER.format(row?.shift?.actual_output ?? 0)} / {NUMBER.format(row?.shift?.planned_output ?? 0)} cases</span></div>
                        </div>;
                      })}
                    </article>
                  ))}
                </div>
              </section>

              <div className="overview-lower-grid">
              <section className="overview-priorities" aria-labelledby="overview-priorities-title">
                <header><span><AppIcon name="clipboard" size={24} /></span><div><h2 id="overview-priorities-title">Suggested priorities</h2><p>Based on current performance and risks</p></div></header>
                <ol>
                  <li><button type="button" onClick={() => setView("lines")}><b>1</b><span><strong>Resolve {highestRiskLine ? displayLine(highestRiskLine.assignment.production_line_code) : "highest-risk line"} stop – conveyor reset</strong><small>Target restart within 15 minutes</small></span></button></li>
                  <li><button type="button" onClick={() => setView("actions")}><b>2</b><span><strong>{materialRisks[0] ? `Check ${materialRisks[0].product_name} supply` : "Confirm material availability"}</strong><small>Confirm next delivery and responsible owner</small></span></button></li>
                  <li><button type="button" onClick={() => setView("lines")}><b>3</b><span><strong>Prepare recovery for monitored lines</strong><small>{stableLineLabels || "Review staffing and clear minor stops"}</small></span></button></li>
                </ol>
                <button type="button" className="button button--primary overview-priorities__cta" onClick={() => setView("briefing")}>View full briefing <span aria-hidden="true">→</span></button>
              </section>

              <section className="hourly-downtime" aria-labelledby="hourly-downtime-title">
                <div className="manager-section-heading">
                  <div>
                    <h2 id="hourly-downtime-title"><AppIcon name="chart" size={22} /> Hourly downtime – {rows.find((row) => row.assignment.production_line === effectiveDowntimeLine) ? displayLine(rows.find((row) => row.assignment.production_line === effectiveDowntimeLine)!.assignment.production_line_code) : "Line"}</h2>
                  </div>
                  <select aria-label="Downtime line" value={effectiveDowntimeLine ?? ""} onChange={(event) => { setSelectedDowntimeLine(Number(event.target.value)); setSelectedDowntimeEventId(null); }}>
                    {rows.map((row) => <option key={row.assignment.production_line} value={row.assignment.production_line}>{displayLine(row.assignment.production_line_code)} – {row.update?.current_product || row.assignment.production_line_name}</option>)}
                  </select>
                </div>
                <div className="downtime-chart-layout">
                  <div className="downtime-bars" aria-label="Hourly downtime chart">
                    {downtimeHours.map((hour) => (
                      <article className={hour.minutes ? "has-loss" : ""} key={hour.label}>
                        <button type="button" disabled={!hour.eventIds.length} onClick={() => hour.eventIds[0] && openDowntimeEvent(hour.eventIds[0])} aria-label={`${hour.label}, ${hour.minutes} minutes, ${hour.description}`}>
                          <span className="downtime-bar" style={{ height: `${Math.max(2, Math.min(100, hour.minutes * 5))}%` }} /><small>{hour.label.slice(0, 2)}</small>
                        </button>
                      </article>
                    ))}
                  </div>
                  <aside className="downtime-event-card">
                    {selectedDowntimeEvent ? <>
                      <span>Event at {shortTime(selectedDowntimeEvent.started_at)}</span><strong>{selectedDowntimeEvent.duration_minutes} min</strong><small>Reason</small><p>{selectedDowntimeEvent.description}</p>
                      <button type="button" className="event-edit-link" onClick={() => openDowntimeEvent(selectedDowntimeEvent.id)}><AppIcon name="edit" size={18} /> Edit / comment</button>
                    </> : <><span>No event selected</span><p>Select a downtime bar to review its description.</p></>}
                  </aside>
                </div>
              </section>
              </div>

              {selectedDowntimeEvent && (downtimeEditorOpen || selectedDowntimeEventId) ? <div className="downtime-modal-backdrop" role="presentation">
                <section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="downtime-editor-title">
                  <header><div><span className="eyebrow">Manager event review</span><h2 id="downtime-editor-title">Edit downtime & description</h2></div><button type="button" aria-label="Close downtime editor" onClick={() => { setSelectedDowntimeEventId(null); setDowntimeEditorOpen(false); }}>×</button></header>
                  <div className="downtime-editor__summary"><strong>{displayLine(data.assignments.find((assignment) => assignment.production_line === selectedDowntimeEvent.production_line)?.production_line_code ?? selectedDowntimeEvent.production_line_code)}</strong><span>Started {formatDateTime(selectedDowntimeEvent.started_at)} · Current {selectedDowntimeEvent.duration_minutes} min</span></div>
                  <label>Description<textarea rows={3} value={downtimeDescription} onChange={(event) => setDowntimeDescription(event.target.value)} required /></label>
                  <label>Downtime end<input type="datetime-local" value={downtimeEndedAt} min={selectedDowntimeEvent.started_at.slice(0, 16)} onChange={(event) => setDowntimeEndedAt(event.target.value)} /></label>
                  <label>Manager comment<textarea rows={3} value={managerComment} onChange={(event) => setManagerComment(event.target.value)} placeholder="Add context, evidence or correction reason" /></label>
                  <p className="downtime-editor__policy"><AppIcon name="info" size={18} /> Changes update calculated downtime. Planned breaks remain excluded from loss reporting.</p>
                  {downtimeMessage ? <p className="downtime-editor__message" role="status">{downtimeMessage}</p> : null}
                  <footer><button type="button" className="button button--ghost" onClick={() => { setSelectedDowntimeEventId(null); setDowntimeEditorOpen(false); }}>Cancel</button><button type="button" className="button button--primary" disabled={downtimeSaving || !downtimeDescription.trim()} onClick={saveDowntimeEvent}>{downtimeSaving ? "Saving…" : "Review & save"}</button></footer>
                </section>
              </div> : null}
            </>
          ) : null}

          {view === "lines" ? (
            <>
              <header className="team-control-heading">
                <h1>Team Leaders &amp; line control</h1>
              </header>
              <section className="manager-board" aria-labelledby="priority-board-title">
          <div className="team-control-selects">
            <label>Group by<select aria-label="Group by"><option>Team Leader</option></select></label>
            <label>Line<select aria-label="Line" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)}><option value="all">All lines ({rows.length} selected)</option>{rows.map((row) => <option key={row.assignment.production_line} value={row.assignment.production_line}>{displayLine(row.assignment.production_line_code)}</option>)}</select></label>
          </div>
          <div className="manager-section-heading team-control-filter-row">
            <h2 id="priority-board-title" className="sr-only">Team Leaders and line control table</h2>
            <div className="manager-filters" aria-label="Filter priority board">
              {(
                [
                  ["all", `All (${rows.length})`],
                  ["attention", `Needs attention (${rows.filter((row) => row.attentionLevel !== "stable").length})`],
                  ["red", `Stopped (${rows.filter((row) => row.update?.status === "red").length})`],
                  ["materials", `Materials (${rows.filter((row) => row.materialRisks.length).length})`],
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
                      <th>Line &amp; product</th>
                      <th>Team Leader</th>
                      <th>Status</th>
                      <th>Plan complete</th>
                      <th>Downtime</th>
                      <th>Issues</th>
                      <th><span className="sr-only">Open</span></th>
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
                        <td data-label="Line & product">
                          <strong>{displayLine(row.assignment.production_line_code)}</strong>
                          <span>{row.update?.current_product || row.assignment.production_line_name}</span>
                        </td>
                        <td data-label="Team Leader"><strong>{row.assignment.team_leader_username || `TL${row.assignment.team_leader}`}</strong></td>
                        <td data-label="Status">
                          <span className={`status-dot status-text status-dot--${row.update?.status || "missing"}`}>{row.update?.status === "green" ? "Running" : row.update?.status === "amber" ? "Behind" : row.update?.status === "red" ? "Stopped" : "No update"}</span>
                        </td>
                        <td data-label="Plan complete"><div className="team-plan-cell"><strong>{planPercent(row.shift) ?? 0}%</strong><progress value={planPercent(row.shift) ?? 0} max="100" /></div></td>
                        <td data-label="Downtime"><strong>{lineDowntime(data.downtimeEvents, row.assignment.production_line)} min</strong></td>
                        <td data-label="Issues"><strong className={row.openActions.length ? "issue-count" : ""}>{row.openActions.length}</strong></td>
                        <td className="team-row-chevron" aria-hidden="true">›</td>
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
                      <h2>{displayLine(selectedLine.assignment.production_line_code)}</h2>
                      <p>{selectedLine.update?.current_product || selectedLine.assignment.production_line_name}</p>
                    </div>
                    <button type="button" className="drawer-close" aria-label="Back to line list" onClick={() => setSelectedLineId(null)}><span className="drawer-back-label">Back</span><span aria-hidden="true">×</span></button>
                  </header>
                  <div className="drawer-status-card">
                    <span className={`status-dot status-text status-dot--${selectedLine.update?.status ?? "missing"}`}>{selectedLine.update?.status === "green" ? "Running" : selectedLine.update?.status === "amber" ? "Behind" : selectedLine.update?.status === "red" ? "Stopped" : "No update"}</span>
                    <strong>{lineDowntime(data.downtimeEvents, selectedLine.assignment.production_line)} min</strong>
                    <span>downtime</span>
                  </div>
                  <section>
                    <h3>Last recorded status</h3>
                    <dl className="drawer-facts">
                      <div><dt>Time</dt><dd>{shortTime(selectedLine.update?.recorded_at ?? null)}</dd></div>
                      <div><dt>Status</dt><dd>{selectedLine.update?.status ? titleCase(selectedLine.update.status) : "No update"}</dd></div>
                      <div><dt>Action</dt><dd>{selectedLine.update?.action_taken || "Continue scheduled monitoring"}</dd></div>
                    </dl>
                  </section>
                  <section>
                    <h3>Issue details</h3>
                    <dl className="drawer-facts"><div><dt>Severity</dt><dd>{selectedLine.openActions[0]?.priority ? titleCase(selectedLine.openActions[0].priority) : "No open issue"}</dd></div><div><dt>Issue</dt><dd>{selectedLine.update?.issue_summary || selectedLine.openActions[0]?.summary || "No issue recorded"}</dd></div><div><dt>Next action</dt><dd>{selectedLine.openActions[0]?.immediate_action || "Continue scheduled monitoring"}</dd></div></dl>
                  </section>
                  <section>
                    <h3>Status timeline</h3>
                    <ol className="drawer-event-history">
                      {data.downtimeEvents.filter((event) => event.production_line === selectedLine.assignment.production_line).slice(-4).map((event) => (
                        <li key={event.id}><button type="button" onClick={() => openDowntimeEvent(event.id)}><strong>{shortTime(event.started_at)}</strong><span>{event.description || event.reason_category}</span><small>{event.duration_minutes} min · {titleCase(event.status)} · Edit/comment</small></button></li>
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

              {selectedDowntimeEventId && selectedDowntimeEvent ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="line-downtime-editor-title"><header><div><span className="eyebrow">Manager event review</span><h2 id="line-downtime-editor-title">Edit downtime &amp; description</h2></div><button type="button" aria-label="Close downtime editor" onClick={() => setSelectedDowntimeEventId(null)}>×</button></header><div className="downtime-editor__summary"><strong>{displayLine(selectedLine?.assignment.production_line_code ?? selectedDowntimeEvent.production_line_code)}</strong><span>Started {formatDateTime(selectedDowntimeEvent.started_at)} · Current {selectedDowntimeEvent.duration_minutes} min</span></div><label>Description<textarea rows={3} value={downtimeDescription} onChange={(event) => setDowntimeDescription(event.target.value)} required /></label><label>Downtime end<input type="datetime-local" value={downtimeEndedAt} min={selectedDowntimeEvent.started_at.slice(0, 16)} onChange={(event) => setDowntimeEndedAt(event.target.value)} /></label><label>Manager comment<textarea rows={3} value={managerComment} onChange={(event) => setManagerComment(event.target.value)} /></label>{downtimeMessage ? <p className="downtime-editor__message" role="status">{downtimeMessage}</p> : null}<footer><button type="button" className="button button--ghost" onClick={() => setSelectedDowntimeEventId(null)}>Cancel</button><button type="button" className="button button--primary" disabled={downtimeSaving || !downtimeDescription.trim()} onClick={saveDowntimeEvent}>{downtimeSaving ? "Saving…" : "Review & save"}</button></footer></section></div> : null}
            </>
          ) : null}

          {view === "plans" ? (
            <>
              <ManagerViewIntro
                eyebrow="Today&apos;s schedule"
                title="Daily plans"
                body="Compare the approved schedule with recorded output. Production blocks are blue; planned breaks are grey."
              />
              <div className="daily-plan-controls">
                <select aria-label="Filter daily plans by line" value={planLineFilter} onChange={(event) => setPlanLineFilter(event.target.value)}><option value="all">All lines</option>{rows.map((row) => <option key={row.assignment.id} value={row.assignment.production_line}>{displayLine(row.assignment.production_line_code)}</option>)}</select>
                <select aria-label="Filter daily plans by Team Leader" value={planLeaderFilter} onChange={(event) => setPlanLeaderFilter(event.target.value)}><option value="all">All Team Leaders</option>{hierarchyGroups.map((group, index) => <option key={group.teamLeaderId} value={group.teamLeaderId}>Team Leader {index + 1}</option>)}</select>
                {profile.is_staff ? <button type="button" className="button button--primary" onClick={() => setPlanEditorOpen(true)}><AppIcon name="edit" size={18} /> Edit plan</button> : null}
              </div>
              <section className="daily-plan-timeline-board" aria-label="Daily schedule timeline">
                <header className="daily-plan-timeline-header">
                  <div><strong>Shift schedule</strong><span>07:00 – 18:00</span></div>
                  <div className="daily-plan-legend"><span className="legend-production">Production</span><span className="legend-break">Planned break</span></div>
                </header>
                <div className="daily-plan-axis" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index}>{String(7 + index).padStart(2, "0")}:00</span>)}</div>
                <div className="daily-plan-rows">
                  {planRows.map((row) => {
                    const blocks = (data.planBlocks ?? []).filter((block) => block.assignment === row.assignment.id).sort((left, right) => left.sequence_number - right.sequence_number);
                    return <article className="daily-plan-row" key={row.assignment.id}>
                      <div className="daily-plan-row-label"><strong>{displayLine(row.assignment.production_line_code)}</strong><span>{row.update?.current_product || "Planned production"}</span></div>
                      <div className="daily-plan-track">
                        {blocks.length ? blocks.map((block) => {
                          return <button type="button" className={`daily-plan-block daily-plan-block--${block.block_type}`} style={planBlockPosition(block)} key={block.id} onClick={() => setSelectedPlanBlock(block)}>
                            <strong>{block.block_type === "break" ? `Break ${block.break_number ?? ""}` : block.product_name}</strong><span>{shortTime(block.planned_start_at)} – {shortTime(block.planned_end_at)}</span>
                          </button>;
                        }) : <span className="daily-plan-empty">No plan blocks recorded</span>}
                      </div>
                    </article>;
                  })}
                </div>
              </section>
              <section className="daily-plan-output-table" aria-label="Daily plan output table">
                <h2>Output by line</h2>
                <div className="responsive-table"><table><thead><tr><th>Line</th><th>Planned</th><th>Actual</th><th>Full-day completion</th><th>Position now</th></tr></thead><tbody>{planRows.map((row) => { const delta = (row.shift?.actual_output ?? 0) - Math.round((row.shift?.planned_output ?? 0) * Math.min(1, Math.max(0, (new Date().getHours() * 60 + new Date().getMinutes() - 420) / 660))); return <tr key={row.assignment.id}><td>{displayLine(row.assignment.production_line_code)}</td><td>{NUMBER.format(row.shift?.planned_output ?? 0)}</td><td>{NUMBER.format(row.shift?.actual_output ?? 0)}</td><td>{planPercent(row.shift) ?? 0}%</td><td className={delta < 0 ? "metric-behind" : "metric-ahead"}>{delta < 0 ? `${NUMBER.format(Math.abs(delta))} behind` : `${NUMBER.format(delta)} ahead`}</td></tr>; })}</tbody></table></div>
              </section>
              {selectedPlanBlock ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="plan-block-title"><header><div><span className="eyebrow">Schedule detail</span><h2 id="plan-block-title">{selectedPlanBlock.block_type === "break" ? `Planned break ${selectedPlanBlock.break_number ?? ""}` : selectedPlanBlock.product_name}</h2></div><button type="button" aria-label="Close plan detail" onClick={() => setSelectedPlanBlock(null)}>×</button></header><dl className="plan-block-facts"><div><dt>Start</dt><dd>{shortTime(selectedPlanBlock.planned_start_at)}</dd></div><div><dt>End</dt><dd>{shortTime(selectedPlanBlock.planned_end_at)}</dd></div><div><dt>Target</dt><dd>{selectedPlanBlock.target_units_per_hour ?? "—"} / hour</dd></div><div><dt>Quantity</dt><dd>{NUMBER.format(selectedPlanBlock.planned_units)}</dd></div><div><dt>Materials</dt><dd>{data.materials.filter((item) => item.assignment === selectedPlanBlock.assignment && item.sequence_number === selectedPlanBlock.sequence_number).map((item) => item.product_name).join(", ") || "No material record"}</dd></div></dl><footer><button type="button" className="button button--primary" onClick={() => setSelectedPlanBlock(null)}>Done</button></footer></section></div> : null}
              {planEditorOpen ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="plan-review-title"><header><div><span className="eyebrow">Permission verified</span><h2 id="plan-review-title">Review plan changes</h2></div><button type="button" aria-label="Close plan editor" onClick={() => setPlanEditorOpen(false)}>×</button></header><p>Review line, timing, quantities and materials before saving. Existing published blocks remain unchanged until confirmation.</p><footer><button type="button" className="button button--ghost" onClick={() => setPlanEditorOpen(false)}>Cancel</button><button type="button" className="button button--primary" onClick={() => setPlanEditorOpen(false)}>Continue to edit</button></footer></section></div> : null}
            </>
          ) : null}

          {view === "actions" ? (
            <>
              <ManagerViewIntro
                eyebrow="Response workspace"
                title="Materials & actions"
                body="Track unresolved ownership and supply constraints without losing the current operational context."
              />
              <div className="materials-tabs" role="tablist" aria-label="Materials workspace"><button type="button" role="tab" aria-selected={materialsTab === "materials"} className={materialsTab === "materials" ? "is-active" : ""} onClick={() => setMaterialsTab("materials")}>Materials <b>{data.materials.length}</b></button><button type="button" role="tab" aria-selected={materialsTab === "actions"} className={materialsTab === "actions" ? "is-active" : ""} onClick={() => setMaterialsTab("actions")}>Open actions <b>{openActions.length}</b></button></div>
              {materialsTab === "materials" ? <>
                <div className="material-status-cards" aria-label="Filter materials by status">{(["ready", "in_process", "short", "held"] as MaterialStatus[]).map((status) => <button type="button" className={materialStatusFilter === status ? `is-selected status-${status}` : `status-${status}`} key={status} onClick={() => setMaterialStatusFilter(materialStatusFilter === status ? "all" : status)}><span>{titleCase(status)}</span><strong>{data.materials.filter((item) => item.status === status).length}</strong></button>)}</div>
                <div className="materials-filter-row"><select aria-label="Filter materials by line" value={materialLineFilter} onChange={(event) => setMaterialLineFilter(event.target.value)}><option value="all">All lines</option>{rows.map((row) => <option key={row.assignment.id} value={row.assignment.production_line}>{displayLine(row.assignment.production_line_code)}</option>)}</select><input aria-label="Search materials" placeholder="Search materials…" value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} /></div>
                <div className="manager-table-card responsive-table"><table><thead><tr><th>Line</th><th>Product</th><th>Needed by</th><th>Supply position</th><th>Status</th><th>Responsible function</th></tr></thead><tbody>{visibleMaterials.map((item) => <tr className={selectedMaterialId === item.id ? "is-selected" : ""} key={item.id} onClick={() => setSelectedMaterialId(item.id)}><td>{displayLine(item.production_line_code)}</td><td><strong>{item.product_name}</strong><small>{item.product_code}</small></td><td>{shortTime(item.expected_available_at)}</td><td>{item.status === "held" ? item.hold_reason || "Reason not recorded" : item.shortage_quantity ? `${NUMBER.format(item.shortage_quantity)} units short` : item.notes || "Available"}</td><td><StatusPill value={item.status} /></td><td>{item.owner_username || (item.status === "held" ? "QA" : "Operations")}</td></tr>)}</tbody></table></div>
                {selectedMaterial ? <section className="material-detail-card" aria-labelledby="selected-material-title"><header><div><h2 id="selected-material-title">{selectedMaterial.product_name} · {displayLine(selectedMaterial.production_line_code)}</h2><StatusPill value={selectedMaterial.status} /></div></header><dl><div><dt>Supply position</dt><dd>{selectedMaterial.shortage_quantity ? `${NUMBER.format(selectedMaterial.shortage_quantity)} units short` : titleCase(selectedMaterial.status)}</dd></div><div><dt>Needed by</dt><dd>{shortTime(selectedMaterial.expected_available_at)}</dd></div><div><dt>Responsible</dt><dd>{selectedMaterial.owner_username || "Operations"}</dd></div><div><dt>Held reason / next action</dt><dd>{selectedMaterial.hold_reason || selectedMaterial.notes || "Confirm replenishment"}</dd></div></dl><div className="material-detail-actions"><button type="button" className="button button--primary" onClick={() => { setMaterialForm("status"); setMaterialNextStatus(selectedMaterial.status); setMaterialQuantity(String(selectedMaterial.shortage_quantity || "")); setMaterialNote(selectedMaterial.notes); }}>Update status</button><button type="button" className="button button--ghost" onClick={() => { setMaterialForm("issue"); setMaterialNote(""); }}>Raise issue</button></div>{materialMessage ? <p role="status">{materialMessage}</p> : null}</section> : <p className="materials-action-note"><AppIcon name="info" size={18} /> Select a material to review its history and next action.</p>}
              </> : <section className="manager-detail-card"><h2>Open actions</h2>{openActions.length ? <ul className="manager-risk-list">{openActions.map((item) => <li key={item.id}><StatusPill value={item.priority} /><div><strong>{item.production_line_code} · {item.summary}</strong><span>Responsible: {escalationRole(item.category)} · Due {formatDateTime(item.response_due_at)}</span></div>{item.is_overdue ? <span className="risk-label">Overdue</span> : null}</li>)}</ul> : <EmptyState title="No open actions" body="No unresolved escalation is visible for this date." />}</section>}
              {selectedMaterial && materialForm ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="material-form-title"><header><div><span className="eyebrow">{displayLine(selectedMaterial.production_line_code)} · {selectedMaterial.product_name}</span><h2 id="material-form-title">{materialForm === "status" ? "Update material status" : "Raise material issue"}</h2></div><button type="button" aria-label="Close material form" onClick={() => setMaterialForm(null)}>×</button></header>{materialForm === "status" ? <><label>Status<select value={materialNextStatus} onChange={(event) => setMaterialNextStatus(event.target.value as MaterialStatus)}>{(["ready", "in_process", "short", "held"] as MaterialStatus[]).map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label><label>Shortage quantity / units<input type="number" min="0" value={materialQuantity} onChange={(event) => setMaterialQuantity(event.target.value)} /></label></> : <p>Line and material are prefilled from the selected record.</p>}<label>Short note<textarea required rows={3} value={materialNote} onChange={(event) => setMaterialNote(event.target.value)} /></label><footer><button type="button" className="button button--ghost" onClick={() => setMaterialForm(null)}>Cancel</button><button type="button" className="button button--primary" disabled={materialSaving || !materialNote.trim()} onClick={materialForm === "status" ? saveMaterialStatus : raiseMaterialIssue}>{materialSaving ? "Saving…" : materialForm === "status" ? "Save update" : "Raise issue"}</button></footer></section></div> : null}
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

    </div>
  );
}
