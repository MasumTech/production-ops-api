import { EmptyState, PageIntro, StatusPill } from "../components";
import { formatDateTime } from "../format";
import type { WorkspaceData } from "../types";

export function MyLinesPanel({
  data,
  onRaiseIssue,
}: {
  data: WorkspaceData;
  onRaiseIssue: (assignmentId: number) => void;
}) {
  const updateByAssignment = new Map(data.updates.map((update) => [update.assignment, update]));

  return (
    <section>
      <PageIntro
        eyebrow="Shift control"
        title="My Lines"
        body="One view of each assigned line, its latest RAG state, product, next check, and unresolved actions."
      />

      {data.assignments.length === 0 ? (
        <EmptyState
          title="No lines assigned for today"
          body="Ask an authorised manager to create the date- and shift-specific assignment."
        />
      ) : (
        <div className="line-grid">
          {data.assignments.map((assignment) => {
            const update = updateByAssignment.get(assignment.id);
            const escalations = data.escalations.filter(
              (item) => item.assignment === assignment.id && item.status !== "resolved",
            );
            const materialRisks = data.materials.filter(
              (item) =>
                item.assignment === assignment.id && ["short", "held"].includes(item.status),
            );

            return (
              <article className="line-card" key={assignment.id}>
                <div className="line-card__header">
                  <div>
                    <span className="eyebrow">{assignment.shift_type} shift</span>
                    <h3>{assignment.production_line_code}</h3>
                    <p>{assignment.production_line_name}</p>
                  </div>
                  {update ? <StatusPill value={update.status} /> : <StatusPill value="no update" />}
                </div>

                <dl className="metric-list">
                  <div>
                    <dt>Current product</dt>
                    <dd>{update?.current_product || "Not reported"}</dd>
                  </div>
                  <div>
                    <dt>Issue</dt>
                    <dd>{update?.issue_summary || "No active line issue reported"}</dd>
                  </div>
                  <div>
                    <dt>Next update</dt>
                    <dd>{formatDateTime(update?.next_update_due_at ?? null)}</dd>
                  </div>
                </dl>

                <div className="risk-strip">
                  <span className={escalations.length ? "risk-count risk-count--danger" : "risk-count"}>
                    {escalations.length} open actions
                  </span>
                  <span className={materialRisks.length ? "risk-count risk-count--warning" : "risk-count"}>
                    {materialRisks.length} material risks
                  </span>
                </div>

                <button
                  className="button button--primary button--full"
                  onClick={() => onRaiseIssue(assignment.id)}
                >
                  Update line or raise issue
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
