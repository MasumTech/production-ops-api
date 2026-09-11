import { EmptyState, PageIntro, StatusPill } from "../components";
import { formatDateTime } from "../format";
import { lineResponseRole } from "../operationalRoles";
import type { WorkspaceData } from "../types";

export function MyLinesPanel({
  data,
  onRaiseIssue,
}: {
  data: WorkspaceData;
  onRaiseIssue: (assignmentId: number) => void;
}) {
  const updateByAssignment = new Map(data.updates.map((update) => [update.assignment, update]));
  const focusedAssignments = data.assignments.slice(0, 2);

  return (
    <section>
      <PageIntro
        eyebrow="Shift control"
        title="My Lines"
        body="Your two-line shift view: current product, RAG position, next check, and the team responsible for recovery."
      />

      {data.assignments.length > 2 ? (
        <div className="scope-warning" role="alert">
          This Team Leader has {data.assignments.length} assignments. Only the first two are shown;
          ask Operations to correct today&apos;s line allocation.
        </div>
      ) : null}

      {data.assignments.length === 0 ? (
        <EmptyState
          title="No lines assigned for today"
          body="Ask an authorised manager to create the date- and shift-specific assignment."
        />
      ) : (
        <div className="line-grid">
          {focusedAssignments.map((assignment) => {
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
                    <dt>Responsible team</dt>
                    <dd>{lineResponseRole(escalations[0], update?.support_required)}</dd>
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
                  Update status / raise issue
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
