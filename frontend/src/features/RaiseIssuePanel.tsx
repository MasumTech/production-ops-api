import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  OfflineQueuedError,
  postForm,
  postJson,
} from "../api";
import { AppIcon } from "../AppIcon";
import { ErrorBanner } from "../components";
import type {
  Assignment,
  Escalation,
  LineUpdate,
  RagStatus,
} from "../types";

type IssueMode = "update" | "escalation";
type IssueStep = 1 | 2 | 3;

type IssueCaptureResponse = {
  line_update: LineUpdate;
  escalation: Escalation | null;
  evidence: {
    id: number;
    original_name: string;
    content_type: string;
    size_bytes: number;
  } | null;
};

type IssueDraft = {
  assignment: string;
  status: RagStatus;
  category: string;
  shortProblem: string;
  immediateControl: string;
  supportRequired: string;
  actionOwnerRole: string;
  nextUpdateMinutes: number;
};

const SUPPORT_ROLES = [
  ["engineering", "Engineering"],
  ["qa", "QA"],
  ["operations", "Operations"],
  ["materials", "Materials"],
  ["machine_minder", "Machine Minder"],
  ["operative", "Operative"],
] as const;

const CATEGORY_OPTIONS = [
  ["equipment", "Machine / seal"],
  ["material", "Materials"],
  ["quality", "Quality"],
  ["staffing", "Staffing"],
  ["safety", "Safety"],
  ["other", "Other"],
] as const;

const NEXT_UPDATE_OPTIONS = [10, 20, 30, 60] as const;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

function draftKey(assignment: string): string {
  return `team-leader-issue-draft:${assignment || "unassigned"}`;
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function lineNumber(code: string): string {
  const match = code.match(/(\d+)$/);
  return match ? String(Number(match[1])) : code;
}

function safeParseDraft(value: string | null): IssueDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<IssueDraft>;
    if (
      typeof parsed.assignment === "string" &&
      typeof parsed.status === "string" &&
      typeof parsed.category === "string" &&
      typeof parsed.shortProblem === "string" &&
      typeof parsed.immediateControl === "string" &&
      typeof parsed.supportRequired === "string" &&
      typeof parsed.actionOwnerRole === "string" &&
      typeof parsed.nextUpdateMinutes === "number"
    ) {
      return parsed as IssueDraft;
    }
  } catch {
    return null;
  }
  return null;
}

export function RaiseIssuePanel({
  assignments,
  updates,
  selectedAssignment,
  initialMode = "update",
  initialEscalation,
  online,
  onSaved,
  onCancel,
}: {
  assignments: Assignment[];
  updates: LineUpdate[];
  selectedAssignment: number | null;
  initialMode?: IssueMode;
  initialEscalation?: {
    category: string;
    summary: string;
    details: string;
  } | null;
  online: boolean;
  onSaved: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [assignment, setAssignment] = useState(
    selectedAssignment?.toString() ?? assignments[0]?.id.toString() ?? "",
  );
  const [status, setStatus] = useState<RagStatus>(
    initialMode === "escalation" ? "amber" : "green",
  );
  const [category, setCategory] = useState("equipment");
  const [shortProblem, setShortProblem] = useState("");
  const [immediateControl, setImmediateControl] = useState("");
  const [supportRequired, setSupportRequired] = useState("engineering");
  const [actionOwnerRole, setActionOwnerRole] = useState("engineering");
  const [nextUpdateMinutes, setNextUpdateMinutes] = useState(10);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [raisedAt, setRaisedAt] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<IssueStep>(1);
  const [highestStep, setHighestStep] = useState<IssueStep>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = assignments.find((item) => String(item.id) === assignment);
  const latestUpdate = useMemo(
    () =>
      updates
        .filter((item) => String(item.assignment) === assignment)
        .sort(
          (left, right) =>
            new Date(right.recorded_at).getTime() -
            new Date(left.recorded_at).getTime(),
        )[0],
    [assignment, updates],
  );
  const currentProduct = latestUpdate?.current_product ?? "";
  const pageTitle = initialMode === "escalation" ? "Raise issue" : "Update line";
  const pageSubtitle =
    initialMode === "escalation"
      ? "Record a short structured update after the approved urgent escalation"
      : "Record the current line position, ownership and next update";

  useEffect(() => {
    const nextAssignment =
      selectedAssignment?.toString() ?? assignments[0]?.id.toString() ?? "";
    setAssignment(nextAssignment);
    setStatus(initialMode === "escalation" ? "amber" : "green");
    setRaisedAt(new Date());
    setEvidence(null);
    setStep(1);
    setHighestStep(1);

    if (initialMode === "escalation" && initialEscalation) {
      setCategory(initialEscalation.category || "other");
      setShortProblem(initialEscalation.summary);
      setImmediateControl(initialEscalation.details);
      return;
    }

    const draft = safeParseDraft(localStorage.getItem(draftKey(nextAssignment)));
    if (draft) {
      setStatus(draft.status);
      setCategory(draft.category);
      setShortProblem(draft.shortProblem);
      setImmediateControl(draft.immediateControl);
      setSupportRequired(draft.supportRequired);
      setActionOwnerRole(draft.actionOwnerRole);
      setNextUpdateMinutes(draft.nextUpdateMinutes);
    } else {
      setCategory("equipment");
      setShortProblem("");
      setImmediateControl("");
      setSupportRequired("engineering");
      setActionOwnerRole("engineering");
      setNextUpdateMinutes(10);
    }
  }, [assignments, initialEscalation, initialMode, selectedAssignment]);

  useEffect(() => {
    if (status === "red" && actionOwnerRole === "operative") {
      setActionOwnerRole("operations");
    }
  }, [actionOwnerRole, status]);

  const nextUpdateLabel = (minutes: number) => {
    const value = new Date(raisedAt.getTime() + minutes * 60_000);
    return `${minutes} minutes · ${formatTime(value)}`;
  };

  const selectAssignment = (nextAssignment: string) => {
    setAssignment(nextAssignment);
    setRaisedAt(new Date());
    setEvidence(null);
    setError("");
    setStep(1);
    setHighestStep(1);
    if (fileInputRef.current) fileInputRef.current.value = "";

    const draft = safeParseDraft(
      localStorage.getItem(draftKey(nextAssignment)),
    );
    if (draft) {
      setStatus(draft.status);
      setCategory(draft.category);
      setShortProblem(draft.shortProblem);
      setImmediateControl(draft.immediateControl);
      setSupportRequired(draft.supportRequired);
      setActionOwnerRole(draft.actionOwnerRole);
      setNextUpdateMinutes(draft.nextUpdateMinutes);
      return;
    }

    setStatus(initialMode === "escalation" ? "amber" : "green");
    setCategory("equipment");
    setShortProblem("");
    setImmediateControl("");
    setSupportRequired("engineering");
    setActionOwnerRole("engineering");
    setNextUpdateMinutes(10);
  };

  const describeIsValid = () => {
    if (!assignment) {
      setError("Select an assigned line.");
      return false;
    }
    if (!shortProblem.trim() && status !== "green") {
      setError("Add a short problem for Amber or Red status.");
      return false;
    }
    if (status === "red" && !immediateControl.trim()) {
      setError("Record the immediate control before continuing a Red issue.");
      return false;
    }
    return true;
  };

  const goToStep = (target: IssueStep) => {
    setError("");
    if (target > step && step === 1 && !describeIsValid()) return;
    setStep(target);
    if (target > highestStep) setHighestStep(target);
  };

  const nextStep = () => {
    if (step === 1) goToStep(2);
    if (step === 2) goToStep(3);
  };

  const saveDraft = async () => {
    setError("");
    const draft: IssueDraft = {
      assignment,
      status,
      category,
      shortProblem,
      immediateControl,
      supportRequired,
      actionOwnerRole,
      nextUpdateMinutes,
    };
    localStorage.setItem(draftKey(assignment), JSON.stringify(draft));
    await onSaved("Issue draft saved on this device.");
  };

  const selectEvidence = (file: File | null) => {
    setError("");
    if (!file) {
      setEvidence(null);
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setError("Evidence must be 5 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setEvidence(file);
  };

  const submit = async (escalate: boolean) => {
    setError("");

    if (!assignment) {
      setError("Select an assigned line.");
      return;
    }
    if (!shortProblem.trim() && status !== "green") {
      setError("Add a short problem for Amber or Red status.");
      return;
    }
    if (status === "red" && !immediateControl.trim()) {
      setError("Record the immediate control before saving a Red issue.");
      return;
    }
    if (escalate && status === "green") {
      setError("Change the status to Amber or Red before escalating.");
      return;
    }

    const payload = {
      assignment: Number(assignment),
      status,
      category,
      current_product: currentProduct,
      short_problem: shortProblem.trim() || "Routine line update",
      immediate_control: immediateControl.trim(),
      support_required: supportRequired,
      action_owner_role: actionOwnerRole,
      next_update_minutes: nextUpdateMinutes,
      escalate,
    };

    setBusy(true);
    try {
      let result: IssueCaptureResponse;
      if (evidence) {
        const form = new FormData();
        Object.entries(payload).forEach(([key, value]) =>
          form.append(key, String(value)),
        );
        form.append("evidence", evidence);
        result = await postForm<IssueCaptureResponse>("/issue-captures/", form);
      } else {
        result = await postJson<IssueCaptureResponse>(
          "/issue-captures/",
          payload,
        );
      }

      localStorage.removeItem(draftKey(assignment));
      setEvidence(null);
      setShortProblem("");
      setImmediateControl("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      await onSaved(
        result.escalation
          ? "Issue recorded and escalated to the attention queue."
          : initialMode === "update"
            ? "Line update recorded."
            : "Support request recorded.",
      );
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        localStorage.removeItem(draftKey(assignment));
        await onSaved(caught.message);
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not record this issue.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="raise-issue-v2">
      <header className="raise-issue-v2__header">
        <div>
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
        </div>
        <span className="raise-issue-v2__connection">
          <i className={online ? "is-online" : ""} aria-hidden="true" />
          {online ? "Online" : "Offline"}
        </span>
      </header>

      <div className="raise-issue-v2__card">
        <div className="issue-stepper" aria-label="Issue capture progress">
          <button
            type="button"
            className={`issue-stepper__item ${step === 1 ? "is-active" : "is-complete"}`}
            aria-label="Step 1: Describe"
            aria-current={step === 1 ? "step" : undefined}
            onClick={() => goToStep(1)}
          >
            <span>1</span>
            <strong>Describe</strong>
          </button>
          <i aria-hidden="true" />
          <button
            type="button"
            className={`issue-stepper__item ${step === 2 ? "is-active" : highestStep > 2 ? "is-complete" : ""}`}
            aria-label="Step 2: Support"
            aria-current={step === 2 ? "step" : undefined}
            disabled={highestStep < 2}
            onClick={() => goToStep(2)}
          >
            <span>2</span>
            <strong>Support</strong>
          </button>
          <i aria-hidden="true" />
          <button
            type="button"
            className={`issue-stepper__item ${step === 3 ? "is-active" : ""}`}
            aria-label="Step 3: Follow-up"
            aria-current={step === 3 ? "step" : undefined}
            disabled={highestStep < 3}
            onClick={() => goToStep(3)}
          >
            <span>3</span>
            <strong>Follow-up</strong>
          </button>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        <form
          className="raise-issue-v2__form"
          onSubmit={(event) => event.preventDefault()}
        >
          {step === 1 ? (
            <div className="issue-form-step issue-form-step--describe">
              <label>
                <span>Line</span>
                <select
                  aria-label="Line"
                  value={assignment}
                  onChange={(event) => selectAssignment(event.target.value)}
                  required
                >
                  {assignments.map((item) => {
                    const update = updates
                      .filter((entry) => entry.assignment === item.id)
                      .sort(
                        (left, right) =>
                          new Date(right.recorded_at).getTime() -
                          new Date(left.recorded_at).getTime(),
                      )[0];
                    return (
                      <option value={item.id} key={item.id}>
                        Line {lineNumber(item.production_line_code)}
                        {update?.current_product
                          ? ` · ${update.current_product}`
                          : ` · ${item.production_line_name}`}
                      </option>
                    );
                  })}
                </select>
              </label>

              <fieldset className="issue-status-field">
                <legend>Status</legend>
                <div
                  className="issue-status-selector"
                  role="group"
                  aria-label="Status"
                >
                  {(["green", "amber", "red"] as RagStatus[]).map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={status === value ? `is-active is-${value}` : ""}
                      aria-pressed={status === value}
                      onClick={() => setStatus(value)}
                    >
                      <i className={`is-${value}`} aria-hidden="true" />
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label>
                <span>Category</span>
                <select
                  aria-label="Category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {CATEGORY_OPTIONS.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Time raised</span>
                <span className="issue-time-field">
                  <input
                    aria-label="Time raised"
                    value={formatTime(raisedAt)}
                    readOnly
                  />
                  <AppIcon name="clock" size={19} />
                </span>
              </label>

              <label className="span-2">
                <span>Short problem</span>
                <textarea
                  aria-label="Short problem"
                  value={shortProblem}
                  onChange={(event) => setShortProblem(event.target.value)}
                  rows={2}
                  maxLength={255}
                  placeholder="Describe the issue briefly"
                />
              </label>

              <label className="span-2">
                <span>Immediate control</span>
                <textarea
                  aria-label="Immediate control"
                  value={immediateControl}
                  onChange={(event) => setImmediateControl(event.target.value)}
                  rows={2}
                  placeholder="Record the approved immediate control already taken"
                />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="issue-form-step issue-form-step--support">
              <div className="issue-step-heading span-2">
                <h2>Support and ownership</h2>
                <p>Route the issue to the right team and name the action owner.</p>
              </div>
              <label>
                <span>Support required</span>
                <select
                  aria-label="Support required"
                  value={supportRequired}
                  onChange={(event) => setSupportRequired(event.target.value)}
                >
                  {SUPPORT_ROLES.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Action owner</span>
                <select
                  aria-label="Action owner"
                  value={actionOwnerRole}
                  onChange={(event) => setActionOwnerRole(event.target.value)}
                >
                  {SUPPORT_ROLES.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="issue-evidence-field span-2">
                <span>Evidence / photo</span>
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  aria-label="Evidence file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                  onChange={(event) =>
                    selectEvidence(event.target.files?.[0] ?? null)
                  }
                />
                <button
                  type="button"
                  className={evidence ? "has-file" : ""}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AppIcon name="paperclip" size={20} />
                  {evidence ? evidence.name : "Add evidence"}
                </button>
                {!online ? (
                  <small>Evidence uploads require a connection. Save a draft to keep the issue offline.</small>
                ) : null}
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="issue-form-step issue-form-step--follow-up">
              <div className="issue-step-heading">
                <h2>Follow-up and review</h2>
                <p>Confirm the next update time before recording the issue.</p>
              </div>
              <label>
                <span>Next update</span>
                <select
                  aria-label="Next update"
                  value={nextUpdateMinutes}
                  onChange={(event) =>
                    setNextUpdateMinutes(Number(event.target.value))
                  }
                >
                  {NEXT_UPDATE_OPTIONS.map((minutes) => (
                    <option value={minutes} key={minutes}>
                      {nextUpdateLabel(minutes)}
                    </option>
                  ))}
                </select>
              </label>
              <dl className="issue-review" aria-label="Issue review">
                <div>
                  <dt>Line</dt>
                  <dd>{selected ? `Line ${lineNumber(selected.production_line_code)}` : "—"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd className={`is-${status}`}>{status.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Problem</dt>
                  <dd>{shortProblem.trim() || "Routine line update"}</dd>
                </div>
                <div>
                  <dt>Support</dt>
                  <dd>{SUPPORT_ROLES.find(([value]) => value === supportRequired)?.[1]}</dd>
                </div>
                <div>
                  <dt>Action owner</dt>
                  <dd>{SUPPORT_ROLES.find(([value]) => value === actionOwnerRole)?.[1]}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{evidence?.name ?? "None attached"}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </form>

        <div className="raise-issue-v2__safety" role="note">
          <AppIcon name="warning" size={30} />
          <p>
            Make the situation safe and follow the approved safety, food-safety,
            quality or technical procedure first. This app records visibility and
            ownership; it does not replace the procedure.
          </p>
        </div>

        <footer className="raise-issue-v2__actions">
          <button
            type="button"
            className="issue-action issue-action--cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="issue-action issue-action--outline"
            onClick={() => void saveDraft()}
            disabled={busy}
          >
            Save draft
          </button>
          {step > 1 ? (
            <button
              type="button"
              className="issue-action issue-action--outline"
              onClick={() => goToStep((step - 1) as IssueStep)}
              disabled={busy}
            >
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button
              type="button"
              className="issue-action issue-action--primary"
              onClick={nextStep}
              disabled={busy}
            >
              Continue
            </button>
          ) : (
            <>
              <button
                type="button"
                className="issue-action issue-action--primary"
                onClick={() => void submit(false)}
                disabled={busy}
              >
                {busy
                  ? "Saving…"
                  : initialMode === "update"
                    ? "Save update"
                    : "Request support"}
              </button>
              <button
                type="button"
                className="issue-action issue-action--danger"
                onClick={() => void submit(true)}
                disabled={busy || status === "green"}
              >
                {busy ? "Saving…" : "Save & escalate"}
              </button>
            </>
          )}
        </footer>
      </div>
    </section>
  );
}
