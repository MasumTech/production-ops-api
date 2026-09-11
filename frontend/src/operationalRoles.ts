import type { Escalation } from "./types";

const ESCALATION_ROLE: Record<Escalation["category"], string> = {
  equipment: "Engineering",
  material: "Materials",
  quality: "QA",
  staffing: "Operations",
  safety: "QA & Operations",
  other: "Operations",
};

export function escalationRole(category: Escalation["category"]): string {
  return ESCALATION_ROLE[category];
}

export function lineResponseRole(
  escalation: Escalation | undefined,
  supportRequired: string | undefined,
): string {
  if (escalation) return escalationRole(escalation.category);
  if (supportRequired?.trim()) return supportRequired.trim();
  return "Team Leader";
}
