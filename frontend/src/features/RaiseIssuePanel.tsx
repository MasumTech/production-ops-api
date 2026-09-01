import { useEffect, useState } from "react";

import { OfflineQueuedError, postJson } from "../api";
import {
  AssignmentSelect,
  ErrorBanner,
  PageIntro,
  SubmitButton,
  UserSelect,
} from "../components";
import { toIso } from "../format";
import type { Assignment, Escalation, LineUpdate, UserChoice } from "../types";

function futureLocal(minutes: number): string {
  const value = new Date(Date.now() + minutes * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

export function RaiseIssuePanel({
  assignments,
  users,
  selectedAssignment,
  onSaved,
}: {
  assignments: Assignment[];
  users: UserChoice[];
  selectedAssignment: number | null;
  onSaved: (message: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"update" | "escalation">("update");
  const [assignment, setAssignment] = useState(selectedAssignment?.toString() ?? "");
  const [status, setStatus] = useState("green");
  const [currentProduct, setCurrentProduct] = useState("");
  const [issueSummary, setIssueSummary] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [supportRequired, setSupportRequired] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [nextUpdate, setNextUpdate] = useState(futureLocal(60));

  const [category, setCategory] = useState("equipment");
  const [priority, setPriority] = useState("medium");
  const [escalationSummary, setEscalationSummary] = useState("");
  const [details, setDetails] = useState("");
  const [immediateAction, setImmediateAction] = useState("");
  const [responseOwner, setResponseOwner] = useState("");
  const [responseDue, setResponseDue] = useState(futureLocal(60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedAssignment) setAssignment(String(selectedAssignment));
  }, [selectedAssignment]);

  useEffect(() => {
    if (status === "red") setFollowUp(true);
  }, [status]);

  const saveUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson<LineUpdate>("/hourly-line-updates/", {
        assignment: Number(assignment),
        status,
        current_product: currentProduct.trim(),
        issue_summary: issueSummary.trim(),
        action_taken: actionTaken.trim(),
        action_owner: actionOwner ? Number(actionOwner) : null,
        support_required: supportRequired.trim(),
        requires_follow_up: followUp,
        next_update_due_at: toIso(nextUpdate),
      });
      await onSaved("Line status recorded.");
      setIssueSummary("");
      setActionTaken("");
      setSupportRequired("");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        setIssueSummary("");
        setActionTaken("");
        setSupportRequired("");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not save the line update.");
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEscalation = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson<Escalation>("/operational-escalations/", {
        assignment: Number(assignment),
        category,
        priority,
        summary: escalationSummary.trim(),
        details: details.trim(),
        immediate_action: immediateAction.trim(),
        owner: responseOwner ? Number(responseOwner) : null,
        response_due_at: toIso(responseDue),
      });
      await onSaved("Escalation raised and added to the attention queue.");
      setEscalationSummary("");
      setDetails("");
      setImmediateAction("");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        setEscalationSummary("");
        setDetails("");
        setImmediateAction("");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not raise the escalation.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <PageIntro
        eyebrow="Fast capture"
        title="Update line or raise issue"
        body="Record the RAG position first. Use escalation when a blocker needs a named response owner and deadline."
      />
      <div className="segmented-control" aria-label="Issue workflow">
        <button
          className={mode === "update" ? "is-active" : ""}
          onClick={() => setMode("update")}
        >
          Line update
        </button>
        <button
          className={mode === "escalation" ? "is-active" : ""}
          onClick={() => setMode("escalation")}
        >
          Escalation
        </button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {mode === "update" ? (
        <form className="form-card form-grid" onSubmit={saveUpdate}>
          <label className="span-2">
            Assigned line
            <AssignmentSelect
              assignments={assignments}
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
              required
            />
          </label>
          <label>
            RAG status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="red">Red</option>
            </select>
          </label>
          <label>
            Current product
            <input value={currentProduct} onChange={(event) => setCurrentProduct(event.target.value)} />
          </label>
          <label className="span-2">
            Issue summary {status !== "green" ? "(required)" : ""}
            <input
              value={issueSummary}
              onChange={(event) => setIssueSummary(event.target.value)}
              required={status !== "green"}
              maxLength={255}
            />
          </label>
          <label className="span-2">
            Action taken
            <textarea value={actionTaken} onChange={(event) => setActionTaken(event.target.value)} rows={3} />
          </label>
          <label>
            Action owner
            <UserSelect users={users} value={actionOwner} onChange={(event) => setActionOwner(event.target.value)} />
          </label>
          <label>
            Next update due
            <input
              type="datetime-local"
              value={nextUpdate}
              onChange={(event) => setNextUpdate(event.target.value)}
              required
            />
          </label>
          <label className="span-2">
            Support required
            <input value={supportRequired} onChange={(event) => setSupportRequired(event.target.value)} />
          </label>
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(event) => setFollowUp(event.target.checked)}
              disabled={status === "red"}
            />
            Requires follow-up {status === "red" ? "(mandatory for Red)" : ""}
          </label>
          <div className="form-actions span-2">
            <SubmitButton busy={busy}>Record line update</SubmitButton>
          </div>
        </form>
      ) : (
        <form className="form-card form-grid" onSubmit={saveEscalation}>
          <label className="span-2">
            Assigned line
            <AssignmentSelect
              assignments={assignments}
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
              required
            />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="equipment">Equipment</option>
              <option value="material">Material</option>
              <option value="quality">Quality</option>
              <option value="staffing">Staffing</option>
              <option value="safety">Safety</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="span-2">
            Summary
            <input
              value={escalationSummary}
              onChange={(event) => setEscalationSummary(event.target.value)}
              required
              maxLength={255}
            />
          </label>
          <label className="span-2">
            Detail
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={3} />
          </label>
          <label className="span-2">
            Immediate action {priority === "critical" ? "(required)" : ""}
            <textarea
              value={immediateAction}
              onChange={(event) => setImmediateAction(event.target.value)}
              required={priority === "critical"}
              rows={3}
            />
          </label>
          <label>
            Response owner {priority === "high" || priority === "critical" ? "(required)" : ""}
            <UserSelect
              users={users}
              value={responseOwner}
              onChange={(event) => setResponseOwner(event.target.value)}
              required={priority === "high" || priority === "critical"}
            />
          </label>
          <label>
            Response due
            <input
              type="datetime-local"
              value={responseDue}
              onChange={(event) => setResponseDue(event.target.value)}
              required
            />
          </label>
          <div className="form-actions span-2">
            <SubmitButton busy={busy}>Raise escalation</SubmitButton>
          </div>
        </form>
      )}
    </section>
  );
}
