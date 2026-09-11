import { EmptyState, PageIntro } from "../components";
import { formatDateTime } from "../format";
import type { Assignment, DailyPlanBlock } from "../types";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DailyPlanPanel({
  assignments,
  planBlocks,
}: {
  assignments: Assignment[];
  planBlocks: DailyPlanBlock[];
}) {
  const visibleAssignments = assignments.slice(0, 2);

  return (
    <section>
      <PageIntro
        eyebrow="07:00–18:00 day shift"
        title="Daily production plan"
        body="Follow the approved product sequence, hourly rate and two 40-minute break windows for each assigned line."
      />

      {visibleAssignments.length === 0 ? (
        <EmptyState
          title="No assigned lines"
          body="The daily schedule will appear when Operations assigns a line for this date."
        />
      ) : (
        <div className="daily-plan-grid">
          {visibleAssignments.map((assignment) => {
            const blocks = planBlocks
              .filter((block) => block.assignment === assignment.id)
              .sort((left, right) => left.sequence_number - right.sequence_number);
            const plannedUnits = blocks.reduce((total, block) => total + block.planned_units, 0);
            const breaks = blocks.filter((block) => block.block_type === "break");

            return (
              <article className="daily-plan-card" key={assignment.id}>
                <header className="daily-plan-card__header">
                  <div>
                    <span className="eyebrow">{assignment.production_line_code}</span>
                    <h3>{assignment.production_line_name}</h3>
                  </div>
                  <div className="daily-plan-card__summary">
                    <strong>{plannedUnits}</strong>
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
                        <div>
                          {block.block_type === "break" ? (
                            <>
                              <strong>Break {block.break_number} · 40 minutes</strong>
                              <span>Approved window ends {formatTime(block.planned_end_at)}</span>
                            </>
                          ) : (
                            <>
                              <strong>{block.product_name}</strong>
                              <span>
                                {block.product_code} · {block.target_units_per_hour}/hour · {block.planned_units} units
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
                  <span>{breaks.length}/2 approved breaks</span>
                  <span>Published for {formatDateTime(blocks[0]?.planned_start_at ?? null)}</span>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <p className="workflow-boundary">
        The plan supports shift decisions. Approved production, food-safety, quality and escalation procedures remain authoritative.
      </p>
    </section>
  );
}
