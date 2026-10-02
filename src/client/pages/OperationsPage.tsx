import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpRight,
  Cable,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  Database,
  ImageOff,
  Info,
  Layers,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Replace,
  Sparkles,
  TriangleAlert,
  Waves
} from "lucide-react";
import { formatClock } from "../../shared/normalize";
import { generateTeamAliases, normalizeTeamName } from "../../shared/teamMatching";
import type { AppSettings, NormalizedLiveState, TeamMatchResult, TeamRecord, ThemeDefinition } from "../../shared/theme";
import { ApiError, api } from "../api";
import { useAssets, useLiveState, useNow, useOperatorTextState, useOverlayState, useRehearsal, useRuntimeInfo, useSettings, useTeams, useThemes } from "../hooks";
import { feedShowsRunningMatch } from "../../shared/rehearsal";
import { RehearsalPanel } from "../components/RehearsalPanel";
import { formatAge as formatOverlayAge, summarizeOverlays, type OverlayClient, type OverlayState } from "../../shared/overlayHealth";
import { showToast } from "../toast";
import { useEntranceCueToken } from "../appEvents";
import { Button, Chip, Dot, Grow, Toolbar, type Tone } from "../components/admin/kit";
import { OnAirStrip, type StripMarker } from "../components/OnAirStrip";

type WarningItem = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
};

type LogoResolution = {
  key: "registry" | "slotFallback" | "eventLogo" | "missing" | "unknown";
  label: string;
  tone: "ok" | "warning" | "info";
};

type ReadinessCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function formatAge(value: string | null) {
  if (!value) {
    return "No successful fetch yet";
  }

  const ageMs = Date.now() - Date.parse(value);
  if (Number.isNaN(ageMs) || ageMs < 0) {
    return "Unknown age";
  }
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 5) {
    return "Just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function isLocalBrowserHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function eventLabel(event: NormalizedLiveState["teamEvent"]) {
  switch (event) {
    case "towel-home":
      return "Towel on home";
    case "towel-away":
      return "Towel on away";
    case "base-home":
      return "Base point to home";
    case "base-away":
      return "Base point to away";
    default:
      return "None";
  }
}


type GoLiveIssue = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  cause: string;
  fix: string;
  /** One button that does the fix, e.g. copy the live URL. */
  action?: { label: string; onClick: () => void };
};

const ISSUE_SEVERITY_RANK: Record<GoLiveIssue["severity"], number> = {
  critical: 3,
  warning: 2,
  info: 1
};


// Which root cause an issue belongs to, so one outage does not surface as several cards.
const ISSUE_GROUPS: Record<string, { key: string; title?: string; fix?: string }> = {
  "Live feed unreachable": { key: "feed" },
  "Upstream reachable": { key: "feed" },
  "No data from the feed yet": { key: "feed" },
  "Waiting for the feed": { key: "feed" },
  "Feed data is out of date": { key: "feed" },
  "Live data fresh": { key: "feed" },
  "Left team needs confirmation": { key: "teams", title: "Team names need confirmation", fix: "Pick the team for each side in Team names on air." },
  "Right team needs confirmation": { key: "teams", title: "Team names need confirmation", fix: "Pick the team for each side in Team names on air." },
  "Left team resolved": { key: "teams", title: "Team names need confirmation", fix: "Pick the team for each side in Team names on air." },
  "Right team resolved": { key: "teams", title: "Team names need confirmation", fix: "Pick the team for each side in Team names on air." },
  "Left team has no logo": { key: "logos", title: "Team logos missing" },
  "Right team has no logo": { key: "logos", title: "Team logos missing" },
  "Logo coverage": { key: "logos", title: "Team logos missing" },
  "Both teams show the event logo": { key: "logos", title: "Team logos missing" }
};

function groupIssuesByCause(issues: GoLiveIssue[]) {
  const groups = new Map<string, GoLiveIssue[]>();
  for (const issue of issues) {
    const key = ISSUE_GROUPS[issue.title]?.key ?? issue.title;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }

  return Array.from(groups.values())
    .map((members) => {
      const lead = [...members].sort((a, b) => ISSUE_SEVERITY_RANK[b.severity] - ISSUE_SEVERITY_RANK[a.severity])[0];
      const group = members.length > 1 ? ISSUE_GROUPS[lead.title] : undefined;
      // Keep each distinct fact once: drop details another member already states in full.
      const unique = Array.from(new Set(members.map((member) => member.detail.trim().replace(/\.$/, "")).filter(Boolean)));
      const details = unique.filter((detail) => !unique.some((other) => other !== detail && other.includes(detail)));
      const detail = details.map((item) => `${item}.`).join(" ");
      return {
        ...lead,
        title: group?.title ?? lead.title,
        detail,
        // A cause that only repeated the detail would now repeat it twice.
        cause: lead.cause === lead.detail ? detail : lead.cause,
        fix: group?.fix ?? lead.fix
      };
    })
    .sort((a, b) => ISSUE_SEVERITY_RANK[b.severity] - ISSUE_SEVERITY_RANK[a.severity]);
}

function describeFeed(live: NormalizedLiveState | null, settings: AppSettings) {
  if (!live) {
    return { label: "Connecting", variant: "info" as const, detail: "Waiting for the first live state." };
  }
  const age = live.fetchedAt ? formatAge(live.fetchedAt).toLowerCase() : null;
  if (!settings.pollEnabled || live.sourceStatus === "paused") {
    return {
      label: "Paused",
      variant: "warning" as const,
      detail: age ? `Polling stopped. Overlay holds data from ${age}.` : "Polling stopped before any data arrived."
    };
  }
  if (live.sourceStatus === "error") {
    return {
      label: "Feed error",
      variant: "critical" as const,
      detail: age ? `Overlay holds data from ${age}.` : "No data received yet. Overlay shows placeholders."
    };
  }
  if (live.sourceStatus === "idle" || !live.fetchedAt) {
    return { label: "Connecting", variant: "warning" as const, detail: "No data received yet. Overlay shows placeholders." };
  }
  const staleThresholdMs = Math.max(settings.pollIntervalMs * 4, 5000);
  if (Date.now() - Date.parse(live.fetchedAt) > staleThresholdMs) {
    return { label: "Stale", variant: "warning" as const, detail: `Last update ${age}.` };
  }
  return { label: "Live", variant: "success" as const, detail: `Updated ${age}.` };
}


function normalizeReadinessIssue(check: ReadinessCheck): Pick<GoLiveIssue, "severity" | "title" | "detail"> {
  switch (check.label) {
    case "Upstream reachable":
      return {
        severity: "warning",
        title: "Live feed unreachable",
        detail: check.detail
      };
    case "Polling enabled":
      return {
        severity: "warning",
        title: "Polling is stopped",
        detail: check.detail
      };
    case "Live data fresh":
      return {
        severity: "warning",
        title: check.detail === "No successful fetch yet." ? "No data from the feed yet" : "Feed data is out of date",
        detail: check.detail
      };
    case "Published theme ready":
      return {
        severity: "critical",
        title: "No theme on air",
        detail: check.detail
      };
    case "Left team resolved":
      return {
        severity: "warning",
        title: "Left team needs confirmation",
        detail: check.detail
      };
    case "Right team resolved":
      return {
        severity: "warning",
        title: "Right team needs confirmation",
        detail: check.detail
      };
    case "Logo coverage":
      return {
        severity: "warning",
        title: "Logo coverage",
        detail: check.detail
      };
    default:
      return {
        severity: "warning",
        title: check.label,
        detail: check.detail
      };
  }
}

function issueGuidance(title: string, detail: string) {
  switch (title) {
    case "Live feed unreachable":
      return {
        cause: "The PBResults live feed can't be reached, or it is returning errors.",
        fix: "Check the PBResults machine and the network, confirm the feed address in Settings, then press Refresh now."
      };
    case "Feed data is out of date":
    case "Live data fresh":
      return {
        cause: "No new update has arrived for longer than a few polling cycles.",
        fix: "Leave polling on, check the connection to the PBResults machine, and wait for the next update."
      };
    case "Polling is stopped":
    case "Polling enabled":
      return {
        cause: "The app has stopped asking PBResults for updates, so the overlay is frozen.",
        fix: "Press Start polling at the top of this page; the status changes to Live."
      };
    case "No data from the feed yet":
    case "Waiting for the feed":
      return {
        cause: "The app has not received any data from PBResults since it started.",
        fix: "Confirm the feed address in Settings and the network, keep polling on, then press Refresh now."
      };
    case "Left team needs confirmation":
    case "Right team needs confirmation":
    case "Left team resolved":
    case "Right team resolved":
      return {
        cause: detail,
        fix: "Pick the team in Team names on air, from the suggestion or the search."
      };
    case "Left team has no logo":
    case "Right team has no logo":
    case "Logo coverage":
      return {
        cause: detail,
        fix: "Add the logo in Teams, or set a fallback image for the logo slot in the theme editor."
      };
    case "No theme on air":
    case "Published theme ready":
      return {
        cause: detail,
        fix: "Open Themes and publish the theme this event uses."
      };
    case "Upstream reachable":
      return {
        cause: detail,
        fix: "Check the PBResults machine is running and reachable at the feed address in Settings."
      };
    default:
      return {
        cause: detail,
        fix: "Resolve it in the matching section of this page before going on air."
      };
  }
}

function resolveLogoSource(
  side: "left" | "right",
  theme: ThemeDefinition | null,
  live: NormalizedLiveState | null
): LogoResolution {
  if (!theme || !live) {
    return {
      key: "unknown",
      label: "Waiting for theme or live data",
      tone: "info"
    };
  }

  const component = side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
  const team = side === "left" ? live.displayLeftTeamMatch.team : live.displayRightTeamMatch.team;
  const registryHasLogo = Boolean(team?.logoAssetId ?? team?.alternateLogoAssetId);
  const slotFallbackHasLogo = Boolean(component.assetId);
  const eventLogoHasLogo = Boolean(theme.components.eventLogo.assetId);

  if (registryHasLogo) {
    return {
      key: "registry",
      label: "Matched team logo",
      tone: "ok"
    };
  }

  switch (component.teamLogoFallbackMode) {
    case "eventLogo":
      return eventLogoHasLogo
        ? { key: "eventLogo", label: "Event logo fallback", tone: "warning" }
        : { key: "missing", label: "Event logo fallback missing", tone: "warning" };
    case "slotFallbackThenEventLogo":
      if (slotFallbackHasLogo) {
        return { key: "slotFallback", label: "Slot fallback logo", tone: "warning" };
      }
      if (eventLogoHasLogo) {
        return { key: "eventLogo", label: "Event logo fallback", tone: "warning" };
      }
      return { key: "missing", label: "No fallback logo available", tone: "warning" };
    case "slotFallback":
      return slotFallbackHasLogo
        ? { key: "slotFallback", label: "Slot fallback logo", tone: "warning" }
        : { key: "missing", label: "No slot fallback logo", tone: "warning" };
    case "none":
    default:
      return { key: "missing", label: "No logo fallback enabled", tone: "warning" };
  }
}

function buildWarnings(
  settings: AppSettings,
  live: NormalizedLiveState | null,
  theme: ThemeDefinition | null,
  leftLogo: LogoResolution,
  rightLogo: LogoResolution
) {
  const warnings: WarningItem[] = [];

  if (!settings.pollEnabled) {
    warnings.push({
      severity: "warning",
      title: "Polling is stopped",
      detail: "No new data is fetched until polling starts again."
    });
  }

  if (!theme) {
    warnings.push({
      severity: "critical",
      title: "No theme on air",
      detail: "The live overlay has no theme to show."
    });
  }

  if (!live) {
    warnings.push({
      severity: "warning",
      title: "Waiting for the feed",
      detail: "No live data has arrived yet."
    });
    return warnings;
  }

  if (live.sourceStatus === "error") {
    warnings.push({
      severity: "critical",
      title: "Live feed unreachable",
      detail: live.errorMessage ?? "The PBResults live feed could not be reached."
    });
  }

  if (live.sourceStatus === "idle") {
    warnings.push({
      severity: "warning",
      title: "No data from the feed yet",
      detail: "Waiting for the first update from PBResults."
    });
  }

  if (live.displayLeftTeamMatch.status !== "matched" && live.displayLeftTeamMatch.inputName.trim()) {
    warnings.push({
      severity: live.displayLeftTeamMatch.status === "uncertain" ? "warning" : "critical",
      title: "Left team needs confirmation",
      detail: `The feed sent “${live.displayLeftTeamMatch.inputName}” and no team is picked, so it shows on air as sent.`
    });
  }

  if (live.displayRightTeamMatch.status !== "matched" && live.displayRightTeamMatch.inputName.trim()) {
    warnings.push({
      severity: live.displayRightTeamMatch.status === "uncertain" ? "warning" : "critical",
      title: "Right team needs confirmation",
      detail: `The feed sent “${live.displayRightTeamMatch.inputName}” and no team is picked, so it shows on air as sent.`
    });
  }

  if (leftLogo.key === "missing") {
    warnings.push({
      severity: "warning",
      title: "Left team has no logo",
      detail: leftLogo.label
    });
  }

  if (rightLogo.key === "missing") {
    warnings.push({
      severity: "warning",
      title: "Right team has no logo",
      detail: rightLogo.label
    });
  }

  if (leftLogo.key === "eventLogo" && rightLogo.key === "eventLogo") {
    warnings.push({
      severity: "info",
      title: "Both teams show the event logo",
      detail: "Viewers may not tell the teams apart when both show the same image."
    });
  }

  const staleThresholdMs = Math.max(settings.pollIntervalMs * 4, 5000);
  if (live.fetchedAt && Date.now() - Date.parse(live.fetchedAt) > staleThresholdMs && live.sourceStatus !== "paused") {
    warnings.push({
      severity: "warning",
      title: "Feed data is out of date",
      detail: `Last successful fetch was ${formatAge(live.fetchedAt)}.`
    });
  }

  return warnings;
}

type TeamSearchResult = {
  team: TeamRecord;
  via: string | null;
};

// Ranks active teams against the typed query: name prefix, then alias/live-name prefix, then substring.
function searchTeams(teams: TeamRecord[], query: string, limit = 6): TeamSearchResult[] {
  const needle = normalizeTeamName(query);
  if (!needle) {
    return [];
  }

  const ranked: Array<TeamSearchResult & { rank: number }> = [];
  for (const team of teams) {
    if (!team.active) {
      continue;
    }
    const name = normalizeTeamName(team.canonicalName);
    if (name.startsWith(needle)) {
      ranked.push({ team, via: null, rank: 0 });
      continue;
    }
    const aliases = generateTeamAliases(team);
    const aliasPrefix = aliases.find((alias) => normalizeTeamName(alias).startsWith(needle));
    if (aliasPrefix) {
      ranked.push({ team, via: aliasPrefix, rank: 1 });
      continue;
    }
    if (name.includes(needle)) {
      ranked.push({ team, via: null, rank: 2 });
      continue;
    }
    const aliasContains = aliases.find((alias) => normalizeTeamName(alias).includes(needle));
    if (aliasContains) {
      ranked.push({ team, via: aliasContains, rank: 3 });
    }
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || a.team.canonicalName.localeCompare(b.team.canonicalName))
    .slice(0, limit)
    .map(({ team, via }) => ({ team, via }));
}

function describeResolution(match: TeamMatchResult, rememberedLiveName: boolean) {
  if (!match.inputName.trim()) {
    return { label: "Waiting", variant: "info" as const, hint: "No team name from the feed yet." };
  }
  if (match.resolutionSource === "manual") {
    return { label: "Override", variant: "success" as const, hint: "You picked this team for the current live name." };
  }
  if (rememberedLiveName) {
    return { label: "Remembered", variant: "success" as const, hint: null };
  }
  if (match.status === "matched") {
    return { label: "Matched", variant: "success" as const, hint: null };
  }
  if (match.status === "uncertain") {
    return { label: "Check", variant: "warning" as const, hint: "Not certain. Confirm the suggestion or search for the right team." };
  }
  return { label: "No match", variant: "critical" as const, hint: "Pick the team for this name." };
}

function feedTone(variant: ReturnType<typeof describeFeed>["variant"]): Tone {
  return variant === "success" ? "ok" : variant === "critical" ? "critical" : variant === "warning" ? "warning" : "blue";
}

function statusTone(variant: ReturnType<typeof describeResolution>["variant"]): Tone {
  return variant === "success" ? "ok" : variant === "critical" ? "critical" : variant === "warning" ? "warning" : "neutral";
}

function FactList({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="ad-facts">
      {items.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Disclosure({
  icon,
  title,
  summary,
  children,
  id
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <details className="ad-disclose" id={id}>
      <summary>
        {icon}
        <b>{title}</b>
        <span className="ad-muted">{summary}</span>
        <ChevronDown className="ad-disclose-chevron" aria-hidden />
      </summary>
      <div className="ad-disclose-body">{children}</div>
    </details>
  );
}

function ago(value: string, now: number) {
  return formatOverlayAge(now - Date.parse(value));
}

const CONNECTION_COPY: Record<OverlayClient["connection"], string> = {
  connected: "connected",
  stale: "not responding",
  lost: "lost",
  closed: "closed"
};

/** Every page showing the overlay: what it renders and when it last reported. */
function OverlayPages({ state, now }: { state: OverlayState | null; now: number }) {
  if (!state) {
    return <p className="ad-hint">Checking…</p>;
  }
  if (!state.clients.length) {
    return <p className="ad-hint">No page has loaded the overlay since the server started.</p>;
  }
  return (
    <>
      <ul className="ad-overlay-pages">
        {state.clients.map((client) => {
          const tone =
            client.connection === "lost" || client.connection === "stale"
              ? "critical"
              : client.connection === "closed"
                ? undefined
                : client.issues.length
                  ? "warning"
                  : client.page === "live"
                    ? "live"
                    : undefined;
          const issues = new Set(client.issues.map((issue) => issue.code));
          const report = client.report;
          const status =
            client.connection === "connected"
              ? report?.visibility === "hidden"
                ? "in background"
                : `connected ${ago(client.firstSeenAt, now)}`
              : `${CONNECTION_COPY[client.connection]} ${ago(client.lastSeenAt, now)} ago`;
          return (
            <li key={client.clientId} className={`ad-overlay-page is-${client.connection}`}>
              <Dot tone={tone} flat />
              <div>
                <div className="ad-overlay-page-head">
                  <b>
                    {client.page === "live" ? "Live" : "Preview"} · {client.local ? "This computer" : client.remoteAddress}
                  </b>
                  <span className="ad-hint">{status}</span>
                </div>
                <dl className="ad-overlay-page-facts">
                  <dt>Browser</dt>
                  <dd>{client.browser}</dd>
                  <dt>Theme</dt>
                  <dd className={issues.has("wrong-theme") || issues.has("outdated-theme") ? "is-warn" : undefined}>
                    {client.themeName ?? report?.themeId ?? "—"}
                    {issues.has("outdated-theme") ? " · older save" : ""}
                  </dd>
                  <dt>Live data</dt>
                  <dd className={issues.has("behind") ? "is-warn" : undefined}>
                    {client.lagMs === null ? (report?.liveSourceStatus === "ok" ? "—" : "feed not live") : `${Math.round(client.lagMs / 1000)} s behind the server`}
                    {report?.transport === "fallback" ? " · polling" : ""}
                  </dd>
                  <dt>Size</dt>
                  <dd>{report ? `${report.viewport.width} × ${report.viewport.height}` : "—"}</dd>
                  {issues.has("old-version") ? (
                    <>
                      <dt>Version</dt>
                      <dd className="is-warn">{report?.appVersion} (older)</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="ad-hint">Shows what each page renders and when it last reported. Whether vMix has the input on Program is not visible from here.</p>
    </>
  );
}

/**
 * Finds a team by typing. Enter uses the highlighted team for this match; Shift+Enter also remembers the feed name.
 * Shared by the inline picker (when a name needs a team) and the Change team popover.
 */
function TeamPicker({
  side,
  inputName,
  teams,
  logoFor,
  suggestions,
  disabled,
  autoFocus,
  createName,
  onPick,
  onCreate
}: {
  side: "left" | "right";
  inputName: string;
  teams: TeamRecord[];
  logoFor: (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
  suggestions: TeamMatchResult["candidates"];
  disabled: boolean;
  /** Only the Change team popover takes focus; the inline picker must never pull focus away mid-typing. */
  autoFocus: boolean;
  /** Offered when the feed name has no team: creates one with that name and puts it on air. */
  createName: string | null;
  onPick: (teamId: string, remember: boolean) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [remember, setRemember] = useState(false);
  const searched = useMemo(() => searchTeams(teams, query), [query, teams]);
  const byId = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const options = query.trim()
    ? searched.map((result) => ({ id: result.team.id, name: result.team.canonicalName, tag: result.via ? `as ${result.via}` : null, team: result.team }))
    : suggestions.map((candidate) => ({
        id: candidate.teamId,
        name: candidate.teamName,
        tag: `${Math.round(candidate.confidence * 100)}%`,
        team: byId.get(candidate.teamId) ?? null
      }));
  const listId = `team-picker-${side}`;

  function pick(index: number, rememberName: boolean) {
    const target = options[index];
    if (!target || disabled) return;
    onPick(target.id, rememberName);
    setQuery("");
  }

  return (
    <div className="ad-picker">
      <input
        className="ad-input"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`Search a team for the ${side} side`}
        aria-activedescendant={options[highlight] ? `${listId}-${options[highlight].id}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search teams, short names, match names"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setHighlight((current) => (current + 1) % options.length);
          } else if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            setHighlight((current) => (current - 1 + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(highlight, remember || event.shiftKey);
          } else if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery("");
          }
        }}
      />
      <ul id={listId} role="listbox" className="ad-picker-list" aria-label={query.trim() ? "Matching teams" : "Suggested teams"}>
        {options.length === 0 ? (
          <li className="ad-picker-empty">{query.trim() ? `No active team matches “${query.trim()}”.` : "Type to search the team registry."}</li>
        ) : (
          options.map((option, index) => {
            const logo = logoFor(option.team);
            return (
              <li
                key={option.id}
                id={`${listId}-${option.id}`}
                role="option"
                aria-selected={index === highlight}
                className="ad-picker-option"
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(index, remember || event.shiftKey);
                }}
              >
                <span className="ad-picker-logo">{logo ? <img src={logo} alt="" /> : null}</span>
                <span className="ad-picker-name">{option.name}</span>
                {option.tag ? <span className="ad-picker-tag">{option.tag}</span> : null}
              </li>
            );
          })
        )}
      </ul>
      {createName ? (
        <button type="button" className="ad-picker-create" disabled={disabled} onClick={onCreate}>
          <Plus aria-hidden />
          Create team “{createName}”
        </button>
      ) : null}
      <label className="ad-picker-remember">
        <input className="ad-check" type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        <span>
          Remember “{inputName || "this name"}”
          <span className="ad-hint">Next time the feed sends it, the same team is picked automatically.</span>
        </span>
      </label>
      <div className="ad-picker-keys ad-hint">
        <kbd>↵</kbd> Use for this match <kbd>⇧↵</kbd> Use and remember
      </div>
    </div>
  );
}

function TeamSide({
  side,
  match,
  renderedName,
  teams,
  logoFor,
  resolving,
  clearing,
  canCreate,
  onApply,
  onClear,
  onCreate
}: {
  side: "left" | "right";
  match: TeamMatchResult;
  renderedName: string;
  teams: TeamRecord[];
  logoFor: (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
  resolving: boolean;
  clearing: boolean;
  canCreate: boolean;
  onApply: (teamId: string, remember: boolean) => void;
  onClear: () => void;
  onCreate: () => void;
}) {
  const hasInput = Boolean(match.inputName.trim());
  const manualOverrideActive = match.resolutionSource === "manual";
  const rememberedLiveName = Boolean(match.resolutionSource === "automatic" && match.team?.liveMatchNames.includes(match.matchedAlias ?? ""));
  const needsPick = hasInput && match.status !== "matched" && !manualOverrideActive;
  const status = describeResolution(match, rememberedLiveName);
  const [changing, setChanging] = useState(false);

  // Close the picker whenever the live name or its resolution changes underneath the operator.
  const resolutionKey = `${match.inputName}|${match.status}|${match.resolutionSource}|${match.teamId ?? ""}`;
  const previousKeyRef = useRef(resolutionKey);
  useEffect(() => {
    if (previousKeyRef.current !== resolutionKey) {
      previousKeyRef.current = resolutionKey;
      setChanging(false);
    }
  }, [resolutionKey]);

  const busy = resolving || !hasInput;
  const label = status.label === "Override" ? "Picked by you" : status.label === "Check" ? "Not sure" : status.label;
  const logo = logoFor(match.team);
  const pickHint =
    match.status === "uncertain" && match.candidates[0]
      ? `Looks like ${match.candidates[0].teamName}. Confirm it, or search for the right team.`
      : match.status === "unmatched"
        ? "Nothing in Teams looks like this name."
        : status.hint;
  const picker = (
    <TeamPicker
      side={side}
      inputName={match.inputName}
      teams={teams}
      logoFor={logoFor}
      suggestions={(needsPick ? match.candidates : match.candidates.filter((candidate) => candidate.teamId !== match.teamId)).slice(0, 3)}
      disabled={busy}
      autoFocus={!needsPick}
      createName={needsPick && match.status === "unmatched" && canCreate ? match.inputName.trim() : null}
      onPick={(teamId, remember) => {
        setChanging(false);
        onApply(teamId, remember);
      }}
      onCreate={onCreate}
    />
  );

  return (
    <div className={needsPick ? "ad-team-side needs-pick" : "ad-team-side"}>
      <div className="ad-side-label">
        {side === "left" ? <ArrowLeftToLine aria-hidden /> : <ArrowRightToLine aria-hidden />}
        {side === "left" ? "Left team" : "Right team"}
        <Chip tone={statusTone(status.variant)}>{label}</Chip>
      </div>

      {hasInput ? (
        <div className="ad-team-id">
          <span className={logo ? "ad-team-logo" : "ad-team-logo is-empty"}>{logo ? <img src={logo} alt="" /> : <ImageOff aria-hidden />}</span>
          <div className="ad-team-text">
            <div className={match.team ? "ad-team-name" : "ad-team-name is-missing"}>{match.team?.canonicalName ?? "No team yet"}</div>
            <div className="ad-feed-name">
              Feed sends <code>{match.inputName}</code>
              {match.team ? null : " · on air as typed"}
            </div>
          </div>
        </div>
      ) : (
        <p className="ad-hint">{status.hint}</p>
      )}

      {needsPick ? (
        <>
          <p className={match.status === "unmatched" ? "ad-side-hint is-critical" : "ad-side-hint"}>{pickHint}</p>
          {picker}
        </>
      ) : hasInput ? (
        <div className="ad-team-actions">
          <Popover.Root open={changing} onOpenChange={setChanging}>
            <Popover.Trigger asChild>
              <Button disabled={busy}>
                <Replace aria-hidden />
                Change team
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="ad-scope ad-pop ad-picker-pop" align="start" sideOffset={6}>
                {picker}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {manualOverrideActive ? (
            <Button variant="text" onClick={onClear} disabled={clearing}>
              {clearing ? "Clearing…" : "Back to automatic"}
            </Button>
          ) : null}
          {resolving ? <span className="ad-hint">Applying…</span> : null}
        </div>
      ) : null}

      {status.hint && hasInput && !needsPick ? <p className="ad-side-hint">{status.hint}</p> : null}

      {hasInput ? (
        <details className="ad-why">
          <summary>
            <ChevronRight aria-hidden />
            Why this team?
          </summary>
          <FactList
            items={[
              ["Read as", match.normalizedInput || "—"],
              ["Matched by", match.matchedAlias ?? (manualOverrideActive ? "Your pick" : "—")],
              ["How sure", `${Math.round(match.confidence * 100)}%`],
              ["Shown on air", renderedName || "—"]
            ]}
          />
        </details>
      ) : null}
    </div>
  );
}

export function OperationsPage() {
  const settings = useSettings();
  const themes = useThemes();
  const teams = useTeams();
  const assets = useAssets();
  const runtimeInfo = useRuntimeInfo();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const operatorText = useOperatorTextState();
  const [togglingPoll, setTogglingPoll] = useState(false);
  const [togglingMotion, setTogglingMotion] = useState(false);
  const [playingEntrance, setPlayingEntrance] = useState(false);
  const entranceToken = useEntranceCueToken();
  const [refreshing, setRefreshing] = useState(false);
  const [resolvingSide, setResolvingSide] = useState<"left" | "right" | null>(null);
  const [clearingSide, setClearingSide] = useState<"left" | "right" | null>(null);
  const operatorThemeIdRef = useRef<string | null>(null);
  const [operatorTextDrafts, setOperatorTextDrafts] = useState<Record<string, string>>({});
  const [dirtyOperatorTextIds, setDirtyOperatorTextIds] = useState<Set<string>>(() => new Set());
  const [operatorTextBusyId, setOperatorTextBusyId] = useState<string | null>(null);

  const publishedTheme = useMemo(
    () => themes.data?.find((theme) => theme.id === settings.data?.publishedThemeId) ?? null,
    [settings.data?.publishedThemeId, themes.data]
  );
  const themeHasEntrance = Boolean(
    publishedTheme &&
      [...Object.values(publishedTheme.components), ...publishedTheme.freeComponents].some((component) => component.visible && component.enterMotion.preset !== "none")
  );

  const browserOrigin = typeof window === "undefined" ? null : window.location.origin;
  const currentHostname = typeof window === "undefined" ? null : window.location.hostname;
  const vmixOrigin =
    browserOrigin && currentHostname && isLocalBrowserHost(currentHostname) && runtimeInfo.data?.preferredOrigin
      ? runtimeInfo.data.preferredOrigin
      : browserOrigin;
  const liveUrl = browserOrigin ? `${browserOrigin}/overlay/live` : "/overlay/live";
  const previewUrl = publishedTheme && browserOrigin ? `${browserOrigin}/overlay/preview/${publishedTheme.id}` : publishedTheme ? `/overlay/preview/${publishedTheme.id}` : null;
  const vmixLiveUrl = vmixOrigin ? `${vmixOrigin}/overlay/live` : liveUrl;
  const vmixPreviewUrl = publishedTheme && vmixOrigin ? `${vmixOrigin}/overlay/preview/${publishedTheme.id}` : previewUrl;

  const leftLogo = useMemo(() => resolveLogoSource("left", publishedTheme, live.data), [publishedTheme, live.data]);
  const rightLogo = useMemo(() => resolveLogoSource("right", publishedTheme, live.data), [publishedTheme, live.data]);

  const warnings = useMemo(() => {
    if (!settings.data) {
      return [];
    }
    return buildWarnings(settings.data, live.data, publishedTheme, leftLogo, rightLogo);
  }, [leftLogo, live.data, publishedTheme, settings.data, rightLogo]);

  const readinessChecks = useMemo<ReadinessCheck[]>(() => {
    if (!settings.data) {
      return [];
    }

    return [
      {
        label: "Upstream reachable",
        ok: live.data?.sourceStatus === "ok",
        detail:
          live.data?.sourceStatus === "ok"
            ? "Live feed is responding."
            : live.data?.errorMessage || "Waiting for a healthy upstream response."
      },
      {
        label: "Polling enabled",
        ok: settings.data.pollEnabled,
        detail: settings.data.pollEnabled ? "Automatic polling is running." : "Polling is currently paused."
      },
      {
        label: "Live data fresh",
        ok:
          Boolean(live.data?.fetchedAt) &&
          Date.now() - Date.parse(live.data?.fetchedAt ?? "") <= Math.max(settings.data.pollIntervalMs * 4, 5000),
        detail: live.data?.fetchedAt ? `Last successful fetch ${formatAge(live.data.fetchedAt)}.` : "No successful fetch yet."
      },
      {
        label: "Published theme ready",
        ok: Boolean(publishedTheme),
        detail: publishedTheme ? publishedTheme.name : "Choose a published theme."
      },
      {
        label: "Left team resolved",
        ok: live.data?.displayLeftTeamMatch.status === "matched" || !live.data?.displayLeftTeamMatch.inputName.trim(),
        detail:
          live.data?.displayLeftTeamMatch.status === "matched"
            ? live.data.displayLeftTeamMatch.team?.canonicalName ?? "Matched"
            : `The feed sent “${live.data?.displayLeftTeamMatch.inputName ?? ""}” and no team is picked, so it shows on air as sent.`
      },
      {
        label: "Right team resolved",
        ok: live.data?.displayRightTeamMatch.status === "matched" || !live.data?.displayRightTeamMatch.inputName.trim(),
        detail:
          live.data?.displayRightTeamMatch.status === "matched"
            ? live.data.displayRightTeamMatch.team?.canonicalName ?? "Matched"
            : `The feed sent “${live.data?.displayRightTeamMatch.inputName ?? ""}” and no team is picked, so it shows on air as sent.`
      },
      {
        label: "Logo coverage",
        ok: leftLogo.key !== "missing" && rightLogo.key !== "missing",
        detail: `Left: ${leftLogo.label}. Right: ${rightLogo.label}.`
      }
    ];
  }, [leftLogo, live.data, publishedTheme, rightLogo, settings.data]);

  const overlayState = useOverlayState();
  const rehearsal = useRehearsal();
  const rehearsalPhase = rehearsal.data?.phase ?? "idle";
  const rehearsing = rehearsalPhase === "running";
  const [rehearsalOpen, setRehearsalOpen] = useState(false);
  // A running or just-ended rehearsal always shows its panel, in every tab.
  const showRehearsal = rehearsalOpen || rehearsalPhase !== "idle";
  const now = useNow();
  const overlaySummary = summarizeOverlays(overlayState, now, publishedTheme?.name ?? null);
  const overlayCheck = overlaySummary.check;
  const overlayLevel = overlaySummary.level;

  const goLiveIssues = useMemo<GoLiveIssue[]>(() => {
    const issuesFromWarnings: GoLiveIssue[] = warnings.map((warning) => ({
      severity: warning.severity,
      title: warning.title,
      detail: warning.detail,
      ...issueGuidance(warning.title, warning.detail)
    }));

    const issuesFromReadiness: GoLiveIssue[] = readinessChecks
      .filter((check) => !check.ok)
      .map((check) => {
        const normalized = normalizeReadinessIssue(check);
        return {
          ...normalized,
          ...issueGuidance(normalized.title, normalized.detail)
        };
      });

    const issuesFromOverlay: GoLiveIssue[] =
      overlayCheck && (overlayLevel === "critical" || overlayLevel === "warning")
        ? [
            {
              severity: overlayLevel,
              title: overlayCheck.title,
              detail: overlayCheck.detail,
              cause: overlayCheck.detail,
              fix: overlayCheck.fix,
              action: overlayCheck.showUrl ? { label: "Copy live URL", onClick: () => void handleCopyOverlayUrl(vmixLiveUrl) } : undefined
            }
          ]
        : [];

    const deduped = new Map<string, GoLiveIssue>();
    [...issuesFromOverlay, ...issuesFromWarnings, ...issuesFromReadiness].forEach((issue) => {
      const current = deduped.get(issue.title);
      if (!current) {
        deduped.set(issue.title, issue);
        return;
      }
      if (ISSUE_SEVERITY_RANK[issue.severity] > ISSUE_SEVERITY_RANK[current.severity]) {
        deduped.set(issue.title, issue);
      }
    });

    return groupIssuesByCause(Array.from(deduped.values()));
  }, [readinessChecks, warnings, overlayCheck?.title, overlayCheck?.detail, overlayLevel, vmixLiveUrl]);

  const goLiveStatus = useMemo(() => {
    if (goLiveIssues.some((issue) => issue.severity === "critical")) {
      return { label: "Action needed", variant: "critical" as const };
    }
    if (goLiveIssues.length > 0) {
      return { label: "Check", variant: "warning" as const };
    }
    return { label: "Ready", variant: "success" as const };
  }, [goLiveIssues]);

  useEffect(() => {
    const state = operatorText.data;
    if (!state) {
      return;
    }
    const themeChanged = operatorThemeIdRef.current !== state.themeId;
    operatorThemeIdRef.current = state.themeId;
    if (themeChanged) {
      setDirtyOperatorTextIds(new Set());
      setOperatorTextDrafts(Object.fromEntries(state.fields.map((field) => [field.componentId, field.value])));
      return;
    }
    setOperatorTextDrafts((current) =>
      Object.fromEntries(
        state.fields.map((field) => [
          field.componentId,
          dirtyOperatorTextIds.has(field.componentId) ? current[field.componentId] ?? field.value : field.value
        ])
      )
    );
  }, [dirtyOperatorTextIds, operatorText.data]);

  async function handleSetPolling(enabled: boolean) {
    if (!enabled && !window.confirm("Stop polling the live feed? The overlay freezes on the current data until you start polling again.")) {
      return;
    }
    setTogglingPoll(true);
    try {
      const next = enabled ? await api.startLivePolling() : await api.stopLivePolling();
      settings.setData(next);
      showToast({ kind: "success", message: enabled ? "Live polling started." : "Live polling stopped." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to update polling." });
    } finally {
      setTogglingPoll(false);
    }
  }

  async function handlePlayEntrance() {
    setPlayingEntrance(true);
    try {
      await api.playEntrance();
      showToast({ kind: "success", message: "Entrance played on the live overlay." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to play the entrance." });
    } finally {
      setPlayingEntrance(false);
    }
  }

  async function handleSetReduceMotion(reduceMotion: boolean) {
    if (!settings.data) {
      return;
    }
    setTogglingMotion(true);
    try {
      const next = await api.updateSettings({ ...settings.data, reduceMotion });
      settings.setData(next);
      showToast({ kind: "success", message: reduceMotion ? "Motion reduced: the overlay cuts instead of animating." : "Overlay motion is back on." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to update motion." });
    } finally {
      setTogglingMotion(false);
    }
  }

  async function handleRefreshNow() {
    setRefreshing(true);
    try {
      await api.refreshLivePolling();
      showToast({ kind: "success", message: "Refresh requested." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to refresh live feed." });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCopyOverlayUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      showToast({ kind: "success", message: "Overlay URL copied.", durationMs: 1600 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to copy overlay URL." });
    }
  }

  async function handleApplyResolution(side: "left" | "right", match: TeamMatchResult, teamId: string, remember = false, forceReassign = false) {
    if (!teamId || !match.inputName.trim()) {
      return;
    }
    const selectedTeamName = teams.data?.find((team) => team.id === teamId)?.canonicalName ?? "the selected team";
    setResolvingSide(side);
    try {
      const result = await api.resolveLiveTeam({
        teamId,
        rawInputName: match.inputName,
        remember,
        forceReassign
      });
      if (result.rememberedTeam || result.reassignedFromTeam) {
        teams.setData((current) =>
          (current ?? []).map((team) => {
            if (result.rememberedTeam && team.id === result.rememberedTeam.id) {
              return result.rememberedTeam;
            }
            if (result.reassignedFromTeam && team.id === result.reassignedFromTeam.id) {
              return result.reassignedFromTeam;
            }
            return team;
          })
        );
      }
      showToast({
        kind: "success",
        message: remember
          ? `Override applied and "${match.inputName}" will now match automatically.`
          : `Override applied for "${match.inputName}".`
      });
    } catch (error) {
      if (error instanceof ApiError && remember && !forceReassign && error.status === 409 && error.payload?.conflictType === "reassignable") {
        const confirmed = window.confirm(
          `"${match.inputName}" is already remembered for ${error.payload.conflictTeamName ?? "another team"}. Reassign it to ${selectedTeamName}?`
        );
        if (confirmed) {
          await handleApplyResolution(side, match, teamId, true, true);
          return;
        }
      }
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to apply team override." });
    } finally {
      setResolvingSide(null);
    }
  }

  async function handleClearResolution(side: "left" | "right") {
    const match = side === "left" ? live.data?.displayLeftTeamMatch : live.data?.displayRightTeamMatch;
    if (!match?.inputName.trim()) {
      return;
    }
    setClearingSide(side);
    try {
      await api.clearLiveTeamResolution(side, match.inputName);
      showToast({ kind: "success", message: `Override cleared for "${match.inputName}".` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to clear team override." });
    } finally {
      setClearingSide(null);
    }
  }

  async function handleTakeOperatorText(componentId: string) {
    const themeId = operatorText.data?.themeId;
    if (!themeId) {
      return;
    }
    setOperatorTextBusyId(componentId);
    try {
      await api.updateOperatorText(themeId, componentId, operatorTextDrafts[componentId] ?? "");
      setDirtyOperatorTextIds((current) => {
        const next = new Set(current);
        next.delete(componentId);
        return next;
      });
      showToast({ kind: "success", message: "Operator text taken live.", durationMs: 1600 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to take operator text live." });
    } finally {
      setOperatorTextBusyId(null);
    }
  }

  async function handleResetOperatorText(componentId: string) {
    const themeId = operatorText.data?.themeId;
    if (!themeId) {
      return;
    }
    setOperatorTextBusyId(componentId);
    try {
      await api.resetOperatorText(themeId, componentId);
      setDirtyOperatorTextIds((current) => {
        const next = new Set(current);
        next.delete(componentId);
        return next;
      });
      showToast({ kind: "success", message: "Operator text reset to its theme default.", durationMs: 1800 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to reset operator text." });
    } finally {
      setOperatorTextBusyId(null);
    }
  }


  async function handleTakeAll() {
    const fields = operatorText.data?.fields ?? [];
    for (const field of fields) {
      const draft = operatorTextDrafts[field.componentId] ?? field.value;
      if (dirtyOperatorTextIds.has(field.componentId) && draft.length <= field.maxLength) {
        await handleTakeOperatorText(field.componentId);
      }
    }
  }

  const [creatingSide, setCreatingSide] = useState<"left" | "right" | null>(null);

  // Creates a team named exactly as the feed sends it, so it also matches automatically next time, and puts it on air.
  async function handleCreateTeam(side: "left" | "right", match: TeamMatchResult) {
    const name = match.inputName.trim();
    if (!name || creatingSide) return;
    setCreatingSide(side);
    try {
      const created = await api.createTeam({ canonicalName: name, active: true });
      teams.setData((current) => [...(current ?? []), created].sort((left, right) => left.canonicalName.localeCompare(right.canonicalName)));
      showToast({ kind: "success", message: `Created ${created.canonicalName}. Add its logo in Teams.` });
      await handleApplyResolution(side, match, created.id, false);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to create the team." });
    } finally {
      setCreatingSide(null);
    }
  }

  function canCreateTeam(inputName: string) {
    const wanted = normalizeTeamName(inputName);
    return Boolean(wanted) && !(teams.data ?? []).some((team) => normalizeTeamName(team.canonicalName) === wanted);
  }

  const assetUrl = useMemo(() => new Map((assets.data ?? []).map((asset) => [asset.id, asset.url])), [assets.data]);
  const logoFor = (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => {
    const id = team?.logoAssetId ?? team?.alternateLogoAssetId;
    return id ? assetUrl.get(id) : undefined;
  };

  if (!settings.data || !themes.data || !teams.data) {
    return (
      <div className="ad-page ad-scope">
        <Toolbar title="Operations" />
        <p className="ad-hint" style={{ padding: 20 }}>
          Loading operations…
        </p>
      </div>
    );
  }

  const feed = describeFeed(live.data, settings.data);
  const operatorFields = operatorText.data?.fields ?? [];
  const pendingTakeIds = operatorFields
    .filter((field) => dirtyOperatorTextIds.has(field.componentId) && (operatorTextDrafts[field.componentId] ?? field.value).length <= field.maxLength)
    .map((field) => field.componentId);
  const stripOperatorText =
    operatorText.data && publishedTheme && operatorText.data.themeId === publishedTheme.id
      ? Object.fromEntries(operatorText.data.fields.map((field) => [field.componentId, field.value]))
      : {};
  const stripMarkers: StripMarker[] = [];
  if (live.data) {
    for (const [side, match] of [
      ["left", live.data.displayLeftTeamMatch],
      ["right", live.data.displayRightTeamMatch]
    ] as const) {
      if (!match.inputName.trim() || match.status === "matched" || match.resolutionSource === "manual") continue;
      stripMarkers.push({
        side,
        tone: match.status === "uncertain" ? "warning" : "critical",
        label: `${match.status === "uncertain" ? "Not sure" : "No team"} · shows “${match.inputName}”${match.team ? "" : ", no logo"}`
      });
    }
  }
  const readyChecks: Array<{ label: string; detail: string }> = [
    { label: "Feed reachable", detail: live.data?.fetchedAt ? formatAge(live.data.fetchedAt) : "—" },
    { label: "Polling on", detail: `every ${settings.data.pollIntervalMs} ms` },
    { label: "Theme on air", detail: publishedTheme?.name ?? "—" },
    { label: "Both teams matched", detail: live.data?.displayLeftTeamMatch.inputName ? "left and right" : "waiting for names" },
    { label: "Team logos", detail: leftLogo.key === "registry" && rightLogo.key === "registry" ? "from Teams" : "fallback in use" },
    { label: "Live overlay connected", detail: overlaySummary.code === "connected" ? overlaySummary.label.toLowerCase() : overlaySummary.label }
  ];

  const openOverlayPages = () => {
    const details = document.getElementById("overlay-pages") as HTMLDetailsElement | null;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="ad-page ad-scope">
      <Toolbar title="Operations">
        <span className="ad-feed-state" role="status" aria-live="polite">
          <Chip tone={feedTone(feed.variant)}>
            <Dot tone={feed.variant === "success" ? "live" : feed.variant === "critical" ? "critical" : feed.variant === "warning" ? "warning" : undefined} flat />
            {feed.label === "Live" ? "Feed live" : feed.label}
          </Chip>
          <span className="ad-hint" title={live.data?.errorMessage ?? undefined}>
            {feed.detail}
            {settings.data.pollEnabled ? ` Checking every ${settings.data.pollIntervalMs} ms.` : ""}
          </span>
        </span>
        <Grow />
        <Button
          variant="ghost"
          disabled={rehearsing}
          title={rehearsing ? "A rehearsal is running" : "Play test cases on the live overlay before a show"}
          onClick={() => setRehearsalOpen(true)}
        >
          <Play aria-hidden />
          {rehearsing ? "Rehearsing…" : "Rehearse"}
        </Button>
        {goLiveIssues.length ? (
          <a className="ad-btn ad-btn--ghost ad-issues-link" href="#operator-status">
            <TriangleAlert aria-hidden />
            {goLiveIssues.length === 1 ? "1 issue" : `${goLiveIssues.length} issues`}
          </a>
        ) : null}
        {themeHasEntrance ? (
          <Button
            variant="ghost"
            disabled={playingEntrance || settings.data.reduceMotion}
            title={settings.data.reduceMotion ? "Motion is reduced, so pieces appear without their entrance" : "Play the scoreboard's entrance on the live overlay, e.g. as you cut to it"}
            onClick={() => void handlePlayEntrance()}
          >
            <Sparkles aria-hidden />
            Play entrance
          </Button>
        ) : null}
        <Button
          variant={settings.data.reduceMotion ? "default" : "ghost"}
          aria-pressed={settings.data.reduceMotion}
          disabled={togglingMotion}
          title={
            settings.data.reduceMotion
              ? "The overlay cuts instead of animating. Click to bring motion back."
              : "Make the overlay cut instead of animate: no score pops, pulses or looping event cards"
          }
          onClick={() => void handleSetReduceMotion(!settings.data!.reduceMotion)}
        >
          <Waves aria-hidden />
          {settings.data.reduceMotion ? "Motion reduced" : "Reduce motion"}
        </Button>
        <Button variant="ghost" onClick={() => void handleRefreshNow()} disabled={refreshing}>
          <RefreshCw aria-hidden />
          {refreshing ? "Refreshing…" : "Refresh now"}
        </Button>
        <Button
          variant={settings.data.pollEnabled ? "default" : "primary"}
          onClick={() => void handleSetPolling(!settings.data!.pollEnabled)}
          disabled={togglingPoll}
        >
          {settings.data.pollEnabled ? <Pause aria-hidden /> : <Play aria-hidden />}
          {togglingPoll ? "Updating…" : settings.data.pollEnabled ? "Stop polling" : "Start polling"}
        </Button>
      </Toolbar>

      <div className="ad-body">
        <div className="ad-ops2">
          <OnAirStrip
            theme={publishedTheme}
            live={live.data}
            assets={assets.data ?? []}
            operatorTextValues={stripOperatorText}
            reduceMotion={settings.data.reduceMotion}
            entranceToken={entranceToken}
            markers={stripMarkers}
            summary={
              live.data ? (
                <>
                  <b>
                    {live.data.displayLeftTeam.name || "Left"} {live.data.displayLeftTeam.score}–{live.data.displayRightTeam.score}{" "}
                    {live.data.displayRightTeam.name || "Right"}
                  </b>{" "}
                  · {formatClock(live.data.gameTimer.value)} · {live.data.state} / {live.data.period}
                </>
              ) : (
                live.error ?? "Waiting for live data…"
              )
            }
            overlayUrl={vmixLiveUrl}
            onCopyUrl={() => void handleCopyOverlayUrl(vmixLiveUrl)}
            overlayStatus={overlayState ? { level: overlaySummary.level, label: overlaySummary.chip, onOpen: openOverlayPages } : null}
            rehearsalLabel={rehearsing && rehearsal.data ? `Rehearsal · case ${rehearsal.data.caseIndex + 1}` : null}
          />
          <div className="ad-ops2-grid">
            <div className="ad-ops-col">
              <section className="ad-surface" aria-labelledby="team-resolution-title">
                <div className="ad-section-head ad-ops-head">
                  <h2 id="team-resolution-title" className="ad-title">
                    Team names on air
                  </h2>
                  <p className="ad-hint">A pick applies to this feed name only, unless you choose Remember.</p>
                </div>
                {rehearsing ? (
                  <p className="ad-callout ad-callout--info ad-rh-callout ad-rh-picks">
                    Team picks are paused during the rehearsal: these names are test data, and nothing here is saved.
                  </p>
                ) : null}
                {live.data ? (
                  // A disabled fieldset turns off every pick, create and remember control while rehearsing.
                  <fieldset className="ad-resolve-fieldset" disabled={rehearsing}>
                  <div className="ad-resolve">
                    <TeamSide
                      side="left"
                      match={live.data.displayLeftTeamMatch}
                      renderedName={live.data.displayLeftTeam.name}
                      teams={teams.data}
                      logoFor={logoFor}
                      resolving={resolvingSide === "left" || creatingSide === "left"}
                      clearing={clearingSide === "left"}
                      onApply={(teamId, remember) => void handleApplyResolution("left", live.data!.displayLeftTeamMatch, teamId, remember)}
                      onClear={() => void handleClearResolution("left")}
                      canCreate={canCreateTeam(live.data.displayLeftTeamMatch.inputName)}
                      onCreate={() => void handleCreateTeam("left", live.data!.displayLeftTeamMatch)}
                    />
                    <TeamSide
                      side="right"
                      match={live.data.displayRightTeamMatch}
                      renderedName={live.data.displayRightTeam.name}
                      teams={teams.data}
                      logoFor={logoFor}
                      resolving={resolvingSide === "right" || creatingSide === "right"}
                      clearing={clearingSide === "right"}
                      onApply={(teamId, remember) => void handleApplyResolution("right", live.data!.displayRightTeamMatch, teamId, remember)}
                      onClear={() => void handleClearResolution("right")}
                      canCreate={canCreateTeam(live.data.displayRightTeamMatch.inputName)}
                      onCreate={() => void handleCreateTeam("right", live.data!.displayRightTeamMatch)}
                    />
                  </div>
                  </fieldset>
                ) : (
                  <p className="ad-hint ad-section">{live.error ?? "Waiting for live data…"}</p>
                )}
              </section>

            {operatorFields.length || operatorText.error ? (
              <section className="ad-surface" aria-labelledby="operator-text-title">
                <div className="ad-section">
                  <div className="ad-section-head">
                    <h2 id="operator-text-title" className="ad-title">
                      Operator text
                    </h2>
                    <p className="ad-hint">
                      {operatorFields.length > 1
                        ? `${operatorFields.length} in this theme${pendingTakeIds.length ? ` · ${pendingTakeIds.length === 1 ? "1 draft" : `${pendingTakeIds.length} drafts`} not on air` : ""}`
                        : "Type a draft, then Take it live."}
                    </p>
                    {pendingTakeIds.length > 1 ? (
                      <Button variant="primary" onClick={() => void handleTakeAll()} disabled={operatorTextBusyId !== null}>
                        <Dot flat />
                        Take all ({pendingTakeIds.length})
                      </Button>
                    ) : null}
                  </div>
                  {operatorText.error ? <p className="ad-hint">{operatorText.error}</p> : null}
                  <div className="ad-og-list">
                    {operatorFields.map((field) => {
                      const draft = operatorTextDrafts[field.componentId] ?? field.value;
                      const dirty = dirtyOperatorTextIds.has(field.componentId);
                      const busy = operatorTextBusyId === field.componentId;
                      const inputId = `optext-${field.componentId}`;
                      const updateDraft = (value: string) => {
                        setOperatorTextDrafts((current) => ({ ...current, [field.componentId]: value }));
                        setDirtyOperatorTextIds((current) => new Set(current).add(field.componentId));
                      };
                      const take = () => {
                        if (!busy && dirty && draft.length <= field.maxLength) void handleTakeOperatorText(field.componentId);
                      };
                      return (
                        <div key={field.componentId} className="ad-og-row">
                          <label className="ad-og-label" htmlFor={inputId}>
                            {field.label}
                            {field.multiline ? <small>Several lines</small> : null}
                          </label>
                          <div className="ad-og-main">
                            {field.multiline ? (
                              <textarea
                                id={inputId}
                                className="ad-textarea"
                                rows={2}
                                maxLength={field.maxLength}
                                value={draft}
                                onChange={(event) => updateDraft(event.target.value)}
                              />
                            ) : (
                              <input
                                id={inputId}
                                className="ad-input"
                                maxLength={field.maxLength}
                                value={draft}
                                onChange={(event) => updateDraft(event.target.value.replace(/[\r\n]+/g, " "))}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    take();
                                  }
                                }}
                              />
                            )}
                            <div className="ad-og-air" title={field.value}>
                              <Dot tone="tally" flat />
                              On air: <b>{field.value || "(blank)"}</b>
                              <span className="ad-og-count">
                                {draft.length} / {field.maxLength}
                              </span>
                            </div>
                          </div>
                          <div className="ad-og-actions">
                            <Chip tone={dirty ? "warning" : field.hasOverride ? "ok" : "neutral"}>{dirty ? "Draft" : field.hasOverride ? "On air" : "Default"}</Chip>
                            <Button variant="ghost" disabled={busy || !field.hasOverride} onClick={() => void handleResetOperatorText(field.componentId)} title="Back to the theme's default text">
                              Reset
                            </Button>
                            <Button variant="primary" disabled={busy || !dirty || draft.length > field.maxLength} onClick={take} title="Put this text on air (Enter)">
                              {busy ? "Taking…" : "Take"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : null}
            </div>
            <div className="ad-ops-col">
              {showRehearsal ? (
                <RehearsalPanel
                  status={rehearsal.data}
                  themeName={publishedTheme?.name ?? null}
                  blockedReason={
                    !publishedTheme
                      ? "No theme is on air. Put a theme on air first: rehearsal tests what vMix shows."
                      : live.data && !rehearsing && feedShowsRunningMatch(live.data)
                        ? "A match is running. Rehearsal takes over what vMix shows, so it only starts when the feed is stopped, paused or unreachable, or during a break."
                        : null
                  }
                  onStatus={(status) => rehearsal.setData?.(status)}
                  onClose={() => setRehearsalOpen(false)}
                />
              ) : (
              <section id="operator-status" className="ad-surface" aria-labelledby="checks-title">
                <div className="ad-section-head ad-ops-head">
                  <h2 id="checks-title" className="ad-title">
                    Checks
                  </h2>
                  <Chip tone={goLiveStatus.variant === "success" ? "ok" : goLiveStatus.variant} className="ad-push">
                    {goLiveStatus.label}
                  </Chip>
                </div>
                {goLiveIssues.length ? (
                  <ul className="ad-issues">
                    {goLiveIssues.map((issue) => (
                      <li key={`${issue.severity}-${issue.title}`} className={`ad-issue is-${issue.severity}`}>
                        {issue.severity === "info" ? <Info aria-hidden /> : <TriangleAlert aria-hidden />}
                        <div>
                          <b>
                            <span className="ad-sr">{issue.severity === "critical" ? "Critical: " : issue.severity === "warning" ? "Warning: " : "Note: "}</span>
                            {issue.title}
                          </b>
                          {issue.cause !== issue.detail ? <p className="ad-muted">{issue.cause}</p> : null}
                          <p className="ad-muted ad-break">{issue.detail}</p>
                          <p>
                            <b>Fix:</b> {issue.fix}
                          </p>
                          {issue.action ? (
                            <div className="ad-actions">
                              <Button size="sm" onClick={issue.action.onClick}>
                                <Copy aria-hidden />
                                {issue.action.label}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="ad-checks">
                    {readyChecks.map((check) => (
                      <li key={check.label}>
                        <CircleCheck aria-hidden />
                        {check.label}
                        <span className="ad-hint">{check.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              )}
              <section className="ad-surface" aria-label="Setup and diagnostics">
                <Disclosure icon={<Cable aria-hidden />} title="vMix setup" summary="URL, host, shortcuts">
                  <FactList
                    items={[
                      ["vMix live URL", <span className="ad-break">{vmixLiveUrl}</span>],
                      ["Host address for vMix", runtimeInfo.data?.preferredHost ?? "The address in use now"]
                    ]}
                  />
                  <div className="ad-actions">
                    <Button onClick={() => void handleCopyOverlayUrl(vmixLiveUrl)}>
                      <Copy aria-hidden />
                      Copy live URL
                    </Button>
                    <a className="ad-btn ad-btn--ghost" href={vmixLiveUrl} target="_blank" rel="noreferrer">
                      Open live overlay
                    </a>
                    {vmixPreviewUrl ? (
                      <a className="ad-btn ad-btn--ghost" href={vmixPreviewUrl} target="_blank" rel="noreferrer">
                        Open preview
                      </a>
                    ) : null}
                    {publishedTheme ? (
                      <Link className="ad-btn ad-btn--ghost" to={`/admin/themes/${publishedTheme.id}`}>
                        Edit theme on air
                      </Link>
                    ) : null}
                  </div>
                </Disclosure>
                <Disclosure icon={<Database aria-hidden />} title="Feed data" summary="What the feed sends">
                  {live.data ? (
                    <FactList
                      items={[
                        ["Teams on screen", `${live.data.displayLeftTeam.name || "Left"} vs ${live.data.displayRightTeam.name || "Right"}`],
                        ["Score", `${live.data.displayLeftTeam.score} – ${live.data.displayRightTeam.score}`],
                        ["Main clock", formatClock(live.data.gameTimer.value)],
                        ["Break clock", formatClock(live.data.breakTimer.value)],
                        ["State / period", `${live.data.state} / ${live.data.period}`],
                        ["Round", String(live.data.round)],
                        ["Sides switched", live.data.sidesSwitched ? "Yes" : "No"],
                        ["Current event", eventLabel(live.data.teamEvent)],
                        ["Second game", Array.isArray(live.data.secondGame) ? "Available" : "None"],
                        ["Last update", formatTimestamp(live.data.fetchedAt)]
                      ]}
                    />
                  ) : (
                    <p className="ad-hint">{live.error ?? "Waiting for live data…"}</p>
                  )}
                </Disclosure>
                <Disclosure
                  id="overlay-pages"
                  icon={<MonitorPlay aria-hidden />}
                  title="Overlay pages"
                  summary={overlayState ? overlaySummary.chip : "Checking…"}
                >
                  <OverlayPages state={overlayState} now={now} />
                </Disclosure>
                <Disclosure icon={<Layers aria-hidden />} title="Overlay details" summary="Logo sources, modes">
                  <FactList
                    items={[
                      ["Theme on air", publishedTheme?.name ?? "None"],
                      ["Left logo", <Chip tone={leftLogo.tone === "ok" ? "ok" : leftLogo.tone === "warning" ? "warning" : "blue"}>{leftLogo.label}</Chip>],
                      ["Right logo", <Chip tone={rightLogo.tone === "ok" ? "ok" : rightLogo.tone === "warning" ? "warning" : "blue"}>{rightLogo.label}</Chip>],
                      [
                        "Lower line",
                        live.data?.period === "BREAK" ? publishedTheme?.centerSecondary.breakMode ?? "—" : publishedTheme?.centerSecondary.gameMode ?? "—"
                      ],
                      [
                        "Operator text",
                        operatorFields.length ? (
                          `${operatorFields.length} in this theme`
                        ) : (
                          <>
                            None in this theme
                            {publishedTheme ? (
                              <>
                                {" · "}
                                <Link className="ad-text-link" to={`/admin/themes/${publishedTheme.id}`}>
                                  Edit theme on air
                                </Link>
                              </>
                            ) : null}
                          </>
                        )
                      ],
                      [
                        "Overlay state",
                        live.data?.teamEvent === "none" ? "Normal" : live.data?.teamEvent.startsWith("towel") ? "Towel overlay" : "Base overlay"
                      ]
                    ]}
                  />
                </Disclosure>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
