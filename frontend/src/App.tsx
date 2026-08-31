import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, apiList, apiRequest, clearSession, hasSession, login } from "./api";
import { ErrorBanner } from "./components";
import { BreakRecoveryPanel } from "./features/BreakRecoveryPanel";
import { HandoversPanel } from "./features/HandoversPanel";
import { ManagerConsole } from "./features/ManagerConsole";
import { MaterialsPanel } from "./features/MaterialsPanel";
import { MyLinesPanel } from "./features/MyLinesPanel";
import { RaiseIssuePanel } from "./features/RaiseIssuePanel";
import { localDate } from "./format";
import type {
  Assignment,
  BreakRecovery,
  Escalation,
  LineUpdate,
  ManagerWorkspaceData,
  MaterialReadiness,
  ShiftRecord,
  ShiftHandover,
  UserChoice,
  UserSummary,
  WorkspaceData,
  WorkspaceTab,
} from "./types";

const EMPTY_DATA: WorkspaceData = {
  assignments: [],
  updates: [],
  materials: [],
  escalations: [],
  breaks: [],
  handovers: [],
  users: [],
};

const EMPTY_MANAGER_DATA: ManagerWorkspaceData = {
  assignments: [],
  updates: [],
  materials: [],
  escalations: [],
  shifts: [],
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

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; shortLabel: string }> = [
  { id: "lines", label: "My Lines", shortLabel: "Lines" },
  { id: "issues", label: "Raise Issue", shortLabel: "Issue" },
  { id: "materials", label: "Materials", shortLabel: "Materials" },
  { id: "breaks", label: "Break & Recovery", shortLabel: "Breaks" },
  { id: "handover", label: "Handover", shortLabel: "Handover" },
];

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
  const [assignments, updates, materials, escalations, breaks, handovers, users] =
    await Promise.all([
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
      apiList<BreakRecovery>("/break-recoveries/?ordering=-created_at"),
      apiList<ShiftHandover>("/shift-handovers/?ordering=-handed_over_at"),
      apiList<UserChoice>("/active-users/"),
    ]);

  return { assignments, updates, materials, escalations, breaks, handovers, users };
}

async function loadManagerData(operationalDate: string): Promise<ManagerWorkspaceData> {
  const [assignments, updates, materials, escalations, shifts, summary] = await Promise.all([
    apiList<Assignment>(`/team-leader-assignments/?date=${operationalDate}`),
    apiList<LineUpdate>(`/hourly-line-updates/latest-status/?date=${operationalDate}`),
    apiList<MaterialReadiness>(
      `/product-material-readiness/?date=${operationalDate}&ordering=sequence_number`,
    ),
    apiList<Escalation>(
      `/operational-escalations/?date=${operationalDate}&ordering=-raised_at`,
    ),
    apiList<ShiftRecord>(`/shifts/?date=${operationalDate}&ordering=-actual_output`),
    apiRequest<ManagerWorkspaceData["summary"]>(
      `/dashboard/summary/?date_from=${operationalDate}&date_to=${operationalDate}`,
    ),
  ]);

  return { assignments, updates, materials, escalations, shifts, summary };
}

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          ML
        </div>
        <span className="eyebrow">Production operations workspace</span>
        <h1 id="login-title">Multi-Line Control</h1>
        <p>Team Leaders control assigned lines. Managers see the full Live Floor priority board.</p>
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
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="button button--primary button--large" disabled={busy}>
            {busy ? "Signing in…" : "Sign in securely"}
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
  const [loading, setLoading] = useState(hasSession());
  const [error, setError] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("lines");
  const [selectedAssignment, setSelectedAssignment] = useState<number | null>(null);
  const [operationalDate, setOperationalDate] = useState(localDate());
  const [toast, setToast] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const online = useOnlineStatus();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentProfile = await apiRequest<UserSummary>("/auth/me/");
      setProfile(currentProfile);
      if (currentProfile.is_staff) {
        setManagerData(await loadManagerData(operationalDate));
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

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError("");
    try {
      if (profile.is_staff) {
        setManagerData(await loadManagerData(operationalDate));
      } else {
        setData(await loadWorkspaceData(operationalDate));
      }
      setLastUpdatedAt(new Date().toISOString());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearSession();
        setProfile(null);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not refresh the workspace.");
      }
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
    if (!profile?.is_staff || !online) return;
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [online, profile?.is_staff, refresh]);

  const openIssueFor = (assignmentId: number) => {
    setSelectedAssignment(assignmentId);
    setTab("issues");
  };

  const unresolvedCount = useMemo(
    () => data.escalations.filter((item) => item.status !== "resolved").length,
    [data.escalations],
  );

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
    setLastUpdatedAt(null);
  };

  if (profile?.is_staff) {
    return (
      <ManagerConsole
        profile={profile}
        data={managerData}
        operationalDate={operationalDate}
        lastUpdatedAt={lastUpdatedAt}
        online={online}
        busy={loading}
        error={error}
        onDateChange={setOperationalDate}
        onRefresh={() => void refresh()}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="app-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          Offline: current screen remains visible, but new submissions need a connection.
        </div>
      ) : null}
      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-mark brand-mark--small" aria-hidden="true">
            ML
          </div>
          <div>
            <strong>Multi-Line Control</strong>
            <span>{operationalDate} · Live workspace</span>
          </div>
        </div>
        <div className="topbar__actions">
          <label className="date-control">
            <span>Operational date</span>
            <input
              aria-label="Operational date"
              type="date"
              value={operationalDate}
              onChange={(event) => setOperationalDate(event.target.value)}
            />
          </label>
          <span className="user-chip">{profile?.display_name}</span>
          <button className="button button--ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="button button--ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Team Leader workspace">
        <div className="shift-summary">
          <span className="eyebrow">Current scope</span>
          <strong>{data.assignments.length} assigned lines</strong>
          <span>{unresolvedCount} unresolved escalations</span>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "nav-item nav-item--active" : "nav-item"}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <span className="nav-item__dot" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
        <p className="sidebar__boundary">
          Visibility tool only. It does not replace approved verbal communication or official
          production records.
        </p>
      </aside>

      <main className="workspace">
        {error ? <ErrorBanner message={error} /> : null}
        {tab === "lines" ? (
          <MyLinesPanel data={data} onRaiseIssue={openIssueFor} />
        ) : null}
        {tab === "issues" && profile ? (
          <RaiseIssuePanel
            assignments={data.assignments}
            users={data.users}
            selectedAssignment={selectedAssignment}
            onSaved={async (message) => {
              await refresh();
              setToast(message);
            }}
          />
        ) : null}
        {tab === "materials" && profile ? (
          <MaterialsPanel
            assignments={data.assignments}
            materials={data.materials}
            users={data.users}
            onSaved={async (message) => {
              await refresh();
              setToast(message);
            }}
          />
        ) : null}
        {tab === "breaks" && profile ? (
          <BreakRecoveryPanel
            profile={profile}
            assignments={data.assignments}
            breaks={data.breaks}
            users={data.users}
            onSaved={async (message) => {
              await refresh();
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
              await refresh();
              setToast(message);
            }}
          />
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Team Leader workspace">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "bottom-nav__item bottom-nav__item--active" : "bottom-nav__item"}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.shortLabel}
          </button>
        ))}
      </nav>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
