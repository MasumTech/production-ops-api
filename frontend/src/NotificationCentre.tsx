import { useEffect, useState } from "react";

import { ApiError, OfflineQueuedError, apiRequest, postJson } from "./api";
import { formatDateTime, titleCase } from "./format";
import type { NotificationInbox, OperationalEvent } from "./types";
import { AppIcon } from "./AppIcon";

function notificationTitle(event: OperationalEvent): string {
  return event.event_type.split(".").map(titleCase).join(" · ");
}

function notificationDescription(event: OperationalEvent): string {
  const lineContext = event.production_line ? "Production-line alert: " : "";
  const descriptions: Record<string, string> = {
    "escalation.overdue": "The response deadline has passed. Review the owner and immediate action.",
    "line_update.overdue": "The next line update is overdue. Confirm the current condition and record a new status.",
    "break_recovery.overdue": "The expected return time has passed. Confirm return, checks and safe restart.",
    "line_update.created": "A new line status was recorded. Review the RAG state, control and next update time.",
    "line_update.changed": "A line status was updated. Review the latest control and follow-up requirement.",
    "escalation.created": "A new operational action was raised. Review its priority, owner and response time.",
    "escalation.changed": "An operational action changed. Review the latest ownership and status.",
    "material.created": "A material-readiness record was added. Check availability, owner and need-by time.",
    "material.changed": "Material readiness changed. Review the supply position and required action.",
    "handover.created": "A shift handover is ready for review and acceptance.",
    "handover.changed": "Shift handover status changed. Review the latest summary and open actions.",
  };
  const fallback = event.event_type.endsWith(".created")
    ? "A new operational record was created. Open the related workspace for full details."
    : "An operational record changed. Open the related workspace for full details.";
  const status = typeof event.metadata.status === "string"
    ? ` Current status: ${titleCase(event.metadata.status)}.`
    : "";
  return `${lineContext}${descriptions[event.event_type] ?? fallback}${status}`;
}

export function NotificationCentre({
  refreshToken,
  iconOnly = false,
}: {
  refreshToken: string | null;
  iconOnly?: boolean;
}) {
  const [inbox, setInbox] = useState<NotificationInbox>({ unread_count: 0, results: [] });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<NotificationInbox>("/notifications/")
      .then((result) => {
        if (active) setInbox(result);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof ApiError ? caught.message : "Notifications are unavailable.");
        }
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  const markRead = async (event: OperationalEvent) => {
    setBusyId(event.id);
    setError("");
    try {
      await postJson(`/notifications/${event.id}/read/`);
      setInbox((current) => ({
        unread_count: Math.max(0, current.unread_count - 1),
        results: current.results.filter((item) => item.id !== event.id),
      }));
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        setInbox((current) => ({
          unread_count: Math.max(0, current.unread_count - 1),
          results: current.results.filter((item) => item.id !== event.id),
        }));
      } else {
        setError(caught instanceof ApiError ? caught.message : "Could not mark notification read.");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="notification-centre">
      <button
        type="button"
        className={`button button--ghost notification-trigger${iconOnly ? " notification-trigger--icon" : ""}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label={iconOnly ? `Alerts${inbox.unread_count ? ` (${inbox.unread_count})` : ""}` : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {iconOnly
          ? <AppIcon name="bell" size={23} />
          : `Alerts${inbox.unread_count ? ` (${inbox.unread_count})` : ""}`}
        {iconOnly && inbox.unread_count ? (
          <span className="notification-count">{inbox.unread_count}</span>
        ) : null}
      </button>
      {open ? (
        <section id="notification-panel" className="notification-panel" aria-label="Notifications">
          <div className="notification-panel__heading">
            <div>
              <span className="eyebrow">In-app delivery</span>
              <h2>Notifications</h2>
            </div>
            <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {error ? <p className="notification-error" role="alert">{error}</p> : null}
          <div className="notification-list">
            {inbox.results.map((event) => (
              <article key={event.id} className={`notification-item notification-item--${event.severity}`}>
                <div>
                  <strong>{notificationTitle(event)}</strong>
                  <p className="notification-item__description">{notificationDescription(event)}</p>
                  <span>{formatDateTime(event.occurred_at)}</span>
                </div>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busyId === event.id}
                  onClick={() => void markRead(event)}
                >
                  {busyId === event.id ? "Saving…" : "Mark read"}
                </button>
              </article>
            ))}
            {!inbox.results.length ? <p className="empty-state">No unread notifications.</p> : null}
          </div>
          <p className="notification-boundary">
            Read status confirms visibility only; it does not acknowledge or resolve an operational action.
          </p>
        </section>
      ) : null}
    </div>
  );
}
