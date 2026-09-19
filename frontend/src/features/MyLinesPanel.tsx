import { useMemo } from "react";

import { AppIcon } from "../AppIcon";
import { EmptyState } from "../components";
import type {
  Assignment,
  DowntimeEvent,
  LineUpdate,
  RagStatus,
  ShiftRecord,
  WorkspaceData,
} from "../types";

type LineView = {
  assignment: Assignment;
  shift?: ShiftRecord;
  update?: LineUpdate;
  events: DowntimeEvent[];
  product: string;
  status: RagStatus;
  planned: number;
  actual: number;
  progress: number;
  downtime: number;
};

function lineLabel(code: string, fallbackIndex: number): string {
  const lineNumber = code.match(/(\d+)$/)?.[1];
  return `Line ${lineNumber ? Number(lineNumber) : fallbackIndex + 1}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatClock(value: string | null | undefined): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function latestUpdate(data: WorkspaceData, assignmentId: number): LineUpdate | undefined {
  return data.updates
    .filter((item) => item.assignment === assignmentId)
    .sort(
      (left, right) =>
        new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime(),
    )[0];
}

function buildLineViews(data: WorkspaceData): LineView[] {
  const statusWeight: Record<RagStatus, number> = { green: 0, amber: 1, red: 2 };

  return data.assignments
    .slice(0, 3)
    .map((assignment) => {
      const update = latestUpdate(data, assignment.id);
      const shift = data.shifts.find(
        (item) =>
          item.production_line === assignment.production_line &&
          item.date === assignment.date &&
          item.shift_type === assignment.shift_type,
      );
      const events = data.downtimeEvents.filter(
        (event) => event.production_line === assignment.production_line,
      );
      const firstProductionBlock = data.planBlocks
        .filter(
          (block) =>
            block.assignment === assignment.id && block.block_type === "production",
        )
        .sort((left, right) => left.sequence_number - right.sequence_number)[0];
      const planned =
        shift?.planned_output ??
        data.planBlocks
          .filter(
            (block) =>
              block.assignment === assignment.id && block.block_type === "production",
          )
          .reduce((total, block) => total + block.planned_units, 0);
      const actual = shift?.actual_output ?? 0;
      const downtimeFromEvents = events.reduce(
        (total, event) => total + event.duration_minutes,
        0,
      );

      return {
        assignment,
        shift,
        update,
        events,
        product:
          update?.current_product ||
          firstProductionBlock?.product_name ||
          assignment.production_line_name ||
          "Plan not published",
        status: update?.status ?? "amber",
        planned,
        actual,
        progress: planned ? Math.round((actual / planned) * 100) : 0,
        downtime: downtimeFromEvents || shift?.downtime_minutes || 0,
      };
    })
    .sort(
      (left, right) =>
        statusWeight[right.status] - statusWeight[left.status] ||
        right.downtime - left.downtime ||
        right.assignment.production_line_code.localeCompare(
          left.assignment.production_line_code,
        ),
    );
}

function statusCopy(status: RagStatus): {
  title: string;
  detail: string;
  symbol: string;
} {
  if (status === "red") {
    return {
      title: "STOPPED",
      detail: "Line halted — investigation in progress",
      symbol: "−",
    };
  }
  if (status === "amber") {
    return {
      title: "Running with issues",
      detail: "Close monitoring required",
      symbol: "!",
    };
  }
  return {
    title: "Running to plan",
    detail: "Performance on track",
    symbol: "✓",
  };
}

function ownerCopy(line: LineView): string {
  return line.update?.support_required.trim() || "Line team";
}

function supportLabel(line: LineView): string {
  if (line.status === "green") return "Owner";
  if (line.status === "red") return "Support required";
  return "Owner / Support";
}

function controlCopy(line: LineView): string {
  if (line.status === "green") return "Running to plan";
  return line.update?.action_taken.trim() || "Control action required";
}

function issueLabel(line: LineView): string {
  return line.status === "green" ? "Status" : "Issue";
}

function issueCopy(line: LineView): string {
  if (line.status === "green") return "Running to plan";
  return line.update?.issue_summary.trim() || "Issue under review";
}

function snapshotTime(lines: LineView[]): number {
  const recordedTimes = lines
    .map((line) => line.update?.recorded_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return recordedTimes.length ? Math.max(...recordedTimes) : Date.now();
}

function dueCopy(line: LineView, referenceTime: number): string {
  const due = line.update?.next_update_due_at;
  if (!due) return "Not set";

  const dueTime = new Date(due).getTime();
  const minutes = Math.ceil((dueTime - referenceTime) / 60_000);
  if (minutes <= 0) return "Due now";
  if (minutes <= 15) return `Due in ${minutes} min`;
  return formatClock(due);
}

function isDueSoon(line: LineView, referenceTime: number): boolean {
  const due = line.update?.next_update_due_at;
  if (!due) return false;
  return new Date(due).getTime() <= referenceTime + 15 * 60_000;
}

function contactCopy(line: LineView): string {
  const owner = ownerCopy(line);
  const normalized = owner.toLowerCase();

  if (normalized.includes("qa")) return "QA · Line contact";
  if (normalized.includes("engineering")) return "Engineering · Line contact";
  if (normalized.includes("materials")) return "Materials · Line contact";
  if (normalized.includes("operations")) return "Operations · Line contact";
  return `${owner} · Line contact`;
}

function priorityCopy(line: LineView, index: number): string {
  const label = lineLabel(line.assignment.production_line_code, index);

  if (line.status === "red") {
    const issue = line.update?.issue_summary.toLowerCase() ?? "";
    if (issue.includes("quality")) return `${label} quality control first`;
    if (issue.includes("safety")) return `${label} safety control first`;
    return `${label} immediate control first`;
  }

  if (line.status === "amber") {
    const due = line.update?.next_update_due_at;
    return `${label} ${ownerCopy(line)} update${due ? ` due ${formatClock(due)}` : ""}`;
  }

  return `${label} continue normal checks`;
}

export function MyLinesPanel({
  data,
  onRaiseIssue,
}: {
  data: WorkspaceData;
  onRaiseIssue: (assignmentId: number, mode: "update" | "escalation") => void;
}) {
  const lines = useMemo(() => buildLineViews(data), [data]);
  const referenceTime = useMemo(() => snapshotTime(lines), [lines]);
  const counts = useMemo(
    () => ({
      green: lines.filter((line) => line.status === "green").length,
      amber: lines.filter((line) => line.status === "amber").length,
      red: lines.filter((line) => line.status === "red").length,
      due: lines.filter((line) => isDueSoon(line, referenceTime)).length,
    }),
    [lines, referenceTime],
  );
  const priorityLine = lines[0];

  return (
    <section className="team-lines-v2">
      <header className="team-lines-v2__header">
        <div>
          <h1>My Lines</h1>
          <p>Current position, ownership and next update</p>
        </div>
        {priorityLine ? (
          <div className="team-lines-v2__header-actions">
            <button
              type="button"
              className="team-line-primary-action"
              onClick={() => onRaiseIssue(priorityLine.assignment.id, "update")}
            >
              <AppIcon name="edit" size={21} />
              Update line
            </button>
            <button
              type="button"
              className="team-line-danger-action"
              onClick={() => onRaiseIssue(priorityLine.assignment.id, "escalation")}
            >
              <AppIcon name="warning" size={21} />
              Raise issue
            </button>
          </div>
        ) : null}
      </header>

      {data.assignments.length > 3 ? (
        <div className="scope-warning" role="alert">
          This Team Leader has {data.assignments.length} assignments. The control board
          supports up to three active lines; ask Operations to review today&apos;s allocation.
        </div>
      ) : null}

      {lines.length === 0 ? (
        <EmptyState
          title="No lines assigned for today"
          body="Ask an authorised manager to create the date- and shift-specific assignment."
        />
      ) : (
        <>
          <div className="team-lines-v2__summary" aria-label="Assigned-line summary">
            <article>
              <AppIcon name="users" size={23} />
              <strong>{lines.length}</strong>
              <span>assigned</span>
            </article>
            <article className="is-green">
              <span className="team-summary-dot" aria-hidden="true" />
              <strong>{counts.green}</strong>
              <span>Green</span>
            </article>
            <article className="is-amber">
              <span className="team-summary-dot" aria-hidden="true" />
              <strong>{counts.amber}</strong>
              <span>Amber</span>
            </article>
            <article className="is-red">
              <span className="team-summary-dot" aria-hidden="true" />
              <strong>{counts.red}</strong>
              <span>Red</span>
            </article>
            <article>
              <AppIcon name="clock" size={23} />
              <strong>{counts.due}</strong>
              <span>updates due</span>
            </article>
          </div>

          <div className="team-lines-v2__cards">
            {lines.map((line, index) => {
              const status = statusCopy(line.status);
              const due = dueCopy(line, referenceTime);
              return (
                <article
                  className={`team-control-card team-control-card--${line.status}`}
                  key={line.assignment.id}
                >
                  <header className="team-control-card__header">
                    <div>
                      <h2>{lineLabel(line.assignment.production_line_code, index)}</h2>
                      <strong>{line.product}</strong>
                    </div>
                    <span className={`team-rag-badge team-rag-badge--${line.status}`}>
                      <span aria-hidden="true">{status.symbol}</span>
                      {line.status.toUpperCase()}
                    </span>
                  </header>

                  <div className={`team-control-state team-control-state--${line.status}`}>
                    <span aria-hidden="true">{status.symbol}</span>
                    <div>
                      <strong>{status.title}</strong>
                      <small>{status.detail}</small>
                    </div>
                  </div>

                  <div className="team-control-output">
                    <div>
                      <span>Output (packs)</span>
                      <strong>
                        {formatNumber(line.actual)} <b>/ {formatNumber(line.planned)}</b>
                      </strong>
                    </div>
                    <div className="team-control-progress" aria-label={`${line.progress}% complete`}>
                      <span
                        className={`team-control-progress__fill team-control-progress__fill--${line.status}`}
                        style={{ width: `${Math.min(100, Math.max(0, line.progress))}%` }}
                      />
                    </div>
                    <small>{line.progress}% complete</small>
                  </div>

                  <dl className="team-control-details">
                    <div>
                      <dt><AppIcon name="clock" size={18} />Downtime</dt>
                      <dd className={`team-control-value team-control-value--${line.status}`}>
                        {line.downtime} min
                      </dd>
                    </div>
                    <div>
                      <dt><AppIcon name={line.status === "green" ? "chart" : "warning"} size={18} />{issueLabel(line)}</dt>
                      <dd>{issueCopy(line)}</dd>
                    </div>
                    <div>
                      <dt><AppIcon name="settings" size={18} />Immediate control</dt>
                      <dd>{controlCopy(line)}</dd>
                    </div>
                    <div>
                      <dt><AppIcon name="users" size={18} />{supportLabel(line)}</dt>
                      <dd>{ownerCopy(line)}</dd>
                    </div>
                    <div>
                      <dt><AppIcon name="clock" size={18} />Next update</dt>
                      <dd className={isDueSoon(line, referenceTime) ? `team-control-value team-control-value--${line.status}` : ""}>
                        {due}
                      </dd>
                    </div>
                    <div>
                      <dt><span className="team-contact-icon" aria-hidden="true">⌕</span>Contact</dt>
                      <dd>{contactCopy(line)}</dd>
                    </div>
                  </dl>

                  <footer className="team-control-card__actions">
                    <button
                      type="button"
                      className="team-line-primary-action"
                      onClick={() => onRaiseIssue(line.assignment.id, "update")}
                    >
                      <AppIcon name="edit" size={20} />
                      Update line
                    </button>
                    <button
                      type="button"
                      className="team-line-outline-danger"
                      onClick={() => onRaiseIssue(line.assignment.id, "escalation")}
                    >
                      <AppIcon name="warning" size={20} />
                      Raise issue
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>

          <div className="team-lines-v2__priority" role="status">
            <span className="team-priority-warning" aria-hidden="true">!</span>
            <strong>Priority:</strong>
            <p>
              {lines
                .map((line, index) => priorityCopy(line, index))
                .join(" · ")}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
