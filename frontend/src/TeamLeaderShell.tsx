import { useState, type ReactNode } from "react";

import { AppIcon } from "./AppIcon";
import { NotificationCentre } from "./NotificationCentre";
import { getShiftWindow } from "./shiftTiming";
import type { ShiftRecord, UserSummary, WorkspaceTab } from "./types";
import {
  WorkspaceBottomNavigation,
  WorkspaceSidebar,
  type WorkspaceNavigationItem,
} from "./WorkspaceNavigation";

const TEAM_LEADER_NAV_ITEMS: Array<WorkspaceNavigationItem<Exclude<WorkspaceTab, "issues">>> = [
  { id: "lines", label: "My Lines", shortLabel: "Lines", icon: "factory" },
  { id: "plan", label: "Daily Plan", shortLabel: "Plan", icon: "calendar" },
  { id: "materials", label: "Materials", shortLabel: "Materials", icon: "package" },
  { id: "breaks", label: "Break & Recovery", shortLabel: "Recovery", icon: "coffee" },
  { id: "handover", label: "Shift Handover", shortLabel: "Handover", icon: "clipboard" },
];

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function updatedTime(value: string | null): string {
  if (!value) return "Updated —";
  return `Updated ${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))}`;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "TL";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function TeamLeaderShell({
  profile,
  activeTab,
  operationalDate,
  shifts,
  shiftPattern,
  viewMode,
  online,
  lastUpdatedAt,
  busy,
  children,
  onSelectTab,
  onOperationalDateChange,
  onShiftPatternChange,
  onViewModeChange,
  onRefresh,
  onSignOut,
}: {
  profile: UserSummary;
  activeTab: WorkspaceTab;
  operationalDate: string;
  shifts: ShiftRecord[];
  shiftPattern: "day" | "night";
  viewMode: "live" | "historical";
  online: boolean;
  lastUpdatedAt: string | null;
  busy: boolean;
  children: ReactNode;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOperationalDateChange: (value: string) => void;
  onShiftPatternChange: (value: "day" | "night") => void;
  onViewModeChange: (value: "live" | "historical") => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const activeNavigation: Exclude<WorkspaceTab, "issues"> =
    activeTab === "issues" ? "lines" : activeTab;
  const shiftWindow = getShiftWindow(operationalDate, shifts, shiftPattern);
  const dayWindow = getShiftWindow(operationalDate, shifts, "day");
  const nightWindow = getShiftWindow(operationalDate, shifts, "night");

  const selectNavigation = (value: Exclude<WorkspaceTab, "issues">) => {
    setNavigationOpen(false);
    onSelectTab(value);
  };

  return (
    <div className="team-control-shell">
      <header className="team-control-topbar">
        <div className="team-control-brand">
          <button
            type="button"
            className="team-control-menu"
            aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((current) => !current)}
          >
            <AppIcon name="menu" size={24} />
          </button>
          <strong>Operations Control Board</strong>
        </div>

        <div className="team-control-meta" aria-label="Workspace controls">
          <label className="team-control-date">
            <AppIcon name="calendar" size={22} />
            <span>{formattedDate(operationalDate)}</span>
            <input
              aria-label="Operational date"
              type="date"
              value={operationalDate}
              onChange={(event) => onOperationalDateChange(event.target.value)}
            />
          </label>

          <label className="team-control-shift">
            <AppIcon name="clock" size={22} />
            <select
              aria-label="Shift pattern"
              value={shiftPattern}
              onChange={(event) =>
                onShiftPatternChange(event.target.value as "day" | "night")
              }
            >
              <option value="day">
                Day · {dayWindow.startLabel}–{dayWindow.endLabel}
              </option>
              <option value="night">
                Night · {nightWindow.startLabel}–{nightWindow.endLabel}
              </option>
            </select>
          </label>

          <div className="team-control-view" role="group" aria-label="Data view">
            <button
              type="button"
              className={viewMode === "live" ? "is-active" : ""}
              aria-pressed={viewMode === "live"}
              onClick={() => onViewModeChange("live")}
            >
              Live
            </button>
            <button
              type="button"
              className={viewMode === "historical" ? "is-active" : ""}
              aria-pressed={viewMode === "historical"}
              onClick={() => onViewModeChange("historical")}
            >
              Historical
            </button>
          </div>

          <button
            type="button"
            className="team-control-refresh"
            aria-label="Refresh"
            disabled={busy}
            onClick={onRefresh}
          >
            <span className="team-control-refresh__icon">
              <AppIcon name="refresh" size={23} />
            </span>
            <span>
              <strong>{busy ? "Refreshing…" : "Refresh"}</strong>
              <small>{updatedTime(lastUpdatedAt)}</small>
            </span>
          </button>

          <NotificationCentre refreshToken={lastUpdatedAt} iconOnly />

          <details className="team-control-profile">
            <summary aria-label={`Open profile menu for ${profile.display_name}`}>
              <span className="team-control-profile__avatar">
                {initials(profile.display_name)}
              </span>
              <span className="team-control-profile__identity">
                <strong>{profile.display_name}</strong>
                <small>Team Leader</small>
              </span>
              <span className="team-control-profile__chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="team-control-profile__menu">
              <strong>{profile.display_name}</strong>
              <span>{profile.username}</span>
              <span>Team Leader</span>
              <span>
                {shiftPattern === "day" ? "Day" : "Night"} · {shiftWindow.startLabel}–{shiftWindow.endLabel}
              </span>
              <button type="button" onClick={onSignOut}>Sign out</button>
            </div>
          </details>
        </div>
      </header>

      <div className="team-control-layout">
        <WorkspaceSidebar
          ariaLabel="Team Leader workspace"
          navigationLabel="Team Leader sections"
          className={`team-control-sidebar${navigationOpen ? " team-control-sidebar--open" : ""}`}
          items={TEAM_LEADER_NAV_ITEMS}
          activeItem={activeNavigation}
          onSelect={selectNavigation}
          boundary={
            <div className="team-control-sidebar__footer">
              <span className="team-control-online">
                <i className={online ? "is-online" : ""} aria-hidden="true" />
                {online ? "Online" : "Offline"}
              </span>
              <span>Version 1.4.0</span>
            </div>
          }
        />

        {navigationOpen ? (
          <button
            type="button"
            className="team-control-backdrop"
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
          />
        ) : null}

        <main className="team-control-workspace">{children}</main>
      </div>

      <WorkspaceBottomNavigation
        ariaLabel="Team Leader mobile workspace"
        items={TEAM_LEADER_NAV_ITEMS}
        activeItem={activeNavigation}
        onSelect={selectNavigation}
      />
    </div>
  );
}
