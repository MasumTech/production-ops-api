import type { ReactNode, SelectHTMLAttributes } from "react";

import { titleCase } from "./format";
import type { Assignment, UserChoice } from "./types";

export function StatusPill({ value }: { value: string }): ReactNode {
  const tone = ["green", "ready", "recovered", "accepted", "resolved"].includes(value)
    ? "positive"
    : ["amber", "short", "planned", "coverage_accepted", "acknowledged"].includes(value)
      ? "warning"
      : ["red", "held", "critical", "active", "cancelled"].includes(value)
        ? "danger"
        : "neutral";

  return <span className={`status-pill status-pill--${tone}`}>{titleCase(value)}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }): ReactNode {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }): ReactNode {
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}

export function AssignmentSelect({
  assignments,
  ...props
}: { assignments: Assignment[] } & SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <select {...props}>
      <option value="">Select a line</option>
      {assignments.map((assignment) => (
        <option key={assignment.id} value={assignment.id}>
          {assignment.production_line_code} · {titleCase(assignment.shift_type)} · {assignment.date}
        </option>
      ))}
    </select>
  );
}

export function UserSelect({
  users,
  currentUserId,
  includeBlank = true,
  ...props
}: {
  users: UserChoice[];
  currentUserId?: number;
  includeBlank?: boolean;
} & SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <select {...props}>
      {includeBlank ? <option value="">Not assigned</option> : <option value="">Select a user</option>}
      {users
        .filter((user) => user.id !== currentUserId)
        .map((user) => (
          <option key={user.id} value={user.id}>
            {user.display_name}
          </option>
        ))}
    </select>
  );
}

export function PageIntro({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <header className="page-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action}
    </header>
  );
}

export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <button className="button button--primary" type="submit" disabled={busy}>
      {busy ? "Saving…" : children}
    </button>
  );
}
