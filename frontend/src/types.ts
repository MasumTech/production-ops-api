export type RagStatus = "green" | "amber" | "red";
export type MaterialStatus = "ready" | "in_process" | "short" | "held";
export type EscalationStatus = "open" | "acknowledged" | "resolved";
export type BreakStatus =
  | "planned"
  | "coverage_accepted"
  | "active"
  | "recovered"
  | "cancelled";

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface UserChoice {
  id: number;
  username: string;
  display_name: string;
}

export interface UserSummary extends UserChoice {
  is_staff: boolean;
  workspace: "manager" | "team_leader" | "support";
}

export interface Assignment {
  id: number;
  team_leader: number;
  team_leader_username: string;
  production_line: number;
  production_line_code: string;
  production_line_name: string;
  date: string;
  shift_type: "day" | "night";
  notes: string;
}

export interface LineUpdate {
  id: number;
  assignment: number;
  production_line: number;
  production_line_code: string;
  production_line_name: string;
  status: RagStatus;
  current_product: string;
  issue_summary: string;
  action_taken: string;
  action_owner: number | null;
  action_owner_username: string | null;
  support_required: string;
  requires_follow_up: boolean;
  recorded_at: string;
  next_update_due_at: string | null;
}

export interface MaterialReadiness {
  id: number;
  assignment: number;
  production_line: number;
  production_line_code: string;
  sequence_number: number;
  product_code: string;
  product_name: string;
  planned_quantity: number;
  status: MaterialStatus;
  shortage_quantity: number;
  owner: number | null;
  owner_username: string | null;
  expected_available_at: string | null;
  hold_reason: string;
  notes: string;
}

export interface Escalation {
  id: number;
  asset: number | null;
  asset_code: string | null;
  asset_name: string | null;
  loss_minutes: number;
  estimated_lost_units: number;
  assignment: number;
  production_line: number;
  production_line_code: string;
  category: "equipment" | "material" | "quality" | "staffing" | "safety" | "other";
  priority: "low" | "medium" | "high" | "critical";
  status: EscalationStatus;
  summary: string;
  details: string;
  immediate_action: string;
  owner: number | null;
  owner_username: string | null;
  response_due_at: string | null;
  is_overdue: boolean;
  needs_attention: boolean;
}

export interface BreakRecovery {
  id: number;
  assignment: number;
  production_line: number;
  production_line_code: string;
  team_leader_username: string;
  cover_user: number;
  cover_user_username: string;
  status: BreakStatus;
  planned_start_at: string;
  expected_return_at: string;
  coverage_notes: string;
  recovery_notes: string;
  cancellation_reason: string;
  is_overdue: boolean;
  needs_attention: boolean;
}

export interface ShiftHandover {
  id: number;
  outgoing_assignment: number;
  incoming_assignment: number;
  production_line: number;
  production_line_code: string;
  outgoing_team_leader_username: string;
  incoming_team_leader_username: string;
  outgoing_date: string;
  outgoing_shift_type: string;
  incoming_date: string;
  incoming_shift_type: string;
  escalations: Escalation[];
  status: "pending" | "accepted";
  operational_summary: string;
  notes: string;
  handed_over_at: string;
}

export interface ShiftRecord {
  id: number;
  production_line: number;
  production_line_code: string;
  supervisor: number;
  supervisor_username: string;
  date: string;
  shift_type: "day" | "night";
  planned_output: number;
  actual_output: number;
  downtime_minutes: number;
  performance_percentage: number | null;
}

export interface DashboardSummary {
  total_shifts: number;
  total_planned_output: number;
  total_actual_output: number;
  overall_performance_percentage: number | null;
  total_downtime_minutes: number;
  open_incidents: number;
  critical_incidents: number;
}

export interface WorkspaceData {
  assignments: Assignment[];
  updates: LineUpdate[];
  materials: MaterialReadiness[];
  escalations: Escalation[];
  breaks: BreakRecovery[];
  handovers: ShiftHandover[];
  users: UserChoice[];
}

export interface ManagerWorkspaceData {
  assignments: Assignment[];
  updates: LineUpdate[];
  materials: MaterialReadiness[];
  escalations: Escalation[];
  shifts: ShiftRecord[];
  summary: DashboardSummary;
}

export interface SupportCompanionData {
  generated_at: string | null;
  assignments: Assignment[];
  updates: LineUpdate[];
  materials: MaterialReadiness[];
  escalations: Escalation[];
}

export interface OperationalEvent {
  id: number;
  event_type: string;
  resource_type: string;
  resource_id: number;
  assignment: number | null;
  production_line: number | null;
  actor: number | null;
  severity: "info" | "warning" | "critical";
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface ProductionAsset {
  id: number;
  production_line: number;
  production_line_code: string;
  code: string;
  name: string;
  asset_type: string;
  status: "active" | "maintenance" | "retired";
}

export interface AssetLossRow {
  asset_id: number;
  asset_code: string;
  asset_name: string;
  production_line_code: string;
  occurrences: number;
  affected_shifts: number;
  open_events: number;
  total_loss_minutes: number;
  total_estimated_lost_units: number;
  latest_event_at: string;
  recurring: boolean;
}

export interface LineLossRow {
  production_line_id: number;
  production_line_code: string;
  category: string;
  occurrences: number;
  affected_shifts: number;
  total_loss_minutes: number;
  total_estimated_lost_units: number;
}

export interface LossAnalyticsReport {
  summary: {
    date_from: string;
    date_to: string;
    total_events: number;
    total_loss_minutes: number;
    total_estimated_lost_units: number;
    unassigned_asset_events: number;
    recurring_asset_count: number;
  };
  assets: AssetLossRow[];
  line_losses: LineLossRow[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  code: string;
  source: string;
  severity: RiskLevel;
  score: number;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface MissingDataWarning {
  code: string;
  source: string;
  message: string;
}

export interface RiskMetrics {
  assignment_count: number;
  shift_count: number;
  planned_output: number;
  actual_output: number;
  performance_percentage: number | null;
  downtime_minutes: number;
  latest_status: string | null;
  latest_update_at: string | null;
  open_escalations: number;
  overdue_escalations: number;
  critical_escalations: number;
  unassigned_escalations: number;
  short_material_items: number;
  held_material_items: number;
  active_assets: number;
  recurring_asset_faults: number;
  confirmed_loss_minutes: number;
  estimated_lost_units: number;
}

export interface LineRiskBriefing {
  production_line_id: number;
  production_line_code: string;
  production_line_name: string;
  risk_level: RiskLevel;
  risk_score: number;
  confidence_percent: number;
  risk_factors: RiskFactor[];
  missing_data_warnings: MissingDataWarning[];
  metrics: RiskMetrics;
}

export interface DailyRiskBriefing {
  summary: {
    date: string;
    generated_at: string;
    rules_version: string;
    overall_risk_level: RiskLevel;
    highest_risk_score: number;
    average_confidence_percent: number;
    lines_assessed: number;
    risk_counts: Record<RiskLevel, number>;
  };
  lines: LineRiskBriefing[];
}

export type WorkspaceTab = "lines" | "issues" | "materials" | "breaks" | "handover";
