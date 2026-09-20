import { useEffect, useMemo, useRef, useState } from "react";

import { apiRequest, OfflineQueuedError, postJson } from "../api";
import { AppIcon } from "../AppIcon";
import { EmptyState, ErrorBanner } from "../components";
import { formatScheduleClock } from "../shiftTiming";
import type {
  Assignment,
  BreakOpportunity,
  Escalation,
  LineUpdate,
  ShiftHandover,
  UserSummary,
} from "../types";

const PRIORITY_ORDER: Record<Escalation["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function lineLabel(code: string): string {
  const match = code.match(/(\d+)$/);
  return match ? "Line " + Number(match[1]) : code;
}

function priorityLabel(value: Escalation["priority"]): string {
  if (value === "critical") return "Critical";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function responsibility(item: Escalation): string {
  return {
    equipment: "Engineering",
    material: "Materials",
    quality: "QA / Operations",
    staffing: "Operations",
    safety: "Operations / QA",
    other: "Operations",
  }[item.category];
}

function incomingAction(item: Escalation): string {
  return {
    equipment: "Monitor first 3 runs",
    material: "Confirm safe ETA",
    quality: "Confirm release position",
    staffing: "Confirm cover plan",
    safety: "Confirm safe controls",
    other: "Confirm current control",
  }[item.category];
}

function localDraftKey(profile: UserSummary, assignments: Assignment[]): string {
  const operationalDate = assignments[0]?.date ?? "unassigned";
  return (
    "team-leader-handover-draft:" +
    profile.username +
    ":" +
    operationalDate
  );
}

function savedClock(value: string | null): string {
  if (!value) return "Not saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not saved";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function HandoversPanel({
  profile,
  assignments,
  handovers,
  escalations,
  updates = [],
  opportunities = [],
  onSaved,
}: {
  profile: UserSummary;
  assignments: Assignment[];
  handovers: ShiftHandover[];
  escalations: Escalation[];
  updates?: LineUpdate[];
  opportunities?: BreakOpportunity[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "handover" | "accept" | null>(
    null,
  );
  const [error, setError] = useState("");
  const openItemsRef = useRef<HTMLDivElement>(null);

  const assignmentIds = useMemo(
    () => new Set(assignments.slice(0, 3).map((item) => item.id)),
    [assignments],
  );

  const openItems = useMemo(
    () =>
      escalations
        .filter(
          (item) =>
            assignmentIds.has(item.assignment) && item.status !== "resolved",
        )
        .sort(
          (left, right) =>
            PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
            new Date(left.raised_at ?? 0).getTime() -
              new Date(right.raised_at ?? 0).getTime(),
        ),
    [assignmentIds, escalations],
  );

  const relevantHandovers = useMemo(
    () =>
      handovers.filter(
        (handover) =>
          assignmentIds.has(handover.outgoing_assignment) ||
          assignmentIds.has(handover.incoming_assignment),
      ),
    [assignmentIds, handovers],
  );

  const pendingHandovers = relevantHandovers.filter(
    (handover) => handover.status === "pending",
  );

  const incomingForCurrentUser = pendingHandovers.filter(
    (handover) =>
      handover.incoming_team_leader_username === profile.username,
  );

  const latestSavedRecord = [...relevantHandovers].sort(
    (left, right) =>
      new Date(right.handed_over_at).getTime() -
      new Date(left.handed_over_at).getTime(),
  )[0];

  const completedItems = useMemo(() => {
    const items: string[] = [];
    const green = updates.find(
      (update) =>
        assignmentIds.has(update.assignment) && update.status === "green",
    );
    if (green) {
      items.push(lineLabel(green.production_line_code) + " status update complete");
    }

    const recovered = opportunities.find(
      (item) =>
        assignmentIds.has(item.assignment) && item.status === "recovered",
    );
    if (recovered) {
      items.push(
        "Break " +
          recovered.break_number +
          " moved under approved decision · full 40 minutes",
      );
      if (recovered.run_resumed_at) {
        items.push(
          "Restart checks completed at " +
            formatScheduleClock(recovered.run_resumed_at),
        );
      }
    }
    return items;
  }, [assignmentIds, opportunities, updates]);

  const everyOpenItemControlled = openItems.every(
    (item) => Boolean(item.owner) && Boolean(item.response_due_at),
  );

  useEffect(() => {
    const key = localDraftKey(profile, assignments);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        note?: string;
        savedAt?: string;
      };
      setNote(parsed.note ?? "");
      setDraftSavedAt(parsed.savedAt ?? null);
    } catch {
      localStorage.removeItem(key);
    }
  }, [assignments, profile]);

  const saveDraft = async () => {
    setBusy("draft");
    setError("");
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(
        localDraftKey(profile, assignments),
        JSON.stringify({ note, savedAt }),
      );
      setDraftSavedAt(savedAt);
      await onSaved("Handover draft saved on this device.");
    } finally {
      setBusy(null);
    }
  };

  const reviewOpenItems = () => {
    openItemsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    openItemsRef.current?.focus();
  };

  const handOver = async () => {
    if (!everyOpenItemControlled) {
      setError("Owner and next update are required for every open item.");
      return;
    }
    if (openItems.length === 0) {
      setError("There are no unresolved items to hand over.");
      return;
    }

    setBusy("handover");
    setError("");

    try {
      let created = 0;
      const outgoingAssignments = assignments
        .slice(0, 3)
        .filter((assignment) =>
          openItems.some((item) => item.assignment === assignment.id),
        );

      for (const outgoing of outgoingAssignments) {
        const existing = handovers.find(
          (handover) =>
            handover.outgoing_assignment === outgoing.id &&
            handover.status !== "accepted",
        );
        if (existing) continue;

        const options = await apiRequest<Assignment[]>(
          "/team-leader-assignments/" +
            outgoing.id +
            "/handover-options/",
        );
        const incoming =
          options.find((option) => option.shift_type === "night") ??
          options[0];

        if (!incoming) {
          throw new Error(
            "No incoming assignment is available for " +
              lineLabel(outgoing.production_line_code) +
              ".",
          );
        }

        const escalationIds = openItems
          .filter((item) => item.assignment === outgoing.id)
          .map((item) => item.id);

        await postJson<ShiftHandover>("/shift-handovers/", {
          outgoing_assignment: outgoing.id,
          incoming_assignment: incoming.id,
          escalation_ids: escalationIds,
          operational_summary:
            escalationIds.length +
            " unresolved item" +
            (escalationIds.length === 1 ? "" : "s") +
            " require incoming review.",
          notes: note.trim(),
        });
        created += 1;
      }

      localStorage.removeItem(localDraftKey(profile, assignments));
      setDraftSavedAt(null);
      await onSaved(
        created
          ? "Shift handover sent. Incoming Team Leader acceptance is required."
          : "Shift handover is already awaiting incoming acceptance.",
      );
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not hand over the shift.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const acceptIncoming = async () => {
    if (incomingForCurrentUser.length === 0) return;
    setBusy("accept");
    setError("");
    try {
      for (const handover of incomingForCurrentUser) {
        await postJson<ShiftHandover>(
          "/shift-handovers/" + handover.id + "/accept/",
        );
      }
      await onSaved("Incoming handover accepted.");
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not accept the handover.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  if (assignments.length === 0) {
    return (
      <section className="handover-v2">
        <EmptyState
          title="No assigned lines"
          body="Shift handover becomes available when you have an active assignment."
        />
      </section>
    );
  }

  const outgoingName = profile.display_name || profile.username;
  const lastSavedAt =
    draftSavedAt ?? latestSavedRecord?.handed_over_at ?? null;

  return (
    <section className="handover-v2">
      <header className="handover-v2__hero">
        <div>
          <h1>Shift Handover</h1>
          <p>Transfer only unresolved work with control, owner and next update</p>
        </div>
        <span className="handover-v2__open-count">
          <i aria-hidden="true">!</i>
          {openItems.length} open item{openItems.length === 1 ? "" : "s"}
        </span>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      <section
        className="handover-v2__transfer"
        aria-label="Shift responsibility transfer"
      >
        <div className="handover-v2__person">
          <span className="handover-v2__person-icon">
            <AppIcon name="users" size={22} />
          </span>
          <strong>Outgoing: Day shift · {outgoingName}</strong>
        </div>
        <span className="handover-v2__arrow" aria-hidden="true">
          →
        </span>
        <div className="handover-v2__person">
          <span className="handover-v2__person-icon">
            <AppIcon name="users" size={22} />
          </span>
          <strong>
            Incoming: Night shift ·{" "}
            <em>
              {pendingHandovers.length
                ? "Acceptance required"
                : "Not yet sent"}
            </em>
          </strong>
        </div>
        <span className="handover-v2__draft-time">
          Draft saved {savedClock(lastSavedAt)}
        </span>
      </section>

      <section
        className="handover-v2__open"
        ref={openItemsRef}
        tabIndex={-1}
        aria-label="Open items for handover"
      >
        <h2>Open items for handover</h2>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Line / item</th>
                <th>Current control</th>
                <th>Responsible</th>
                <th>Created</th>
                <th>Next update</th>
                <th>Incoming action</th>
              </tr>
            </thead>
            <tbody>
              {openItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span
                      className={
                        "handover-v2__priority is-" + item.priority
                      }
                    >
                      <i aria-hidden="true">!</i>
                      {priorityLabel(item.priority)}
                    </span>
                  </td>
                  <td>
                    {lineLabel(item.production_line_code)} · {item.summary}
                  </td>
                  <td>{item.immediate_action || "Control not recorded"}</td>
                  <td>{responsibility(item)}</td>
                  <td>
                    {item.raised_at
                      ? formatScheduleClock(item.raised_at)
                      : "—"}
                  </td>
                  <td>
                    <strong
                      className={
                        item.priority === "critical"
                          ? "handover-v2__due-now"
                          : ""
                      }
                    >
                      {item.priority === "critical"
                        ? "Due now"
                        : item.response_due_at
                          ? formatScheduleClock(item.response_due_at)
                          : "Missing"}
                    </strong>
                  </td>
                  <td>{incomingAction(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="handover-v2__lower">
        <section className="handover-v2__completed">
          <h2>Completed this shift</h2>
          <div className="handover-v2__completed-list">
            {completedItems.length ? (
              completedItems.map((item) => (
                <p key={item}>
                  <span aria-hidden="true">✓</span>
                  {item}
                </p>
              ))
            ) : (
              <p>No completed control items recorded yet.</p>
            )}
          </div>
        </section>

        <section className="handover-v2__signoff">
          <h2>Sign-off</h2>
          <div className="handover-v2__signoff-grid">
            <article>
              <span className="is-ready" aria-hidden="true">
                ✓
              </span>
              <p>
                Outgoing Team Leader:
                <strong>
                  {outgoingName} ·{" "}
                  <em>
                    {everyOpenItemControlled
                      ? "Ready to hand over"
                      : "Review required"}
                  </em>
                </strong>
              </p>
            </article>
            <article>
              <span className="is-pending" aria-hidden="true" />
              <p>
                Incoming Team Leader:
                <strong>
                  <em>
                    {pendingHandovers.length
                      ? "Acceptance required"
                      : "Not yet sent"}
                  </em>
                </strong>
              </p>
            </article>
          </div>

          <label>
            Handover note (optional)
            <textarea
              aria-label="Handover note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add any additional information for the incoming team…"
              rows={3}
            />
          </label>
        </section>
      </div>

      <div
        className={
          everyOpenItemControlled
            ? "handover-v2__warning is-clear"
            : "handover-v2__warning"
        }
        role="note"
      >
        <span aria-hidden="true">!</span>
        <p>Owner and next update are required for every open item.</p>
      </div>

      <footer className="handover-v2__actions">
        <button
          type="button"
          className="handover-v2__outline"
          disabled={busy !== null}
          onClick={() => void saveDraft()}
        >
          {busy === "draft" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          className="handover-v2__outline"
          onClick={reviewOpenItems}
        >
          Review open items
        </button>
        {incomingForCurrentUser.length ? (
          <button
            type="button"
            className="handover-v2__primary"
            disabled={busy !== null}
            onClick={() => void acceptIncoming()}
          >
            {busy === "accept" ? "Accepting…" : "Accept handover"}
          </button>
        ) : (
          <button
            type="button"
            className="handover-v2__primary"
            disabled={busy !== null || !everyOpenItemControlled}
            onClick={() => void handOver()}
          >
            {busy === "handover" ? "Handing over…" : "Hand over"}
          </button>
        )}
      </footer>
    </section>
  );
}
