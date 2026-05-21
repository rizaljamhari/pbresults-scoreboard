import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Palette, Radio } from "lucide-react";
import { formatClock } from "../../shared/normalize";
import type {
  AppSettings,
  NormalizedLiveState,
  TeamMatchResult,
  TeamRecord,
  ThemeDefinition
} from "../../shared/theme";
import { ApiError, api } from "../api";
import { useAutoCloseRowActionMenus, useLiveState, useSettings, useTeams, useThemes } from "../hooks";
import { showToast } from "../toast";
import {
  AdminPageFrame,
  AdminPageHeader,
  AdminStatTile,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldHint,
  Select,
  StatusPanel,
  buttonVariants
} from "../components/ui";

// Overlay preview with zoom controls (persisted in localStorage)
function OverlayPreviewWithZoom({ liveUrl }: { liveUrl: string }) {
  const [zoom, setZoom] = useState(() => {
    const stored = window.localStorage.getItem("overlayPreviewZoom");
    const parsed = stored ? parseFloat(stored) : 2;
    return isNaN(parsed) ? 2 : Math.min(3, Math.max(1, parsed));
  });
  useEffect(() => {
    window.localStorage.setItem("overlayPreviewZoom", String(zoom));
  }, [zoom]);

  function handleZoomIn() {
    setZoom((z: number) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
  }
  function handleZoomOut() {
    setZoom((z: number) => Math.max(1, Math.round((z - 0.25) * 100) / 100));
  }

  return (
    <div
      className="group/zoom relative overflow-hidden rounded-md3m border border-md3-outlineVariant bg-black"
      tabIndex={0}
    >
      <div
        className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 opacity-0 transition-opacity group-hover/zoom:opacity-100 group-focus-within/zoom:opacity-100"
        style={{ pointerEvents: "auto" }}
      >
        <button
          type="button"
          aria-label="Zoom out"
          className="rounded border border-md3-outlineVariant bg-md3-surface px-2 py-0.5 text-lg font-bold text-md3-onSurfaceVariant disabled:opacity-50"
          onClick={handleZoomOut}
          disabled={zoom <= 1}
        >
          –
        </button>
        <span className="min-w-[2.5em] text-center text-xs font-semibold text-md3-onSurfaceVariant">{zoom.toFixed(2)}x</span>
        <button
          type="button"
          aria-label="Zoom in"
          className="rounded border border-md3-outlineVariant bg-md3-surface px-2 py-0.5 text-lg font-bold text-md3-onSurfaceVariant disabled:opacity-50"
          onClick={handleZoomIn}
          disabled={zoom >= 3}
        >
          +
        </button>
      </div>
      <iframe
        title="Live scoreboard overlay"
        src={liveUrl}
        className="h-[184px] w-full origin-center border-0 pointer-events-none transition-transform duration-200"
        style={{ transform: `scale(${zoom})` }}
        loading="lazy"
      />
    </div>
  );
}

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

type OperatorPriority = {
  tone: "success" | "warning" | "critical";
  title: string;
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

function matchTone(match: TeamMatchResult) {
  if (match.status === "matched") {
    return "success" as const;
  }
  if (match.status === "uncertain") {
    return "warning" as const;
  }
  return "critical" as const;
}

function confidenceTone(confidence: number) {
  if (confidence >= 0.95) {
    return "success" as const;
  }
  if (confidence >= 0.75) {
    return "warning" as const;
  }
  return "info" as const;
}

function sourceStatusTone(sourceStatus: NormalizedLiveState["sourceStatus"] | undefined) {
  if (sourceStatus === "ok") {
    return "success" as const;
  }
  if (sourceStatus === "error") {
    return "critical" as const;
  }
  if (sourceStatus === "paused") {
    return "info" as const;
  }
  return "warning" as const;
}

function logoTone(logo: LogoResolution) {
  if (logo.tone === "ok") {
    return "success" as const;
  }
  if (logo.tone === "warning") {
    return "warning" as const;
  }
  return "info" as const;
}

function resolutionNoteClass(tone: "ok" | "warning" | "critical" | "info") {
  if (tone === "ok") {
    return "grid gap-1 rounded-md3m border border-[#245b3224] bg-[var(--md3-success-container)] px-4 py-3";
  }
  if (tone === "warning") {
    return "grid gap-1 rounded-md3m border border-[#b8800038] bg-[#fff9e8] px-4 py-3";
  }
  if (tone === "critical") {
    return "grid gap-1 rounded-md3m border border-[#c93a2c38] bg-[#fff2f0] px-4 py-3";
  }
  return "grid gap-1 rounded-md3m border border-[#005fa32e] bg-[#eef7ff] px-4 py-3";
}

function warningCardClass(severity: WarningItem["severity"]) {
  if (severity === "critical") {
    return "grid gap-3 rounded-md3m border border-[#e4b9b4] border-l-4 border-l-[#c54535] bg-[#fff7f6] p-4 shadow-[0_1px_2px_rgba(10,18,32,0.06)]";
  }
  if (severity === "warning") {
    return "grid gap-3 rounded-md3m border border-[#e5cf8f] border-l-4 border-l-[#a97400] bg-[#fffdf4] p-4 shadow-[0_1px_2px_rgba(10,18,32,0.05)]";
  }
  return "grid gap-3 rounded-md3m border border-[#b6d2ec] border-l-4 border-l-[#1f73b8] bg-[#f5faff] p-4 shadow-[0_1px_2px_rgba(10,18,32,0.05)]";
}

function severityIconClass(severity: WarningItem["severity"] | "ok") {
  if (severity === "ok") {
    return "inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--md3-success-container)] text-[0.76rem] font-extrabold text-[#245b32]";
  }
  if (severity === "warning") {
    return "inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#fff0c2] text-[0.76rem] font-extrabold text-[#7a4b00]";
  }
  if (severity === "critical") {
    return "inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#fde4e1] text-[0.76rem] font-extrabold text-[#962b22]";
  }
  return "inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#dceeff] text-[0.76rem] font-extrabold text-[#0d4a7c]";
}

function dataTileClassName() {
  return "grid gap-1.5 rounded-md3s border border-md3-outlineVariant bg-md3-surface px-3.5 py-3";
}

function dataTileLabelClassName() {
  return "text-[0.72rem] font-bold uppercase tracking-[0.06em] text-md3-onSurfaceVariant";
}

function dataTileValueClassName() {
  return "text-sm leading-snug text-md3-onBackground";
}

function riskCardClassName() {
  return "border-md3-outlineVariant bg-md3-surface";
}

type GoLiveIssue = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  cause: string;
  fix: string;
};

const ISSUE_SEVERITY_RANK: Record<GoLiveIssue["severity"], number> = {
  critical: 3,
  warning: 2,
  info: 1
};

function issueBadgeVariant(severity: GoLiveIssue["severity"]) {
  if (severity === "critical") {
    return "critical" as const;
  }
  if (severity === "warning") {
    return "warning" as const;
  }
  return "info" as const;
}

function normalizeReadinessIssue(check: ReadinessCheck): Pick<GoLiveIssue, "severity" | "title" | "detail"> {
  switch (check.label) {
    case "Upstream reachable":
      return {
        severity: "warning",
        title: "Upstream feed error",
        detail: check.detail
      };
    case "Polling enabled":
      return {
        severity: "warning",
        title: "Polling is paused",
        detail: check.detail
      };
    case "Live data fresh":
      return {
        severity: "warning",
        title: check.detail === "No successful fetch yet." ? "No successful live fetch yet" : "Live data is stale",
        detail: check.detail
      };
    case "Published theme ready":
      return {
        severity: "critical",
        title: "No published theme",
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
    case "Upstream feed error":
      return {
        cause: "The PBResults `/live` source is unreachable or returning an error.",
        fix: "Check upstream PBResults server/network, verify URL in Settings, then press Refresh now."
      };
    case "Live data is stale":
    case "Live data fresh":
      return {
        cause: "Recent live updates are delayed beyond expected polling freshness.",
        fix: "Keep polling enabled, verify upstream connectivity, and wait for a new successful fetch."
      };
    case "Polling is paused":
    case "Polling enabled":
      return {
        cause: "Automatic polling is currently disabled.",
        fix: "Click Start polling and confirm status changes to Active."
      };
    case "No successful live fetch yet":
    case "Waiting for live state":
      return {
        cause: "No successful `/live` response has been received in this session yet.",
        fix: "Confirm upstream URL and connectivity, keep polling active, and refresh once source is healthy."
      };
    case "Left team needs confirmation":
    case "Right team needs confirmation":
    case "Left team resolved":
    case "Right team resolved":
      return {
        cause: detail,
        fix: "Use Team resolution (Step 1 quick suggestions first, then Step 2 manual selection if needed)."
      };
    case "Left logo unresolved":
    case "Right logo unresolved":
    case "Logo coverage":
      return {
        cause: detail,
        fix: "Add team logo in Teams registry or configure fallback/logo assets in Theme Editor."
      };
    case "No published theme":
    case "Published theme ready":
      return {
        cause: detail,
        fix: "Publish/select a valid theme in Themes before continuing on-air."
      };
    case "Upstream reachable":
      return {
        cause: detail,
        fix: "Confirm upstream server health and network route to the configured source URL."
      };
    default:
      return {
        cause: detail,
        fix: "Open the related section on this page and resolve the highlighted issue before go-live."
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

function severityIcon(severity: WarningItem["severity"] | "ok") {
  if (severity === "critical") {
    return "!";
  }
  if (severity === "warning") {
    return "!";
  }
  if (severity === "info") {
    return "i";
  }
  return "OK";
}

function teamOptionLabel(team: TeamRecord) {
  const detail = team.shortName?.trim() ? ` · ${team.shortName.trim()}` : "";
  return `${team.canonicalName}${detail}`;
}

function describeResolutionState(match: TeamMatchResult, rememberedLiveName: boolean) {
  if (match.resolutionSource === "manual") {
    return {
      tone: "ok" as const,
      title: "Temporary match active",
      detail: "This side is currently using an operator override for the current live name."
    };
  }

  if (rememberedLiveName) {
    return {
      tone: "ok" as const,
      title: "Live name remembered",
      detail: `"${match.inputName}" will keep matching ${match.team?.canonicalName ?? "this team"} automatically.`
    };
  }

  if (match.status === "matched") {
    return {
      tone: "ok" as const,
      title: "Automatic match ready",
      detail: "The live name is resolving cleanly without operator intervention."
    };
  }

  if (match.status === "uncertain") {
    return {
      tone: "warning" as const,
      title: "Needs confirmation",
      detail: "Choose the correct team before this side goes on air."
    };
  }

  return {
    tone: "critical" as const,
    title: "No match yet",
    detail: "Pick a team manually or use one of the suggestions below."
  };
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
      title: "Polling is paused",
      detail: "The app is not fetching new /live updates until polling is started again."
    });
  }

  if (!theme) {
    warnings.push({
      severity: "critical",
      title: "No published theme",
      detail: "Choose a published theme before using the live overlay on air."
    });
  }

  if (!live) {
    warnings.push({
      severity: "warning",
      title: "Waiting for live state",
      detail: "The Operations page has not received live feed data yet."
    });
    return warnings;
  }

  if (live.sourceStatus === "error") {
    warnings.push({
      severity: "critical",
      title: "Upstream feed error",
      detail: live.errorMessage ?? "The upstream /live endpoint could not be reached."
    });
  }

  if (live.sourceStatus === "idle") {
    warnings.push({
      severity: "warning",
      title: "No successful live fetch yet",
      detail: "Waiting for the first successful response from the upstream /live feed."
    });
  }

  if (live.displayLeftTeamMatch.status !== "matched" && live.displayLeftTeamMatch.inputName.trim()) {
    warnings.push({
      severity: live.displayLeftTeamMatch.status === "uncertain" ? "warning" : "critical",
      title: "Left team needs confirmation",
      detail: `Live name "${live.displayLeftTeamMatch.inputName}" is ${live.displayLeftTeamMatch.status}.`
    });
  }

  if (live.displayRightTeamMatch.status !== "matched" && live.displayRightTeamMatch.inputName.trim()) {
    warnings.push({
      severity: live.displayRightTeamMatch.status === "uncertain" ? "warning" : "critical",
      title: "Right team needs confirmation",
      detail: `Live name "${live.displayRightTeamMatch.inputName}" is ${live.displayRightTeamMatch.status}.`
    });
  }

  if (leftLogo.key === "missing") {
    warnings.push({
      severity: "warning",
      title: "Left logo unresolved",
      detail: leftLogo.label
    });
  }

  if (rightLogo.key === "missing") {
    warnings.push({
      severity: "warning",
      title: "Right logo unresolved",
      detail: rightLogo.label
    });
  }

  if (leftLogo.key === "eventLogo" && rightLogo.key === "eventLogo") {
    warnings.push({
      severity: "info",
      title: "Both sides are using the event logo fallback",
      detail: "The scoreboard may look ambiguous if both teams share the same fallback logo."
    });
  }

  const staleThresholdMs = Math.max(settings.pollIntervalMs * 4, 5000);
  if (live.fetchedAt && Date.now() - Date.parse(live.fetchedAt) > staleThresholdMs && live.sourceStatus !== "paused") {
    warnings.push({
      severity: "warning",
      title: "Live data is stale",
      detail: `Last successful fetch was ${formatAge(live.fetchedAt)}.`
    });
  }

  return warnings;
}

function ResolutionCard({
  side,
  match,
  renderedName,
  teams,
  selectedTeamId,
  resolving,
  clearing,
  onChangeSelection,
  onApply,
  onApplyAndRemember,
  onClear
}: {
  side: "left" | "right";
  match: TeamMatchResult;
  renderedName: string;
  teams: TeamRecord[];
  selectedTeamId: string;
  resolving: boolean;
  clearing: boolean;
  onChangeSelection: (teamId: string) => void;
  onApply: (teamId?: string) => void;
  onApplyAndRemember: (teamId?: string) => void;
  onClear: () => void;
}) {
  const title = side === "left" ? "Left side on screen" : "Right side on screen";
  const manualOverrideActive = match.resolutionSource === "manual";
  const needsResolution = match.status !== "matched" || manualOverrideActive;
  const rememberedLiveName = Boolean(match.resolutionSource === "automatic" && match.team?.liveMatchNames.includes(match.matchedAlias ?? ""));
  const showSuggestedTeams = needsResolution && match.candidates.length > 0;
  const resolutionState = describeResolutionState(match, rememberedLiveName);
  const activeTeams = teams.filter((team) => team.active);
  const statusLabel = manualOverrideActive
    ? "Override active"
    : match.status === "matched"
      ? "Matched"
      : match.status === "uncertain"
        ? "Needs review"
        : "Unmatched";
  const statusVariant = manualOverrideActive ? "success" : matchTone(match);
  const verdict = manualOverrideActive
    ? "Temporary decision is active. Confirm this is still correct for on-air output."
    : match.status === "matched"
      ? "No action required. This side is currently stable."
      : match.status === "uncertain"
        ? "Confirm team before going on air."
        : "Assignment required before this side is safe for on-air.";
  const detailItems = [
    ["Normalized live input", match.normalizedInput || "—"],
    ["Matched alias", match.matchedAlias ?? (manualOverrideActive ? "Manual override" : "—")],
    ["Confidence", `${Math.round(match.confidence * 100)}%`]
  ];
  const manualSelectionDefaultOpen = !manualOverrideActive && needsResolution && !showSuggestedTeams;
  const resolutionViewKey = `${match.inputName}|${match.status}|${manualOverrideActive ? "manual" : "auto"}|${match.candidates
    .map((candidate) => candidate.teamId)
    .join(",")}`;
  const previousResolutionViewKeyRef = useRef(resolutionViewKey);
  const closeManualSelectionAfterQuickActionRef = useRef(false);
  const [manualSelectionOpen, setManualSelectionOpen] = useState(() => manualSelectionDefaultOpen);

  useEffect(() => {
    if (previousResolutionViewKeyRef.current !== resolutionViewKey) {
      previousResolutionViewKeyRef.current = resolutionViewKey;
      if (closeManualSelectionAfterQuickActionRef.current) {
        closeManualSelectionAfterQuickActionRef.current = false;
        setManualSelectionOpen(false);
        return;
      }
      setManualSelectionOpen(manualSelectionDefaultOpen);
    }
  }, [manualSelectionDefaultOpen, resolutionViewKey]);

  function handleQuickSuggestionApply(teamId: string) {
    closeManualSelectionAfterQuickActionRef.current = true;
    setManualSelectionOpen(false);
    onApply(teamId);
  }

  function handleQuickSuggestionApplyAndRemember(teamId: string) {
    closeManualSelectionAfterQuickActionRef.current = true;
    setManualSelectionOpen(false);
    onApplyAndRemember(teamId);
  }

  return (
    <Card className="grid min-h-full content-start gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer px-4 py-4">
      <div className="panel-header items-start">
        <strong>{title}</strong>
        <div className="action-row compact justify-end max-[780px]:justify-start">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          {rememberedLiveName ? (
            <Badge variant="success">remembered live name</Badge>
          ) : null}
        </div>
      </div>
      <div className={resolutionNoteClass(needsResolution ? resolutionState.tone : "ok")}>
        <strong>{needsResolution ? resolutionState.title : "Stable"}</strong>
        <p className="m-0 text-sm text-md3-onSurfaceVariant">{verdict}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={dataTileClassName()}>
          <strong className={dataTileLabelClassName()}>Live input</strong>
          <span className={dataTileValueClassName()}>{match.inputName || "—"}</span>
        </div>
        <div className={dataTileClassName()}>
          <strong className={dataTileLabelClassName()}>Assigned team</strong>
          <span className={dataTileValueClassName()}>{match.team?.canonicalName ?? "Not resolved"}</span>
        </div>
        <div className={dataTileClassName()}>
          <strong className={dataTileLabelClassName()}>Mode</strong>
          <span className={dataTileValueClassName()}>
            {manualOverrideActive
              ? "Manual override"
              : rememberedLiveName
                ? "Remembered live name"
                : match.status === "matched"
                  ? "Automatic"
                  : "Needs operator review"}
          </span>
        </div>
      </div>

      <div className="grid content-start gap-3">
        {showSuggestedTeams ? (
          <div className="grid gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-4">
            <div className="panel-header">
              <div>
                <strong>Step 1: Quick suggestions</strong>
                <FieldHint>Choose the best candidate if it matches what should be on air.</FieldHint>
              </div>
            </div>
            {match.candidates.slice(0, 3).map((candidate, index) => (
              <div
                key={`${candidate.teamId}-${candidate.matchedAlias}`}
                className={`grid gap-3 rounded-md3s border border-md3-outlineVariant bg-md3-surfaceContainer px-4 py-3 ${index === 0 ? "border-[#005fa33d] shadow-md31" : ""}`}
              >
                <div className="grid gap-1.5">
                  <strong>{candidate.teamName}</strong>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={confidenceTone(candidate.confidence)}>{Math.round(candidate.confidence * 100)}% confidence</span>
                    <span className="text-md3-onSurfaceVariant">{candidate.matchedAlias ? `Matched by ${candidate.matchedAlias}` : "Suggested candidate"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => handleQuickSuggestionApply(candidate.teamId)}
                    disabled={resolving || !match.inputName.trim()}
                  >
                    Match now
                  </Button>
                  {manualOverrideActive ? (
                    <Button variant="secondary" type="button" onClick={onClear} disabled={clearing}>
                      {clearing ? "Clearing…" : "Back to automatic"}
                    </Button>
                  ) : null}
                  <details className="row-action-menu">
                    <summary className={buttonVariants({ variant: "secondary" })}>More</summary>
                    <div className="row-action-menu-list">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => handleQuickSuggestionApplyAndRemember(candidate.teamId)}
                        disabled={resolving || !match.inputName.trim()}
                      >
                        Match and remember
                      </Button>
                      <Link className={buttonVariants({ variant: "secondary" })} to={`/admin/teams/${candidate.teamId}`}>
                        Open team
                      </Link>
                    </div>
                  </details>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-1 rounded-md3m border border-dashed border-md3-outline bg-md3-surface px-4 py-3">
            <strong>No action required</strong>
            <p className="m-0 text-sm text-md3-onSurfaceVariant">
              {manualOverrideActive
                ? "Override is active. Use Change assignment only if this needs correction."
                : needsResolution
                  ? "No quick suggestion is ready. Use manual selection."
                  : "This side is stable for current live input."}
            </p>
          </div>
        )}
        {manualOverrideActive && !manualSelectionOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" type="button" onClick={() => setManualSelectionOpen(true)}>
              Change assignment
            </Button>
          </div>
        ) : null}
        <details
          className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surface data-[state=open]:bg-md3-surfaceContainer"
          open={manualSelectionOpen}
          onToggle={(event) => setManualSelectionOpen(event.currentTarget.open)}
        >
          <summary className="flex list-none items-start justify-between gap-4 px-4 py-3">
            <div>
              <strong>{needsResolution ? "Step 2: Manual selection" : "Change assignment"}</strong>
              <FieldHint>
                {needsResolution ? "Use this only if suggestions are wrong or missing." : "Use this if you need to change the current assignment."}
              </FieldHint>
            </div>
          </summary>
          <div className="grid gap-4 px-4 pb-4">
            <div className="grid gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-3">
              <div className="action-row compact items-end">
                <Select value={selectedTeamId} onChange={(event) => onChangeSelection(event.target.value)}>
                  <option value="">Select a team…</option>
                  {activeTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {teamOptionLabel(team)}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" type="button" onClick={() => onApply()} disabled={!selectedTeamId || resolving || !match.inputName.trim()}>
                  {resolving ? "Applying…" : "Match now"}
                </Button>
                {manualOverrideActive ? (
                  <Button variant="secondary" type="button" onClick={onClear} disabled={clearing}>
                    {clearing ? "Clearing…" : "Back to automatic"}
                  </Button>
                ) : null}
                <details className="row-action-menu row-action-menu--up">
                  <summary className={buttonVariants({ variant: "secondary" })}>{resolving ? "Applying…" : "More"}</summary>
                  <div className="row-action-menu-list">
                    <Button variant="secondary" type="button" onClick={() => onApplyAndRemember()} disabled={!selectedTeamId || resolving || !match.inputName.trim()}>
                      Match and remember
                    </Button>
                    <Link className={buttonVariants({ variant: "secondary" })} to="/admin/teams">
                      Manage teams
                    </Link>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </details>
        <details className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surface">
          <summary className="flex list-none items-start justify-between gap-4 px-4 py-3">
            <div>
              <strong>Why this match?</strong>
              <FieldHint>Technical details for verification.</FieldHint>
            </div>
          </summary>
          <div className="grid gap-4 px-4 pb-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {detailItems.map(([label, value]) => (
                <div key={label} className={dataTileClassName()}>
                  <strong className={dataTileLabelClassName()}>{label}</strong>
                  <span className={dataTileValueClassName()}>{value}</span>
                </div>
              ))}
              <div className={dataTileClassName()}>
                <strong className={dataTileLabelClassName()}>Shown on overlay</strong>
                <span className={dataTileValueClassName()}>{renderedName || "—"}</span>
              </div>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}

export function OperationsPage() {
  useAutoCloseRowActionMenus();
  const settings = useSettings();
  const themes = useThemes();
  const teams = useTeams();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const [togglingPoll, setTogglingPoll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resolutionDrafts, setResolutionDrafts] = useState<{ left: string; right: string }>({ left: "", right: "" });
  const [resolvingSide, setResolvingSide] = useState<"left" | "right" | null>(null);
  const [clearingSide, setClearingSide] = useState<"left" | "right" | null>(null);
  const previousRawNamesRef = useRef<{ left: string; right: string }>({ left: "", right: "" });

  const publishedTheme = useMemo(
    () => themes.data?.find((theme) => theme.id === settings.data?.publishedThemeId) ?? null,
    [settings.data?.publishedThemeId, themes.data]
  );

  const liveUrl = typeof window === "undefined" ? "/overlay/live" : `${window.location.origin}/overlay/live`;
  const previewUrl =
    typeof window === "undefined"
      ? publishedTheme
        ? `/overlay/preview/${publishedTheme.id}`
        : null
      : publishedTheme
        ? `${window.location.origin}/overlay/preview/${publishedTheme.id}`
        : null;

  const leftLogo = useMemo(() => resolveLogoSource("left", publishedTheme, live.data), [publishedTheme, live.data]);
  const rightLogo = useMemo(() => resolveLogoSource("right", publishedTheme, live.data), [publishedTheme, live.data]);

  const warnings = useMemo(() => {
    if (!settings.data) {
      return [];
    }
    return buildWarnings(settings.data, live.data, publishedTheme, leftLogo, rightLogo);
  }, [leftLogo, live.data, publishedTheme, settings.data, rightLogo]);

  const operatorPriority = useMemo<OperatorPriority>(() => {
    if (!settings.data?.pollEnabled) {
      return {
        tone: "critical",
        title: "Polling is paused",
        detail: "Start polling first so every other checklist item can update in real time."
      };
    }

    if (!publishedTheme) {
      return {
        tone: "critical",
        title: "No published theme selected",
        detail: "Publish or select a theme before going on air to avoid incomplete overlays."
      };
    }

    if (!live.data) {
      return {
        tone: "warning",
        title: "Waiting for live feed data",
        detail: "Keep this page open until the first successful /live fetch arrives."
      };
    }

    if (live.data.displayLeftTeamMatch.status !== "matched" || live.data.displayRightTeamMatch.status !== "matched") {
      return {
        tone: "warning",
        title: "Team name resolution needs attention",
        detail: "Use the Team resolution section below and confirm both sides are matched before on-air."
      };
    }

    if (warnings.length) {
      return {
        tone: "critical",
        title: "Operator attention required before go-live",
        detail: "Check Operator status on the right. Each item includes cause and fix steps."
      };
    }

    return {
      tone: "success",
      title: "System ready for live operation",
      detail: "Feed health, matching, and published theme checks are all green."
    };
  }, [live.data, publishedTheme, settings.data?.pollEnabled, warnings.length]);

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
        ok: live.data?.displayLeftTeamMatch.status === "matched",
        detail:
          live.data?.displayLeftTeamMatch.status === "matched"
            ? live.data.displayLeftTeamMatch.team?.canonicalName ?? "Matched"
            : `Current status: ${live.data?.displayLeftTeamMatch.status ?? "waiting"}`
      },
      {
        label: "Right team resolved",
        ok: live.data?.displayRightTeamMatch.status === "matched",
        detail:
          live.data?.displayRightTeamMatch.status === "matched"
            ? live.data.displayRightTeamMatch.team?.canonicalName ?? "Matched"
            : `Current status: ${live.data?.displayRightTeamMatch.status ?? "waiting"}`
      },
      {
        label: "Logo coverage",
        ok: leftLogo.key !== "missing" && rightLogo.key !== "missing",
        detail: `Left: ${leftLogo.label}. Right: ${rightLogo.label}.`
      }
    ];
  }, [leftLogo, live.data, publishedTheme, rightLogo, settings.data]);

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

    const deduped = new Map<string, GoLiveIssue>();
    [...issuesFromWarnings, ...issuesFromReadiness].forEach((issue) => {
      const current = deduped.get(issue.title);
      if (!current) {
        deduped.set(issue.title, issue);
        return;
      }
      if (ISSUE_SEVERITY_RANK[issue.severity] > ISSUE_SEVERITY_RANK[current.severity]) {
        deduped.set(issue.title, issue);
      }
    });

    return Array.from(deduped.values());
  }, [readinessChecks, warnings]);

  const goLiveStatus = useMemo(() => {
    if (goLiveIssues.some((issue) => issue.severity === "critical")) {
      return { label: "Blocked", variant: "critical" as const };
    }
    if (goLiveIssues.length > 0) {
      return { label: "Needs review", variant: "warning" as const };
    }
    return { label: "Ready", variant: "success" as const };
  }, [goLiveIssues]);

  const lastUpdateTone = useMemo<"success" | "warning" | "critical">(() => {
    const fetchedAt = live.data?.fetchedAt;
    if (!fetchedAt) {
      return "critical";
    }

    const ageMs = Date.now() - Date.parse(fetchedAt);
    const pollIntervalMs = settings.data?.pollIntervalMs ?? 1000;
    const staleThresholdMs = Math.max(pollIntervalMs * 4, 5000);
    if (Number.isNaN(ageMs) || ageMs < 0) {
      return "warning";
    }

    if (ageMs <= staleThresholdMs) {
      return "success";
    }

    return live.data?.sourceStatus === "error" ? "critical" : "warning";
  }, [live.data?.fetchedAt, live.data?.sourceStatus, settings.data?.pollIntervalMs]);

  useEffect(() => {
    const leftRaw = live.data?.displayLeftTeamMatch.inputName ?? "";
    const rightRaw = live.data?.displayRightTeamMatch.inputName ?? "";
    const previous = previousRawNamesRef.current;
    const leftChanged = leftRaw !== previous.left;
    const rightChanged = rightRaw !== previous.right;

    if (!leftChanged && !rightChanged) {
      return;
    }

    previousRawNamesRef.current = { left: leftRaw, right: rightRaw };
    setResolutionDrafts((current) => ({
      left: leftChanged ? live.data?.displayLeftTeamMatch.teamId || "" : current.left,
      right: rightChanged ? live.data?.displayRightTeamMatch.teamId || "" : current.right
    }));
  }, [live.data?.displayLeftTeamMatch.inputName, live.data?.displayLeftTeamMatch.teamId, live.data?.displayRightTeamMatch.inputName, live.data?.displayRightTeamMatch.teamId]);

  async function handleSetPolling(enabled: boolean) {
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

  async function handleApplyResolution(side: "left" | "right", match: TeamMatchResult, forcedTeamId?: string, remember = false, forceReassign = false) {
    const teamId = forcedTeamId ?? resolutionDrafts[side];
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
      setResolutionDrafts((current) => ({
        ...current,
        [side]: teamId
      }));
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
      setResolutionDrafts((current) => ({
        ...current,
        [side]: ""
      }));
      showToast({ kind: "success", message: `Override cleared for "${match.inputName}".` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to clear team override." });
    } finally {
      setClearingSide(null);
    }
  }

  if (!settings.data || !themes.data || !teams.data) {
    return (
      <Card>
        <CardContent>Loading operations…</CardContent>
      </Card>
    );
  }

  return (
    <AdminPageFrame className="panel-stack gap-4 w-[90%] !max-w-none">
      <AdminPageHeader
        eyebrow="Operations"
        title="Live operator overview"
        description="Prioritize Go-live status first, then Team resolution. Everything else is secondary."
        actions={(
          <div className="action-row compact items-center max-[1200px]:w-full max-[1200px]:justify-start">
            <Button variant="secondary" type="button" onClick={() => void handleRefreshNow()} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh now"}
            </Button>
            <Button
              variant={settings.data.pollEnabled ? "danger" : "default"}
              type="button"
              onClick={() => void handleSetPolling(!settings.data!.pollEnabled)}
              disabled={togglingPoll}
            >
              {togglingPoll ? "Updating..." : settings.data!.pollEnabled ? "Stop polling" : "Start polling"}
            </Button>
          </div>
        )}
      />

      <StatusPanel
        tone={operatorPriority.tone === "critical" ? "critical" : operatorPriority.tone === "warning" ? "warning" : "success"}
        icon={
          operatorPriority.tone === "critical" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : operatorPriority.tone === "warning" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )
        }
        title={operatorPriority.title}
        description={operatorPriority.detail}
      />

      <div className="grid grid-cols-4 gap-3 max-[1200px]:grid-cols-1">
        <AdminStatTile
          tone={sourceStatusTone(live.data?.sourceStatus)}
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Live feed"
          value={<Badge variant={sourceStatusTone(live.data?.sourceStatus)}>{live.data?.sourceStatus ?? "loading"}</Badge>}
          detail={live.data?.errorMessage ?? "Live feed available"}
        />
        <AdminStatTile
          tone={settings.data.pollEnabled ? "success" : "warning"}
          icon={<Radio className="h-3.5 w-3.5" />}
          label="Polling"
          value={<Badge variant={settings.data.pollEnabled ? "success" : "warning"}>{settings.data.pollEnabled ? "Active" : "Paused"}</Badge>}
          detail={`${settings.data.pollIntervalMs} ms interval`}
        />
        <AdminStatTile
          tone={lastUpdateTone}
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label="Last update"
          value={formatAge(live.data?.fetchedAt ?? null)}
          detail={formatTimestamp(live.data?.fetchedAt ?? null)}
        />
        <AdminStatTile
          tone={publishedTheme ? "success" : "warning"}
          icon={<Palette className="h-3.5 w-3.5" />}
          label="Published theme"
          value={publishedTheme?.name ?? "None selected"}
          detail={publishedTheme ? "Ready for overlay" : "Choose one in Themes"}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)] items-start gap-4 max-[1200px]:grid-cols-1">
        <div className="panel-stack min-w-0 gap-4">
          <Card>
            <CardHeader>
              <div>
                <p className="eyebrow">Team resolution</p>
                <CardTitle className="text-xl">Resolve live team names</CardTitle>
                <CardDescription>When in doubt: use quick suggestions first, then manual selection if needed. Overrides apply only to the current raw live name.</CardDescription>
              </div>
            </CardHeader>
            {live.data ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
                <ResolutionCard
                  side="left"
                  match={live.data.displayLeftTeamMatch}
                  renderedName={live.data.displayLeftTeam.name}
                  teams={teams.data}
                  selectedTeamId={resolutionDrafts.left}
                  resolving={resolvingSide === "left"}
                  clearing={clearingSide === "left"}
                  onChangeSelection={(teamId) => setResolutionDrafts((current) => ({ ...current, left: teamId }))}
                  onApply={(teamId) => void handleApplyResolution("left", live.data!.displayLeftTeamMatch, teamId)}
                  onApplyAndRemember={(teamId) => void handleApplyResolution("left", live.data!.displayLeftTeamMatch, teamId, true)}
                  onClear={() => void handleClearResolution("left")}
                />
                <ResolutionCard
                  side="right"
                  match={live.data.displayRightTeamMatch}
                  renderedName={live.data.displayRightTeam.name}
                  teams={teams.data}
                  selectedTeamId={resolutionDrafts.right}
                  resolving={resolvingSide === "right"}
                  clearing={clearingSide === "right"}
                  onChangeSelection={(teamId) => setResolutionDrafts((current) => ({ ...current, right: teamId }))}
                  onApply={(teamId) => void handleApplyResolution("right", live.data!.displayRightTeamMatch, teamId)}
                  onApplyAndRemember={(teamId) => void handleApplyResolution("right", live.data!.displayRightTeamMatch, teamId, true)}
                  onClear={() => void handleClearResolution("right")}
                />
              </div>
            ) : (
              <p>{live.error ?? "Waiting for live data…"}</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="eyebrow">Match snapshot</p>
                <CardTitle className="text-xl">Current scoreboard state</CardTitle>
                <CardDescription>This is exactly what currently drives the on-air overlay output.</CardDescription>
              </div>
            </CardHeader>
            {live.data ? (
              <div className="grid gap-3">
                <div className="grid grid-cols-4 gap-3 max-[1200px]:grid-cols-1">
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Teams on screen</strong>
                    <span className={dataTileValueClassName()}>
                      {live.data.displayLeftTeam.name || "Left"} vs {live.data.displayRightTeam.name || "Right"}
                    </span>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Score</strong>
                    <span className={dataTileValueClassName()}>
                      {live.data.displayLeftTeam.score} - {live.data.displayRightTeam.score}
                    </span>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Main clock</strong>
                    <span className={dataTileValueClassName()}>{formatClock(live.data.gameTimer.value)}</span>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>State / period</strong>
                    <span className={dataTileValueClassName()}>
                      {live.data.state} / {live.data.period}
                    </span>
                  </div>
                </div>
                <details className="rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-md3-onSurfaceVariant">More scoreboard details</summary>
                  <div className="mt-3 grid grid-cols-2 gap-3 max-[1200px]:grid-cols-1">
                    <div className={dataTileClassName()}>
                      <strong className={dataTileLabelClassName()}>Break clock</strong>
                      <span className={dataTileValueClassName()}>{formatClock(live.data.breakTimer.value)}</span>
                    </div>
                    <div className={dataTileClassName()}>
                      <strong className={dataTileLabelClassName()}>Round</strong>
                      <span className={dataTileValueClassName()}>{live.data.round}</span>
                    </div>
                    <div className={dataTileClassName()}>
                      <strong className={dataTileLabelClassName()}>Side switch</strong>
                      <span className={dataTileValueClassName()}>{live.data.sidesSwitched ? "On" : "Off"}</span>
                    </div>
                    <div className={dataTileClassName()}>
                      <strong className={dataTileLabelClassName()}>Current event</strong>
                      <span className={dataTileValueClassName()}>{eventLabel(live.data.teamEvent)}</span>
                    </div>
                    <div className={dataTileClassName()}>
                      <strong className={dataTileLabelClassName()}>Second game</strong>
                      <span className={dataTileValueClassName()}>{Array.isArray(live.data.secondGame) ? "Available" : "None"}</span>
                    </div>
                  </div>
                </details>
              </div>
            ) : (
              <p>{live.error ?? "Waiting for live data…"}</p>
            )}
          </Card>
        </div>

        <div className="panel-stack sticky top-4 min-w-0 gap-4 max-[1200px]:static">
          <Card>
            <CardHeader>
              <div>
                <p className="eyebrow">On-air now</p>
                <CardTitle className="text-xl">Live overlay view</CardTitle>
                <CardDescription>Current scoreboard overlay render.</CardDescription>
              </div>
            </CardHeader>
            <OverlayPreviewWithZoom liveUrl={liveUrl} />
          </Card>

          <Card className={riskCardClassName()}>
            <CardHeader>
              <div>
                <p className="eyebrow">Go-live status</p>
                <CardTitle className="text-xl">Operator status</CardTitle>
                <CardDescription>Only items needing attention are shown with cause and fix actions.</CardDescription>
              </div>
              <Badge variant={goLiveStatus.variant}>
                {goLiveStatus.label}
              </Badge>
            </CardHeader>
            {goLiveIssues.length ? (
              <div className="grid gap-3">
                {goLiveIssues.map((issue) => (
                  <div key={`${issue.severity}-${issue.title}`} className={warningCardClass(issue.severity)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={severityIconClass(issue.severity)}>{severityIcon(issue.severity)}</span>
                        <div className="grid gap-1">
                          <strong className="text-base leading-tight">{issue.title}</strong>
                          <p className="m-0 text-sm leading-snug text-md3-onSurfaceVariant">{issue.detail}</p>
                        </div>
                      </div>
                      <Badge variant={issueBadgeVariant(issue.severity)} className="normal-case tracking-[0.02em]">
                        {issue.severity === "critical" ? "Immediate" : issue.severity === "warning" ? "Needs action" : "Heads up"}
                      </Badge>
                    </div>
                    <div className="grid gap-1.5 border-t border-md3-outlineVariant/70 pt-2">
                      <p className="m-0 flex items-start gap-2 text-sm leading-snug text-md3-onBackground">
                        <span className="mt-0.5 inline-flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full bg-md3-surfaceContainerHigh text-[0.66rem] font-extrabold text-md3-onSurfaceVariant">
                          ?
                        </span>
                        <span><strong>Cause</strong>: {issue.cause}</span>
                      </p>
                      <p className="m-0 flex items-start gap-2 text-sm leading-snug text-md3-onBackground">
                        <span className="mt-0.5 inline-flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full bg-md3-surfaceContainerHigh text-[0.66rem] font-extrabold text-md3-onSurfaceVariant">
                          →
                        </span>
                        <span><strong>Fix</strong>: {issue.fix}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <FieldHint>All checks are healthy. Safe to proceed on air.</FieldHint>
            )}
          </Card>

          <Card>
            <details className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer data-[state=open]:bg-md3-surface">
              <summary className="flex list-none items-start justify-between gap-4 px-4 py-4">
                <div>
                  <p className="eyebrow">Overlay details</p>
                  <h3>On-air details</h3>
                </div>
              </summary>
              <div className="grid gap-4 px-4 pb-4">
                <div className="grid gap-3">
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Published theme</strong>
                    <span className={dataTileValueClassName()}>{publishedTheme?.name ?? "None selected"}</span>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Left logo source</strong>
                    <Badge variant={logoTone(leftLogo)}>{leftLogo.label}</Badge>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Right logo source</strong>
                    <Badge variant={logoTone(rightLogo)}>{rightLogo.label}</Badge>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Lower line mode</strong>
                    <span className={dataTileValueClassName()}>
                      {live.data?.period === "BREAK"
                        ? publishedTheme?.centerSecondary.breakMode ?? "—"
                        : publishedTheme?.centerSecondary.gameMode ?? "—"}
                    </span>
                  </div>
                  <div className={dataTileClassName()}>
                    <strong className={dataTileLabelClassName()}>Active overlay state</strong>
                    <span className={dataTileValueClassName()}>
                      {live.data?.teamEvent === "none"
                        ? "Normal"
                        : live.data?.teamEvent.startsWith("towel")
                          ? "Towel overlay"
                          : "Base overlay"}
                    </span>
                  </div>
                </div>
              </div>
            </details>
          </Card>

          <Card>
            <details className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer data-[state=open]:bg-md3-surface">
              <summary className="flex list-none items-start justify-between gap-4 px-4 py-4">
                <div>
                  <p className="eyebrow">Quick links</p>
                  <h3>Shortcuts</h3>
                </div>
              </summary>
              <div className="grid gap-4 px-4 pb-4">
                <div className="action-row compact">
                  <a className={buttonVariants({ variant: "secondary" })} href={liveUrl} target="_blank" rel="noreferrer">
                    Open live overlay
                  </a>
                  <Button variant="secondary" type="button" onClick={() => void handleCopyOverlayUrl(liveUrl)}>
                    Copy live URL
                  </Button>
                  {previewUrl ? (
                    <a className={buttonVariants({ variant: "secondary" })} href={previewUrl} target="_blank" rel="noreferrer">
                      Open preview
                    </a>
                  ) : null}
                  {publishedTheme ? (
                    <Link className={buttonVariants({ variant: "secondary" })} to={`/admin/themes/${publishedTheme.id}`}>
                      Open theme editor
                    </Link>
                  ) : null}
                  <Link className={buttonVariants({ variant: "secondary" })} to="/admin/teams">
                    Manage teams
                  </Link>
                  <Link className={buttonVariants({ variant: "secondary" })} to="/admin/themes">
                    Manage themes
                  </Link>
                  <Link className={buttonVariants({ variant: "secondary" })} to="/admin/settings">
                    Open settings
                  </Link>
                </div>
              </div>
            </details>
          </Card>
        </div>
      </div>
    </AdminPageFrame>
  );
}
