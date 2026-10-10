import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiError, apiRequest } from "./api";
import type { HourlyOutput } from "./types";

const NUMBER = new Intl.NumberFormat("en-GB");

export interface HourlyOutputContext {
  assignmentId: number;
  lineLabel: string;
  hourLabel: string;
  hourStartAt: string;
  target: number | null;
  downtimeMinutes?: number;
  output: HourlyOutput | null;
}

export function HourlyOutputEditor({
  context,
  manager = false,
  onClose,
  onSaved,
}: {
  context: HourlyOutputContext;
  manager?: boolean;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [actualUnits, setActualUnits] = useState("0");
  const [rejectedUnits, setRejectedUnits] = useState("0");
  const [reworkUnits, setReworkUnits] = useState("0");
  const [notes, setNotes] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setActualUnits(String(context.output?.actual_units ?? 0));
    setRejectedUnits(String(context.output?.rejected_units ?? 0));
    setReworkUnits(String(context.output?.rework_units ?? 0));
    setNotes(context.output?.notes ?? "");
    setCorrectionReason("");
    setConfirmDelete(false);
    setMessage("");
  }, [context]);

  const totals = useMemo(() => {
    const good = Number(actualUnits) || 0;
    const rejected = Number(rejectedUnits) || 0;
    const rework = Number(reworkUnits) || 0;
    const handled = good + rejected + rework;
    return {
      good,
      rejected,
      rework,
      handled,
      yieldPercent: handled ? Math.round((good / handled) * 1000) / 10 : 0,
    };
  }, [actualUnits, rejectedUnits, reworkUnits]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (manager && context.output && !correctionReason.trim()) {
      setMessage("Add a correction reason before saving a Manager change.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        actual_units: totals.good,
        rejected_units: totals.rejected,
        rework_units: totals.rework,
        notes: notes.trim(),
        ...(context.output
          ? {}
          : {
              assignment: context.assignmentId,
              hour_start_at: context.hourStartAt,
            }),
        ...(manager && context.output
          ? { correction_reason: correctionReason.trim() }
          : {}),
      };
      await apiRequest<HourlyOutput>(
        context.output
          ? `/hourly-outputs/${context.output.id}/`
          : "/hourly-outputs/",
        {
          method: context.output ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      await onSaved(
        context.output
          ? manager
            ? "Hourly production correction saved."
            : "Hourly production updated."
          : "Hourly production recorded.",
      );
      onClose();
    } catch (caught) {
      setMessage(
        caught instanceof ApiError
          ? caught.message
          : "Could not save hourly production.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!context.output) return;
    if (manager && !correctionReason.trim()) {
      setMessage("Add a correction reason before deleting a Manager record.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/hourly-outputs/${context.output.id}/`, {
        method: "DELETE",
        ...(manager
          ? {
              body: JSON.stringify({
                correction_reason: correctionReason.trim(),
              }),
            }
          : {}),
      });
      await onSaved("Hourly production record deleted.");
      onClose();
    } catch (caught) {
      setMessage(
        caught instanceof ApiError
          ? caught.message
          : "Could not delete hourly production.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hourly-output-backdrop" role="presentation">
      <section
        className="hourly-output-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hourly-output-title"
      >
        <header>
          <div>
            <span className="eyebrow">
              {manager ? "Manager production review" : "Team Leader production entry"}
            </span>
            <h2 id="hourly-output-title">
              {context.lineLabel} · {context.hourLabel}
            </h2>
            <p>
              {context.target === null
                ? "Hourly target is unavailable."
                : `Hourly target ${NUMBER.format(context.target)} units.`}
              {context.downtimeMinutes === undefined
                ? ""
                : ` Downtime ${NUMBER.format(context.downtimeMinutes)} min.`}
            </p>
          </div>
          <button type="button" aria-label="Close hourly production" onClick={onClose}>×</button>
        </header>

        {context.output ? (
          <div className="hourly-output-editor__audit">
            <span>
              Recorded by {context.output.recorded_by_username || "Team Leader"}
            </span>
            <span>
              Last edited by {context.output.last_edited_by_username || context.output.recorded_by_username || "Team Leader"}
            </span>
          </div>
        ) : null}

        <form onSubmit={save}>
          <div className="hourly-output-editor__grid">
            <label>
              Good units
              <input
                aria-label="Good units"
                type="number"
                min="0"
                step="1"
                value={actualUnits}
                onChange={(event) => setActualUnits(event.target.value)}
                required
              />
            </label>
            <label>
              Reject units
              <input
                aria-label="Reject units"
                type="number"
                min="0"
                step="1"
                value={rejectedUnits}
                onChange={(event) => setRejectedUnits(event.target.value)}
                required
              />
            </label>
            <label>
              Rework units
              <input
                aria-label="Rework units"
                type="number"
                min="0"
                step="1"
                value={reworkUnits}
                onChange={(event) => setReworkUnits(event.target.value)}
                required
              />
            </label>
          </div>

          <div className={`hourly-output-editor__summary${context.downtimeMinutes === undefined ? "" : " has-downtime"}`} aria-label="Hourly production summary">
            <div><span>Total handled</span><strong>{NUMBER.format(totals.handled)}</strong></div>
            <div><span>First-pass yield</span><strong>{totals.yieldPercent}%</strong></div>
            <div>
              <span>Target position</span>
              <strong>
                {context.target === null
                  ? "—"
                  : totals.good >= context.target
                    ? `${NUMBER.format(totals.good - context.target)} ahead`
                    : `${NUMBER.format(context.target - totals.good)} short`}
              </strong>
            </div>
            {context.downtimeMinutes === undefined ? null : (
              <div><span>Downtime</span><strong>{NUMBER.format(context.downtimeMinutes)} min</strong></div>
            )}
          </div>

          <label>
            Production note
            <textarea
              aria-label="Production note"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Counter source, waste reason or useful shift context"
            />
          </label>

          {manager && context.output ? (
            <label>
              Correction reason
              <textarea
                aria-label="Correction reason"
                rows={2}
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                placeholder="Required for Manager changes and deletions"
                required
              />
            </label>
          ) : null}

          {message ? <p className="hourly-output-editor__message" role="alert">{message}</p> : null}

          <footer>
            {context.output ? (
              confirmDelete ? (
                <div className="hourly-output-editor__delete-confirm">
                  <span>Delete this hourly record?</span>
                  <button type="button" className="button button--danger" disabled={busy} onClick={() => void remove()}>Confirm delete</button>
                  <button type="button" className="button button--ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep record</button>
                </div>
              ) : (
                <button type="button" className="button button--danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete record</button>
              )
            ) : <span />}
            <div>
              <button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Cancel</button>
              <button type="submit" className="button button--primary" disabled={busy}>
                {busy ? "Saving…" : context.output ? manager ? "Save correction" : "Update output" : "Record output"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
