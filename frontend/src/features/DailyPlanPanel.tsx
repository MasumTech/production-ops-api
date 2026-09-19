import { EmptyState, PageIntro } from "../components";
import { getShiftWindow } from "../shiftTiming";
import type { Assignment, DailyPlanBlock, ShiftRecord } from "../types";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatPublishedFor(value: string | null): string {
  if (!value) return "Not published";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function displayLineLabel(code: string): string {
  const match = code.match(/(\d+)$/);
  return match ? `LINE ${Number(match[1])}` : code;
}

function plannedUnits(blocks: DailyPlanBlock[]): number {
  return blocks
    .filter((block) => block.block_type === "production")
    .reduce((total, block) => total + block.planned_units, 0);
}

export function DailyPlanPanel({
  assignments,
  planBlocks,
  shifts = [],
}: {
  assignments: Assignment[];
  planBlocks: DailyPlanBlock[];
  shifts?: ShiftRecord[];
}) {
  const visibleAssignments = assignments.slice(0, 3);
  const operationalDate =
    visibleAssignments[0]?.date ?? new Date().toISOString().slice(0, 10);
  const window = getShiftWindow(operationalDate, shifts, "day");

  return (
    <section className="daily-plan-page">
      <PageIntro
        eyebrow={`${window.startLabel}–${window.endLabel} day shift`}
        title="Daily production plan"
        body="Follow the approved product sequence, hourly rate and two 40-minute break windows for each assigned line."
      />

      {visibleAssignments.length === 0 ? (
        <EmptyState
          title="No assigned lines"
          body="The daily schedule will appear when Operations assigns a line for this date."
        />
      ) : (
        <div className="daily-plan-grid" aria-label="Published daily plan">
          {visibleAssignments.map((assignment) => {
            const blocks = planBlocks
              .filter((block) => block.assignment === assignment.id)
              .sort(
                (left, right) =>
                  left.sequence_number - right.sequence_number,
              );
            const breaks = blocks.filter(
              (block) => block.block_type === "break",
            );

            return (
              <article className="daily-plan-card" key={assignment.id}>
                <header className="daily-plan-card__header">
                  <div>
                    <span className="daily-plan-card__line-label">
                      {displayLineLabel(assignment.production_line_code)}
                    </span>
                    <h3>{assignment.production_line_name}</h3>
                  </div>
                  <div
                    className="daily-plan-card__summary"
                    aria-label={`${plannedUnits(blocks)} planned units`}
                  >
                    <strong>{plannedUnits(blocks)}</strong>
                    <span>planned units</span>
                  </div>
                </header>

                {blocks.length === 0 ? (
                  <EmptyState
                    title="Plan not published"
                    body="Operations has not published this line's time-based plan yet."
                  />
                ) : (
                  <ol
                    className="daily-plan-timeline"
                    aria-label={`${assignment.production_line_code} daily plan`}
                  >
                    {blocks.map((block) => (
                      <li
                        className={`daily-plan-block daily-plan-block--${block.block_type}`}
                        key={block.id}
                      >
                        <time dateTime={block.planned_start_at}>
                          {formatTime(block.planned_start_at)}
                        </time>

                        <div className="daily-plan-block__content">
                          {block.block_type === "break" ? (
                            <>
                              <strong>
                                Break {block.break_number} · 40 minutes
                              </strong>
                              <span>
                                Approved break window · return{" "}
                                {formatTime(block.planned_end_at)}
                              </span>
                            </>
                          ) : (
                            <>
                              <strong>{block.product_name}</strong>
                              <span>
                                {block.product_code} ·{" "}
                                {block.target_units_per_hour}/hour ·{" "}
                                {block.planned_units} units
                              </span>
                            </>
                          )}
                        </div>

                        <span className="daily-plan-block__duration">
                          to {formatTime(block.planned_end_at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                <footer className="daily-plan-card__footer">
                  <span>
                    <strong>{breaks.length}/2</strong> approved breaks
                  </span>
                  <span>
                    Published for{" "}
                    <strong>
                      {formatPublishedFor(
                        blocks[0]?.planned_start_at ?? null,
                      )}
                    </strong>
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <p className="workflow-boundary">
        The plan supports shift decisions. Approved production, food-safety,
        quality and escalation procedures remain authoritative.
      </p>
    </section>
  );
}
