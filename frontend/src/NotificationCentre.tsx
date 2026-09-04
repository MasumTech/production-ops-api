import { useEffect, useState } from "react";

import { ApiError, OfflineQueuedError, apiRequest, postJson } from "./api";
import { formatDateTime, titleCase } from "./format";
import type { NotificationInbox, OperationalEvent } from "./types";

function notificationTitle(event: OperationalEvent): string {
  return event.event_type.split(".").map(titleCase).join(" · ");
}

export function NotificationCentre({ refreshToken }: { refreshToken: string | null }) {
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
        className="button button--ghost notification-trigger"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((current) => !current)}
      >
        Alerts{inbox.unread_count ? ` (${inbox.unread_count})` : ""}
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
