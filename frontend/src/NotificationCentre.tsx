import { useEffect, useMemo, useState } from "react";

import { ApiError, OfflineQueuedError, apiRequest, postJson } from "./api";
import { formatDateTime, titleCase } from "./format";
import type { NotificationInbox, OperationalEvent } from "./types";
import { AppIcon } from "./AppIcon";

type NotificationFilter = "all" | "critical" | "updates";

const CONTENT: Record<string, { title: string; description: string }> = {
  "escalation.overdue": { title: "Response overdue", description: "The response deadline has passed. Confirm the owner and immediate action now." },
  "line_update.overdue": { title: "Line update overdue", description: "The next line update is late. Confirm the condition and record a fresh status." },
  "break_recovery.overdue": { title: "Recovery check overdue", description: "The expected return time has passed. Confirm return, checks and safe restart." },
  "line_update.created": { title: "New line status", description: "A Team Leader recorded a new RAG status. Review the control and next update time." },
  "line_update.changed": { title: "Line status changed", description: "A line update changed. Review the latest control and follow-up requirement." },
  "escalation.created": { title: "New action raised", description: "An operational action needs review. Check its priority, owner and response time." },
  "escalation.changed": { title: "Action updated", description: "Ownership or progress changed. Review the latest action status." },
  "material.created": { title: "Material risk added", description: "A material-readiness record was added. Check availability, ownership and need-by time." },
  "material.changed": { title: "Material position changed", description: "Material readiness changed. Review the supply position and required action." },
  "handover.created": { title: "Handover ready", description: "A shift handover is ready for review and acceptance." },
  "handover.changed": { title: "Handover updated", description: "The handover status changed. Review the summary and open actions." },
  "downtime.created": { title: "Downtime recorded", description: "Downtime was added to an hourly plan. Review the reason, owner and duration." },
  "downtime.changed": { title: "Downtime updated", description: "An hourly downtime record changed. Review the latest timing and resolution note." },
  "downtime.deleted": { title: "Downtime removed", description: "An hourly downtime record was deleted. Check the line history if follow-up is still required." },
};

function contentFor(event: OperationalEvent) {
  const fallbackTitle = event.event_type.split(".").map(titleCase).join(" · ");
  const fallbackDescription = event.event_type.endsWith(".created")
    ? "A new operational record is ready for review."
    : "An operational record changed and may need your attention.";
  return CONTENT[event.event_type] ?? { title: fallbackTitle, description: fallbackDescription };
}

function eventContext(event: OperationalEvent): string {
  const code = event.metadata.production_line_code ?? event.metadata.line_code;
  if (typeof code === "string" && code) return code;
  return event.production_line ? `Line ${event.production_line}` : "Operations";
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDateTime(value);
}

export function NotificationCentre({ refreshToken, iconOnly = false }: { refreshToken: string | null; iconOnly?: boolean }) {
  const [inbox, setInbox] = useState<NotificationInbox>({ unread_count: 0, results: [] });
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [allBusy, setAllBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<NotificationInbox>("/notifications/")
      .then((result) => {
        if (active) setInbox({
          unread_count: Number(result?.unread_count ?? 0),
          results: Array.isArray(result?.results) ? result.results : [],
        });
      })
      .catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "Notifications are unavailable."); });
    return () => { active = false; };
  }, [refreshToken]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const visibleEvents = useMemo(() => inbox.results.filter((event) => {
    if (filter === "critical") return event.severity === "critical";
    if (filter === "updates") return event.severity !== "critical";
    return true;
  }), [filter, inbox.results]);

  const markRead = async (event: OperationalEvent) => {
    setBusyId(event.id);
    setError("");
    try {
      await postJson(`/notifications/${event.id}/read/`);
      setInbox((current) => ({ unread_count: Math.max(0, current.unread_count - 1), results: current.results.filter((item) => item.id !== event.id) }));
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        setInbox((current) => ({ unread_count: Math.max(0, current.unread_count - 1), results: current.results.filter((item) => item.id !== event.id) }));
      } else {
        setError(caught instanceof ApiError ? caught.message : "Could not mark notification as seen.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setAllBusy(true);
    setError("");
    try {
      await postJson("/notifications/read-all/");
      setInbox({ unread_count: 0, results: [] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not clear notifications.");
    } finally {
      setAllBusy(false);
    }
  };

  return (
    <div className="notification-centre">
      <button type="button" className={`button button--ghost notification-trigger${iconOnly ? " notification-trigger--icon" : ""}`} aria-expanded={open} aria-controls="notification-panel" aria-label={iconOnly ? `Notifications${inbox.unread_count ? ` (${inbox.unread_count})` : ""}` : undefined} onClick={() => setOpen((current) => !current)}>
        {iconOnly ? <AppIcon name="bell" size={23} /> : "Notifications"}
        {inbox.unread_count ? <span className="notification-count">{inbox.unread_count > 99 ? "99+" : inbox.unread_count}</span> : null}
      </button>
      {open ? <>
        <button className="notification-drawer-backdrop" type="button" aria-label="Close notifications" onClick={() => setOpen(false)} />
        <section id="notification-panel" className="notification-panel notification-drawer" aria-label="Notifications" role="dialog" aria-modal="true">
          <div className="notification-panel__heading">
            <div><span className="eyebrow">Live operations</span><h2>Notifications</h2><p>{inbox.unread_count ? `${inbox.unread_count} item${inbox.unread_count === 1 ? "" : "s"} need your attention` : "You’re all caught up"}</p></div>
            <button type="button" className="notification-close" aria-label="Close notifications" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="notification-toolbar">
            <div role="tablist" aria-label="Notification filters">{(["all", "critical", "updates"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{titleCase(value)}</button>)}</div>
            {inbox.results.length ? <button type="button" className="notification-clear" disabled={allBusy} onClick={() => void markAllRead()}>{allBusy ? "Clearing…" : "Mark all as seen"}</button> : null}
          </div>
          {error ? <p className="notification-error" role="alert">{error}</p> : null}
          <div className="notification-list">
            {visibleEvents.map((event) => {
              const content = contentFor(event);
              return <article key={event.id} className={`notification-item notification-item--${event.severity}`}>
                <span className="notification-item__icon"><AppIcon name={event.severity === "critical" ? "warning" : event.severity === "warning" ? "clock" : "info"} size={19} /></span>
                <div className="notification-item__body">
                  <div className="notification-item__meta"><span>{eventContext(event)}</span><time dateTime={event.occurred_at} title={formatDateTime(event.occurred_at)}>{relativeTime(event.occurred_at)}</time></div>
                  <strong>{content.title}</strong>
                  <p className="notification-item__description">{content.description}{typeof event.metadata.status === "string" ? ` Current status: ${titleCase(event.metadata.status)}.` : ""}</p>
                  <button type="button" className="notification-seen" disabled={busyId === event.id} onClick={() => void markRead(event)}>{busyId === event.id ? "Saving…" : "Mark as seen"}</button>
                </div>
              </article>;
            })}
            {!visibleEvents.length ? <div className="notification-empty"><span>✓</span><strong>{inbox.results.length ? "Nothing in this filter" : "You’re all caught up"}</strong><p>{inbox.results.length ? "Choose another filter to see unread updates." : "New operational updates will appear here."}</p></div> : null}
          </div>
          <p className="notification-boundary"><AppIcon name="info" size={16} /> Marking an item as seen confirms visibility only. It does not acknowledge or resolve the operational action.</p>
        </section>
      </> : null}
    </div>
  );
}
