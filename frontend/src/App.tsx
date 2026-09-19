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
import productionLineIllustration from "./assets/production-line-illustration.png";
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
import { TeamLeaderShell } from "./TeamLeaderShell";
import type {
  Assignment,
  BreakOpportunity,
  BreakRecovery,
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
  breakOpportunities: [],
  breaks: [],
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

async function loadWorkspaceData(
  operationalDate: string,
  shiftType: "day" | "night",
): Promise<WorkspaceData> {
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
      `/team-leader-assignments/my-lines/?date=${operationalDate}&shift_type=${shiftType}`,
    ),
    apiList<LineUpdate>(
      `/hourly-line-updates/latest-status/?date=${operationalDate}&shift_type=${shiftType}`,
    ),
    apiList<MaterialReadiness>(
      `/product-material-readiness/?date=${operationalDate}&shift_type=${shiftType}&ordering=sequence_number`,
    ),
    apiList<Escalation>(
      `/operational-escalations/?date=${operationalDate}&shift_type=${shiftType}&ordering=-raised_at`,
    ),
    apiList<DailyPlanBlock>(`/daily-plan-blocks/?date=${operationalDate}`),
    apiList<BreakOpportunity>(`/break-opportunities/?date=${operationalDate}`),
    apiList<ShiftHandover>("/shift-handovers/?ordering=-handed_over_at"),
    apiList<UserChoice>("/active-users/"),
    apiList<ShiftRecord>(
      `/shifts/?date=${operationalDate}&shift_type=${shiftType}`,
    ),
    apiList<DowntimeEvent>(
      `/downtime-events/?date=${operationalDate}&ordering=started_at`,
    ),
  ]);

  const assignmentIds = new Set(assignments.map((item) => item.id));
  const shiftIds = new Set(shifts.map((item) => item.id));

  return {
    assignments,
    updates,
    materials,
    escalations,
    planBlocks: planBlocks.filter((item) => assignmentIds.has(item.assignment)),
    breakOpportunities: breakOpportunities.filter((item) =>
      assignmentIds.has(item.assignment),
    ),
    breaks: [],
    handovers,
    users,
    shifts,
    downtimeEvents: downtimeEvents.filter((item) => shiftIds.has(item.shift)),
  };
}

async function loadManagerData(operationalDate: string): Promise<ManagerWorkspaceData> {
  const [
    assignments,
    planBlocks,
    breakOpportunities,
    breaks,
    updates,
    materials,
    escalations,
    shifts,
    downtimeEvents,
    summary,
  ] = await Promise.all([
    apiList<Assignment>(`/team-leader-assignments/?date=${operationalDate}`),
    apiList<DailyPlanBlock>(`/daily-plan-blocks/?date=${operationalDate}&ordering=sequence_number`),
    apiList<BreakOpportunity>(`/break-opportunities/?date=${operationalDate}`),
    apiList<BreakRecovery>(`/break-recoveries/?date=${operationalDate}`),
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
    planBlocks,
    breakOpportunities,
    breaks,
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
      <section className="login-brand-panel" aria-label="Operations Control Board">
        <div className="login-brand-copy">
          <h1>Operations<br />Control Board</h1>
          <p className="login-brand-tagline">Keep production moving safely</p>
          <p className="login-brand-workspace">Manager and Team Leader workspace</p>
        </div>

        <div className="production-illustration" aria-hidden="true">
          <img src={productionLineIllustration} alt="" />
        </div>

        <div className="login-brand-values" aria-label="People, process, a safer tomorrow">
          <span>People</span><i aria-hidden="true" /><span>Process</span><i aria-hidden="true" /><span>A safer tomorrow</span>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-card" aria-labelledby="login-title">
          <header className="login-card-header">
            <svg className="login-factory-logo" viewBox="0 0 88 78" aria-hidden="true">
              <path fill="currentColor" d="M8 70V35l23-16v16l22-16v16l17-12V5h10l2 65H8Zm14-18v10h11V52H22Zm20 0v10h11V52H42Zm20 0v10h11V52H62Z" />
            </svg>
            <h1 id="login-title">Welcome back</h1>
            <p>Sign in to your production workspace</p>
          </header>

          {error ? <ErrorBanner message={error} /> : null}

          <form onSubmit={submit} className="stack-form login-form">
            <label>
              Username
              <span className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </span>
            </label>
            <label>
              Password
              <span className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                <input
                  type={showPassword ? "text" : "password"}
                  aria-label="Password"
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
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 8 9 8a17.8 17.8 0 0 1-2.1 3.3M6.6 6.6C4.3 8.1 3 12 3 12s3.5 8 9 8c1.1 0 2.1-.3 3-.7" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-8 9-8 9 8 9 8-3.5 8-9 8-9-8-9-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </span>
            </label>
            <button className="button button--primary login-submit" disabled={busy}>
              {busy ? <><span className="login-button-spinner" aria-hidden="true" />Signing in…</> : <>Sign in<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></>}
            </button>
          </form>

          <footer className="login-card-footer">
            <p>Need access? Contact your administrator.</p>
            <span className="demo-environment">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8" /></svg>
              Demo environment
            </span>
          </footer>
        </div>
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
  const [captureMode, setCaptureMode] = useState<"update" | "escalation">("update");
  const [capturePrefill, setCapturePrefill] = useState<{
    category: string;
    summary: string;
    details: string;
  } | null>(null);
  const [operationalDate, setOperationalDate] = useState(localDate());
  const [teamShiftPattern, setTeamShiftPattern] = useState<"day" | "night">("day");
  const [teamViewMode, setTeamViewMode] = useState<"live" | "historical">("live");
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
        setData(await loadWorkspaceData(operationalDate, teamShiftPattern));
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
  }, [operationalDate, teamShiftPattern]);

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
        setData(await loadWorkspaceData(operationalDate, teamShiftPattern));
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
  }, [operationalDate, profile, teamShiftPattern]);

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
  }, [online, profile, refresh, teamViewMode]);

  useEffect(() => {
    if (online && profile) void syncOutbox();
  }, [online, profile, syncOutbox]);

  useEffect(() => {
    if (!profile || !online) {
      setLiveState("offline");
      return;
    }
    if (profile.workspace === "team_leader" && teamViewMode === "historical") {
      setLiveState("snapshot");
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

  const openIssueFor = (
    assignmentId: number,
    mode: "update" | "escalation" = "update",
  ) => {
    setSelectedAssignment(assignmentId);
    setCaptureMode(mode);
    setCapturePrefill(null);
    setTab("issues");
  };

  const openMaterialIssue = (item: MaterialReadiness) => {
    setSelectedAssignment(item.assignment);
    setCaptureMode("escalation");
    setCapturePrefill({
      category: "material",
      summary: `${item.product_name} material risk`,
      details:
        item.status === "short"
          ? `${item.shortage_quantity} units short. Needed by ${item.expected_available_at ?? "time not set"}.`
          : item.hold_reason || item.notes || "Material requires follow-up.",
    });
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
    <>
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

      {profile ? (
        <TeamLeaderShell
          profile={profile}
          activeTab={tab}
          operationalDate={operationalDate}
          shifts={data.shifts}
          shiftPattern={teamShiftPattern}
          viewMode={teamViewMode}
          online={online}
          lastUpdatedAt={lastUpdatedAt}
          busy={loading}
          onSelectTab={setTab}
          onOperationalDateChange={(value) => {
            setOperationalDate(value);
            setTeamViewMode(value === localDate() ? "live" : "historical");
          }}
          onShiftPatternChange={setTeamShiftPattern}
          onViewModeChange={(value) => {
            setTeamViewMode(value);
            if (value === "live") setOperationalDate(localDate());
          }}
          onRefresh={() => void refresh()}
          onSignOut={signOut}
        >
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
              assignments={data.assignments.slice(0, 3)}
              users={data.users}
              selectedAssignment={selectedAssignment}
              initialMode={captureMode}
              initialEscalation={capturePrefill}
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
            shifts={data.shifts}
          />
        ) : null}
        {tab === "materials" && profile ? (
          <MaterialsPanel
            assignments={data.assignments}
            materials={data.materials}
            users={data.users}
            onRaiseIssue={openMaterialIssue}
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
        </TeamLeaderShell>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  );
}
