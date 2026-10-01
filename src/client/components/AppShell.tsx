import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
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
  TriangleAlert
} from "lucide-react";
import { ToastViewport } from "./ToastViewport";
import { cn } from "../lib/utils";
import { useAssets, useLiveState, useNow, useOverlayState, useRuntimeVersionWatcher, useSettings, useTeams, useThemes } from "../hooks";
import { summarizeOverlays } from "../../shared/overlayHealth";
import type { AppSettings } from "../../shared/theme";
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

  const onAirTheme = themes.data?.find((theme) => theme.id === settings.data?.publishedThemeId) ?? null;

  const navItems = [
    { to: "/admin/operations", label: "Operations", icon: RadioTower, active: location.pathname === "/admin/operations" },
    { to: "/admin/themes", label: "Themes", icon: Palette, active: location.pathname.startsWith("/admin/themes"), count: themes.data?.length },
    { to: "/admin/teams", label: "Teams", icon: Shield, active: location.pathname.startsWith("/admin/teams"), count: teams.data?.length },
    { to: "/admin/assets", label: "Assets", icon: Images, active: location.pathname.startsWith("/admin/assets"), count: assets.data?.length },
    { to: "/admin/settings", label: "Settings", icon: Settings2, active: location.pathname === "/admin/settings" }
  ];

  return (
    <AppearanceContext.Provider value={appearance}>
      <div className={cn("ad-shell", collapsed && "is-collapsed", focusMode && "is-focus")}>
        <aside className="ad-side ad-scope" aria-label="Main" hidden={focusMode}>
          <div className="ad-side-head">
            <span className="ad-mark" aria-hidden>
              <ScanLine />
            </span>
            <span className="ad-app-name">PBResults Scoreboard</span>
          </div>

          <nav className="ad-nav">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} aria-current={item.active ? "page" : undefined} title={collapsed ? item.label : undefined}>
                <item.icon aria-hidden />
                <span>{item.label}</span>
                {item.count !== undefined ? <span className="ad-nav-count">{item.count}</span> : null}
              </Link>
            ))}
            <div className="ad-nav-sep" />
            <a className="ad-nav-ext" href="/overlay/live" target="_blank" rel="noreferrer" title="Opens the live overlay in a new tab">
              <MonitorPlay aria-hidden />
              <span>Open live overlay</span>
              <ArrowUpRight className="ad-trail" aria-hidden />
            </a>
          </nav>

          <div className="ad-side-foot">
            <SidebarLiveStatus settings={settings.data} onAirTheme={onAirTheme} />

            <div className="ad-foot-row">
              <div className="ad-seg" role="radiogroup" aria-label="Appearance">
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
              <IconButton className="ad-rail-collapse" label="Collapse sidebar" title="Collapse sidebar (Ctrl/Cmd+\)" onClick={toggleCollapsed}>
                <PanelLeftClose />
              </IconButton>
              <IconButton className="ad-rail-expand" label="Expand sidebar" title="Expand sidebar (Ctrl/Cmd+\)" onClick={toggleCollapsed}>
                <PanelLeftOpen />
              </IconButton>
            </div>
          </div>
        </aside>
        <main className="ad-main">
          {/* Teams and Assets keep one page while their side panel opens different records, so the list and filters stay put. */}
          <Outlet key={outletKey(location.pathname)} />
        </main>
        <ToastViewport />
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
  const now = useNow();
  const overlay = summarizeOverlays(overlayState, now, onAirTheme?.name ?? null);
  const overlayLine = overlayDot(overlayState ? overlay : null);
  const summary = liveSummary(live.data, settings, onAirTheme, now, overlayState ? overlay : null);
  const state = live.data;
  const StateIcon = summary.tone === "ok" ? CircleCheck : summary.tone === "critical" ? CircleAlert : TriangleAlert;

  return (
    <Link className="ad-live" to="/admin/operations" title={`${summary.feedLabel} · Overlay ${overlayLine.label} · ${summary.stateLabel}. Opens Operations.`}>
      <div className="ad-live-body">
        <div className="ad-live-row">
          <span className="ad-k">Feed</span>
          <Dot tone={summary.feedTone} />
          <span className="ad-v">{summary.feedLabel}</span>
        </div>
        <div className="ad-live-row">
          <span className="ad-k">On air</span>
          <Dot tone={onAirTheme ? "tally" : undefined} />
          <span className="ad-v">{onAirTheme?.name ?? "No theme"}</span>
        </div>
        <div className="ad-live-row" title="Whether the page vMix loads (/overlay/live) is connected and current">
          <span className="ad-k">Overlay</span>
          <Dot tone={overlayLine.tone} />
          <span className="ad-v">{overlayLine.label}</span>
        </div>
        {state && state.sourceStatus !== "idle" ? (
          <div className="ad-live-score">
            <b>
              {state.displayLeftTeam.name || "Left"} {state.displayLeftTeam.score}–{state.displayRightTeam.score}{" "}
              {state.displayRightTeam.name || "Right"}
            </b>{" "}
            · {formatClock(state.gameTimer.value)}
          </div>
        ) : null}
        <div className={`ad-live-state ad-live-state--${summary.tone}`}>
          <StateIcon aria-hidden />
          {summary.stateLabel}
        </div>
      </div>
      <div className="ad-live-mini" aria-hidden>
        <Dot tone={summary.feedTone} />
        <Dot tone={onAirTheme ? "tally" : undefined} />
        <Dot tone={overlayLine.tone} />
      </div>
    </Link>
  );
}
