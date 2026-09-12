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

export interface ProductionLine {
  id: number;
  code: string;
  name: string;
  location: string;
  target_units_per_hour: number;
  status: "active" | "inactive" | "maintenance";
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

export interface DailyPlanBlock {
  id: number;
  assignment: number;
  assignment_date: string;
  production_line: number;
  production_line_code: string;
  sequence_number: number;
  block_type: "production" | "break";
  planned_start_at: string;
  planned_end_at: string;
  product_code: string;
  product_name: string;
  target_units_per_hour: number | null;
  planned_units: number;
  break_number: number | null;
}

export type BreakOpportunityStatus =
  | "suggested"
  | "confirmed"
  | "returned"
  | "checks_complete"
  | "recovered"
  | "declined";

export interface BreakOpportunity {
  id: number;
  assignment: number;
  production_line: number;
  production_line_code: string;
  break_block: number;
  break_number: number;
  source_update: number;
  issue_summary: string;
  status: BreakOpportunityStatus;
  fault_at: string;
  suggested_start_at: string;
  expected_return_at: string;
  confirmed_at: string | null;
  returned_at: string | null;
  checks_completed_at: string | null;
  run_resumed_at: string | null;
  recovery_notes: string;
  declined_at: string | null;
  decline_reason: string;
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

export interface DowntimeEvent {
  id: number;
  shift: number;
  production_line: number;
  production_line_code: string;
  shift_date: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  reason_category: "equipment" | "material" | "quality" | "staffing" | "changeover" | "other";
  description: string;
  owner_group: "operations" | "engineering" | "qa" | "machine_minder";
  status: "open" | "resolved";
  resolution_note: string;
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
  planBlocks: DailyPlanBlock[];
  breakOpportunities: BreakOpportunity[];
  breaks: BreakRecovery[];
  handovers: ShiftHandover[];
  users: UserChoice[];
  shifts: ShiftRecord[];
  downtimeEvents: DowntimeEvent[];
}

export interface ManagerWorkspaceData {
  assignments: Assignment[];
  updates: LineUpdate[];
  materials: MaterialReadiness[];
  escalations: Escalation[];
  shifts: ShiftRecord[];
  downtimeEvents: DowntimeEvent[];
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

export interface NotificationInbox {
  unread_count: number;
  results: OperationalEvent[];
}

export interface PilotWorkerStatus {
  status: "healthy" | "attention" | "not_started";
  last_started_at: string | null;
  last_completed_at: string | null;
  last_error: string;
  published_count: number;
}

export interface PilotStatus {
  status: "ready" | "attention";
  generated_at: string;
  active_users: number;
  support_users: number;
  events_last_hour: number;
  latest_event_at: string | null;
  unread_notifications: number;
  open_actions: number;
  overdue_actions: number;
  unassigned_actions: number;
  reminder_worker: PilotWorkerStatus;
}

export type PilotTrialStatus = "planned" | "active" | "completed" | "stopped";

export interface PilotTrial {
  id: number;
  name: string;
  objective: string;
  start_date: string;
  end_date: string;
  status: PilotTrialStatus;
  selected_lines: ProductionLine[];
  created_by: number;
  created_by_username: string;
  started_at: string | null;
  started_by: number | null;
  started_by_username: string | null;
  decided_at: string | null;
  decided_by: number | null;
  decided_by_username: string | null;
  decision_note: string;
}

export interface PilotObservation {
  id: number;
  trial: number;
  production_line: number;
  production_line_code: string;
  observed_on: string;
  shift_type: "day" | "night";
  line_status: RagStatus;
  update_duration_seconds: number;
  escalation_ack_seconds: number | null;
  missed_actions: number;
  status_was_accurate: boolean;
  used_paper_fallback: boolean;
  notes: string;
  observed_by: number;
  observed_by_username: string;
}

export interface PilotEvidence {
  trial: PilotTrial;
  summary: {
    observation_count: number;
    average_update_duration_seconds: number | null;
    average_escalation_ack_seconds: number | null;
    missed_actions: number;
    accurate_updates: number;
    paper_fallback_count: number;
  };
  review: PilotReviewSummary;
  approvals: PilotApproval[];
  feedback: PilotFeedback[];
  observations: PilotObservation[];
}

export type PilotReviewerRole =
  | "operations"
  | "quality_safety"
  | "engineering_it"
  | "product_owner";
export type PilotApprovalDecision = "pending" | "approved" | "changes_requested";

export interface PilotApproval {
  id: number;
  trial: number;
  reviewer_role: PilotReviewerRole;
  decision: PilotApprovalDecision;
  note: string;
  decided_by: number | null;
  decided_by_username: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PilotFeedbackCategory = "usability" | "workflow" | "safety_quality" | "technical";
export type PilotFeedbackSentiment = "positive" | "neutral" | "concern";

export interface PilotFeedback {
  id: number;
  trial: number;
  reviewer_role: PilotReviewerRole;
  category: PilotFeedbackCategory;
  sentiment: PilotFeedbackSentiment;
  notes: string;
  created_by: number;
  created_by_username: string;
  created_at: string;
  updated_at: string;
}

export interface PilotReviewSummary {
  required_approvals: number;
  approved_approvals: number;
  pending_approvals: number;
  changes_requested: number;
  feedback_count: number;
  ready_for_start: boolean;
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

export type WorkspaceTab = "lines" | "issues" | "plan" | "materials" | "breaks" | "handover";
