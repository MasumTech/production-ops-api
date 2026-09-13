import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  apiList,
  apiRequest,
  bindSessionUser,
  clearSession,
  flushOfflineActions,
  getOfflineActions,
  hasSession,
  login,
  subscribeToOutbox,
} from "./api";
import { ErrorBanner } from "./components";
import { NotificationCentre } from "./NotificationCentre";
import { BreakRecoveryPanel } from "./features/BreakRecoveryPanel";
import { DailyPlanPanel } from "./features/DailyPlanPanel";
import { HandoversPanel } from "./features/HandoversPanel";
import { ManagerConsole } from "./features/ManagerConsole";
import { MaterialsPanel } from "./features/MaterialsPanel";
import { MyLinesPanel } from "./features/MyLinesPanel";
import { RaiseIssuePanel } from "./features/RaiseIssuePanel";
import { SupportCompanion } from "./features/SupportCompanion";
import { localDate } from "./format";
import { connectOperationalEvents, type LiveConnectionState } from "./realtime";
import {
  WorkspaceBottomNavigation,
  WorkspaceSidebar,
} from "./WorkspaceNavigation";
import type { WorkspaceNavigationItem } from "./WorkspaceNavigation";
import type {
  Assignment,
  BreakOpportunity,
  DailyPlanBlock,
  DowntimeEvent,
  Escalation,
  LineUpdate,
  ManagerWorkspaceData,
  MaterialReadiness,
  OperationalEvent,
  ShiftRecord,
  ShiftHandover,
  SupportCompanionData,
  UserChoice,
  UserSummary,
  WorkspaceData,
  WorkspaceTab,
} from "./types";

function eventMessage(event: OperationalEvent): string {
  const label = event.event_type.replaceAll("_", " ").replaceAll(".", " · ");
  return `${event.severity === "critical" ? "Critical live update" : "Live update"}: ${label}`;
}

const EMPTY_DATA: WorkspaceData = {
  assignments: [],
  updates: [],
  materials: [],
  escalations: [],
  planBlocks: [],
  breakOpportunities: [],
  breaks: [],
  handovers: [],
  users: [],
  shifts: [],
  downtimeEvents: [],
};

const EMPTY_MANAGER_DATA: ManagerWorkspaceData = {
  assignments: [],
  updates: [],
  materials: [],
  escalations: [],
  shifts: [],
  downtimeEvents: [],
  summary: {
    total_shifts: 0,
    total_planned_output: 0,
    total_actual_output: 0,
    overall_performance_percentage: null,
    total_downtime_minutes: 0,
    open_incidents: 0,
    critical_incidents: 0,
  },
};

const EMPTY_SUPPORT_DATA: SupportCompanionData = {
  generated_at: null,
  assignments: [],
  updates: [],
  materials: [],
  escalations: [],
};

const NAV_ITEMS: Array<WorkspaceNavigationItem<WorkspaceTab>> = [
  { id: "lines", label: "My lines", shortLabel: "Lines", icon: "home" },
  { id: "plan", label: "Daily plan", shortLabel: "Plan", icon: "calendar" },
  { id: "materials", label: "Materials", shortLabel: "Materials", icon: "package" },
  { id: "breaks", label: "Break & recovery", shortLabel: "Breaks", icon: "coffee" },
  { id: "handover", label: "Handover", shortLabel: "Handover", icon: "clipboard" },
];

function formatOperationalDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

async function loadWorkspaceData(operationalDate: string): Promise<WorkspaceData> {
  const [
    assignments,
    updates,
    materials,
    escalations,
    planBlocks,
    breakOpportunities,
    handovers,
    users,
    shifts,
    downtimeEvents,
  ] = await Promise.all([
      apiList<Assignment>(
        `/team-leader-assignments/my-lines/?date=${operationalDate}`,
      ),
      apiList<LineUpdate>(
        `/hourly-line-updates/latest-status/?date=${operationalDate}`,
      ),
      apiList<MaterialReadiness>(
        `/product-material-readiness/?date=${operationalDate}&ordering=sequence_number`,
      ),
      apiList<Escalation>("/operational-escalations/?ordering=-raised_at"),
      apiList<DailyPlanBlock>(`/daily-plan-blocks/?date=${operationalDate}`),
      apiList<BreakOpportunity>(`/break-opportunities/?date=${operationalDate}`),
      apiList<ShiftHandover>("/shift-handovers/?ordering=-handed_over_at"),
      apiList<UserChoice>("/active-users/"),
      apiList<ShiftRecord>(`/shifts/?date=${operationalDate}`),
      apiList<DowntimeEvent>(`/downtime-events/?date=${operationalDate}&ordering=started_at`),
    ]);

  return {
    assignments,
    updates,
    materials,
    escalations,
    planBlocks,
    breakOpportunities,
    breaks: [],
    handovers,
    users,
    shifts,
    downtimeEvents,
  };
}

async function loadManagerData(operationalDate: string): Promise<ManagerWorkspaceData> {
  const [
    assignments,
    updates,
    materials,
    escalations,
    shifts,
    downtimeEvents,
    summary,
  ] = await Promise.all([
    apiList<Assignment>(`/team-leader-assignments/?date=${operationalDate}`),
    apiList<LineUpdate>(`/hourly-line-updates/latest-status/?date=${operationalDate}`),
    apiList<MaterialReadiness>(
      `/product-material-readiness/?date=${operationalDate}&ordering=sequence_number`,
    ),
    apiList<Escalation>(
      `/operational-escalations/?date=${operationalDate}&ordering=-raised_at`,
    ),
    apiList<ShiftRecord>(`/shifts/?date=${operationalDate}&ordering=-actual_output`),
    apiList<DowntimeEvent>(`/downtime-events/?date=${operationalDate}&ordering=started_at`),
    apiRequest<ManagerWorkspaceData["summary"]>(
      `/dashboard/summary/?date_from=${operationalDate}&date_to=${operationalDate}`,
    ),
  ]);

  return {
    assignments,
    updates,
    materials,
    escalations,
    shifts,
    downtimeEvents,
    summary,
  };
}

async function loadSupportData(operationalDate: string): Promise<SupportCompanionData> {
  return apiRequest<SupportCompanionData>(
    `/support/companion/?date=${operationalDate}`,
  );
}

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-label="Production workspace summary">
        <div className="brand-mark brand-mark--large" aria-hidden="true">
          ML
        </div>
        <span className="eyebrow">Operations Control Board</span>
        <h1>Multi-Line Team Leader Digital Solution</h1>
        <p>
          Live line status, daily plans, material risks, break recovery and AI briefing
          in one production-floor workspace.
        </p>
        <div className="login-brand-metrics" aria-hidden="true">
          <span>07:00-18:00 shift</span>
          <span>2 x 40 min breaks</span>
          <span>Manager + Team Leader views</span>
        </div>
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          ML
        </div>
        <span className="eyebrow">Production operations workspace</span>
        <h1 id="login-title">Welcome back</h1>
        <p>Sign in to open the correct Manager or Team Leader workspace for your account.</p>
        {error ? <ErrorBanner message={error} /> : null}
        <form onSubmit={submit} className="stack-form">
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          <button className="button button--primary button--large" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="safety-note">
          Follow approved safety, food-safety, quality, engineering, and escalation procedures
          before entering a software update.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  const [profile, setProfile] = useState<UserSummary | null>(null);
  const [data, setData] = useState<WorkspaceData>(EMPTY_DATA);
  const [managerData, setManagerData] = useState<ManagerWorkspaceData>(EMPTY_MANAGER_DATA);
  const [supportData, setSupportData] = useState<SupportCompanionData>(EMPTY_SUPPORT_DATA);
  const [loading, setLoading] = useState(hasSession());
  const [error, setError] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("lines");
  const [selectedAssignment, setSelectedAssignment] = useState<number | null>(null);
  const [operationalDate, setOperationalDate] = useState(localDate());
  const [toast, setToast] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveConnectionState>("connecting");
  const [outbox, setOutbox] = useState(getOfflineActions());
  const online = useOnlineStatus();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentProfile = await apiRequest<UserSummary>("/auth/me/");
      bindSessionUser(currentProfile.id);
      setProfile(currentProfile);
      if (currentProfile.workspace === "manager") {
        setManagerData(await loadManagerData(operationalDate));
      } else if (currentProfile.workspace === "support") {
        setSupportData(await loadSupportData(operationalDate));
      } else {
        setData(await loadWorkspaceData(operationalDate));
      }
      setLastUpdatedAt(new Date().toISOString());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearSession();
        setProfile(null);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not load the workspace.");
      }
    } finally {
      setLoading(false);
    }
  }, [operationalDate]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!profile) return false;
    setLoading(true);
    setError("");
    try {
      if (profile.workspace === "manager") {
        setManagerData(await loadManagerData(operationalDate));
      } else if (profile.workspace === "support") {
        setSupportData(await loadSupportData(operationalDate));
      } else {
        setData(await loadWorkspaceData(operationalDate));
      }
      setLastUpdatedAt(new Date().toISOString());
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearSession();
        setProfile(null);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not refresh the workspace.");
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [operationalDate, profile]);

  useEffect(() => {
    if (hasSession()) void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const update = () => setOutbox(getOfflineActions(profile?.id));
    update();
    return subscribeToOutbox(update);
  }, [profile?.id]);

  const syncOutbox = useCallback(async () => {
    if (!online || !profile) return;
    const result = await flushOfflineActions();
    if (result.synced) {
      await refresh();
      setToast(`${result.synced} queued action${result.synced === 1 ? "" : "s"} synced.`);
    }
    if (result.needsReview) {
      setToast(`${result.needsReview} queued action${result.needsReview === 1 ? "" : "s"} need review.`);
    }
  }, [online, profile, refresh]);

  useEffect(() => {
    if (online && profile) void syncOutbox();
  }, [online, profile, syncOutbox]);

  useEffect(() => {
    if (!profile || !online) {
      setLiveState("offline");
      return;
    }
    let refreshTimer: number | null = null;
    const disconnect = connectOperationalEvents({
      userId: profile.id,
      onState: setLiveState,
      onEvent: (event) => {
        setToast(eventMessage(event));
        if (refreshTimer !== null) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => void refresh(), 250);
      },
      onResync: () => refresh(),
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      disconnect();
    };
  }, [online, profile, refresh]);

  useEffect(() => {
    if (
      !profile ||
      profile.workspace === "team_leader" ||
      !online ||
      liveState === "live"
    ) return;
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [liveState, online, profile, refresh]);

  const openIssueFor = (assignmentId: number) => {
    setSelectedAssignment(assignmentId);
    setTab("issues");
  };

  if (!profile && !loading) return <LoginScreen onAuthenticated={() => void load()} />;

  if (loading && !profile) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="spinner" />
        <p>Loading live line control…</p>
      </main>
    );
  }

  const signOut = () => {
    clearSession();
    setProfile(null);
    setData(EMPTY_DATA);
    setManagerData(EMPTY_MANAGER_DATA);
    setSupportData(EMPTY_SUPPORT_DATA);
    setLastUpdatedAt(null);
  };

  if (profile?.workspace === "manager") {
    return (
      <>
        {outbox.length ? (
          <div className="outbox-banner" role="status">
            <span>{outbox.length} offline action{outbox.length === 1 ? "" : "s"} waiting.</span>
            <button className="button button--ghost" onClick={() => void syncOutbox()} disabled={!online}>
              Sync now
            </button>
          </div>
        ) : null}
        <ManagerConsole
          profile={profile}
          data={managerData}
          operationalDate={operationalDate}
          lastUpdatedAt={lastUpdatedAt}
          online={online}
          liveState={liveState}
          busy={loading}
          error={error}
          onDateChange={setOperationalDate}
          onRefresh={() => void refresh()}
          onSignOut={signOut}
        />
      </>
    );
  }

  if (profile?.workspace === "support") {
    return (
      <>
        {outbox.length ? (
          <div className="outbox-banner" role="status">
            <span>{outbox.length} offline action{outbox.length === 1 ? "" : "s"} waiting.</span>
            <button className="button button--ghost" onClick={() => void syncOutbox()} disabled={!online}>
              Sync now
            </button>
          </div>
        ) : null}
        <SupportCompanion
          profile={profile}
          data={supportData}
          operationalDate={operationalDate}
          lastUpdatedAt={lastUpdatedAt}
          online={online}
          liveState={liveState}
          busy={loading}
          error={error}
          onDateChange={setOperationalDate}
          onRefresh={() => void refresh()}
          onSignOut={signOut}
          onSaved={async (message) => {
            if (online) await refresh();
            setToast(message);
          }}
        />
        {toast ? <div className="toast" role="status">{toast}</div> : null}
      </>
    );
  }

  return (
    <div className="app-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: current screen remains visible, but new submissions need a connection.
        </div>
      ) : null}
      {outbox.length ? (
        <div className="outbox-banner" role="status">
          <span>{outbox.length} offline action{outbox.length === 1 ? "" : "s"} waiting.</span>
          <button className="button button--ghost" onClick={() => void syncOutbox()} disabled={!online}>
            Sync now
          </button>
        </div>
      ) : null}
      <header className="topbar team-leader-topbar">
        <strong className="team-leader-brand">LINE CONTROL ASSISTANT</strong>
        <div className="team-leader-shift-meta">
          <span>Shift&nbsp; 07:00 – 18:00</span>
          <span className="team-leader-header-divider" aria-hidden="true" />
          <details className="team-leader-tools">
            <summary aria-label="Open workspace controls">
              {formatOperationalDate(operationalDate)}
            </summary>
            <div className="team-leader-tools__menu">
              <strong>{profile?.display_name}</strong>
              <span>{liveState === "live" ? "Live connected" : "Snapshot mode"}</span>
              <label>
                Operational date
                <input
                  aria-label="Operational date"
                  type="date"
                  value={operationalDate}
                  onChange={(event) => setOperationalDate(event.target.value)}
                />
              </label>
              <NotificationCentre refreshToken={lastUpdatedAt} />
              <button className="button button--ghost" onClick={() => void refresh()}>
                Refresh
              </button>
              <button className="button button--ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          </details>
        </div>
      </header>

      <WorkspaceSidebar
        ariaLabel="Team Leader workspace"
        navigationLabel="Team Leader sections"
        items={NAV_ITEMS}
        activeItem={tab}
        onSelect={setTab}
        className="team-leader-sidebar"
      />

      <main className="workspace">
        {error ? <ErrorBanner message={error} /> : null}
        {tab === "lines" ? (
          <MyLinesPanel
            data={data}
            onRaiseIssue={openIssueFor}
            onNavigate={setTab}
          />
        ) : null}
        {tab === "issues" && profile ? (
          <>
            <button className="button button--ghost workspace-back" onClick={() => setTab("lines")}>
              Back to My Lines
            </button>
            <RaiseIssuePanel
              assignments={data.assignments.slice(0, 2)}
              users={data.users}
              selectedAssignment={selectedAssignment}
              onSaved={async (message) => {
                if (online) await refresh();
                setToast(message);
              }}
            />
          </>
        ) : null}
        {tab === "plan" ? (
          <DailyPlanPanel
            assignments={data.assignments}
            planBlocks={data.planBlocks}
          />
        ) : null}
        {tab === "materials" && profile ? (
          <MaterialsPanel
            assignments={data.assignments}
            materials={data.materials}
            users={data.users}
            onSaved={async (message) => {
              if (online) await refresh();
              setToast(message);
            }}
          />
        ) : null}
        {tab === "breaks" && profile ? (
          <BreakRecoveryPanel
            assignments={data.assignments}
            opportunities={data.breakOpportunities}
            onSaved={async (message) => {
              if (online) await refresh();
              setToast(message);
            }}
          />
        ) : null}
        {tab === "handover" && profile ? (
          <HandoversPanel
            profile={profile}
            assignments={data.assignments}
            handovers={data.handovers}
            escalations={data.escalations}
            onSaved={async (message) => {
              if (online) await refresh();
              setToast(message);
            }}
          />
        ) : null}
      </main>

      <WorkspaceBottomNavigation
        ariaLabel="Team Leader mobile workspace"
        items={NAV_ITEMS}
        activeItem={tab}
        onSelect={setTab}
      />
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
