import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Globe,
  Images,
  Monitor,
  MonitorPlay,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  ScanLine,
  Settings2,
  Shield,
  Sun,
  TriangleAlert,
  Wrench
} from "lucide-react";
import { ToastViewport } from "./ToastViewport";
import { ConfirmHost } from "../confirm";
import { cn } from "../lib/utils";
import { useAssets, useLiveState, useNow, useOverlayState, useRehearsal, useRemoteAccessStatus, useRuntimeVersionWatcher, useSettings, useTeams, useThemes } from "../hooks";
import { formatRemaining, formatRemoteConnections, formatTime } from "./RemoteAccessRows";
import { api } from "../api";
import { summarizeOverlays } from "../../shared/overlayHealth";
import { DEFAULT_APP_NAME, appDisplayName, type AppSettings } from "../../shared/theme";
import { setBaseTitle } from "../documentTitle";
import { AppearanceContext, useAdminAppearance, type AppearancePreference } from "../appearance";
import { formatClock } from "../../shared/normalize";
import { liveSummary, overlayDot } from "./liveSummary";
import { Dot, IconButton } from "./admin/kit";

function outletKey(pathname: string) {
  for (const prefix of ["/admin/teams", "/admin/assets"]) {
    if (pathname.startsWith(prefix)) return prefix;
  }
  return pathname;
}

const APPEARANCE_OPTIONS: Array<{ value: AppearancePreference; label: string; icon: typeof Sun }> = [
  { value: "system", label: "Follow system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon }
];

const COLLAPSE_KEY = "pbresults.admin.sidebarCollapsed";

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  useRuntimeVersionWatcher();
  const location = useLocation();
  const appearance = useAdminAppearance();
  const settings = useSettings();
  const themes = useThemes();
  const teams = useTeams();
  const assets = useAssets();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const focusMode = /^\/admin\/themes\/[^/]+/.test(location.pathname);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Still collapses for this visit.
      }
      return next;
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const appName = appDisplayName(settings.data);
  const showPoweredBy = appName !== DEFAULT_APP_NAME && (settings.data?.brandPoweredBy ?? true);
  const brandLogoId = settings.data?.brandLogoAssetId ?? null;
  const brandLogoUrl = brandLogoId ? assets.data?.find((asset) => asset.id === brandLogoId)?.url : undefined;

  useEffect(() => {
    setBaseTitle(appName);
  }, [appName]);

  useEffect(() => {
    if (!brandLogoUrl) return;
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = brandLogoUrl;
    document.head.appendChild(icon);
    return () => icon.remove();
  }, [brandLogoUrl]);

  const onAirTheme = themes.data?.find((theme) => theme.id === settings.data?.publishedThemeId) ?? null;

  const navItems = [
    { to: "/admin/operations", label: "Operations", icon: RadioTower, active: location.pathname === "/admin/operations" },
    { to: "/admin/themes", label: "Themes", icon: Palette, active: location.pathname.startsWith("/admin/themes"), count: themes.data?.length },
    { to: "/admin/teams", label: "Teams", icon: Shield, active: location.pathname.startsWith("/admin/teams"), count: teams.data?.length },
    { to: "/admin/assets", label: "Assets", icon: Images, active: location.pathname.startsWith("/admin/assets"), count: assets.data?.length },
    { to: "/admin/maintenance", label: "Maintenance", icon: Wrench, active: location.pathname === "/admin/maintenance" },
    { to: "/admin/settings", label: "Settings", icon: Settings2, active: location.pathname === "/admin/settings" }
  ];

  return (
    <AppearanceContext.Provider value={appearance}>
      <div className={cn("pba-shell", collapsed && "is-collapsed", focusMode && "is-focus")}>
        <aside className="pba-side pba-scope" aria-label="Main" hidden={focusMode}>
          <div className="pba-side-head">
            {brandLogoUrl ? (
              <span className="pba-mark pba-mark--logo" aria-hidden>
                <img src={brandLogoUrl} alt="" />
              </span>
            ) : (
              <span className="pba-mark" aria-hidden>
                <ScanLine />
              </span>
            )}
            <span className="pba-app-name" title={appName}>
              {appName}
              {showPoweredBy ? <small>Powered by {DEFAULT_APP_NAME}</small> : null}
            </span>
          </div>

          <nav className="pba-nav">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} aria-current={item.active ? "page" : undefined} title={collapsed ? item.label : undefined}>
                <item.icon aria-hidden />
                <span>{item.label}</span>
                {item.count !== undefined ? <span className="pba-nav-count">{item.count}</span> : null}
              </Link>
            ))}
            <div className="pba-nav-sep" />
            <a className="pba-nav-ext" href="/overlay/live" target="_blank" rel="noreferrer" title="Opens the live overlay in a new tab">
              <MonitorPlay aria-hidden />
              <span>Open live overlay</span>
              <ArrowUpRight className="pba-trail" aria-hidden />
            </a>
          </nav>

          <div className="pba-side-foot">
            <SidebarLiveStatus settings={settings.data} onAirTheme={onAirTheme} />

            <div className="pba-foot-row">
              <div className="pba-seg" role="radiogroup" aria-label="Appearance">
                {APPEARANCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={appearance.preference === option.value}
                    aria-label={option.label}
                    title={option.label}
                    onClick={() => appearance.setPreference(option.value)}
                  >
                    <option.icon aria-hidden />
                  </button>
                ))}
              </div>
              <IconButton className="pba-rail-collapse" label="Collapse sidebar" title="Collapse sidebar (Ctrl/Cmd+\)" onClick={toggleCollapsed}>
                <PanelLeftClose />
              </IconButton>
              <IconButton className="pba-rail-expand" label="Expand sidebar" title="Expand sidebar (Ctrl/Cmd+\)" onClick={toggleCollapsed}>
                <PanelLeftOpen />
              </IconButton>
            </div>
          </div>
        </aside>
        <main className="pba-main">
          {/* Teams and Assets keep one page while their side panel opens different records, so the list and filters stay put. */}
          <RemoteAccessBanner />
          <RehearsalBanner />
          <Outlet key={outletKey(location.pathname)} />
        </main>
        <ToastViewport />
        <ConfirmHost />
      </div>
    </AppearanceContext.Provider>
  );
}

/** Its own component: the live clock re-renders it several times a second, and the pages must not follow. */
function SidebarLiveStatus({
  settings,
  onAirTheme
}: {
  settings: AppSettings | null;
  onAirTheme: { id: string; name: string } | null;
}) {
  const live = useLiveState(true, settings?.pollIntervalMs);
  const overlayState = useOverlayState();
  const rehearsal = useRehearsal();
  const rehearsing = rehearsal.data?.phase === "running";
  const now = useNow();
  const overlay = summarizeOverlays(overlayState, now, onAirTheme?.name ?? null);
  const overlayLine = overlayDot(overlayState ? overlay : null);
  const summary = liveSummary(live.data, settings, onAirTheme, now, overlayState ? overlay : null);
  const state = live.data;
  const StateIcon = summary.tone === "ok" ? CircleCheck : summary.tone === "critical" ? CircleAlert : TriangleAlert;

  return (
    <Link className="pba-live" to="/admin/operations" title={`Feed ${summary.feedLabel.toLowerCase()} · Overlay ${overlayLine.label} · ${summary.stateLabel}. Opens Operations.`}>
      <div className="pba-live-body">
        <div className="pba-live-row">
          <span className="pba-k">On air</span>
          <Dot tone={onAirTheme ? "tally" : undefined} />
          <span className="pba-v">{onAirTheme?.name ?? "No theme"}</span>
        </div>
        <div className="pba-live-row" title="Whether the page vMix loads (/overlay/live) is connected and current">
          <span className="pba-k">Overlay</span>
          <Dot tone={overlayLine.tone} />
          <span className="pba-v">{overlayLine.label}</span>
        </div>
        {state && state.sourceStatus !== "idle" ? (
          <div className="pba-live-score">
            <b>
              {state.displayLeftTeam.name || "Left"} {state.displayLeftTeam.score}–{state.displayRightTeam.score}{" "}
              {state.displayRightTeam.name || "Right"}
            </b>{" "}
            · {formatClock(state.gameTimer.value)}
          </div>
        ) : null}
        {rehearsing && rehearsal.data ? (
          <div className="pba-live-state pba-live-state--rehearsal">
            <Dot tone="rehearsal" />
            Rehearsing · case {rehearsal.data.caseIndex + 1} of {rehearsal.data.cases.length}
          </div>
        ) : (
          <div className={`pba-live-state pba-live-state--${summary.tone}`}>
            <StateIcon aria-hidden />
            {summary.stateLabel}
          </div>
        )}
      </div>
      <div className="pba-live-mini" aria-hidden>
        <Dot tone={onAirTheme ? "tally" : undefined} />
        <Dot tone={overlayLine.tone} />
        {/* The overall state, so a feed problem still shows with the sidebar collapsed. */}
        <Dot tone={summary.tone === "ok" ? "live" : summary.tone} />
      </div>
    </Link>
  );
}

/**
 * On every admin page, for every browser, while remote access is on. Not dismissable: it is how everyone editing
 * knows changes may be coming from off site too.
 */
function RemoteAccessBanner() {
  const remote = useRemoteAccessStatus();
  const now = useNow(30_000);
  const location = useLocation();
  const status = remote.data;
  if (!status || (status.phase !== "active" && status.phase !== "degraded")) return null;
  const degraded = status.phase === "degraded";
  const remaining = formatRemaining(status.expiresAt, now);
  return (
    <div className={cn("pba-ra-banner pba-scope", degraded && "pba-ra-banner--critical")} role="status">
      <Globe aria-hidden />
      {degraded ? "Remote access is reconnecting" : status.remoteRequest ? "You are connected remotely" : "Remote access is on"}
      <span>
        {status.remoteRequest ? "" : `· ${formatRemoteConnections(status.remoteConnections)} `}·{" "}
        {remaining === "ending now" ? "ending now" : `ends ${formatTime(status.expiresAt)} (${remaining})`}
      </span>
      <span className="pba-grow" />
      {status.managementAllowed && location.pathname !== "/admin/maintenance" ? (
        <Link className="pba-btn pba-btn--sm pba-btn--ghost" to="/admin/maintenance#set-remote">
          Manage
        </Link>
      ) : null}
    </div>
  );
}

/** On every admin page while a rehearsal runs: vMix is showing test data, and one click ends it. */
function RehearsalBanner() {
  const rehearsal = useRehearsal();
  const status = rehearsal.data;
  const location = useLocation();
  if (!status || status.phase !== "running") return null;
  return (
    <div className="pba-rh-banner pba-scope" role="status">
      <Dot tone="rehearsal" />
      Rehearsing
      <span>
        · vMix is showing test data, case {status.caseIndex + 1} of {status.cases.length}
      </span>
      <span className="pba-grow" />
      {location.pathname !== "/admin/operations" ? (
        <Link className="pba-btn pba-btn--sm pba-btn--ghost" to="/admin/operations">
          Open rehearsal
        </Link>
      ) : null}
      <button
        type="button"
        className="pba-btn pba-btn--sm"
        onClick={() => void api.rehearsal("stop").then((next) => rehearsal.setData?.(next)).catch(() => undefined)}
      >
        Stop rehearsal
      </button>
    </div>
  );
}
