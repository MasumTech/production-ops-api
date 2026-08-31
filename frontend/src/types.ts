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

export interface WorkspaceData {
  assignments: Assignment[];
  updates: LineUpdate[];
  materials: MaterialReadiness[];
  escalations: Escalation[];
  breaks: BreakRecovery[];
  handovers: ShiftHandover[];
  users: UserChoice[];
}

export type WorkspaceTab = "lines" | "issues" | "materials" | "breaks" | "handover";
