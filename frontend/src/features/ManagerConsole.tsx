import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DailyRiskBriefingPanel } from "./DailyRiskBriefingPanel";
import { completedFractionForBlock } from "./dailyPlanMath";
import {
  aggregateManagerPosition,
  buildManagerProgress,
  managerSnapshotMinutes,
} from "./managerProgress";
import { LossAnalyticsPanel } from "./LossAnalyticsPanel";
import { PilotAdminPanel } from "./PilotAdminPanel";
import { EmptyState, ErrorBanner, StatusPill } from "../components";
import { formatDateTime, localDate, titleCase } from "../format";
import { escalationRole } from "../operationalRoles";
import { NotificationCentre } from "../NotificationCentre";
import { AppIcon, type AppIconName } from "../AppIcon";
import { apiRequest } from "../api";
import {
  formatClockMinutes,
  formatScheduleClock,
  getShiftWindow,
  timeBuckets,
  timelineStyle,
  timelineTicks,
} from "../shiftTiming";
import type { LiveConnectionState } from "../realtime";
import {
  WorkspaceSidebar,
} from "../WorkspaceNavigation";
import type {
  Assignment,
  BreakOpportunity,
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
  | "recovery"
  | "pilot";
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
  { id: "pilot", label: "Pilot admin", shortLabel: "Pilot", icon: "shield" },
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

export interface ManagerPriority {
  key: string;
  title: string;
  detail: string;
  view: "lines" | "actions";
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

function timePositionLabel(minutes: number | null): string {
  if (minutes === null) return "Time unavailable";
  if (minutes === 0) return "On target";
  return `${NUMBER.format(Math.abs(minutes))} min ${minutes > 0 ? "ahead" : "behind"}`;
}

function unitPositionLabel(delta: number | null): string {
  if (delta === null) return "Target unavailable";
  if (delta === 0) return "No unit gap";
  return `${NUMBER.format(Math.abs(delta))} units ${delta > 0 ? "ahead" : "short"}`;
}

function assignmentKey(assignment: Assignment): string {
  return `${assignment.production_line}:${assignment.shift_type}`;
}

function shiftKey(shift: ShiftRecord): string {
  return `${shift.production_line}:${shift.shift_type}`;
}

export function buildManagerRows(
  data: ManagerWorkspaceData,
  shiftPattern: ManagerShiftPattern = "day",
  now = Date.now(),
): ManagerLineRow[] {
  const updateByAssignment = new Map(data.updates.map((item) => [item.assignment, item]));
  const shiftByLine = new Map(data.shifts.map((item) => [shiftKey(item), item]));

  return data.assignments
    .filter((assignment) => assignment.shift_type === shiftPattern)
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

export function buildManagerPriorities(rows: ManagerLineRow[]): ManagerPriority[] {
  const priorities: ManagerPriority[] = [];
  const actionRank: Record<Escalation["priority"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  const actions = rows
    .flatMap((row) => row.openActions.map((action) => ({ action, row })))
    .sort(
      (left, right) =>
        actionRank[left.action.priority] - actionRank[right.action.priority] ||
        Number(right.action.is_overdue) - Number(left.action.is_overdue),
    );

  actions.forEach(({ action, row }) => {
    const line = displayLine(row.assignment.production_line_code);
    const owner = action.owner_username
      ? `Owner: ${action.owner_username}`
      : `Owner group: ${escalationRole(action.category)}`;
    priorities.push({
      key: `action-${action.id}`,
      title: `${line}: ${action.summary}`,
      detail: action.immediate_action || `${owner} · Due ${formatDateTime(action.response_due_at)}`,
      view: "actions",
    });
  });

  rows.forEach((row) => {
    if (row.update?.status === "red" && !row.openActions.some(
      (action) => action.summary.trim().toLowerCase() === row.update?.issue_summary.trim().toLowerCase(),
    )) {
      priorities.push({
        key: `line-${row.assignment.id}`,
        title: `${displayLine(row.assignment.production_line_code)}: ${row.update.issue_summary || "Stopped"}`,
        detail: row.update.action_taken || row.update.support_required || "Review the latest line update.",
        view: "lines",
      });
    }
  });

  rows.flatMap((row) => row.materialRisks.map((material) => ({ material, row }))).forEach(
    ({ material, row }) => {
      const availability = material.expected_available_at
        ? `ETA ${formatDateTime(material.expected_available_at)}`
        : "ETA not recorded";
      priorities.push({
        key: `material-${material.id}`,
        title: `${displayLine(row.assignment.production_line_code)}: ${material.product_name} ${material.status}`,
        detail: `${material.owner_username ? `Owner: ${material.owner_username}` : "Owner not assigned"} · ${availability}`,
        view: "actions",
      });
    },
  );

  rows.filter((row) => !row.update).forEach((row) => {
    priorities.push({
      key: `missing-${row.assignment.id}`,
      title: `${displayLine(row.assignment.production_line_code)}: status update missing`,
      detail: `No update recorded for the ${titleCase(row.assignment.shift_type)} shift.`,
      view: "lines",
    });
  });

  rows.filter((row) => row.update && row.update.status !== "red" && row.isLate).forEach((row) => {
    priorities.push({
      key: `late-${row.assignment.id}`,
      title: `${displayLine(row.assignment.production_line_code)}: update overdue`,
      detail: `Next update was due ${formatDateTime(row.update!.next_update_due_at)}.`,
      view: "lines",
    });
  });

  return priorities.slice(0, 3);
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

function shortTime(value: string | null | undefined): string {
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

function localDateTimeAfter(value: string, minutes: number): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function dateDaysBefore(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
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

function hourlyDowntime(
  events: DowntimeEvent[],
  operationalDate: string,
  startMinutes: number,
  endMinutes: number,
) {
  const window = {
    startMinutes,
    endMinutes,
    startLabel: formatClockMinutes(startMinutes),
    endLabel: formatClockMinutes(endMinutes),
  };
  return timeBuckets(window).map((bucket) => {
    const bucketStart = new Date(
      `${operationalDate}T${formatClockMinutes(bucket.startMinutes)}:00`,
    );
    const bucketEnd = new Date(
      bucketStart.getTime() +
        (bucket.endMinutes - bucket.startMinutes) * 60 * 1000,
    );
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
      label: bucket.label,
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
  shiftPattern,
  lastUpdatedAt,
  online,
  liveState,
  busy,
  error,
  onDateChange,
  onShiftPatternChange,
  onRefresh,
  onEditProfile,
  onSignOut,
}: {
  profile: UserSummary;
  data: ManagerWorkspaceData;
  operationalDate: string;
  shiftPattern: ManagerShiftPattern;
  lastUpdatedAt: string | null;
  online: boolean;
  liveState: LiveConnectionState;
  busy: boolean;
  error: string;
  onDateChange: (value: string) => void;
  onShiftPatternChange: (value: ManagerShiftPattern) => void;
  onRefresh: () => void;
  onEditProfile?: () => void;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<ManagerWorkspaceView>("overview");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [selectedDowntimeLine, setSelectedDowntimeLine] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ManagerViewMode>(
    operationalDate === localDate() ? "live" : "historical",
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [lineFilter, setLineFilter] = useState("all");
  const [planLineFilter, setPlanLineFilter] = useState("all");
  const [planLeaderFilter, setPlanLeaderFilter] = useState("all");
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [editingPlanBlock, setEditingPlanBlock] = useState<DailyPlanBlock | null>(null);
  const [planAssignment, setPlanAssignment] = useState("");
  const [planTeamLeader, setPlanTeamLeader] = useState("");
  const [planSequence, setPlanSequence] = useState("");
  const [planBlockType, setPlanBlockType] = useState<"production" | "break">("production");
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [planProductCode, setPlanProductCode] = useState("");
  const [planProductName, setPlanProductName] = useState("");
  const [planHourlyTarget, setPlanHourlyTarget] = useState("");
  const [planBreakNumber, setPlanBreakNumber] = useState("1");
  const [planSaving, setPlanSaving] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const [shiftEditorOpen, setShiftEditorOpen] = useState(false);
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");
  const [shiftTimeSaving, setShiftTimeSaving] = useState(false);
  const [shiftTimeMessage, setShiftTimeMessage] = useState("");
  const [selectedPlanBlock, setSelectedPlanBlock] = useState<DailyPlanBlock | null>(null);
  const [expandedPlanLine, setExpandedPlanLine] = useState<number | null>(null);
  const [materialsTab, setMaterialsTab] = useState<"materials" | "actions">("materials");
  const [materialStatusFilter, setMaterialStatusFilter] = useState<MaterialStatus | "all">("all");
  const [materialLineFilter, setMaterialLineFilter] = useState("all");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [materialForm, setMaterialForm] = useState<"status" | "issue" | null>(null);
  const [materialQuantity, setMaterialQuantity] = useState("");
  const [materialNote, setMaterialNote] = useState("");
  const [materialNextStatus, setMaterialNextStatus] = useState<MaterialStatus>("ready");
  const [materialResponseDueAt, setMaterialResponseDueAt] = useState("");
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialMessage, setMaterialMessage] = useState("");
  const [selectedAction, setSelectedAction] = useState<Escalation | null>(null);
  const [actionResolutionNotes, setActionResolutionNotes] = useState("");
  const [actionSavingId, setActionSavingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [recoveryTab, setRecoveryTab] = useState<"shift" | "history">("shift");
  const [recoveryLineFilter, setRecoveryLineFilter] = useState("all");
  const [recoveryRange, setRecoveryRange] = useState("shift");
  const [selectedRecovery, setSelectedRecovery] = useState<BreakOpportunity | null>(null);
  const [recoveryEvidence, setRecoveryEvidence] = useState("");
  const [recoveryTime, setRecoveryTime] = useState("");
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [selectedDowntimeEventId, setSelectedDowntimeEventId] = useState<number | null>(null);
  const [downtimeEditorOpen, setDowntimeEditorOpen] = useState(false);
  const [downtimeDescription, setDowntimeDescription] = useState("");
  const [downtimeEndedAt, setDowntimeEndedAt] = useState("");
  const [managerComment, setManagerComment] = useState("");
  const [downtimeSaving, setDowntimeSaving] = useState(false);
  const [downtimeMessage, setDowntimeMessage] = useState("");
  const rows = useMemo(() => buildManagerRows(data, shiftPattern), [data, shiftPattern]);
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
  const openActions = rows
    .flatMap((row) => row.openActions)
    .sort((left, right) => Number(right.needs_attention) - Number(left.needs_attention));
  const materialRisks = rows.flatMap((row) => row.materialRisks);
  const summary = data.summary ?? EMPTY_SUMMARY;
  const hierarchyGroups = useMemo(
    () => buildHierarchyGroups(rows.map((row) => row.assignment)),
    [rows],
  );
  const effectiveDowntimeLine = selectedDowntimeLine ?? rows[0]?.assignment.production_line ?? null;
  const selectedDowntimeEvents = data.downtimeEvents.filter(
    (event) => event.production_line === effectiveDowntimeLine,
  );
  const scheduleWindow = getShiftWindow(operationalDate, data.shifts, shiftPattern);
  const downtimeHours = hourlyDowntime(
    selectedDowntimeEvents,
    operationalDate,
    scheduleWindow.startMinutes,
    scheduleWindow.endMinutes,
  );
  const selectedDowntimeEvent = data.downtimeEvents.find(
    (event) => event.id === selectedDowntimeEventId,
  ) ?? selectedDowntimeEvents[0] ?? null;
  const planCompletion = summary.overall_performance_percentage ?? 0;
  const downtimeRisk = Math.min(100, Math.round((summary.total_downtime_minutes / 66) * 100));
  const materialRisk = Math.min(100, materialRisks.length * 21);
  const criticalIssueCount = openActions.filter((item) => item.priority === "critical").length;
  const missingUpdateCount = rows.filter((row) => !row.update).length;
  const managerPriorities = buildManagerPriorities(rows);
  const selectedShiftRecords = data.shifts.filter(
    (shift) => shift.shift_type === shiftPattern,
  );
  const weekend = [0, 6].includes(new Date(`${operationalDate}T12:00:00`).getDay());
  const defaultShiftStart = shiftPattern === "day" ? (weekend ? "07:00" : "06:45") : "23:00";
  const defaultShiftEnd = shiftPattern === "day" ? "18:00" : "07:00";
  const configuredShiftStart = selectedShiftRecords[0]?.start_time?.slice(0, 5) || defaultShiftStart;
  const configuredShiftEnd = selectedShiftRecords[0]?.end_time?.slice(0, 5) || defaultShiftEnd;
  const shiftLabel = `${configuredShiftStart}–${configuredShiftEnd}`;
  const planAxisTicks = timelineTicks(scheduleWindow);
  const liveView = viewMode === "live" && !isHistorical;
  const snapshotMinutes = managerSnapshotMinutes(
    data.updates,
    rows,
    scheduleWindow,
    liveView,
  );
  const progressLines = buildManagerProgress(
    rows,
    data.planBlocks ?? [],
    data.hourlyOutputs ?? [],
    scheduleWindow,
    snapshotMinutes,
  );
  const selectedLineProgress = selectedLine
    ? progressLines.find((item) => item.row.assignment.id === selectedLine.assignment.id)
    : undefined;
  const selectedPlanAssignment = data.assignments.find(
    (assignment) => String(assignment.id) === planAssignment,
  );
  const planLineOptions = data.productionLines.map((line) => ({
    line,
    assignment: data.assignments.find(
      (candidate) => candidate.production_line === line.id,
    ) ?? null,
  }));
  const selectedPlanLine = selectedPlanAssignment
    ? data.productionLines.find(
        (line) => line.id === selectedPlanAssignment.production_line,
      ) ?? null
    : data.productionLines.find(
        (line) => planAssignment === `line-${line.id}`,
      ) ?? null;
  const planLeaderOptions = data.users.filter(
    (user) => user.workspace === "team_leader" || user.workspace === undefined,
  );
  const aggregatePosition = aggregateManagerPosition(progressLines);
  const snapshotFraction = Math.max(0, Math.min(100,
    ((snapshotMinutes - scheduleWindow.startMinutes) /
      Math.max(1, scheduleWindow.endMinutes - scheduleWindow.startMinutes)) * 100,
  ));
  const snapshotInsideShift = snapshotMinutes >= scheduleWindow.startMinutes &&
    snapshotMinutes <= scheduleWindow.endMinutes;
  const recoveryDateFrom = recoveryRange === "shift"
    ? operationalDate
    : dateDaysBefore(operationalDate, Number(recoveryRange) - 1);
  const recoveryOpportunitySource = recoveryRange === "shift"
    ? (data.breakOpportunities ?? [])
    : (data.recoveryBreakOpportunities ?? data.breakOpportunities ?? []);
  const recoveryDowntimeSource = recoveryRange === "shift"
    ? data.downtimeEvents
    : (data.recoveryDowntimeEvents ?? data.downtimeEvents);
  const recoveryOpportunities = recoveryOpportunitySource.filter((item) =>
    (!item.assignment_date || item.assignment_date >= recoveryDateFrom) &&
    (!item.assignment_date || item.assignment_date <= operationalDate) &&
    (recoveryLineFilter === "all" || String(item.production_line) === recoveryLineFilter),
  );
  const recoveryDowntimeEvents = recoveryDowntimeSource.filter((event) =>
    event.shift_date >= recoveryDateFrom &&
    event.shift_date <= operationalDate &&
    (recoveryLineFilter === "all" || String(event.production_line) === recoveryLineFilter),
  );
  const eligibleRecovery = recoveryOpportunities.find(
    (item) => item.status === "checks_complete",
  ) ?? null;
  const recordedDowntime = recoveryDowntimeEvents.reduce((total, event) => total + event.duration_minutes, 0);
  const recoveredMinutes = recoveryOpportunities.filter((item) => item.status === "recovered" && item.checks_completed_at).reduce((total, item) => total + Math.max(0, Math.round((new Date(item.checks_completed_at!).getTime() - new Date(item.suggested_start_at).getTime()) / 60000)), 0);
  const remainingLoss = Math.max(0, recordedDowntime - recoveredMinutes);

  useEffect(() => {
    setSelectedLineId(null);
    setSelectedDowntimeLine(null);
    setSelectedDowntimeEventId(null);
    setSelectedMaterialId(null);
    setSelectedPlanBlock(null);
    setExpandedPlanLine(null);
    setSelectedRecovery(null);
  }, [operationalDate, shiftPattern]);

  useEffect(() => {
    if (!shiftEditorOpen) {
      setShiftStart(configuredShiftStart);
      setShiftEnd(configuredShiftEnd);
    }
  }, [configuredShiftEnd, configuredShiftStart, shiftEditorOpen]);

  useEffect(() => {
    if (isHistorical) setViewMode("historical");
  }, [isHistorical]);

  const selectView = (nextView: ManagerWorkspaceView) => {
    setView(nextView);
    setNavigationOpen(false);
    workspaceRef.current?.focus();
  };

  useEffect(() => {
    if (!navigationOpen) return;
    const closeNavigation = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavigationOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", closeNavigation);
    document.querySelector<HTMLButtonElement>(
      "#manager-navigation button",
    )?.focus();
    return () => document.removeEventListener("keydown", closeNavigation);
  }, [navigationOpen]);

  const selectLiveView = () => {
    if (isHistorical) onDateChange(localDate());
    setViewMode("live");
  };

  const openPlanEditor = (block: DailyPlanBlock | null = null) => {
    const assignment = block
      ? rows.find((row) => row.assignment.id === block.assignment)?.assignment
      : planRows[0]?.assignment;
    const nextSequence = assignment
      ? Math.max(
          0,
          ...(data.planBlocks ?? [])
            .filter((item) => item.assignment === assignment.id)
            .map((item) => item.sequence_number),
        ) + 1
      : 1;
    setEditingPlanBlock(block);
    setPlanAssignment(String(block?.assignment ?? assignment?.id ?? ""));
    setPlanTeamLeader(String(block?.assignment ? assignment?.team_leader ?? "" : assignment?.team_leader ?? planLeaderOptions[0]?.id ?? ""));
    setPlanSequence(String(block?.sequence_number ?? nextSequence));
    setPlanBlockType(block?.block_type ?? "production");
    const defaultStart = `${operationalDate}T${configuredShiftStart}`;
    setPlanStart(block?.planned_start_at.slice(0, 16) ?? defaultStart);
    setPlanEnd(block?.planned_end_at.slice(0, 16) ?? localDateTimeAfter(defaultStart, 60));
    setPlanProductCode(block?.product_code ?? "");
    setPlanProductName(block?.product_name ?? "");
    setPlanHourlyTarget(String(block?.target_units_per_hour ?? ""));
    setPlanBreakNumber(String(block?.break_number ?? 1));
    setPlanMessage("");
    setPlanEditorOpen(true);
    setSelectedPlanBlock(null);
  };

  const changePlanAssignment = (value: string) => {
    setPlanAssignment(value);
    const assignmentId = value.startsWith("line-") ? null : Number(value);
    const nextSequence = Math.max(
      0,
      ...(data.planBlocks ?? [])
        .filter((item) => assignmentId !== null && item.assignment === assignmentId)
        .map((item) => item.sequence_number),
    ) + 1;
    setPlanSequence(String(nextSequence));
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

  const saveShiftTimes = async () => {
    if (!shiftStart || !shiftEnd || shiftStart === shiftEnd) {
      setShiftTimeMessage("Choose different start and end times.");
      return;
    }
    if (!selectedShiftRecords.length) {
      setShiftTimeMessage("No shift records exist for this date and shift.");
      return;
    }
    setShiftTimeSaving(true);
    setShiftTimeMessage("");
    try {
      await Promise.all(
        selectedShiftRecords.map((shift) =>
          apiRequest<ShiftRecord>(`/shifts/${shift.id}/`, {
            method: "PATCH",
            body: JSON.stringify({
              start_time: shiftStart,
              end_time: shiftEnd,
            }),
          }),
        ),
      );
      setShiftTimeMessage("Shift time updated for all lines.");
      onRefresh();
      setShiftEditorOpen(false);
    } catch (caught) {
      setShiftTimeMessage(
        caught instanceof Error ? caught.message : "Could not update shift time.",
      );
    } finally {
      setShiftTimeSaving(false);
    }
  };

  const savePlanBlock = async () => {
    if (!planAssignment || !planSequence || !planStart || !planEnd) {
      setPlanMessage("Choose a line, sequence, start time and end time.");
      return;
    }
    if (new Date(planEnd).getTime() <= new Date(planStart).getTime()) {
      setPlanMessage("Plan end must be later than plan start.");
      return;
    }
    if (
      planBlockType === "production" &&
      (!planProductCode.trim() || !planProductName.trim() || !Number(planHourlyTarget))
    ) {
      setPlanMessage("Production blocks require a product code, name and hourly target.");
      return;
    }
    setPlanSaving(true);
    setPlanMessage("");
    try {
      let assignmentId = selectedPlanAssignment?.id;
      if (!assignmentId) {
        if (!selectedPlanLine || !planTeamLeader) {
          setPlanMessage("Choose a production line and Team Leader.");
          return;
        }
        const assignment = await apiRequest<Assignment>("/team-leader-assignments/", {
          method: "POST",
          body: JSON.stringify({
            team_leader: Number(planTeamLeader),
            production_line: selectedPlanLine.id,
            date: operationalDate,
            shift_type: shiftPattern,
            notes: "Created by Operations Manager during daily planning.",
          }),
        });
        assignmentId = assignment.id;
      }
      const payload = {
        assignment: assignmentId,
        sequence_number: Number(planSequence),
        block_type: planBlockType,
        planned_start_at: new Date(planStart).toISOString(),
        planned_end_at: new Date(planEnd).toISOString(),
        product_code: planBlockType === "production" ? planProductCode.trim() : "",
        product_name: planBlockType === "production" ? planProductName.trim() : "",
        target_units_per_hour: planBlockType === "production" ? Number(planHourlyTarget) : null,
        break_number: planBlockType === "break" ? Number(planBreakNumber) : null,
      };
      await apiRequest(
        editingPlanBlock
          ? `/daily-plan-blocks/${editingPlanBlock.id}/`
          : "/daily-plan-blocks/",
        {
          method: editingPlanBlock ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setPlanMessage(editingPlanBlock ? "Plan block updated." : "Plan block added.");
      setPlanEditorOpen(false);
      onRefresh();
    } catch (caught) {
      setPlanMessage(caught instanceof Error ? caught.message : "Could not save this plan block.");
    } finally {
      setPlanSaving(false);
    }
  };

  const deletePlanBlock = async (block: DailyPlanBlock) => {
    if (!window.confirm("Delete this plan block? This cannot be undone.")) return;
    setPlanSaving(true);
    setPlanMessage("");
    try {
      await apiRequest(`/daily-plan-blocks/${block.id}/`, { method: "DELETE" });
      setPlanMessage("Plan block deleted.");
      setSelectedPlanBlock(null);
      onRefresh();
    } catch (caught) {
      setPlanMessage(caught instanceof Error ? caught.message : "Could not delete this plan block.");
    } finally {
      setPlanSaving(false);
    }
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
      const releasingHeldMaterial = selectedMaterial.status === "held" && materialNextStatus === "ready";
      await apiRequest(
        releasingHeldMaterial
          ? `/product-material-readiness/${selectedMaterial.id}/release/`
          : `/product-material-readiness/${selectedMaterial.id}/`,
        {
          method: releasingHeldMaterial ? "POST" : "PATCH",
          body: JSON.stringify(
            releasingHeldMaterial
              ? { shortage_quantity: Number(materialQuantity || 0), notes: materialNote.trim() }
              : { status: materialNextStatus, shortage_quantity: Number(materialQuantity || 0), notes: materialNote.trim() },
          ),
        },
      );
      setMaterialMessage(releasingHeldMaterial ? "Held material released." : "Material status updated.");
      setMaterialForm(null);
      onRefresh();
    } catch (caught) {
      setMaterialMessage(caught instanceof Error ? caught.message : "Could not update material status.");
    } finally {
      setMaterialSaving(false);
    }
  };

  const raiseMaterialIssue = async () => {
    if (!selectedMaterial || !materialNote.trim() || !materialResponseDueAt) return;
    if (new Date(materialResponseDueAt).getTime() <= Date.now()) {
      setMaterialMessage("Response deadline must be in the future.");
      return;
    }
    setMaterialSaving(true);
    setMaterialMessage("");
    try {
      await apiRequest("/operational-escalations/", {
        method: "POST",
        body: JSON.stringify({
          assignment: selectedMaterial.assignment,
          category: "material",
          priority: "high",
          summary: `${selectedMaterial.product_name} supply issue`,
          details: materialNote.trim(),
          immediate_action: "Confirm replenishment",
          owner_role: "materials",
          response_due_at: new Date(materialResponseDueAt).toISOString(),
        }),
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

  const assignAction = async (item: Escalation, ownerId: string) => {
    if (!ownerId) return;
    setActionSavingId(item.id);
    setActionMessage("");
    try {
      await apiRequest(`/operational-escalations/${item.id}/assign/`, {
        method: "POST",
        body: JSON.stringify({ owner: Number(ownerId) }),
      });
      setActionMessage("Action owner updated.");
      onRefresh();
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Could not assign this action.");
    } finally {
      setActionSavingId(null);
    }
  };

  const acknowledgeAction = async (item: Escalation) => {
    setActionSavingId(item.id);
    setActionMessage("");
    try {
      await apiRequest(`/operational-escalations/${item.id}/acknowledge/`, { method: "POST" });
      setActionMessage("Action acknowledged.");
      onRefresh();
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Could not acknowledge this action.");
    } finally {
      setActionSavingId(null);
    }
  };

  const resolveAction = async () => {
    if (!selectedAction || !actionResolutionNotes.trim()) return;
    setActionSavingId(selectedAction.id);
    setActionMessage("");
    try {
      await apiRequest(`/operational-escalations/${selectedAction.id}/resolve/`, {
        method: "POST",
        body: JSON.stringify({ resolution_notes: actionResolutionNotes.trim() }),
      });
      setActionMessage("Action resolved.");
      setSelectedAction(null);
      setActionResolutionNotes("");
      onRefresh();
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : "Could not resolve this action.");
    } finally {
      setActionSavingId(null);
    }
  };

  const recordRecovery = async () => {
    if (!selectedRecovery || !recoveryEvidence.trim() || !recoveryTime) return;
    setRecoverySaving(true);
    setRecoveryMessage("");
    try {
      await apiRequest(`/break-opportunities/${selectedRecovery.id}/resume/`, {
        method: "POST",
        body: JSON.stringify({ recovery_notes: recoveryEvidence.trim(), run_resumed_at: new Date(recoveryTime).toISOString() }),
      });
      setRecoveryMessage("Recovery evidence recorded.");
      setSelectedRecovery(null);
      onRefresh();
    } catch (caught) {
      setRecoveryMessage(caught instanceof Error ? caught.message : "Could not record recovery.");
    } finally {
      setRecoverySaving(false);
    }
  };

  return (
    <div className="manager-shell">
      <a className="skip-link" href="#manager-content">Skip to main content</a>
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: this snapshot remains visible, but refresh needs a connection.
        </div>
      ) : null}

      <header className="manager-topbar">
        <div className="manager-topbar__brand">
          <button
            type="button"
            ref={menuButtonRef}
            className="manager-menu-button"
            aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navigationOpen}
            aria-controls="manager-navigation"
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
              onChange={(event) => onShiftPatternChange(event.target.value as ManagerShiftPattern)}
            >
              <option value="day">Day · {shiftPattern === "day" ? shiftLabel : getShiftWindow(operationalDate, data.shifts, "day").startLabel + "–" + getShiftWindow(operationalDate, data.shifts, "day").endLabel}</option>
              <option value="night">Night · {shiftPattern === "night" ? shiftLabel : getShiftWindow(operationalDate, data.shifts, "night").startLabel + "–" + getShiftWindow(operationalDate, data.shifts, "night").endLabel}</option>
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
              {onEditProfile ? <button type="button" onClick={onEditProfile}>Edit profile</button> : null}
              <button type="button" onClick={onSignOut}>Sign out</button>
            </div>
          </details>
        </div>
      </header>

      <div className="manager-layout">
        <WorkspaceSidebar
          id="manager-navigation"
          ariaLabel="Operations Manager workspace"
          navigationLabel="Manager sections"
          className={`manager-sidebar${navigationOpen ? " manager-sidebar--open" : ""}`}
          items={MANAGER_NAV_ITEMS}
          activeItem={view}
          onSelect={selectView}
          contentId="manager-content"
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

        <main
          id="manager-content"
          ref={workspaceRef}
          className="manager-workspace"
          tabIndex={-1}
        >
          {error ? <ErrorBanner message={error} /> : null}

          {view === "overview" ? (
            <>
              <section className="manager-hero" aria-labelledby="manager-title">
                <div>
                  <h1 id="manager-title">Before-shift and live overview</h1>
                  <p>{shiftPattern === "day" ? "Day" : "Night"} shift {shiftLabel}&nbsp;&nbsp; | &nbsp;&nbsp;{liveView && liveState === "live" ? "Live data" : "Historical data"}</p>
                  {isHistorical ? <span className="historical-badge">Historical view</span> : null}
                </div>
                <span className="manager-snapshot-badge">{liveView ? "Now" : "Snapshot"} {formatClockMinutes(snapshotMinutes)}</span>
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
                <article className="control-kpi">
                  <span className="control-kpi__icon control-kpi__icon--green"><AppIcon name="chart" size={31} /></span>
                  <div><strong>{aggregatePosition ? `${aggregatePosition.shiftAttainment}%` : "—"}</strong><span>Time attainment</span><small>{aggregatePosition ? `${NUMBER.format(aggregatePosition.actual)} / ${NUMBER.format(aggregatePosition.due)} target due now` : "Target unavailable for some lines"}</small></div>
                </article>
                <article className="control-kpi control-kpi--downtime">
                  <span className="control-kpi__icon control-kpi__icon--red"><AppIcon name="clock" size={31} /></span>
                  <div><strong>{NUMBER.format(summary.total_downtime_minutes)} min</strong><span>Downtime</span><small>Total across all lines</small></div>
                </article>
              </section>

              <section className="manager-attention-strip" aria-label="Attention summary">
                <AppIcon name="warning" size={26} />
                <button type="button" onClick={() => setView("actions")}><strong>{criticalIssueCount} critical issue{criticalIssueCount === 1 ? "" : "s"}</strong></button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setView("actions")}><strong>{materialRisks.length} material risk{materialRisks.length === 1 ? "" : "s"}</strong></button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setView("actions")}><strong>{openActions.length} open action{openActions.length === 1 ? "" : "s"}</strong></button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setView("lines")}><strong>{missingUpdateCount} missing update{missingUpdateCount === 1 ? "" : "s"}</strong></button>
                <button className="attention-strip__open" type="button" aria-label="Open critical line control" onClick={() => setView("lines")}>›</button>
              </section>

              <div className="manager-overview-primary-grid">
              <section className="manager-position-board" aria-labelledby="coverage-board-title">
                <header className="manager-position-head">
                  <div><h2 id="coverage-board-title">All lines · position now</h2><p>Green = done · marker = target due now · track = full-shift plan</p></div>
                  <span>{formatClockMinutes(snapshotMinutes)}</span>
                </header>
                {progressLines.length ? progressLines.map(({ row, actual, expectedNow, delta, positionMinutes, shiftAttainment }) => (
                  <div className="manager-position-row" key={row.assignment.id}>
                    <div><strong>{displayLine(row.assignment.production_line_code)}</strong><small>{row.update?.current_product || row.assignment.production_line_name}</small></div>
                    <div className="manager-position-progress">
                      <div className="manager-position-track" aria-label={`${displayLine(row.assignment.production_line_code)}: ${actual === null ? "output unavailable" : `${NUMBER.format(actual)} done`}, ${expectedNow === null ? "target unavailable" : `${NUMBER.format(expectedNow)} due now`}`}>
                        <span style={{ width: `${row.shift?.planned_output && actual !== null ? Math.min(100, actual / row.shift.planned_output * 100) : 0}%` }} />
                        {row.shift?.planned_output && expectedNow !== null ? <i style={{ left: `${Math.min(100, expectedNow / row.shift.planned_output * 100)}%` }} /> : null}
                      </div>
                      <small>{actual === null ? "Output unavailable" : `${NUMBER.format(actual)} done`} / {expectedNow === null ? "target unavailable" : `${NUMBER.format(expectedNow)} due`}</small>
                    </div>
                    <div className={`manager-position-result ${positionMinutes === null ? "" : positionMinutes >= 0 ? "metric-ahead" : "metric-behind"}`}><strong>{timePositionLabel(positionMinutes)}</strong><small>{unitPositionLabel(delta)} · {shiftAttainment === null ? "—" : `${shiftAttainment}% attainment`}</small></div>
                  </div>
                )) : <p>No assigned lines for this shift.</p>}
                <button type="button" className="manager-position-link" onClick={() => setView("plans")}>Open hour-by-hour plan →</button>
              </section>

              <section className="overview-priorities" aria-labelledby="overview-priorities-title">
                <header><span><AppIcon name="clipboard" size={24} /></span><div><h2 id="overview-priorities-title">Suggested priorities</h2><p>Based on current performance and risks</p></div></header>
                {managerPriorities.length ? <ol>
                  {managerPriorities.map((priority, index) => <li key={priority.key}><button type="button" onClick={() => setView(priority.view)}><b>{index + 1}</b><span><strong>{priority.title}</strong><small>{priority.detail}</small></span></button></li>)}
                </ol> : <p className="overview-priorities__empty">No immediate intervention is required for this shift.</p>}
                <button type="button" className="button button--primary overview-priorities__cta" onClick={() => setView("briefing")}>View full briefing <span aria-hidden="true">→</span></button>
              </section>
              </div>

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
            <div className="manager-leader-progress-grid">
              {hierarchyGroups.map(({ teamLeaderId }, leaderIndex) => {
                const leaderLines = visibleRows.filter((row) => row.assignment.team_leader === teamLeaderId);
                if (!leaderLines.length) return null;
                return <article className="manager-leader-progress-card" key={teamLeaderId}>
                  <header><div><h2>Team Leader {leaderIndex + 1}</h2><p>{(["Operations", "Engineering", "QA"] as const)[leaderIndex] ?? "Operations"} · {leaderLines.map((row) => displayLine(row.assignment.production_line_code)).join(" & ")}</p></div><span>{leaderLines.length} assigned line{leaderLines.length === 1 ? "" : "s"}</span></header>
                  {leaderLines.map((row) => {
                    const progress = progressLines.find((item) => item.row.assignment.id === row.assignment.id);
                    const recentHours = progress?.hours.filter((hour) => !hour.future).slice(-4) ?? [];
                    return <div className="manager-leader-progress-line" key={row.assignment.id}>
                      <div className="manager-leader-progress-label"><button type="button" aria-label={`Open details for ${row.assignment.production_line_code}`} onClick={() => setSelectedLineId(row.assignment.id)}>{displayLine(row.assignment.production_line_code)} · {row.update?.current_product || row.assignment.production_line_name}</button><div className={progress?.positionMinutes === null || progress?.positionMinutes === undefined ? "" : progress.positionMinutes >= 0 ? "metric-ahead" : "metric-behind"}><strong>{timePositionLabel(progress?.positionMinutes ?? null)}</strong><small>{unitPositionLabel(progress?.delta ?? null)} · {progress?.shiftAttainment ?? "—"}%</small></div></div>
                      <p>{row.update?.status === "red" ? "Stopped" : row.update?.status === "amber" ? "Behind" : row.update?.status === "green" ? "Running" : "No update"} · {progress?.actual === null || progress?.actual === undefined ? "Output unavailable" : `${NUMBER.format(progress.actual)} / ${NUMBER.format(row.shift?.planned_output ?? 0)} shift plan`} · {lineDowntime(data.downtimeEvents, row.assignment.production_line)} min downtime</p>
                      <div className="manager-leader-hours">
                        {recentHours.map((hour) => <div key={hour.label}>
                          <div className="manager-leader-hour-track"><i style={{ width: `${hour.done !== null && hour.target ? Math.min(100, hour.done / hour.target * 100) : 0}%` }} /></div>
                          <small>{hour.current ? formatClockMinutes(snapshotMinutes) : hour.label.split("–")[0]}</small><span>{hour.done === null ? "—" : NUMBER.format(hour.done)} / {hour.dueNow === null ? "—" : NUMBER.format(hour.current ? hour.dueNow : hour.target ?? hour.dueNow)}</span>
                        </div>)}
                        {!recentHours.length ? <small>No hours due yet</small> : null}
                      </div>
                    </div>;
                  })}
                  <button type="button" className="manager-leader-open-hours" onClick={() => { setPlanLineFilter("all"); setExpandedPlanLine(leaderLines[0].assignment.id); setView("plans"); }}>Inspect hourly details →</button>
                </article>;
              })}
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
                  <section className="manager-line-hourly-detail">
                    <h3>Hour-by-hour details</h3>
                    <p>Same target, done and short evidence available to the assigned Team Leader.</p>
                    <div className="tl-plan-v2__metrics">
                      <div><span>Actual now</span><strong>{selectedLineProgress?.actual === null || selectedLineProgress?.actual === undefined ? "—" : NUMBER.format(selectedLineProgress.actual)}</strong></div>
                      <div><span>Target now</span><strong>{selectedLineProgress?.expectedNow === null || selectedLineProgress?.expectedNow === undefined ? "—" : NUMBER.format(selectedLineProgress.expectedNow)}</strong></div>
                      <div><span>Position now</span><strong>{timePositionLabel(selectedLineProgress?.positionMinutes ?? null)}</strong></div>
                      <div><span>Shift plan</span><strong>{selectedLine.shift ? NUMBER.format(selectedLine.shift.planned_output) : "—"}</strong></div>
                    </div>
                    <div className="tl-plan-v2__hours">
                      {selectedLineProgress?.hours.map((hour) => {
                        const short = hour.done !== null && hour.dueNow !== null
                          ? Math.max(0, hour.dueNow - hour.done)
                          : null;
                        const green = hour.target && hour.done !== null
                          ? Math.min(100, hour.done / hour.target * 100)
                          : 0;
                        const amber = hour.target && short !== null
                          ? Math.min(100 - green, short / hour.target * 100)
                          : 0;
                        return <div className={`tl-plan-v2__hour${hour.current ? " is-current" : ""}`} key={hour.label}>
                          <strong>{hour.label}</strong>
                          <span>{hour.breakMinutes ? `${hour.breakMinutes}m break` : "Production"}</span>
                          <span>T {hour.target === null ? "—" : NUMBER.format(hour.target)}</span>
                          <span>D {hour.done === null ? "—" : NUMBER.format(hour.done)}</span>
                          <span>S {short === null ? "—" : NUMBER.format(short)}</span>
                          <div className="tl-plan-v2__hour-bar" aria-label={`${hour.label}: ${hour.done === null ? "actual output unavailable" : `${hour.done} done`}, ${short === null ? "shortage unavailable" : `${short} short`}`}><i style={{ width: `${green}%` }} /><b style={{ width: `${amber}%` }} /></div>
                        </div>;
                      })}
                    </div>
                    {selectedLineProgress && !selectedLineProgress.hours.some((hour) => hour.done !== null) ? <p className="tl-plan-v2__data-note">Hourly actuals have not been recorded for this line.</p> : null}
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
                eyebrow={isHistorical ? "Historical snapshot" : "Today&apos;s schedule"}
                title="Daily plans"
                body={isHistorical ? `Read-only approved schedule and recorded output for ${controlBoardDate(operationalDate)}.` : "Compare the approved schedule with recorded output, target due now and each recorded hour."}
              />
              <div className="daily-plan-controls">
                <select aria-label="Filter daily plans by line" value={planLineFilter} onChange={(event) => setPlanLineFilter(event.target.value)}><option value="all">All lines</option>{rows.map((row) => <option key={row.assignment.id} value={row.assignment.production_line}>{displayLine(row.assignment.production_line_code)}</option>)}</select>
                <select aria-label="Filter daily plans by Team Leader" value={planLeaderFilter} onChange={(event) => setPlanLeaderFilter(event.target.value)}><option value="all">All Team Leaders</option>{hierarchyGroups.map((group, index) => <option key={group.teamLeaderId} value={group.teamLeaderId}>Team Leader {index + 1}</option>)}</select>
                {profile.is_staff && !isHistorical ? <><button type="button" className="button button--ghost" onClick={() => { setShiftStart(configuredShiftStart); setShiftEnd(configuredShiftEnd); setShiftTimeMessage(""); setShiftEditorOpen(true); }}><AppIcon name="clock" size={18} /> Shift times</button><button type="button" className="button button--primary" onClick={() => openPlanEditor()}><AppIcon name="edit" size={18} /> Add plan block</button></> : <span className="daily-plan-snapshot"><AppIcon name="shield" size={18} /> Read-only snapshot</span>}
              </div>
              <section className="daily-plan-timeline-board" aria-label="Daily schedule timeline">
                <header className="daily-plan-timeline-header">
                  <div><strong>Shift schedule</strong><span>{shiftLabel}</span></div>
                  <div className="daily-plan-legend"><span className="legend-done">Done</span><span className="legend-production">Planned output left</span><span className="legend-break">Planned break</span></div>
                </header>
                <div className="daily-plan-axis" aria-hidden="true">{planAxisTicks.map((minutes, index) => index === 1 && minutes - planAxisTicks[0] < 30 ? null : <span key={minutes} style={{ left: `${(minutes - scheduleWindow.startMinutes) / Math.max(1, scheduleWindow.endMinutes - scheduleWindow.startMinutes) * 100}%` }}>{formatClockMinutes(minutes)}</span>)}</div>
                <div className="daily-plan-rows">
                  {planRows.map((row) => {
                    const blocks = (data.planBlocks ?? []).filter((block) => block.assignment === row.assignment.id).sort((left, right) => left.sequence_number - right.sequence_number);
                    const progress = progressLines.find((item) => item.row.assignment.id === row.assignment.id);
                    return <article className="daily-plan-row" key={row.assignment.id}>
                      <div className="daily-plan-row-label"><strong>{displayLine(row.assignment.production_line_code)}</strong><span>{progress?.actual === null || progress?.actual === undefined ? "Output unavailable" : `${NUMBER.format(progress.actual)} done`}</span></div>
                      <div className="daily-plan-track">
                        {blocks.length ? blocks.map((block) => {
                          return <button type="button" className={`daily-plan-block daily-plan-block--${block.block_type}`} style={{ ...timelineStyle(block.planned_start_at, block.planned_end_at, scheduleWindow), "--manager-plan-done": `${completedFractionForBlock(block, blocks, scheduleWindow, row.shift ?? undefined)}%` } as CSSProperties} key={block.id} onClick={() => setSelectedPlanBlock(block)}>
                            <strong>{block.block_type === "break" ? `Break ${block.break_number ?? ""}` : block.product_name}</strong><span>{formatScheduleClock(block.planned_start_at)} – {formatScheduleClock(block.planned_end_at)}</span>
                          </button>;
                        }) : <span className="daily-plan-empty">No plan blocks recorded</span>}
                        {snapshotInsideShift ? <i className="manager-plan-now" style={{ left: `${snapshotFraction}%` }} aria-label={`${liveView ? "Now" : "Snapshot"} ${formatClockMinutes(snapshotMinutes)}`} /> : null}
                      </div>
                    </article>;
                  })}
                </div>
                {snapshotInsideShift && planRows.length ? <div className="manager-plan-now-label">{liveView ? "Now" : "Snapshot"} {formatClockMinutes(snapshotMinutes)}</div> : null}
              </section>
              <section className="daily-plan-output-table" aria-label="Daily plan output table">
                <h2>Output by line</h2>
                <p>Select a line for hourly target, recorded done and short.</p>
                <div className="responsive-table"><table><thead><tr><th>Line</th><th>Planned</th><th>Actual</th><th>Full-day completion</th><th>Position now</th></tr></thead><tbody>{planRows.map((row) => {
                  const progress = progressLines.find((item) => item.row.assignment.id === row.assignment.id);
                  const expanded = expandedPlanLine === row.assignment.id;
                  const delta = progress?.delta ?? null;
                  return <Fragment key={row.assignment.id}>
                    <tr className={expanded ? "manager-output-selected" : ""}>
                      <td><button type="button" className="manager-output-open" aria-expanded={expanded} aria-controls={`manager-hours-${row.assignment.id}`} onClick={() => setExpandedPlanLine(expanded ? null : row.assignment.id)}>{displayLine(row.assignment.production_line_code)} {expanded ? "▴" : "▾"}</button><small>{row.update?.current_product || row.assignment.production_line_name}</small></td>
                      <td>{row.shift ? NUMBER.format(row.shift.planned_output) : "—"}</td>
                      <td>{progress?.actual === null || progress?.actual === undefined ? "—" : NUMBER.format(progress.actual)}</td>
                      <td>{planPercent(row.shift) === null ? "—" : `${planPercent(row.shift)}%`}</td>
                      <td className={delta === null ? "" : delta < 0 ? "metric-behind" : "metric-ahead"}><strong>{timePositionLabel(progress?.positionMinutes ?? null)}</strong><small>{unitPositionLabel(delta)} · {progress?.shiftAttainment ?? "—"}% attainment</small></td>
                    </tr>
                    {expanded ? <tr className="manager-output-detail-row"><td colSpan={5}><div id={`manager-hours-${row.assignment.id}`} className="manager-output-detail" aria-label={`${displayLine(row.assignment.production_line_code)} hourly details`}>
                      <header><div><h3>{displayLine(row.assignment.production_line_code)} · Hourly details</h3><p>Break-aware target · recorded hours only · partial hour due by {formatClockMinutes(snapshotMinutes)}</p></div><span>{progress?.expectedNow ? `${Math.round((progress.actual ?? 0) / progress.expectedNow * 100)}% of target due now` : "Target unavailable"}</span></header>
                      <div className="manager-output-facts"><div><small>Actual now</small><strong>{progress?.actual === null || progress?.actual === undefined ? "—" : NUMBER.format(progress.actual)}</strong></div><div><small>Target due now</small><strong>{progress?.expectedNow === null || progress?.expectedNow === undefined ? "—" : NUMBER.format(progress.expectedNow)}</strong></div><div><small>Position now</small><strong>{timePositionLabel(progress?.positionMinutes ?? null)}</strong><span>{unitPositionLabel(delta)}</span></div><div><small>Shift attainment</small><strong>{progress?.shiftAttainment === null || progress?.shiftAttainment === undefined ? "—" : `${progress.shiftAttainment}%`}</strong><span>Full-shift time basis</span></div><div><small>Left in shift</small><strong>{row.shift && progress?.actual !== null && progress?.actual !== undefined ? NUMBER.format(Math.max(0, row.shift.planned_output - progress.actual)) : "—"}</strong></div></div>
                      <div className="manager-output-hours">{progress?.hours.map((hour) => {
                        const short = hour.done !== null && hour.dueNow !== null ? Math.max(0, hour.dueNow - hour.done) : null;
                        return <div className={`manager-output-hour${hour.current ? " is-current" : ""}`} key={hour.label}><strong>{hour.label}</strong><div className="manager-output-hour-track"><i style={{ width: `${hour.target && hour.done !== null ? Math.min(100, hour.done / hour.target * 100) : 0}%` }} /></div><small>{hour.breakMinutes ? `${hour.breakMinutes}m break · ` : ""}T {hour.target === null ? "—" : NUMBER.format(hour.current ? hour.dueNow ?? 0 : hour.target)} · D {hour.done === null ? "—" : NUMBER.format(hour.done)} · S {short === null ? "—" : NUMBER.format(short)}</small></div>;
                      })}</div>
                      {progress && !progress.hours.some((hour) => hour.done !== null) ? <p>Hourly actuals have not been recorded for this line. Done and short are unavailable.</p> : null}
                    </div></td></tr> : null}
                  </Fragment>;
                })}</tbody></table></div>
              </section>
              {selectedPlanBlock ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="plan-block-title"><header><div><span className="eyebrow">Schedule detail</span><h2 id="plan-block-title">{selectedPlanBlock.block_type === "break" ? `Planned break ${selectedPlanBlock.break_number ?? ""}` : selectedPlanBlock.product_name}</h2></div><button type="button" aria-label="Close plan detail" onClick={() => setSelectedPlanBlock(null)}>×</button></header><dl className="plan-block-facts"><div><dt>Start</dt><dd>{formatScheduleClock(selectedPlanBlock.planned_start_at)}</dd></div><div><dt>End</dt><dd>{formatScheduleClock(selectedPlanBlock.planned_end_at)}</dd></div><div><dt>Target</dt><dd>{selectedPlanBlock.target_units_per_hour ?? "—"} / hour</dd></div><div><dt>Quantity</dt><dd>{NUMBER.format(selectedPlanBlock.planned_units)}</dd></div><div><dt>Materials</dt><dd>{data.materials.filter((item) => item.assignment === selectedPlanBlock.assignment && item.sequence_number === selectedPlanBlock.sequence_number).map((item) => item.product_name).join(", ") || "No material record"}</dd></div></dl>{planMessage ? <p role="status" className="downtime-editor__message">{planMessage}</p> : null}<footer><button type="button" className="button button--ghost" onClick={() => setSelectedPlanBlock(null)}>Done</button>{profile.is_staff && !isHistorical ? <><button type="button" className="button button--danger" disabled={planSaving} onClick={() => void deletePlanBlock(selectedPlanBlock)}>Delete block</button><button type="button" className="button button--primary" onClick={() => openPlanEditor(selectedPlanBlock)}>Edit block</button></> : null}</footer></section></div> : null}
              {shiftEditorOpen ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="shift-time-title"><header><div><span className="eyebrow">Operations control</span><h2 id="shift-time-title">Shift start & end</h2></div><button type="button" aria-label="Close shift time editor" onClick={() => setShiftEditorOpen(false)}>×</button></header><p>These times apply to every recorded {shiftPattern} shift line for {controlBoardDate(operationalDate)}.</p><label>Shift start<input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} /></label><label>Shift end<input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} /></label><p className="workflow-boundary">Default day shift: Monday–Friday 06:45–18:00; Saturday–Sunday 07:00–18:00. Operations may override the recorded shift when required.</p>{shiftTimeMessage ? <p role="status">{shiftTimeMessage}</p> : null}<footer><button type="button" className="button button--ghost" onClick={() => setShiftEditorOpen(false)}>Cancel</button><button type="button" className="button button--primary" disabled={shiftTimeSaving} onClick={() => void saveShiftTimes()}>{shiftTimeSaving ? "Saving…" : "Save shift time"}</button></footer></section></div> : null}
              {planEditorOpen ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor plan-block-editor" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><header><div><span className="eyebrow">Approved schedule</span><h2 id="plan-editor-title">{editingPlanBlock ? "Edit plan block" : "Add plan block"}</h2></div><button type="button" aria-label="Close plan editor" onClick={() => setPlanEditorOpen(false)}>×</button></header>{selectedPlanAssignment ? <div className="plan-editor-line-context"><strong>Selected line: {displayLine(selectedPlanAssignment.production_line_code)}</strong><span>{selectedPlanAssignment.production_line_code} · {selectedPlanAssignment.production_line_name} · {titleCase(selectedPlanAssignment.shift_type)} shift</span></div> : selectedPlanLine ? <div className="plan-editor-line-context"><strong>Selected line: {displayLine(selectedPlanLine.code)}</strong><span>{selectedPlanLine.code} · Assign a Team Leader below to activate this line for the shift.</span></div> : <p className="downtime-editor__message">Choose a production line.</p>}<div className="plan-editor-grid"><label>Production line<select value={planAssignment} disabled={Boolean(editingPlanBlock)} onChange={(event) => changePlanAssignment(event.target.value)}>{planLineOptions.map(({ line, assignment }) => <option key={line.id} value={assignment?.id ?? `line-${line.id}`}>{displayLine(line.code)} · {line.name}{assignment ? ` · ${assignment.team_leader_username}` : " · Assignment required"}</option>)}</select></label>{!selectedPlanAssignment && selectedPlanLine ? <label>Team Leader<select value={planTeamLeader} onChange={(event) => setPlanTeamLeader(event.target.value)}><option value="">Choose Team Leader</option>{planLeaderOptions.map((leader) => <option key={leader.id} value={leader.id}>{leader.display_name}</option>)}</select></label> : null}<label>Sequence<input type="number" min="1" value={planSequence} onChange={(event) => setPlanSequence(event.target.value)} /></label><label>Block type<select value={planBlockType} onChange={(event) => setPlanBlockType(event.target.value as "production" | "break")}><option value="production">Production</option><option value="break">Planned break</option></select></label><label>Start<input type="datetime-local" value={planStart} onChange={(event) => setPlanStart(event.target.value)} /></label><label>End<input type="datetime-local" value={planEnd} onChange={(event) => setPlanEnd(event.target.value)} /></label>{planBlockType === "production" ? <><label>Product code<input value={planProductCode} onChange={(event) => setPlanProductCode(event.target.value)} /></label><label>Product name<input value={planProductName} onChange={(event) => setPlanProductName(event.target.value)} /></label><label>Target units / hour<input type="number" min="1" value={planHourlyTarget} onChange={(event) => setPlanHourlyTarget(event.target.value)} /></label></> : <label>Break number<select value={planBreakNumber} onChange={(event) => setPlanBreakNumber(event.target.value)}><option value="1">Break 1</option><option value="2">Break 2</option></select></label>}</div><p className="workflow-boundary">The master list contains Lines 1–20. An unassigned line is activated by creating its Team Leader assignment when the first block is saved. Blocks must stay inside the selected shift and cannot overlap. Approved breaks are exactly 40 minutes.</p>{planMessage ? <p role="status" className="downtime-editor__message">{planMessage}</p> : null}<footer><button type="button" className="button button--ghost" onClick={() => setPlanEditorOpen(false)}>Cancel</button><button type="button" className="button button--primary" disabled={planSaving || !selectedPlanLine || (!selectedPlanAssignment && !planTeamLeader)} onClick={() => void savePlanBlock()}>{planSaving ? "Saving…" : editingPlanBlock ? "Save changes" : "Add block"}</button></footer></section></div> : null}
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
                <div className="manager-table-card responsive-table"><table><thead><tr><th>Line</th><th>Product</th><th>Needed by</th><th>ETA / supply position</th><th>Status</th><th>Owner</th></tr></thead><tbody>{visibleMaterials.map((item) => <tr className={selectedMaterialId === item.id ? "is-selected" : ""} key={item.id} onClick={() => setSelectedMaterialId(item.id)}><td>{displayLine(item.production_line_code)}</td><td><strong>{item.product_name}</strong><small>{item.product_code}</small></td><td>{shortTime(item.needed_by_at)}</td><td><strong>{item.expected_available_at ? `ETA ${shortTime(item.expected_available_at)}` : "ETA not set"}</strong><small>{item.status === "held" ? item.hold_reason || "Reason not recorded" : item.shortage_quantity ? `${NUMBER.format(item.shortage_quantity)} units short` : item.notes || "Available"}</small></td><td><StatusPill value={item.status} /></td><td>{item.owner_username || item.responsible_role || "Unassigned"}</td></tr>)}</tbody></table></div>
                {selectedMaterial ? <section className="material-detail-card" aria-labelledby="selected-material-title"><header><div><h2 id="selected-material-title">{selectedMaterial.product_name} · {displayLine(selectedMaterial.production_line_code)}</h2><StatusPill value={selectedMaterial.status} /></div></header><dl><div><dt>Supply position</dt><dd>{selectedMaterial.shortage_quantity ? `${NUMBER.format(selectedMaterial.shortage_quantity)} units short` : titleCase(selectedMaterial.status)}</dd></div><div><dt>Needed by</dt><dd>{shortTime(selectedMaterial.needed_by_at)}</dd></div><div><dt>Expected available</dt><dd>{shortTime(selectedMaterial.expected_available_at)}</dd></div><div><dt>Owner</dt><dd>{selectedMaterial.owner_username || selectedMaterial.responsible_role || "Unassigned"}</dd></div><div><dt>Held reason / next action</dt><dd>{selectedMaterial.hold_reason || selectedMaterial.next_action || selectedMaterial.notes || "Confirm replenishment"}</dd></div></dl><div className="material-detail-actions"><button type="button" className="button button--primary" onClick={() => { setMaterialForm("status"); setMaterialNextStatus(selectedMaterial.status === "held" ? "ready" : selectedMaterial.status); setMaterialQuantity(String(selectedMaterial.shortage_quantity || "")); setMaterialNote(selectedMaterial.notes); }}>Update status</button><button type="button" className="button button--ghost" onClick={() => { setMaterialForm("issue"); setMaterialNote(""); setMaterialResponseDueAt(localDateTimeAfter(new Date().toISOString(), 30)); }}>Raise issue</button></div>{materialMessage ? <p role="status">{materialMessage}</p> : null}</section> : <p className="materials-action-note"><AppIcon name="info" size={18} /> Select a material to review its history and next action.</p>}
              </> : <section className="manager-detail-card"><h2>Open actions</h2>{actionMessage ? <p role="status">{actionMessage}</p> : null}{openActions.length ? <ul className="manager-risk-list manager-action-list">{openActions.map((item) => <li key={item.id}><StatusPill value={item.priority} /><div><strong>{item.production_line_code} · {item.summary}</strong><span>Responsible: {item.owner_username || item.owner_role || escalationRole(item.category)} · Due {formatDateTime(item.response_due_at)}</span><small>Status: {titleCase(item.status)}</small></div><div className="manager-action-controls"><select aria-label={`Assign owner for ${item.summary}`} value={item.owner ?? ""} disabled={actionSavingId === item.id} onChange={(event) => void assignAction(item, event.target.value)}><option value="">Unassigned</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}</select>{item.status === "open" ? <button type="button" className="button button--ghost" disabled={actionSavingId === item.id} onClick={() => void acknowledgeAction(item)}>Acknowledge</button> : <button type="button" className="button button--primary" disabled={actionSavingId === item.id} onClick={() => { setSelectedAction(item); setActionResolutionNotes(""); }}>Resolve</button>}</div>{item.is_overdue ? <span className="risk-label">Overdue</span> : null}</li>)}</ul> : <EmptyState title="No open actions" body="No unresolved escalation is visible for this date." />}</section>}
              {selectedMaterial && materialForm ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="material-form-title"><header><div><span className="eyebrow">{displayLine(selectedMaterial.production_line_code)} · {selectedMaterial.product_name}</span><h2 id="material-form-title">{materialForm === "status" ? selectedMaterial.status === "held" ? "Release held material" : "Update material status" : "Raise material issue"}</h2></div><button type="button" aria-label="Close material form" onClick={() => setMaterialForm(null)}>×</button></header>{materialForm === "status" ? <><label>Status<select value={materialNextStatus} onChange={(event) => setMaterialNextStatus(event.target.value as MaterialStatus)}>{(selectedMaterial.status === "held" ? ["ready"] : ["ready", "in_process", "short", "held"] as MaterialStatus[]).map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label><label>Shortage quantity / units<input type="number" min="0" value={materialQuantity} onChange={(event) => setMaterialQuantity(event.target.value)} /></label></> : <><p>Line and material are prefilled from the selected record.</p><label>Response deadline<input type="datetime-local" required value={materialResponseDueAt} onChange={(event) => setMaterialResponseDueAt(event.target.value)} /></label></>}<label>Short note<textarea required rows={3} value={materialNote} onChange={(event) => setMaterialNote(event.target.value)} /></label><footer><button type="button" className="button button--ghost" onClick={() => setMaterialForm(null)}>Cancel</button><button type="button" className="button button--primary" disabled={materialSaving || !materialNote.trim() || (materialForm === "issue" && !materialResponseDueAt)} onClick={materialForm === "status" ? saveMaterialStatus : raiseMaterialIssue}>{materialSaving ? "Saving…" : materialForm === "status" ? selectedMaterial.status === "held" ? "Release material" : "Save update" : "Raise issue"}</button></footer></section></div> : null}
              {selectedAction ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="resolve-action-title"><header><div><span className="eyebrow">{selectedAction.production_line_code} · {titleCase(selectedAction.category)}</span><h2 id="resolve-action-title">Resolve action</h2></div><button type="button" aria-label="Close resolve action form" onClick={() => setSelectedAction(null)}>×</button></header><p>{selectedAction.summary}</p><label>Resolution notes<textarea required rows={4} value={actionResolutionNotes} onChange={(event) => setActionResolutionNotes(event.target.value)} /></label><footer><button type="button" className="button button--ghost" onClick={() => setSelectedAction(null)}>Cancel</button><button type="button" className="button button--primary" disabled={actionSavingId === selectedAction.id || !actionResolutionNotes.trim()} onClick={() => void resolveAction()}>{actionSavingId === selectedAction.id ? "Saving…" : "Resolve action"}</button></footer></section></div> : null}
            </>
          ) : null}

          {view === "briefing" ? (
            <>
              <ManagerViewIntro
                eyebrow="Explainable evidence"
                title="AI Daily Risk Briefing"
                body="Review deterministic line risk, confidence, ranked source evidence, and missing-data warnings."
              />
              <DailyRiskBriefingPanel operationalDate={operationalDate} onOpenLine={(lineId) => {
                const row = rows.find((candidate) => candidate.assignment.production_line === lineId);
                if (row) {
                  setSelectedLineId(row.assignment.id);
                  setView("lines");
                }
              }} />
            </>
          ) : null}

          {view === "pilot" ? <PilotAdminPanel /> : null}

          {view === "recovery" ? (
            <>
              <ManagerViewIntro
                eyebrow="Recorded recovery evidence"
                title="Break recovery & loss history"
                body="Review confirmed downtime, recovered production time and recurring mapped-asset evidence."
              />
              <div className="break-recovery-tabs" role="tablist" aria-label="Recovery views"><button type="button" role="tab" aria-selected={recoveryTab === "shift"} className={recoveryTab === "shift" ? "is-active" : ""} onClick={() => setRecoveryTab("shift")}>Shift recovery</button><button type="button" role="tab" aria-selected={recoveryTab === "history"} className={recoveryTab === "history" ? "is-active" : ""} onClick={() => setRecoveryTab("history")}>Loss & asset history</button></div>
              {recoveryTab === "history" ? <LossAnalyticsPanel assignments={data.assignments} /> : <>
                <div className="break-recovery-filters"><label>Date<input type="date" value={operationalDate} onChange={(event) => onDateChange(event.target.value)} /></label><label>Production line<select value={recoveryLineFilter} onChange={(event) => setRecoveryLineFilter(event.target.value)}><option value="all">All lines</option>{rows.map((row) => <option key={row.assignment.id} value={row.assignment.production_line}>{displayLine(row.assignment.production_line_code)}</option>)}</select></label><label>Time range<select value={recoveryRange} onChange={(event) => setRecoveryRange(event.target.value)}><option value="shift">This shift</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label><button type="button" className="button button--primary" onClick={onRefresh}>Apply filters</button></div>
                <section className="recovery-kpis" aria-label="Recovery summary"><article><span>Recorded downtime</span><strong>{recordedDowntime} min</strong></article><article><span>Recovered time</span><strong>{recoveredMinutes} min</strong></article><article><span>Remaining loss</span><strong>{remainingLoss} min</strong></article><article><span>Opportunities</span><strong>{recoveryOpportunities.length}</strong></article></section>
                <section className="recovery-activity"><header><div><h2>Recovery activity</h2>{recoveryOpportunities.length && !eligibleRecovery ? <small>Record recovery becomes available after checks are complete.</small> : null}</div><button type="button" className="button button--primary" disabled={!eligibleRecovery} onClick={() => { if (eligibleRecovery) { setSelectedRecovery(eligibleRecovery); setRecoveryTime(localDateTimeAfter(new Date().toISOString(), 0)); setRecoveryEvidence(eligibleRecovery.recovery_notes); } }}>Record recovery</button></header>{recoveryOpportunities.length ? recoveryOpportunities.map((item) => <details key={item.id} open={item === recoveryOpportunities[0]}><summary><strong>{displayLine(item.production_line_code)}</strong><span>{item.issue_summary}</span><small>{titleCase(item.status)}</small></summary><ol className="recovery-timeline"><li><time>{shortTime(item.fault_at)}</time><strong>Fault recorded</strong><span>{item.issue_summary}</span></li><li><time>{shortTime(item.suggested_start_at)}</time><strong>Planned break starts</strong><span>Approved recovery window</span></li><li><time>{shortTime(item.checks_completed_at)}</time><strong>Repair complete</strong><span>Checks and evidence recorded</span></li><li><time>{shortTime(item.run_resumed_at)}</time><strong>Production resumes</strong><span>{item.recovery_notes || "Awaiting resume evidence"}</span></li></ol></details>) : <EmptyState title="No recovery activity" body="No linked break opportunity is recorded for this selection." />}</section>
                <section className="hourly-recovery-history"><h2>Hourly event history</h2><div className="responsive-table"><table><thead><tr><th>Hour</th><th>Line</th><th>Duration</th><th>Description</th></tr></thead><tbody>{recoveryDowntimeEvents.map((event) => <tr key={event.id}><td>{shortTime(event.started_at)} – {shortTime(event.ended_at)}</td><td>{displayLine(event.production_line_code)}</td><td>{event.duration_minutes} min</td><td>{event.description}</td></tr>)}</tbody></table></div></section>
                <p className="recovery-rule"><AppIcon name="info" size={18} /> Planned breaks are excluded from recorded downtime. Eligible recovered minutes are counted once; remaining loss never falls below zero.</p>
                {recoveryMessage ? <p role="status">{recoveryMessage}</p> : null}
              </>}
              {selectedRecovery ? <div className="downtime-modal-backdrop" role="presentation"><section className="downtime-editor" role="dialog" aria-modal="true" aria-labelledby="recovery-form-title"><header><div><span className="eyebrow">Linked event #{selectedRecovery.id}</span><h2 id="recovery-form-title">Record recovery</h2></div><button type="button" aria-label="Close recovery form" onClick={() => setSelectedRecovery(null)}>×</button></header><label>Recovery time<input type="datetime-local" required value={recoveryTime} onChange={(event) => setRecoveryTime(event.target.value)} /></label><label>Recovery evidence<textarea rows={4} required value={recoveryEvidence} onChange={(event) => setRecoveryEvidence(event.target.value)} placeholder="Repair check, output evidence or verified restart note" /></label><footer><button type="button" className="button button--ghost" onClick={() => setSelectedRecovery(null)}>Cancel</button><button type="button" className="button button--primary" disabled={recoverySaving || !recoveryTime || !recoveryEvidence.trim()} onClick={recordRecovery}>{recoverySaving ? "Saving…" : "Record recovery"}</button></footer></section></div> : null}
            </>
          ) : null}

        </main>
      </div>

    </div>
  );
}
