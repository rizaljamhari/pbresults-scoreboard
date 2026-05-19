import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldHint, Select, buttonVariants } from "../components/ui";

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
    return "grid gap-2 rounded-md3m border border-[#c93a2c38] bg-[#fff2f0] p-4";
  }
  if (severity === "warning") {
    return "grid gap-2 rounded-md3m border border-[#b8800038] bg-[#fff9e8] p-4";
  }
  return "grid gap-2 rounded-md3m border border-[#005fa32e] bg-[#eef7ff] p-4";
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
      tone: "info" as const,
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
  const needsResolution = match.status !== "matched" || match.resolutionSource === "manual";
  const rememberedLiveName = Boolean(match.resolutionSource === "automatic" && match.team?.liveMatchNames.includes(match.matchedAlias ?? ""));
  const showSuggestedTeams = match.candidates.length > 0 && (match.status !== "matched" || match.resolutionSource === "manual");
  const resolutionState = describeResolutionState(match, rememberedLiveName);
  const activeTeams = teams.filter((team) => team.active);
  const summaryItems = [
    ["Name from /live", match.inputName || "—"],
    ["Name shown on overlay", renderedName || "—"],
    ["Selected team", match.team?.canonicalName ?? "Not resolved"],
    [
      "Current source",
      match.resolutionSource === "manual"
        ? "Temporary override"
        : rememberedLiveName
          ? "Remembered live name"
          : match.status === "matched"
            ? "Automatic match"
            : "Needs operator review"
    ]
  ];
  const detailItems = [
    ["Normalized", match.normalizedInput || "—"],
    ["Matched by", match.matchedAlias ?? (match.resolutionSource === "manual" ? "Manual override" : "—")],
    ["Match confidence", `${Math.round(match.confidence * 100)}%`]
  ];

  return (
    <Card className="grid min-h-full content-start gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer px-4 py-4 [grid-template-rows:auto_auto_auto_auto_1fr]">
      <div className="panel-header items-start">
        <strong>{title}</strong>
        <div className="action-row compact justify-end max-[780px]:justify-start">
          <Badge variant={matchTone(match)}>{match.status}</Badge>
          {match.resolutionSource === "manual" ? <Badge variant="info">temporary override</Badge> : null}
          {rememberedLiveName ? (
            <Badge variant="success">remembered live name</Badge>
          ) : null}
        </div>
      </div>
      <div className="grid items-stretch gap-3 sm:grid-cols-2">
        {summaryItems.map(([label, value]) => (
          <div key={label}>
            <strong>{label}</strong>
            <span className="text-md3-onSurfaceVariant">{value}</span>
          </div>
        ))}
      </div>
      <details className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surface">
        <summary className="flex list-none items-start justify-between gap-4 px-4 py-3">
          <div>
            <strong>Match details</strong>
            <FieldHint>Show normalized input, match source, and confidence.</FieldHint>
          </div>
        </summary>
        <div className="grid gap-4 px-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {detailItems.map(([label, value]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span className="text-md3-onSurfaceVariant">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </details>
      <div className="grid gap-2">
        <strong className="text-xs font-bold uppercase tracking-wide text-md3-onSurfaceVariant">Current resolution</strong>
        <div className={resolutionNoteClass(resolutionState.tone)}>
          <strong>{resolutionState.title}</strong>
          <p className="m-0 text-sm text-md3-onSurfaceVariant">{resolutionState.detail}</p>
        </div>
      </div>
      <div className="grid content-start gap-3">
        {showSuggestedTeams ? (
          <div className="grid gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-4">
            <div className="panel-header">
              <div>
                <strong>Best suggestions</strong>
                <FieldHint>Top candidates first. Use manual selection only if these are wrong.</FieldHint>
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
                  <Button variant="secondary" type="button" onClick={() => onApply(candidate.teamId)} disabled={resolving || !match.inputName.trim()}>
                    Match now
                  </Button>
                  <details className="row-action-menu">
                    <summary className={buttonVariants({ variant: "secondary" })}>More</summary>
                    <div className="row-action-menu-list">
                      <Button variant="secondary" type="button" onClick={() => onApplyAndRemember(candidate.teamId)} disabled={resolving || !match.inputName.trim()}>
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
            <strong>No suggested action needed</strong>
            <p className="m-0 text-sm text-md3-onSurfaceVariant">{needsResolution ? "Use manual selection below to choose a team." : "This side is already stable for the current live name."}</p>
          </div>
        )}
        <details className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surface data-[state=open]:bg-md3-surfaceContainer" open={needsResolution}>
          <summary className="flex list-none items-start justify-between gap-4 px-4 py-3">
            <div>
              <strong>{needsResolution ? "Manual selection" : "Change match"}</strong>
              <FieldHint>
                {needsResolution ? "Use this when the suggested teams are wrong or missing." : "Choose a different team or save a new remembered live name."}
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
                <details className="row-action-menu row-action-menu--up">
                  <summary className={buttonVariants({ variant: "secondary" })}>{resolving ? "Applying…" : "More"}</summary>
                  <div className="row-action-menu-list">
                    <Button variant="secondary" type="button" onClick={() => onApplyAndRemember()} disabled={!selectedTeamId || resolving || !match.inputName.trim()}>
                      Match and remember
                    </Button>
                    {match.resolutionSource === "manual" ? (
                      <Button variant="secondary" type="button" onClick={onClear} disabled={clearing}>
                        {clearing ? "Clearing…" : "Back to automatic"}
                      </Button>
                    ) : null}
                    <Link className={buttonVariants({ variant: "secondary" })} to="/admin/teams">
                      Manage teams
                    </Link>
                  </div>
                </details>
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
    <section className="admin-page panel-stack w-[min(90vw,1800px)] max-w-none gap-4">
      <header className="flex items-end justify-between gap-5 py-1 max-[1200px]:flex-col max-[1200px]:items-start">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Live operator overview</h2>
          <FieldHint>Keep the live feed healthy, fix team matching fast, and confirm the scoreboard is ready for air.</FieldHint>
        </div>
        <div className="action-row compact items-center">
          <Button variant="secondary" type="button" onClick={() => void handleRefreshNow()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh now"}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => void handleSetPolling(!settings.data!.pollEnabled)}
            disabled={togglingPoll}
          >
            {togglingPoll ? "Updating…" : settings.data!.pollEnabled ? "Stop polling" : "Start polling"}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-4 max-[1200px]:grid-cols-1">
        <div className="grid gap-2 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-4 shadow-md31">
          <strong>Live feed</strong>
          <div className="grid gap-1">
            <Badge variant={sourceStatusTone(live.data?.sourceStatus)}>{live.data?.sourceStatus ?? "loading"}</Badge>
            <span className="text-sm text-md3-onSurfaceVariant">{live.data?.errorMessage ?? "Live feed available"}</span>
          </div>
        </div>
        <div className="grid gap-2 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-4 shadow-md31">
          <strong>Polling</strong>
          <div className="grid gap-1">
            <Badge variant={settings.data.pollEnabled ? "success" : "warning"}>
              {settings.data.pollEnabled ? "Active" : "Paused"}
            </Badge>
            <span className="text-sm text-md3-onSurfaceVariant">{settings.data.pollIntervalMs} ms interval</span>
          </div>
        </div>
        <div className="grid gap-2 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-4 shadow-md31">
          <strong>Last update</strong>
          <div className="grid gap-1">
            <span>{formatAge(live.data?.fetchedAt ?? null)}</span>
            <span className="text-sm text-md3-onSurfaceVariant">{formatTimestamp(live.data?.fetchedAt ?? null)}</span>
          </div>
        </div>
        <div className="grid gap-2 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-4 shadow-md31">
          <strong>Published theme</strong>
          <div className="grid gap-1">
            <span>{publishedTheme?.name ?? "None selected"}</span>
            <span className="text-sm text-md3-onSurfaceVariant">{publishedTheme ? "Ready for overlay" : "Choose one in Themes"}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)] items-start gap-4 max-[1200px]:grid-cols-1">
        <div className="panel-stack min-w-0 gap-4">
          <Card>
            <CardHeader>
              <div>
                <p className="eyebrow">Team resolution</p>
                <CardTitle className="text-xl">Resolve live team names</CardTitle>
                <CardDescription>Start here when a name is uncertain or unmatched. Overrides only apply to the current raw live name.</CardDescription>
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
                <CardDescription>This is the live state currently driving the overlay.</CardDescription>
              </div>
            </CardHeader>
            {live.data ? (
              <div className="grid grid-cols-3 gap-3 max-[1200px]:grid-cols-1">
                <div>
                  <strong>Teams on screen</strong>
                  <span>
                    {live.data.displayLeftTeam.name || "Left"} vs {live.data.displayRightTeam.name || "Right"}
                  </span>
                </div>
                <div>
                  <strong>Score</strong>
                  <span>
                    {live.data.displayLeftTeam.score} - {live.data.displayRightTeam.score}
                  </span>
                </div>
                <div>
                  <strong>Main clock</strong>
                  <span>{formatClock(live.data.gameTimer.value)}</span>
                </div>
                <div>
                  <strong>Break clock</strong>
                  <span>{formatClock(live.data.breakTimer.value)}</span>
                </div>
                <div>
                  <strong>State / period</strong>
                  <span>
                    {live.data.state} / {live.data.period}
                  </span>
                </div>
                <div>
                  <strong>Round</strong>
                  <span>{live.data.round}</span>
                </div>
                <div>
                  <strong>Side switch</strong>
                  <span>{live.data.sidesSwitched ? "On" : "Off"}</span>
                </div>
                <div>
                  <strong>Current event</strong>
                  <span>{eventLabel(live.data.teamEvent)}</span>
                </div>
                <div>
                  <strong>Second game</strong>
                  <span>{Array.isArray(live.data.secondGame) ? "Available" : "None"}</span>
                </div>
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
                <p className="eyebrow">Readiness</p>
                <CardTitle className="text-xl">Live checklist</CardTitle>
              </div>
              <Badge variant={readinessChecks.every((check) => check.ok) ? "success" : "warning"}>
                {readinessChecks.every((check) => check.ok) ? "Ready for live" : "Needs attention"}
              </Badge>
            </CardHeader>
            <div className="grid gap-3">
              {readinessChecks.map((check) => (
                <div key={check.label} className="grid items-start gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer p-4 [grid-template-columns:auto_minmax(0,1fr)]">
                  <span className={severityIconClass(check.ok ? "ok" : "warning")}>
                    {severityIcon(check.ok ? "ok" : "warning")}
                  </span>
                  <div>
                    <strong>{check.label}</strong>
                    <p className="m-0 text-sm text-md3-onSurfaceVariant">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="eyebrow">Warnings</p>
                <CardTitle className="text-xl">Operator alerts</CardTitle>
              </div>
              <Badge variant={warnings.length ? "warning" : "success"}>
                {warnings.length ? `${warnings.length} active` : "All clear"}
              </Badge>
            </CardHeader>
            {warnings.length ? (
              <div className="grid gap-3">
                {warnings.map((warning) => (
                  <div key={`${warning.severity}-${warning.title}`} className={warningCardClass(warning.severity)}>
                    <div className="flex items-start gap-3">
                      <span className={severityIconClass(warning.severity)}>{severityIcon(warning.severity)}</span>
                      <strong>{warning.title}</strong>
                    </div>
                    <p className="m-0 text-sm text-md3-onSurfaceVariant">{warning.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <FieldHint>No active operator warnings. The live setup looks healthy.</FieldHint>
            )}
          </Card>

          <Card>
            <details className="overflow-visible rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer data-[state=open]:bg-md3-surface">
              <summary className="flex list-none items-start justify-between gap-4 px-4 py-4">
                <div>
                  <p className="eyebrow">Overlay details</p>
                  <h3>On-air details</h3>
                </div>
                <Badge variant="info">Optional</Badge>
              </summary>
              <div className="grid gap-4 px-4 pb-4">
                <div className="grid gap-3">
                  <div>
                    <strong>Published theme</strong>
                    <span>{publishedTheme?.name ?? "None selected"}</span>
                  </div>
                  <div>
                    <strong>Left logo source</strong>
                    <Badge variant={logoTone(leftLogo)}>{leftLogo.label}</Badge>
                  </div>
                  <div>
                    <strong>Right logo source</strong>
                    <Badge variant={logoTone(rightLogo)}>{rightLogo.label}</Badge>
                  </div>
                  <div>
                    <strong>Lower line mode</strong>
                    <span>
                      {live.data?.period === "BREAK"
                        ? publishedTheme?.centerSecondary.breakMode ?? "—"
                        : publishedTheme?.centerSecondary.gameMode ?? "—"}
                    </span>
                  </div>
                  <div>
                    <strong>Active overlay state</strong>
                    <span>
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
                <Badge variant="info">Optional</Badge>
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
    </section>
  );
}
