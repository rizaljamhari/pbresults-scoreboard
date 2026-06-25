import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useLiveState, useSettings, useTeams, useTheme } from "../hooks";
import { builtinThemes } from "../../shared/builtinThemes";
import { componentIds, fontFamilies } from "../../shared/theme";
import type { ComponentId, NormalizedLiveState, TeamMatchResult, TeamRecord, ThemeDefinition } from "../../shared/theme";
import { ThemeCanvasEditor } from "../components/ThemeCanvasEditor";
import { AdminPageFrame, AdminPageHeader, Badge, Button, FieldHint, buttonVariants } from "../components/ui";

type EditorMode = "basic" | "advanced";
type InspectorView = "theme" | "component" | "concede";
type SlotId = "left" | "center" | "right";
type PreviewNameMode = "live" | "short" | "long";
type PreviewLogoMode = "live" | "matched" | "missing" | "unmatched";
type PreviewPeriodMode = "live" | "GAME" | "BREAK";
type PreviewEventMode = "live" | NormalizedLiveState["teamEvent"];
type PreviewSwitchMode = "live" | "0" | "1";
type PreviewPresetId = "live" | "game" | "break" | "towelHome" | "towelAway" | "baseHome" | "baseAway";
const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const safeAreaTopInset = 54;
const defaultTopInset = 24;
const previewDrawerStorageKey = "pbresults.themeEditor.previewDrawerOpen";

const componentLabels: Record<ComponentId, string> = {
  homeName: "Left Name",
  homeTeamLogo: "Left Logo",
  homeScore: "Left Score",
  awayName: "Right Name",
  awayTeamLogo: "Right Logo",
  awayScore: "Right Score",
  gameTime: "Center Primary",
  breakTime: "Center Secondary",
  eventLogo: "Event Logo"
};

const componentShortLabels: Record<ComponentId, string> = {
  homeName: "Name",
  homeTeamLogo: "Logo",
  homeScore: "Score",
  awayName: "Name",
  awayTeamLogo: "Logo",
  awayScore: "Score",
  gameTime: "Primary",
  breakTime: "Secondary",
  eventLogo: "Event Logo"
};

const teamLogoFallbackModeLabels: Record<
  ThemeDefinition["components"]["homeTeamLogo"]["teamLogoFallbackMode"],
  string
> = {
  none: "Registry only",
  eventLogo: "Event logo",
  slotFallback: "Slot fallback asset",
  slotFallbackThenEventLogo: "Slot fallback, then event logo"
};

const homeBlockIds: ComponentId[] = ["homeTeamLogo", "homeName", "homeScore"];
const awayBlockIds: ComponentId[] = ["awayScore", "awayName", "awayTeamLogo"];
const centerBlockIds: ComponentId[] = ["gameTime", "breakTime", "eventLogo"];
const mirroredComponentPairs: Array<[ComponentId, ComponentId]> = [
  ["homeTeamLogo", "awayTeamLogo"],
  ["homeName", "awayName"],
  ["homeScore", "awayScore"]
];
const previewEventStateMap: Record<Exclude<NormalizedLiveState["teamEvent"], "none">, string> = {
  "towel-home": "TOWEL1",
  "towel-away": "TOWEL2",
  "base-home": "BASE2",
  "base-away": "BASE1"
};

const slotConfig: Record<SlotId, { title: string; description: string; ids: ComponentId[] }> = {
  left: {
    title: "Left Slot",
    description: "The team panel rendered on the left side of the overlay.",
    ids: homeBlockIds
  },
  center: {
    title: "Center Slot",
    description: "Main clock, lower status line, and optional event mark.",
    ids: centerBlockIds
  },
  right: {
    title: "Right Slot",
    description: "The team panel rendered on the right side of the overlay.",
    ids: awayBlockIds
  }
};

const editorRailGroups: Array<{ id: string; title: string; description: string; ids: ComponentId[] }> = [
  {
    id: "left",
    title: "Left Team",
    description: "Logo, name, and score on the left side.",
    ids: homeBlockIds
  },
  {
    id: "center",
    title: "Center",
    description: "Primary clock, secondary line, and event logo.",
    ids: centerBlockIds
  },
  {
    id: "right",
    title: "Right Team",
    description: "Score, name, and logo on the right side.",
    ids: awayBlockIds
  }
];

const concedePresets = {
  stampDark: {
    label: "Dark Stamp",
    values: {
      general: {
        placementMode: "center-stamp" as const,
        borderColor: "#f6f1e8",
        fontFamily: "Bebas Neue" as const,
        fontSize: 34,
        fontWeight: 700,
        letterSpacing: 1.5,
        height: 56,
        padding: 10,
        animationPreset: "slide-vertical" as const
      },
      concede: {
        backgroundColor: "#171311dd",
        color: "#ffffff"
      }
    }
  },
  ribbonLight: {
    label: "Light Ribbon",
    values: {
      general: {
        placementMode: "top-ribbon" as const,
        borderColor: "#111111",
        fontFamily: "Bebas Neue" as const,
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: 1.1,
        height: 48,
        padding: 8,
        animationPreset: "slide-horizontal" as const
      },
      concede: {
        backgroundColor: "#f6f1e8",
        color: "#111111"
      }
    }
  },
  panelAlert: {
    label: "Full Panel",
    values: {
      general: {
        placementMode: "full-panel" as const,
        borderColor: "#f0d7b0",
        fontFamily: "Bebas Neue" as const,
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: 1.8,
        height: 64,
        padding: 14,
        animationPreset: "slide-horizontal" as const
      },
      concede: {
        backgroundColor: "#181311d6",
        color: "#fff7ed"
      }
    }
  }
} as const;

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  unit?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label>
      {props.label}
      <div className="field-with-unit">
        <input
          type="number"
          step={props.step ?? 1}
          min={props.min}
          max={props.max}
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        {props.unit ? (
          <span className="inline-flex min-h-12 items-center whitespace-nowrap rounded-md3s border border-md3-outline bg-md3-surfaceContainer px-3.5 text-md3-onSurfaceVariant">
            {props.unit}
          </span>
        ) : null}
      </div>
    </label>
  );
}

function normalizePickerColor(value: string) {
  const normalized = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4})$/.test(normalized)) {
    const chars = normalized.slice(1).split("");
    return `#${chars[0]}${chars[0]}${chars[1]}${chars[1]}${chars[2]}${chars[2]}`;
  }
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(normalized)) {
    return normalized.slice(0, 7);
  }
  return "#000000";
}

function mergePickerColor(current: string, next: string) {
  const normalized = current.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(normalized)) {
    return `${next}${normalized.slice(7)}`;
  }
  if (/^#[0-9a-fA-F]{4}$/.test(normalized)) {
    return `${next}${normalized.slice(4)}`;
  }
  return next;
}

function ColorField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {props.label}
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <input
          type="color"
          className="mt-0"
          value={normalizePickerColor(props.value)}
          onChange={(event) => props.onChange(mergePickerColor(props.value, event.target.value))}
        />
        <input className="mt-0" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      </div>
    </label>
  );
}

function PercentField(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <NumberField
      label={props.label}
      value={Math.round(props.value * 100)}
      min={0}
      max={100}
      unit="%"
      onChange={(value) => props.onChange(value / 100)}
    />
  );
}

function TextField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {props.label}
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function SectionCard(props: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const openProps = props.open === undefined ? { open: props.defaultOpen ?? true } : { open: props.open };

  return (
    <details
      className="editor-section-card"
      {...openProps}
      onToggle={
        props.onToggle
          ? (event) => {
              props.onToggle?.(event.currentTarget.open);
            }
          : undefined
      }
    >
      <summary className="editor-section-header">
        <div>
          <h3>{props.title}</h3>
        </div>
      </summary>
      <div className="editor-section-body">{props.children}</div>
    </details>
  );
}

function ComponentPillRow(props: {
  ids: ComponentId[];
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  labels?: Record<ComponentId, string>;
}) {
  return (
    <div className="component-pill-row">
      {props.ids.map((id) => (
        <button
          key={id}
          type="button"
          className={
            props.selected === id
              ? "inline-flex min-h-10 items-center justify-center rounded-full border border-[#005fa32e] bg-md3-secondaryContainer px-3.5 py-2.5 text-md3-onPrimaryContainer shadow-none"
              : "inline-flex min-h-10 items-center justify-center rounded-full border border-md3-outlineVariant bg-md3-surface px-3.5 py-2.5 text-md3-onPrimaryContainer shadow-none hover:bg-md3-surfaceContainerLow"
          }
          onClick={() => props.onSelect(id)}
        >
          {props.labels?.[id] ?? componentLabels[id]}
        </button>
      ))}
    </div>
  );
}

function slotForComponent(id: ComponentId | null): SlotId {
  if (!id) {
    return "left";
  }
  if (homeBlockIds.includes(id)) {
    return "left";
  }
  if (awayBlockIds.includes(id)) {
    return "right";
  }
  return "center";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const field = target.closest("input, textarea, select");
  if (!(field instanceof HTMLElement)) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset"].includes(field.type);
  }

  return true;
}

function clonePreviewMatch(match: TeamMatchResult, overrides: Partial<TeamMatchResult>): TeamMatchResult {
  return {
    ...match,
    ...overrides
  };
}

function buildMatchedPreviewMatch(inputName: string, team: TeamRecord): TeamMatchResult {
  return {
    inputName,
    normalizedInput: inputName.trim().toUpperCase(),
    status: "matched",
    confidence: 1,
    matchedAlias: team.aliases[0] ?? team.canonicalName,
    teamId: team.id,
    team,
    candidates: []
  };
}

function buildUnmatchedPreviewMatch(inputName: string): TeamMatchResult {
  return {
    inputName,
    normalizedInput: inputName.trim().toUpperCase(),
    status: "unmatched",
    confidence: 0,
    matchedAlias: null,
    teamId: null,
    team: null,
    candidates: []
  };
}

function clampThemeToCanvas(theme: ThemeDefinition): ThemeDefinition {
  const next = structuredClone(theme);
  const { width: canvasWidth, height: canvasHeight } = next.canvas;

  for (const component of Object.values(next.components)) {
    component.width = Math.min(component.width, canvasWidth);
    component.height = Math.min(component.height, canvasHeight);
    component.x = clamp(component.x, 0, Math.max(0, canvasWidth - component.width));
    component.y = clamp(component.y, 0, Math.max(0, canvasHeight - component.height));
  }

  return next;
}

function mirrorX(canvasWidth: number, x: number, width: number) {
  return canvasWidth - x - width;
}

function mirrorTextAlign(value: "left" | "center" | "right") {
  if (value === "left") {
    return "right";
  }
  if (value === "right") {
    return "left";
  }
  return "center";
}

function mirrorComponentLayout(
  canvasWidth: number,
  sourceComponent: ThemeDefinition["components"][ComponentId],
  targetComponent: ThemeDefinition["components"][ComponentId]
) {
  targetComponent.x = mirrorX(canvasWidth, sourceComponent.x, sourceComponent.width);
  targetComponent.y = sourceComponent.y;
  targetComponent.width = sourceComponent.width;
  targetComponent.height = sourceComponent.height;
  targetComponent.paddingX = sourceComponent.paddingX;
  targetComponent.paddingY = sourceComponent.paddingY;
  targetComponent.offsetX = -sourceComponent.offsetX;
  targetComponent.offsetY = sourceComponent.offsetY;

  if (sourceComponent.kind === "text" && targetComponent.kind === "text") {
    targetComponent.textAlign = mirrorTextAlign(sourceComponent.textAlign);
  }
}

function mirroredPairForComponent(id: ComponentId) {
  return mirroredComponentPairs.find(([leftId, rightId]) => leftId === id || rightId === id) ?? null;
}

type LayoutScopeEntry = {
  id: ComponentId;
  component: ThemeDefinition["components"][ComponentId];
};

function resolveLayoutScopeEntries(
  draft: ThemeDefinition,
  ids: ComponentId[]
): LayoutScopeEntry[] {
  const all = ids.map((id) => ({ id, component: draft.components[id] }));
  const visible = all.filter((entry) => entry.component.visible);
  return visible.length > 0 ? visible : all;
}

const componentOrderIndex: Record<ComponentId, number> = componentIds.reduce(
  (accumulator, id, index) => {
    accumulator[id] = index;
    return accumulator;
  },
  {} as Record<ComponentId, number>
);

function getOrderedComponentIds(theme: ThemeDefinition) {
  return [...componentIds].sort((left, right) => {
    const zIndexDifference = theme.components[left].zIndex - theme.components[right].zIndex;
    if (zIndexDifference !== 0) {
      return zIndexDifference;
    }
    return componentOrderIndex[left] - componentOrderIndex[right];
  });
}

function reorderComponentStack(
  draft: ThemeDefinition,
  selectedId: ComponentId,
  action: "bringForward" | "bringBackward" | "sendToFront" | "sendToBack"
) {
  const orderedIds = getOrderedComponentIds(draft);
  const currentIndex = orderedIds.indexOf(selectedId);
  if (currentIndex === -1) {
    return false;
  }

  const targetIndex =
    action === "bringForward"
      ? Math.min(orderedIds.length - 1, currentIndex + 1)
      : action === "bringBackward"
        ? Math.max(0, currentIndex - 1)
        : action === "sendToFront"
          ? orderedIds.length - 1
          : 0;

  if (targetIndex === currentIndex) {
    return false;
  }

  orderedIds.splice(currentIndex, 1);
  orderedIds.splice(targetIndex, 0, selectedId);

  orderedIds.forEach((id, index) => {
    draft.components[id].zIndex = index + 1;
  });

  return true;
}

export function ThemeEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const themeResource = useTheme(id);
  const assets = useAssets();
  const teams = useTeams();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const [selected, setSelected] = useState<ComponentId | null>("homeName");
  const [selectedIds, setSelectedIds] = useState<ComponentId[]>(["homeName"]);
  const [selectedSlot, setSelectedSlot] = useState<SlotId>("left");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<ThemeDefinition[]>([]);
  const [future, setFuture] = useState<ThemeDefinition[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<ThemeDefinition | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("basic");
  const [inspectorView, setInspectorView] = useState<InspectorView>("component");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(previewDrawerStorageKey) === "1";
  });
  const [previewPeriod, setPreviewPeriod] = useState<PreviewPeriodMode>("live");
  const [previewEvent, setPreviewEvent] = useState<PreviewEventMode>("live");
  const [previewSidesSwitched, setPreviewSidesSwitched] = useState<PreviewSwitchMode>("live");
  const [previewNameMode, setPreviewNameMode] = useState<PreviewNameMode>("live");
  const [previewLeftLogoMode, setPreviewLeftLogoMode] = useState<PreviewLogoMode>("live");
  const [previewRightLogoMode, setPreviewRightLogoMode] = useState<PreviewLogoMode>("live");
  const [previewLeftScore, setPreviewLeftScore] = useState(2);
  const [previewRightScore, setPreviewRightScore] = useState(1);
  const [previewGameTimerValue, setPreviewGameTimerValue] = useState(371);
  const [previewBreakTimerValue, setPreviewBreakTimerValue] = useState(3);
  const theme = themeResource.data;

  const selectedEditableComponent = theme && selected ? theme.components[selected] : null;

  const selectedTextComponent = selectedEditableComponent?.kind === "text" ? selectedEditableComponent : null;
  const selectedImageComponent = selectedEditableComponent?.kind === "image" ? selectedEditableComponent : null;
  const selectedIsTeamLogo = selected === "homeTeamLogo" || selected === "awayTeamLogo";
  const selectedSlotConfig = slotConfig[selectedSlot];
  const selectedShortLabel = selected ? componentShortLabels[selected] : "No piece";
  const sampleTeams = (teams.data ?? []).filter((team) => team.active);
  const defaultLeftPreviewTeam =
    live.data?.displayLeftTeamMatch.team ??
    sampleTeams[0] ?? {
      id: "preview-left",
      canonicalName: "Seattle Uprising",
      scoreboardDisplayName: "UPRISING",
      shortName: "SBJ",
      aliases: ["SBJ", "Seattle Uprising"],
      liveMatchNames: [],
      logoAssetId: null,
      alternateLogoAssetId: null,
      notes: "",
      active: true,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
  const defaultRightPreviewTeam =
    live.data?.displayRightTeamMatch.team ??
    sampleTeams.find((team) => team.id !== defaultLeftPreviewTeam.id) ?? {
      id: "preview-right",
      canonicalName: "Red Tide",
      scoreboardDisplayName: "RED TIDE",
      shortName: "RT",
      aliases: ["RT", "Red Tide"],
      liveMatchNames: [],
      logoAssetId: null,
      alternateLogoAssetId: null,
      notes: "",
      active: true,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };

  const previewLive = (() => {
    const baseLive: NormalizedLiveState = live.data ?? {
      sourceStatus: "ok",
      fetchedAt: new Date().toISOString(),
      errorMessage: null,
      state: "RUNNING",
      period: "GAME",
      round: 1,
      sidesSwitched: 0,
      secondGame: false,
      homeTeam: { name: "SBJ", score: 2, playersAlive: 0, timer: null, midName: "", image: "" },
      awayTeam: { name: "RT", score: 1, playersAlive: 0, timer: null, midName: "", image: "" },
      displayLeftTeam: { name: "SBJ", score: 2, playersAlive: 0, timer: null, midName: "", image: "" },
      displayRightTeam: { name: "RT", score: 1, playersAlive: 0, timer: null, midName: "", image: "" },
      homeTeamMatch: buildMatchedPreviewMatch("SBJ", defaultLeftPreviewTeam),
      awayTeamMatch: buildMatchedPreviewMatch("RT", defaultRightPreviewTeam),
      displayLeftTeamMatch: buildMatchedPreviewMatch("SBJ", defaultLeftPreviewTeam),
      displayRightTeamMatch: buildMatchedPreviewMatch("RT", defaultRightPreviewTeam),
      unresolvedTeamNames: [],
      breakTimer: { value: 3, state: 2 },
      gameTimer: { value: 371, state: 2 },
      teamEvent: "none"
    };

    if (!previewEnabled) {
      return baseLive;
    }

    const next = structuredClone(baseLive);
    next.fetchedAt = new Date().toISOString();
    next.sourceStatus = "ok";
    next.displayLeftTeam.score = previewLeftScore;
    next.displayRightTeam.score = previewRightScore;
    next.homeTeam.score = previewLeftScore;
    next.awayTeam.score = previewRightScore;
    next.gameTimer.value = previewGameTimerValue;
    next.breakTimer.value = previewBreakTimerValue;

    const chooseName = (team: typeof next.displayLeftTeam, record: TeamRecord, side: "left" | "right") => {
      if (previewNameMode === "live") {
        return team.name;
      }
      if (previewNameMode === "short") {
        return record.shortName || record.scoreboardDisplayName || team.name;
      }
      return side === "left" ? "Seattle Uprising Legacy Squad" : "Edmonton Impact Championship Team";
    };

    const leftRecord = defaultLeftPreviewTeam;
    const rightRecord = defaultRightPreviewTeam;
    next.displayLeftTeam.name = chooseName(next.displayLeftTeam, leftRecord, "left");
    next.displayRightTeam.name = chooseName(next.displayRightTeam, rightRecord, "right");
    next.homeTeam.name = next.displayLeftTeam.name;
    next.awayTeam.name = next.displayRightTeam.name;

    const applyLogoMode = (mode: PreviewLogoMode, currentMatch: TeamMatchResult, record: TeamRecord, displayName: string) => {
      if (mode === "live") {
        return currentMatch;
      }
      if (mode === "matched") {
        return buildMatchedPreviewMatch(displayName, record);
      }
      if (mode === "missing") {
        return buildMatchedPreviewMatch(displayName, {
          ...record,
          logoAssetId: null,
          alternateLogoAssetId: null
        });
      }
      return buildUnmatchedPreviewMatch(displayName);
    };

    const leftMatch = applyLogoMode(previewLeftLogoMode, next.displayLeftTeamMatch, leftRecord, next.displayLeftTeam.name);
    const rightMatch = applyLogoMode(previewRightLogoMode, next.displayRightTeamMatch, rightRecord, next.displayRightTeam.name);
    next.displayLeftTeamMatch = leftMatch;
    next.displayRightTeamMatch = rightMatch;
    next.homeTeamMatch = clonePreviewMatch(leftMatch, {});
    next.awayTeamMatch = clonePreviewMatch(rightMatch, {});
    next.unresolvedTeamNames = [leftMatch, rightMatch]
      .filter((match) => match.status !== "matched" && match.inputName.trim())
      .map((match) => match.inputName);

    if (previewPeriod !== "live") {
      next.period = previewPeriod;
      next.gameTimer.state = previewPeriod === "GAME" ? 2 : 0;
      next.breakTimer.state = previewPeriod === "BREAK" ? 2 : 0;
    }

    if (previewSidesSwitched !== "live") {
      next.sidesSwitched = Number(previewSidesSwitched);
    }

    if (previewEvent !== "live") {
      next.teamEvent = previewEvent;
      next.state = previewEvent === "none" ? next.state : previewEventStateMap[previewEvent];
    }

    return next;
  })();

  function resetPreviewState() {
    setPreviewEnabled(false);
    setPreviewPeriod("live");
    setPreviewEvent("live");
    setPreviewSidesSwitched("live");
    setPreviewNameMode("live");
    setPreviewLeftLogoMode("live");
    setPreviewRightLogoMode("live");
    setPreviewLeftScore(live.data?.displayLeftTeam.score ?? 2);
    setPreviewRightScore(live.data?.displayRightTeam.score ?? 1);
    setPreviewGameTimerValue(live.data?.gameTimer.value ?? 371);
    setPreviewBreakTimerValue(live.data?.breakTimer.value ?? 3);
  }

  function applyPreviewPreset(preset: PreviewPresetId) {
    if (preset === "live") {
      resetPreviewState();
      return;
    }

    setPreviewEnabled(true);
    setPreviewSidesSwitched("live");
    setPreviewNameMode("live");
    setPreviewLeftLogoMode("live");
    setPreviewRightLogoMode("live");

    if (preset === "game") {
      setPreviewPeriod("GAME");
      setPreviewEvent("none");
      return;
    }

    if (preset === "break") {
      setPreviewPeriod("BREAK");
      setPreviewEvent("none");
      return;
    }

    setPreviewPeriod("GAME");
    setPreviewEvent(
      preset === "towelHome"
        ? "towel-home"
        : preset === "towelAway"
          ? "towel-away"
          : preset === "baseHome"
            ? "base-home"
            : "base-away"
    );
  }

  const selectedLogoContext =
    selectedIsTeamLogo && selectedImageComponent
      ? (() => {
          const match = selected === "homeTeamLogo" ? previewLive?.displayLeftTeamMatch : previewLive?.displayRightTeamMatch;
          const registryAssetId = match?.team?.logoAssetId ?? match?.team?.alternateLogoAssetId ?? null;
          const registryAsset = registryAssetId ? assets.data?.find((asset) => asset.id === registryAssetId) ?? null : null;
          const fallbackAsset = selectedImageComponent.assetId
            ? assets.data?.find((asset) => asset.id === selectedImageComponent.assetId) ?? null
            : null;
          const eventAsset = theme.components.eventLogo.assetId
            ? assets.data?.find((asset) => asset.id === theme.components.eventLogo.assetId) ?? null
            : null;
          const effectiveAsset =
            registryAsset ??
            (selectedImageComponent.teamLogoFallbackMode === "slotFallback"
              ? fallbackAsset
              : selectedImageComponent.teamLogoFallbackMode === "slotFallbackThenEventLogo"
                ? fallbackAsset ?? eventAsset
                : selectedImageComponent.teamLogoFallbackMode === "eventLogo"
                  ? eventAsset
                  : null);
          return {
            sideLabel: selected === "homeTeamLogo" ? "Left display team" : "Right display team",
            match,
            registryAsset,
            fallbackAsset,
            eventAsset,
            effectiveAsset
          };
        })()
      : null;
  const selectedMirroredPair = selected ? mirroredPairForComponent(selected) : null;
  const hasUnsavedChanges = savedSnapshot ? !sameTheme(savedSnapshot, theme) : false;
  const orderedComponentIds = theme ? getOrderedComponentIds(theme) : [];
  const selectedStackIndex = selected ? orderedComponentIds.indexOf(selected) : -1;
  const canBringBackward = selectedStackIndex > 0;
  const canBringForward = selectedStackIndex >= 0 && selectedStackIndex < orderedComponentIds.length - 1;

  function sameTheme(left: ThemeDefinition, right: ThemeDefinition) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function updateTheme(next: ThemeDefinition, options?: { recordHistory?: boolean }) {
    const normalizedNext = clampThemeToCanvas(next);
    if (themeResource.data && sameTheme(themeResource.data, normalizedNext)) {
      return;
    }
    if (options?.recordHistory !== false) {
      setHistory((current) => {
        const seed = current.length === 0 && themeResource.data ? [structuredClone(themeResource.data)] : current;
        return [...seed, structuredClone(normalizedNext)];
      });
      setFuture([]);
    }
    themeResource.setData(normalizedNext);
  }

  function patchTheme(mutator: (draft: ThemeDefinition) => void) {
    if (!themeResource.data) {
      return;
    }
    const next = structuredClone(themeResource.data);
    mutator(next);
    updateTheme(next);
  }

  function patchSelectedComponent(mutator: (component: ThemeDefinition["components"][ComponentId]) => void) {
    if (!selected) {
      return;
    }
    patchTheme((draft) => {
      mutator(draft.components[selected]);
    });
  }

  function patchSelectedTextComponent(mutator: (component: ThemeDefinition["components"]["homeName"]) => void) {
    if (!selected) {
      return;
    }
    patchTheme((draft) => {
      const component = draft.components[selected];
      if (component.kind === "text") {
        mutator(component);
      }
    });
  }

  function patchTeamEventOverlay(mutator: (overlay: ThemeDefinition["teamEventOverlay"]) => void) {
    patchTheme((draft) => {
      mutator(draft.teamEventOverlay);
    });
  }

  function patchOverlayGeneral(mutator: (general: ThemeDefinition["teamEventOverlay"]["general"]) => void) {
    patchTeamEventOverlay((overlay) => {
      mutator(overlay.general);
    });
  }

  function patchConcede(mutator: (concede: ThemeDefinition["teamEventOverlay"]["concede"]) => void) {
    patchTeamEventOverlay((overlay) => {
      mutator(overlay.concede);
    });
  }

  function patchBaseOverlay(mutator: (base: ThemeDefinition["teamEventOverlay"]["base"]) => void) {
    patchTeamEventOverlay((overlay) => {
      mutator(overlay.base);
    });
  }

  function patchWinnerOverlay(mutator: (winner: ThemeDefinition["teamEventOverlay"]["winner"]) => void) {
    patchTeamEventOverlay((overlay) => {
      mutator(overlay.winner);
    });
  }

  function selectComponent(id: ComponentId, options?: { additive?: boolean }) {
    setActiveMenu(null);
    setSelectAllMode(false);
    const additive = options?.additive === true;

    if (additive) {
      setSelectedIds((current) => {
        const exists = current.includes(id);
        const next = exists ? current.filter((entry) => entry !== id) : [...current, id];
        setSelected(next.length > 0 ? next[next.length - 1] : null);
        return next;
      });
      setSelectedSlot(slotForComponent(id));
    } else {
      setSelected(id);
      setSelectedIds([id]);
      setSelectedSlot(slotForComponent(id));
    }

    setInspectorView("component");
  }

  function selectComponents(ids: ComponentId[], options?: { additive?: boolean }) {
    setActiveMenu(null);
    setSelectAllMode(false);

    const unique = Array.from(new Set(ids));
    if (options?.additive) {
      setSelectedIds((current) => {
        const next = Array.from(new Set([...current, ...unique]));
        setSelected(next.length > 0 ? next[next.length - 1] : null);
        if (next.length > 0) {
          setSelectedSlot(slotForComponent(next[next.length - 1]));
        }
        return next;
      });
    } else {
      setSelectedIds(unique);
      setSelected(unique.length > 0 ? unique[unique.length - 1] : null);
      if (unique.length > 0) {
        setSelectedSlot(slotForComponent(unique[unique.length - 1]));
      }
    }

    setInspectorView("component");
  }

  function selectSlot(slot: SlotId) {
    setActiveMenu(null);
    setSelectAllMode(false);
    setSelectedSlot(slot);
    if (!selected || !slotConfig[slot].ids.includes(selected)) {
      const nextId = slotConfig[slot].ids[0];
      setSelected(nextId);
      setSelectedIds(nextId ? [nextId] : []);
    } else {
      setSelectedIds([selected]);
    }
    setInspectorView("component");
  }

  function selectAllComponents() {
    setActiveMenu(null);
    setSelectAllMode(true);
    if (themeResource.data) {
      const ids = Object.keys(themeResource.data.components) as ComponentId[];
      setSelectedIds(ids);
    }
    setInspectorView("component");
  }

  function toggleMenu(id: string) {
    setActiveMenu((current) => (current === id ? null : id));
  }

  function closeMenus() {
    setActiveMenu(null);
  }

  function applyConcedePreset(presetId: keyof typeof concedePresets) {
    const preset = concedePresets[presetId].values;
    patchTeamEventOverlay((overlay) => {
      Object.assign(overlay.general, preset.general);
      Object.assign(overlay.concede, preset.concede);
    });
  }

  function undo() {
    if (history.length <= 1 || !themeResource.data) {
      return;
    }
    const previous = history[history.length - 2];
    setFuture((current) => [structuredClone(themeResource.data), ...current]);
    setHistory((current) => current.slice(0, -1));
    themeResource.setData(structuredClone(previous));
  }

  function redo() {
    if (future.length === 0) {
      return;
    }
    const [next, ...rest] = future;
    setHistory((current) => [...current, structuredClone(next)]);
    setFuture(rest);
    themeResource.setData(structuredClone(next));
  }

  function bringSelectedIntoView() {
    if (!themeResource.data || !selected) {
      return;
    }
    patchTheme((draft) => {
      const component = draft.components[selected];
      component.width = Math.min(component.width, draft.canvas.width);
      component.height = Math.min(component.height, draft.canvas.height);
      component.x = clamp(component.x, 0, Math.max(0, draft.canvas.width - component.width));
      component.y = clamp(component.y, 0, Math.max(0, draft.canvas.height - component.height));
    });
  }

  function reorderSelectedComponent(action: "bringForward" | "bringBackward" | "sendToFront" | "sendToBack") {
    if (!themeResource.data || !selected) {
      return;
    }

    patchTheme((draft) => {
      reorderComponentStack(draft, selected, action);
    });
  }

  function centerAllComponents() {
    if (!themeResource.data) {
      return;
    }

    patchTheme((draft) => {
      const components = Object.values(draft.components);
      const visibleComponents = components.filter((component) => component.visible);
      const source = visibleComponents.length > 0 ? visibleComponents : components;

      const minX = Math.min(...source.map((component) => component.x));
      const minY = Math.min(...source.map((component) => component.y));
      const maxX = Math.max(...source.map((component) => component.x + component.width));

      const contentWidth = maxX - minX;
      const targetX = Math.round((draft.canvas.width - contentWidth) / 2);
      const targetY = draft.canvas.safeArea ? safeAreaTopInset : defaultTopInset;
      const deltaX = targetX - minX;
      const deltaY = targetY - minY;

      for (const component of Object.values(draft.components)) {
        component.x += deltaX;
        component.y += deltaY;
      }
    });
  }

  function getLayoutScopeIds(currentTheme: ThemeDefinition): ComponentId[] {
    if (selectAllMode) {
      return Object.keys(currentTheme.components) as ComponentId[];
    }
    return selectedSlotConfig.ids;
  }

  function alignLayoutScope(mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") {
    if (!themeResource.data) {
      return;
    }

    patchTheme((draft) => {
      const ids = getLayoutScopeIds(draft);
      const entries = resolveLayoutScopeEntries(draft, ids);
      if (entries.length <= 1) {
        return;
      }

      const minX = Math.min(...entries.map((entry) => entry.component.x));
      const minY = Math.min(...entries.map((entry) => entry.component.y));
      const maxX = Math.max(...entries.map((entry) => entry.component.x + entry.component.width));
      const maxY = Math.max(...entries.map((entry) => entry.component.y + entry.component.height));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      for (const entry of entries) {
        if (mode === "left") {
          entry.component.x = minX;
        } else if (mode === "centerX") {
          entry.component.x = Math.round(centerX - entry.component.width / 2);
        } else if (mode === "right") {
          entry.component.x = Math.round(maxX - entry.component.width);
        } else if (mode === "top") {
          entry.component.y = minY;
        } else if (mode === "centerY") {
          entry.component.y = Math.round(centerY - entry.component.height / 2);
        } else if (mode === "bottom") {
          entry.component.y = Math.round(maxY - entry.component.height);
        }
      }
    });
    closeMenus();
  }

  function distributeLayoutScope(axis: "horizontal" | "vertical") {
    if (!themeResource.data) {
      return;
    }

    patchTheme((draft) => {
      const ids = getLayoutScopeIds(draft);
      const entries = resolveLayoutScopeEntries(draft, ids);
      if (entries.length < 3) {
        return;
      }

      const sorted = [...entries].sort((left, right) =>
        axis === "horizontal"
          ? left.component.x - right.component.x
          : left.component.y - right.component.y
      );

      const first = sorted[0].component;
      const last = sorted[sorted.length - 1].component;
      const start = axis === "horizontal" ? first.x : first.y;
      const end =
        axis === "horizontal"
          ? last.x + last.width
          : last.y + last.height;
      const totalSize = sorted.reduce(
        (sum, entry) => sum + (axis === "horizontal" ? entry.component.width : entry.component.height),
        0
      );
      const span = end - start;
      if (span <= totalSize) {
        return;
      }

      const gap = (span - totalSize) / (sorted.length - 1);
      let cursor = start;

      for (const entry of sorted) {
        if (axis === "horizontal") {
          entry.component.x = Math.round(cursor);
          cursor += entry.component.width + gap;
        } else {
          entry.component.y = Math.round(cursor);
          cursor += entry.component.height + gap;
        }
      }
    });
    closeMenus();
  }

  function matchLayoutScopeSize(mode: "width" | "height" | "both") {
    if (!themeResource.data) {
      return;
    }

    patchTheme((draft) => {
      const ids = getLayoutScopeIds(draft);
      const entries = resolveLayoutScopeEntries(draft, ids);
      if (entries.length < 2) {
        return;
      }

      const referenceId = selected && ids.includes(selected) ? selected : entries[0].id;
      const reference = draft.components[referenceId];

      for (const entry of entries) {
        if (entry.id === referenceId) {
          continue;
        }
        if (mode === "width" || mode === "both") {
          entry.component.width = reference.width;
        }
        if (mode === "height" || mode === "both") {
          entry.component.height = reference.height;
        }
      }
    });
    closeMenus();
  }

  function syncTeamSlot(direction: "leftToRight" | "rightToLeft") {
    if (!themeResource.data) {
      return;
    }

    patchTheme((draft) => {
      for (const [leftId, rightId] of mirroredComponentPairs) {
        const sourceId = direction === "leftToRight" ? leftId : rightId;
        const targetId = direction === "leftToRight" ? rightId : leftId;
        const sourceComponent = structuredClone(draft.components[sourceId]);
        const mirroredX = mirrorX(draft.canvas.width, sourceComponent.x, sourceComponent.width);
        draft.components[targetId] = {
          ...sourceComponent,
          x: mirroredX
        } as ThemeDefinition["components"][ComponentId];
      }
    });

    if (selected) {
      const nextSelected =
        direction === "leftToRight"
          ? mirroredComponentPairs.find(([leftId]) => leftId === selected)?.[1] ?? selected
          : mirroredComponentPairs.find(([, rightId]) => rightId === selected)?.[0] ?? selected;
      setSelected(nextSelected);
      setSelectedIds([nextSelected]);
      setSelectedSlot(slotForComponent(nextSelected));
    }
  }

  function mirrorTeamSlotLayout(direction: "leftToRight" | "rightToLeft") {
    if (!themeResource.data) {
      return;
    }

    patchTheme((draft) => {
      for (const [leftId, rightId] of mirroredComponentPairs) {
        const sourceId = direction === "leftToRight" ? leftId : rightId;
        const targetId = direction === "leftToRight" ? rightId : leftId;
        const sourceComponent = draft.components[sourceId];
        const targetComponent = draft.components[targetId];
        mirrorComponentLayout(draft.canvas.width, sourceComponent, targetComponent);
      }
    });

    if (selected) {
      const nextSelected =
        direction === "leftToRight"
          ? mirroredComponentPairs.find(([leftId]) => leftId === selected)?.[1] ?? selected
          : mirroredComponentPairs.find(([, rightId]) => rightId === selected)?.[0] ?? selected;
      setSelected(nextSelected);
      setSelectedIds([nextSelected]);
      setSelectedSlot(slotForComponent(nextSelected));
    }
  }

  function mirrorSelectedPieceLayout() {
    if (!themeResource.data || !selectedMirroredPair || !selected) {
      return;
    }

    const [leftId, rightId] = selectedMirroredPair;
    const sourceId = selected === leftId ? leftId : rightId;
    const targetId = selected === leftId ? rightId : leftId;

    patchTheme((draft) => {
      const sourceComponent = draft.components[sourceId];
      const targetComponent = draft.components[targetId];
      mirrorComponentLayout(draft.canvas.width, sourceComponent, targetComponent);
    });
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!themeResource.data || !selected) {
      return;
    }

    patchTheme((draft) => {
      const component = draft.components[selected];
      component.x += dx;
      component.y += dy;
    });
  }

  function nudgeActiveSelection(dx: number, dy: number) {
    if (!themeResource.data) {
      return;
    }

    if (selectAllMode) {
      patchTheme((draft) => {
        for (const component of Object.values(draft.components)) {
          component.x += dx;
          component.y += dy;
        }
      });
      return;
    }

    if (selectedIds.length > 1) {
      patchTheme((draft) => {
        for (const id of selectedIds) {
          const component = draft.components[id];
          if (!component) {
            continue;
          }
          component.x += dx;
          component.y += dy;
        }
      });
      return;
    }

    nudgeSelected(dx, dy);
  }

  function clearSelectionState() {
    setActiveMenu(null);
    setSelectAllMode(false);
    setSelectedIds([]);
    setSelected(null);
    setInspectorView("component");
  }

  function resetSelectedPieceToSaved() {
    if (!savedSnapshot || !selected) {
      return;
    }

    patchTheme((draft) => {
      draft.components[selected] = structuredClone(savedSnapshot.components[selected]) as ThemeDefinition["components"][ComponentId];
    });
    closeMenus();
  }

  function resetSelectedSlotToSaved() {
    if (!savedSnapshot) {
      return;
    }

    patchTheme((draft) => {
      for (const id of selectedSlotConfig.ids) {
        draft.components[id] = structuredClone(savedSnapshot.components[id]) as ThemeDefinition["components"][ComponentId];
      }
    });
    closeMenus();
  }

  function applyLayoutPreset(builtinId: string) {
    const preset = builtinThemes.find((item) => item.id === builtinId);
    if (!preset) {
      return;
    }

    patchTheme((draft) => {
      for (const [id, component] of Object.entries(draft.components) as Array<[ComponentId, ThemeDefinition["components"][ComponentId]]>) {
        const source = preset.components[id];
        component.x = source.x;
        component.y = source.y;
        component.width = source.width;
        component.height = source.height;
        component.visible = source.visible;
        component.zIndex = source.zIndex;
      }
      draft.canvas.safeArea = preset.canvas.safeArea;
    });
    closeMenus();
  }

  function cycleSelectedPiece(direction: 1 | -1) {
    const ids = selectedSlotConfig.ids;
    if (ids.length === 0) {
      return;
    }

    setSelectAllMode(false);
    setInspectorView("component");

    if (!selected || !ids.includes(selected)) {
      const next = direction > 0 ? ids[0] : ids[ids.length - 1];
      setSelected(next);
      setSelectedIds([next]);
      return;
    }

    const index = ids.indexOf(selected);
    const nextIndex = (index + direction + ids.length) % ids.length;
    setSelected(ids[nextIndex]);
    setSelectedIds([ids[nextIndex]]);
  }

  function adjustCanvasZoom(direction: 1 | -1) {
    setCanvasZoom((current) => {
      if (direction > 0) {
        return zoomPresets.find((preset) => preset > current) ?? zoomPresets[zoomPresets.length - 1];
      }
      const descending = [...zoomPresets].reverse();
      return descending.find((preset) => preset < current) ?? zoomPresets[0];
    });
  }

  async function save(options?: { skipBuiltinConfirm?: boolean }) {
    if (!themeResource.data) {
      return;
    }
    if (themeResource.data.builtin && !options?.skipBuiltinConfirm) {
      const confirmed = window.confirm(
        "You are about to update a built-in theme. This will affect all users of this built-in. Continue?"
      );
      if (!confirmed) {
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await api.saveTheme(themeResource.data);
      themeResource.setData(saved);
      setSavedSnapshot(structuredClone(saved));
      setHistory([structuredClone(saved)]);
      setFuture([]);
    } finally {
      setSaving(false);
    }
  }

  async function saveAsCopy() {
    if (!themeResource.data) {
      return;
    }
    setSaving(true);
    try {
      const clone = await api.createTheme(themeResource.data.id, `${themeResource.data.name} Copy`);
      const draft = structuredClone(themeResource.data);
      draft.id = clone.id;
      draft.builtin = false;
      draft.name = clone.name;
      const saved = await api.saveTheme(draft);
      themeResource.setData(saved);
      setSavedSnapshot(structuredClone(saved));
      setHistory([structuredClone(saved)]);
      setFuture([]);
      navigate(`/admin/themes/${saved.id}`);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!themeResource.data) {
      return;
    }
    if (themeResource.data.builtin) {
      const confirmed = window.confirm(
        "Publish updates to this built-in theme? This may immediately change the live overlay for published built-ins."
      );
      if (!confirmed) {
        return;
      }
    }
    await save({ skipBuiltinConfirm: true });
    await api.publishTheme(themeResource.data.id);
  }

  async function uploadAssetIntoTarget(file: File, target: "logo" | "surface" | "concede" | "base" | "winner") {
    const result = await api.uploadAsset(file);
    const asset = result.asset;
    assets.setData([asset, ...(assets.data ?? [])]);

    if (result.processing.status !== "processed") {
      showToast({
        kind: "success",
        message: `Asset uploaded. Background removal ${result.processing.status}${result.processing.reason ? `: ${result.processing.reason}` : "."}`
      });
    }

    if (target === "logo") {
      patchTheme((draft) => {
        draft.components.eventLogo.assetId = asset.id;
        draft.components.eventLogo.visible = true;
      });
      return;
    }

    if (target === "surface") {
      patchSelectedComponent((component) => {
        component.backgroundImageAssetId = asset.id;
      });
      return;
    }

    if (target === "concede") {
      patchConcede((concede) => {
        concede.backgroundImageAssetId = asset.id;
      });
      return;
    }

    if (target === "base") {
      patchBaseOverlay((base) => {
        base.backgroundImageAssetId = asset.id;
      });
      return;
    }

    patchWinnerOverlay((winner) => {
      winner.backgroundImageAssetId = asset.id;
    });
  }

  useEffect(() => {
    if (!theme) {
      return;
    }
    const clampedTheme = clampThemeToCanvas(theme);
    if (!sameTheme(theme, clampedTheme)) {
      themeResource.setData(clampedTheme);
      setHistory([structuredClone(clampedTheme)]);
      setFuture([]);
      setSavedSnapshot(structuredClone(clampedTheme));
      return;
    }
    setHistory([structuredClone(theme)]);
    setFuture([]);
    setSavedSnapshot(structuredClone(theme));
  }, [theme?.id]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!activeMenu) {
        return;
      }
      if (!(event.target instanceof Node)) {
        return;
      }
      const menuRoot = (event.target as HTMLElement).closest(".row-action-menu");
      if (!menuRoot) {
        setActiveMenu(null);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [activeMenu]);

  useEffect(() => {
    if (previewEnabled || !live.data) {
      return;
    }
    setPreviewLeftScore(live.data.displayLeftTeam.score);
    setPreviewRightScore(live.data.displayRightTeam.score);
    setPreviewGameTimerValue(live.data.gameTimer.value);
    setPreviewBreakTimerValue(live.data.breakTimer.value);
  }, [previewEnabled, live.data?.displayLeftTeam.score, live.data?.displayRightTeam.score, live.data?.gameTimer.value, live.data?.breakTimer.value]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(previewDrawerStorageKey, previewDrawerOpen ? "1" : "0");
  }, [previewDrawerOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTextEditingTarget(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (activeMenu) {
          setActiveMenu(null);
          return;
        }
        clearSelectionState();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        cycleSelectedPiece(event.shiftKey ? -1 : 1);
        return;
      }

      if ((event.key === "+" || event.key === "=") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        adjustCanvasZoom(1);
        return;
      }

      if ((event.key === "-" || event.key === "_") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        adjustCanvasZoom(-1);
        return;
      }

      if (!selectAllMode && !selected && selectedIds.length === 0) {
        return;
      }

      const step = event.altKey ? 0.5 : event.shiftKey ? 10 : 1;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgeActiveSelection(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgeActiveSelection(0, step);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeActiveSelection(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeActiveSelection(step, 0);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeMenu, future, history, selectAllMode, selected, selectedIds, selectedSlotConfig.ids, themeResource.data]);

  if (!theme) {
    return <section className="panel"><FieldHint>Loading theme...</FieldHint></section>;
  }

  const selectedSummaryLabel =
    selectAllMode
      ? "Editing all components"
      : selectedIds.length > 1
        ? `Editing ${selectedIds.length} pieces`
        : selected
          ? `Editing ${selectedSlotConfig.title} > ${selectedShortLabel}`
          : "No piece selected";
  const selectedIdSet = new Set(selectedIds);
  const selectionModeDetail = selectAllMode
    ? "Global layout scope"
    : selectedIds.length > 1
      ? "Multi-selection active"
      : selected
        ? "Single-piece mode"
        : "Choose a piece from the structure rail or canvas.";

  return (
    <AdminPageFrame className="panel-stack editor-layout">
      <div className="panel">
        <AdminPageHeader
          eyebrow="Theme Editor"
          title={theme.name}
          description={
            <div className="editor-header-status">
              {hasUnsavedChanges ? <Badge variant="warning">Unsaved changes</Badge> : <span>Ready to publish</span>}
              <span>{theme.builtin ? "Built-in theme" : "Custom theme"}</span>
            </div>
          }
          actions={(
            <div className="editor-header-actions editor-header-actions--compact">
              <Button variant="secondary" onClick={() => navigate("/admin/themes")}>
                Back
              </Button>
              <Button variant="secondary" onClick={undo} disabled={history.length <= 1}>
                Undo
              </Button>
              <Button variant="secondary" onClick={redo} disabled={future.length === 0}>
                Redo
              </Button>
              <Button variant="secondary" onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button onClick={() => void publish()}>Publish</Button>
            </div>
          )}
        />

        <div className="editor-workspace">
          <aside className="editor-utility-rail">
            <section className="editor-sidebar-card">
              <div className="editor-sidebar-card-header">
                <div>
                  <p className="editor-sidebar-kicker">Structure</p>
                  <h3>Components</h3>
                </div>
                <Badge variant={hasUnsavedChanges ? "warning" : "default"}>
                  {hasUnsavedChanges ? "Draft" : "Saved"}
                </Badge>
              </div>
              <div className="editor-sidebar-card-body">
                <div className="editor-sidebar-actions editor-sidebar-actions--tight">
                  <button
                    type="button"
                    className={selectAllMode ? "secondary-button active-utility" : "secondary-button"}
                    onClick={selectAllComponents}
                  >
                    Select all
                  </button>
                  <button type="button" className="secondary-button" onClick={centerAllComponents}>
                    Center all
                  </button>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={theme.components.homeTeamLogo.visible}
                    onChange={(event) =>
                      patchTheme((draft) => {
                        draft.components.homeTeamLogo.visible = event.target.checked;
                        draft.components.awayTeamLogo.visible = event.target.checked;
                      })
                    }
                  />
                  Show team logos on both sides
                </label>
                <div className="component-rail">
                  {editorRailGroups.map((group) => (
                    <section key={group.id} className="component-rail-group">
                      <header className="component-rail-group-header">
                        <strong>{group.title}</strong>
                      </header>
                      <div className="component-rail-list">
                        {group.ids.map((id) => {
                          const component = theme.components[id];
                          const isActive = selectedIdSet.has(id) || (selected === id && selectedIds.length === 0);
                          return (
                            <button
                              key={id}
                              type="button"
                              className={
                                isActive
                                  ? "component-rail-item component-rail-item--active"
                                  : "component-rail-item"
                              }
                              onClick={() => selectComponent(id)}
                            >
                              <span className="component-rail-item-main">
                                <strong>{componentLabels[id]}</strong>
                              </span>
                              <span className={component.visible ? "component-rail-visibility" : "component-rail-visibility component-rail-visibility--muted"}>
                                {component.visible ? "Visible" : "Hidden"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </section>
          </aside>

          <div className="editor-canvas-column">
            <div className="canvas-preview-column">
              <div className="canvas-preview-wrapper">
                <ThemeCanvasEditor
                  theme={theme}
                  live={previewLive}
                  assets={assets.data ?? []}
                  selectedId={selected}
                  selectedIds={selectedIds}
                  selectAll={selectAllMode}
                  zoom={canvasZoom}
                  onZoomChange={setCanvasZoom}
                  onSelect={selectComponent}
                  onMarqueeSelect={selectComponents}
                  onSelectAll={selectAllComponents}
                  onUpdate={updateTheme}
                />
              </div>
              <div className="canvas-below-drawers">
                <details className="canvas-arrange-disclosure">
                  <summary className={buttonVariants({ variant: "secondary" })}>Arrange tools</summary>
                  <div className="canvas-preview-bar canvas-preview-bar--drawer" aria-label="Editor arrange tools">
                    <label className="inline-select">
                      <span className="hint">Zoom</span>
                      <select value={String(canvasZoom)} onChange={(event) => setCanvasZoom(Number(event.target.value))}>
                        {zoomPresets.map((preset) => (
                          <option key={preset} value={String(preset)}>
                            {Math.round(preset * 100)}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => setCanvasZoom(1)} disabled={canvasZoom === 1}>
                      Reset zoom
                    </button>
                    <a
                      className={buttonVariants({ variant: "secondary" })}
                      href={`/overlay/preview/${theme.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open preview
                    </a>
                    {theme.builtin ? (
                      <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => void saveAsCopy()}>
                        {saving ? "Saving…" : "Save as Copy"}
                      </button>
                    ) : null}
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => alignLayoutScope("left")}>
                      Align left
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => alignLayoutScope("centerX")}>
                      Center X
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => alignLayoutScope("right")}>
                      Align right
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => alignLayoutScope("top")}>
                      Align top
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => alignLayoutScope("centerY")}>
                      Center Y
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => alignLayoutScope("bottom")}>
                      Align bottom
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => distributeLayoutScope("horizontal")}>
                      Distribute horizontal
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => distributeLayoutScope("vertical")}>
                      Distribute vertical
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => matchLayoutScopeSize("width")}>
                      Match width
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => matchLayoutScopeSize("height")}>
                      Match height
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => matchLayoutScopeSize("both")}>
                      Match both
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => syncTeamSlot("leftToRight")}>
                      Sync left to right
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => syncTeamSlot("rightToLeft")}>
                      Sync right to left
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => mirrorTeamSlotLayout("leftToRight")}>
                      Mirror left layout
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => mirrorTeamSlotLayout("rightToLeft")}>
                      Mirror right layout
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={resetSelectedSlotToSaved} disabled={!savedSnapshot}>
                      Reset slot
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => applyLayoutPreset(builtinThemes[0].id)}>
                      Apply {builtinThemes[0].name}
                    </button>
                    <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => applyLayoutPreset(builtinThemes[1].id)}>
                      Apply {builtinThemes[1].name}
                    </button>
                    <div className="row-action-menu-note">
                      <strong>Guide</strong>
                      <p>Sync copies layout, style, visibility, and assets. Mirror copies frame layout and flips left/right spacing.</p>
                    </div>
                  </div>
                </details>
                <details
                  className="canvas-preview-disclosure"
                  open={previewDrawerOpen}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setPreviewDrawerOpen(isOpen);
                    if (!isOpen) {
                      setActiveMenu(null);
                    }
                  }}
                >
                  <summary className={buttonVariants({ variant: "secondary" })}>State preview</summary>
                  <div className="canvas-preview-bar canvas-preview-bar--drawer" aria-label="Editor preview states">
                    <details className="row-action-menu row-action-menu--up" open={activeMenu === "preview-preset"}>
                      <summary className={buttonVariants({ variant: "secondary" })} onClick={(event) => { event.preventDefault(); toggleMenu("preview-preset"); }}>Preview preset</summary>
                      <div className="row-action-menu-list">
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("live"); closeMenus(); }}>
                          Live
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("game"); closeMenus(); }}>
                          Game
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("break"); closeMenus(); }}>
                          Break
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("towelHome"); closeMenus(); }}>
                          Towel Left
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("towelAway"); closeMenus(); }}>
                          Towel Right
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("baseHome"); closeMenus(); }}>
                          Base Left
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("baseAway"); closeMenus(); }}>
                          Base Right
                        </button>
                      </div>
                    </details>
                    <label className="checkbox canvas-preview-toggle">
                      <input type="checkbox" checked={previewEnabled} onChange={(event) => setPreviewEnabled(event.target.checked)} />
                      Preview states
                    </label>
                    <label className="inline-select">
                      <span className="hint">Period</span>
                      <select value={previewPeriod} onChange={(event) => setPreviewPeriod(event.target.value as PreviewPeriodMode)} disabled={!previewEnabled}>
                        <option value="live">Live</option>
                        <option value="GAME">GAME</option>
                        <option value="BREAK">BREAK</option>
                      </select>
                    </label>
                    <label className="inline-select">
                      <span className="hint">Event</span>
                      <select value={previewEvent} onChange={(event) => setPreviewEvent(event.target.value as PreviewEventMode)} disabled={!previewEnabled}>
                        <option value="live">Live</option>
                        <option value="none">none</option>
                        <option value="towel-home">TOWEL1</option>
                        <option value="towel-away">TOWEL2</option>
                        <option value="base-home">BASE2</option>
                        <option value="base-away">BASE1</option>
                      </select>
                    </label>
                    <label className="inline-select">
                      <span className="hint">Switch</span>
                      <select value={previewSidesSwitched} onChange={(event) => setPreviewSidesSwitched(event.target.value as PreviewSwitchMode)} disabled={!previewEnabled}>
                        <option value="live">Live</option>
                        <option value="0">Off</option>
                        <option value="1">On</option>
                      </select>
                    </label>
                    <label className="inline-select">
                      <span className="hint">Names</span>
                      <select value={previewNameMode} onChange={(event) => setPreviewNameMode(event.target.value as PreviewNameMode)} disabled={!previewEnabled}>
                        <option value="live">Live</option>
                        <option value="short">Short</option>
                        <option value="long">Long</option>
                      </select>
                    </label>
                    <label className="inline-select">
                      <span className="hint">Left logo</span>
                      <select value={previewLeftLogoMode} onChange={(event) => setPreviewLeftLogoMode(event.target.value as PreviewLogoMode)} disabled={!previewEnabled}>
                        <option value="live">Live</option>
                        <option value="matched">Matched</option>
                        <option value="missing">Missing</option>
                        <option value="unmatched">Unmatched</option>
                      </select>
                    </label>
                    <label className="inline-select">
                      <span className="hint">Right logo</span>
                      <select value={previewRightLogoMode} onChange={(event) => setPreviewRightLogoMode(event.target.value as PreviewLogoMode)} disabled={!previewEnabled}>
                        <option value="live">Live</option>
                        <option value="matched">Matched</option>
                        <option value="missing">Missing</option>
                        <option value="unmatched">Unmatched</option>
                      </select>
                    </label>
                    <label className="inline-select inline-number">
                      <span className="hint">Left score</span>
                      <input type="number" min="0" value={previewLeftScore} onChange={(event) => setPreviewLeftScore(Number(event.target.value || 0))} disabled={!previewEnabled} />
                    </label>
                    <label className="inline-select inline-number">
                      <span className="hint">Right score</span>
                      <input type="number" min="0" value={previewRightScore} onChange={(event) => setPreviewRightScore(Number(event.target.value || 0))} disabled={!previewEnabled} />
                    </label>
                    <label className="inline-select inline-number">
                      <span className="hint">Game clock</span>
                      <input type="number" min="0" value={previewGameTimerValue} onChange={(event) => setPreviewGameTimerValue(Number(event.target.value || 0))} disabled={!previewEnabled} />
                    </label>
                    <label className="inline-select inline-number">
                      <span className="hint">Break clock</span>
                      <input type="number" min="0" value={previewBreakTimerValue} onChange={(event) => setPreviewBreakTimerValue(Number(event.target.value || 0))} disabled={!previewEnabled} />
                    </label>
                    <button
                      type="button"
                      className={buttonVariants({ variant: "secondary" })}
                      onClick={resetPreviewState}
                    >
                      Reset preview
                    </button>
                  </div>
                </details>
                <details className="canvas-shortcuts-disclosure">
                  <summary className={buttonVariants({ variant: "secondary" })}>Canvas shortcuts</summary>
                  <div className="canvas-shortcut-bar" aria-label="Editor canvas shortcuts">
                    <span className="canvas-shortcut-pill"><kbd>Shift</kbd> + click add/remove selection</span>
                    <span className="canvas-shortcut-pill"><kbd>Shift</kbd> + drag marquee select</span>
                    <span className="canvas-shortcut-pill">Drag blank area to pan</span>
                    <span className="canvas-shortcut-pill"><kbd>Space</kbd> + drag pan</span>
                    <span className="canvas-shortcut-pill">Middle-drag pan</span>
                    <span className="canvas-shortcut-pill"><kbd>Ctrl/Cmd</kbd> + wheel zoom</span>
                    <span className="canvas-shortcut-pill"><kbd>Tab</kbd> next piece</span>
                    <span className="canvas-shortcut-pill"><kbd>Shift</kbd> + <kbd>Tab</kbd> previous</span>
                    <span className="canvas-shortcut-pill"><kbd>↑↓←→</kbd> move</span>
                    <span className="canvas-shortcut-pill"><kbd>Shift</kbd> + <kbd>Arrow</kbd> jump</span>
                    <span className="canvas-shortcut-pill"><kbd>Alt</kbd> + <kbd>Arrow</kbd> fine</span>
                    <span className="canvas-shortcut-pill"><kbd>+</kbd> <kbd>-</kbd> zoom</span>
                    <span className="canvas-shortcut-pill"><kbd>0</kbd> fit canvas</span>
                    <span className="canvas-shortcut-pill"><kbd>1</kbd> zoom 100%</span>
                    <span className="canvas-shortcut-pill"><kbd>F</kbd> focus selection</span>
                    <span className="canvas-shortcut-pill"><kbd>Esc</kbd> clear</span>
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="inspector-column">
            <div className="inspector v2-inspector">
            <div className="inspector-toolbar">
              <div className="segmented-control">
                <button className={inspectorView === "theme" ? "segmented-button active" : "segmented-button"} onClick={() => setInspectorView("theme")} type="button">
                  Canvas
                </button>
                <button
                  className={inspectorView === "component" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setInspectorView("component")}
                  type="button"
                >
                  Component
                </button>
                <button
                  className={inspectorView === "concede" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setInspectorView("concede")}
                  type="button"
                >
                  Event Overlay
                </button>
              </div>
            </div>

            {inspectorView === "theme" ? (
              <div className="inspector-stack">
                <SectionCard title="Canvas Basics" description="Core identity and canvas options." defaultOpen>
                  <div className="form-grid">
                    <TextField label="Theme name" value={theme.name} onChange={(value) => patchTheme((draft) => (draft.name = value))} />
                    <TextField
                      label="Description"
                      value={theme.description}
                      onChange={(value) => patchTheme((draft) => (draft.description = value))}
                    />
                    <ColorField
                      label="Canvas background"
                      value={theme.canvas.backgroundColor}
                      onChange={(value) => patchTheme((draft) => (draft.canvas.backgroundColor = value))}
                    />
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={theme.canvas.safeArea}
                        onChange={(event) => patchTheme((draft) => (draft.canvas.safeArea = event.target.checked))}
                      />
                      Show safe area
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={theme.canvas.transparentPreview}
                        onChange={(event) => patchTheme((draft) => (draft.canvas.transparentPreview = event.target.checked))}
                      />
                      Transparent admin preview
                    </label>
                  </div>
                </SectionCard>

                <SectionCard title="Working Model" description="Use the canvas for positioning. Use advanced controls only when you need exact geometry." defaultOpen={false}>
                  <div className="editor-notes">
                    <p>`Canvas` covers the page-level frame and preview behavior.</p>
                    <p>`Component` focuses on the selected piece only.</p>
                    <p>`Event Overlay` controls concede, base, and winner treatments.</p>
                  </div>
                </SectionCard>
              </div>
            ) : null}

            {inspectorView === "component" ? (
              <div className="inspector-stack inspector-stack--compact">
                <SectionCard title="Component Overview" description="Selection happens in the structure rail or directly on the canvas." defaultOpen>
                  <div className="editor-selection-summary">
                    <div className="editor-selection-copy">
                      <strong>{selectedSummaryLabel}</strong>
                      <span className="hint">{selectionModeDetail}</span>
                    </div>
                    <div className="segmented-control">
                      <button
                        className={editorMode === "basic" ? "segmented-button active" : "segmented-button"}
                        onClick={() => setEditorMode("basic")}
                        type="button"
                      >
                        Basic
                      </button>
                      <button
                        className={editorMode === "advanced" ? "segmented-button active" : "segmented-button"}
                        onClick={() => setEditorMode("advanced")}
                        type="button"
                      >
                        Advanced
                      </button>
                    </div>
                  </div>
                  {!selectAllMode && selectedEditableComponent ? (
                    <div className="editor-selection-meta">
                      <span>{selectedSlotConfig.title}</span>
                      <span>{selectedEditableComponent.kind === "text" ? "Text component" : "Image component"}</span>
                      <span>{selectedEditableComponent.visible ? "Visible" : "Hidden"}</span>
                    </div>
                  ) : null}
                </SectionCard>

                {selectedSlot === "center" ? (
                  <SectionCard title="Center Behavior" description="Choose what the lower center line shows during game time and during breaks." defaultOpen={false}>
                    <div className="editor-subsection-stack">
                      <div className="editor-subsection-card">
                        <div className="editor-subsection-header">
                          <h4>Display Modes</h4>
                          <p>Decide what the secondary center line shows during live play and during breaks.</p>
                        </div>
                        <div className="form-grid editor-subsection-grid">
                          <label>
                            Game mode
                            <select
                              value={theme.centerSecondary.gameMode}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.gameMode = event.target.value as "timer" | "staticText" | "hidden";
                                })
                              }
                            >
                              <option value="staticText">Static text</option>
                              <option value="timer">Break timer</option>
                              <option value="hidden">Hidden</option>
                            </select>
                          </label>
                          <label>
                            Break mode
                            <select
                              value={theme.centerSecondary.breakMode}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.breakMode = event.target.value as "timer" | "staticText" | "hidden";
                                })
                              }
                            >
                              <option value="timer">Break timer</option>
                              <option value="staticText">Static text</option>
                              <option value="hidden">Hidden</option>
                            </select>
                          </label>
                          {theme.centerSecondary.gameMode === "staticText" ? (
                            <TextField
                              label="Game text"
                              value={theme.centerSecondary.gameText}
                              onChange={(value) => patchTheme((draft) => (draft.centerSecondary.gameText = value))}
                            />
                          ) : null}
                          {theme.centerSecondary.breakMode === "staticText" ? (
                            <TextField
                              label="Break text"
                              value={theme.centerSecondary.breakText}
                              onChange={(value) => patchTheme((draft) => (draft.centerSecondary.breakText = value))}
                            />
                          ) : null}
                        </div>
                      </div>

                      <div className="editor-subsection-card">
                        <div className="editor-subsection-header">
                          <h4>Mode Transition</h4>
                          <p>Control the motion when the center secondary changes between timer and static text.</p>
                        </div>
                        <div className="form-grid editor-subsection-grid">
                          <label>
                            Transition animation
                            <select
                              value={theme.centerSecondary.transition.animation}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.transition.animation = event.target.value as "none" | "fade" | "slide-up";
                                })
                              }
                            >
                              <option value="none">none</option>
                              <option value="fade">fade</option>
                              <option value="slide-up">slide-up</option>
                            </select>
                          </label>
                          <NumberField
                            label="Transition duration"
                            unit="ms"
                            value={theme.centerSecondary.transition.durationMs}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.transition.durationMs = value;
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="editor-subsection-card">
                        <div className="editor-subsection-header">
                          <h4>Timer Style</h4>
                          <p>Used when the secondary line is showing a live break timer.</p>
                        </div>
                        <div className="form-grid editor-subsection-grid">
                          <label>
                            Timer font
                            <select
                              value={theme.centerSecondary.timerStyle.fontFamily}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.timerStyle.fontFamily =
                                    event.target.value as ThemeDefinition["components"]["homeName"]["fontFamily"];
                                })
                              }
                            >
                              {fontFamilies.map((font) => (
                                <option key={font} value={font}>
                                  {font}
                                </option>
                              ))}
                            </select>
                          </label>
                          <NumberField
                            label="Timer size"
                            unit="px"
                            value={theme.centerSecondary.timerStyle.fontSize}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timerStyle.fontSize = value;
                              })
                            }
                          />
                          <ColorField
                            label="Timer color"
                            value={theme.centerSecondary.timerStyle.color}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timerStyle.color = value;
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="editor-subsection-card">
                        <div className="editor-subsection-header">
                          <h4>Static Text Style</h4>
                          <p>Used when the secondary line is showing a label instead of a timer.</p>
                        </div>
                        <div className="form-grid editor-subsection-grid">
                          <label>
                            Static text font
                            <select
                              value={theme.centerSecondary.staticStyle.fontFamily}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.staticStyle.fontFamily =
                                    event.target.value as ThemeDefinition["components"]["homeName"]["fontFamily"];
                                })
                              }
                            >
                              {fontFamilies.map((font) => (
                                <option key={font} value={font}>
                                  {font}
                                </option>
                              ))}
                            </select>
                          </label>
                          <NumberField
                            label="Static text size"
                            unit="px"
                            value={theme.centerSecondary.staticStyle.fontSize}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.staticStyle.fontSize = value;
                              })
                            }
                          />
                          <ColorField
                            label="Static text color"
                            value={theme.centerSecondary.staticStyle.color}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.staticStyle.color = value;
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="editor-subsection-card">
                        <div className="editor-subsection-header">
                          <h4>Timeout Overlay</h4>
                          <p>Flash a one-shot `TIMEOUT` treatment on top of the break timer when break time suddenly jumps upward.</p>
                        </div>
                        <div className="form-grid editor-subsection-grid">
                          <label className="checkbox editor-subsection-toggle">
                            <input
                              type="checkbox"
                              checked={theme.centerSecondary.timeout.enabled}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.timeout.enabled = event.target.checked;
                                })
                              }
                            />
                            Timeout overlay enabled
                          </label>
                          <TextField
                            label="Timeout text"
                            value={theme.centerSecondary.timeout.text}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.text = value;
                              })
                            }
                          />
                          <NumberField
                            label="Timeout duration"
                            unit="ms"
                            value={theme.centerSecondary.timeout.durationMs}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.durationMs = value;
                              })
                            }
                          />
                          <NumberField
                            label="Trigger increase"
                            unit="s"
                            value={theme.centerSecondary.timeout.minIncreaseSeconds}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.minIncreaseSeconds = value;
                              })
                            }
                          />
                          <label>
                            Timeout font
                            <select
                              value={theme.centerSecondary.timeout.fontFamily}
                              onChange={(event) =>
                                patchTheme((draft) => {
                                  draft.centerSecondary.timeout.fontFamily =
                                    event.target.value as ThemeDefinition["components"]["homeName"]["fontFamily"];
                                })
                              }
                            >
                              {fontFamilies.map((font) => (
                                <option key={font} value={font}>
                                  {font}
                                </option>
                              ))}
                            </select>
                          </label>
                          <NumberField
                            label="Timeout size"
                            unit="px"
                            value={theme.centerSecondary.timeout.fontSize}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.fontSize = value;
                              })
                            }
                          />
                          <NumberField
                            label="Timeout weight"
                            value={theme.centerSecondary.timeout.fontWeight}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.fontWeight = value;
                              })
                            }
                          />
                          <NumberField
                            label="Timeout spacing"
                            unit="px"
                            step={0.1}
                            value={theme.centerSecondary.timeout.letterSpacing}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.letterSpacing = value;
                              })
                            }
                          />
                          <ColorField
                            label="Timeout text color"
                            value={theme.centerSecondary.timeout.color}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.color = value;
                              })
                            }
                          />
                          <ColorField
                            label="Timeout background"
                            value={theme.centerSecondary.timeout.backgroundColor}
                            onChange={(value) =>
                              patchTheme((draft) => {
                                draft.centerSecondary.timeout.backgroundColor = value;
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {selectAllMode ? (
                  <SectionCard title="All Components" description="Drag the group box on the canvas to move the entire scoreboard composition together." defaultOpen>
                    <div className="inline-action-grid">
                      <button type="button" className="secondary-button" onClick={centerAllComponents}>
                        Align top-center
                      </button>
                      <button type="button" className="secondary-button" onClick={() => setSelectAllMode(false)}>
                        Exit select all
                      </button>
                    </div>
                    <p className="hint">Selecting any individual piece on the canvas or in the slot list will leave group mode.</p>
                  </SectionCard>
                ) : null}

                {!selectAllMode && selectedEditableComponent ? (
                  <>
                  <SectionCard
                    title={`${selectedSlotConfig.title} > ${selectedShortLabel}`}
                    description="Style the selected live piece. Use drag handles on the canvas for placement."
                    defaultOpen
                  >
                    <div className="inline-action-grid">
                      <details className="row-action-menu row-action-menu--up" open={activeMenu === "piece-tools"}>
                        <summary className="secondary-button" onClick={(event) => { event.preventDefault(); toggleMenu("piece-tools"); }}>Piece tools</summary>
                        <div className="row-action-menu-list">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              reorderSelectedComponent("sendToBack");
                              closeMenus();
                            }}
                            disabled={!canBringBackward}
                          >
                            Send to back
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              reorderSelectedComponent("bringBackward");
                              closeMenus();
                            }}
                            disabled={!canBringBackward}
                          >
                            Bring backward
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              reorderSelectedComponent("bringForward");
                              closeMenus();
                            }}
                            disabled={!canBringForward}
                          >
                            Bring forward
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              reorderSelectedComponent("sendToFront");
                              closeMenus();
                            }}
                            disabled={!canBringForward}
                          >
                            Send to front
                          </button>
                          <button type="button" className="secondary-button" onClick={() => { bringSelectedIntoView(); closeMenus(); }}>
                            Bring into view
                          </button>
                          {selectedMirroredPair ? (
                            <button type="button" className="secondary-button" onClick={() => { mirrorSelectedPieceLayout(); closeMenus(); }}>
                              Mirror piece layout
                            </button>
                          ) : null}
                          <button type="button" className="secondary-button" onClick={resetSelectedPieceToSaved} disabled={!savedSnapshot}>
                            Reset piece to saved
                          </button>
                        </div>
                      </details>
                    </div>
                    {selectedMirroredPair ? (
                      <p className="hint">
                        `Mirror piece layout` copies frame geometry plus inner padding and offset to the opposite side. It keeps colors, fonts, and assets unchanged.
                      </p>
                    ) : null}
                    <div className="form-grid">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedEditableComponent.visible}
                          onChange={(event) => patchSelectedComponent((component) => (component.visible = event.target.checked))}
                        />
                        Visible
                      </label>
                      <ColorField
                        label="Background"
                        value={selectedEditableComponent.backgroundColor}
                        onChange={(value) => patchSelectedComponent((component) => (component.backgroundColor = value))}
                      />
                      <label>
                        Background asset
                        <select
                          value={selectedEditableComponent.backgroundImageAssetId ?? ""}
                          onChange={(event) =>
                            patchSelectedComponent((component) => (component.backgroundImageAssetId = event.target.value || null))
                          }
                        >
                          <option value="">None</option>
                          {assets.data?.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.originalName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="secondary-button">
                        Upload surface asset
                        <input
                          hidden
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              void uploadAssetIntoTarget(file, "surface");
                            }
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      {selectedTextComponent ? (
                        <>
                          <label>
                            Font
                            <select
                              value={selectedTextComponent.fontFamily}
                              onChange={(event) =>
                                patchSelectedTextComponent(
                                  (component) =>
                                    (component.fontFamily = event.target.value as ThemeDefinition["components"]["homeName"]["fontFamily"])
                                )
                              }
                            >
                              <option>Bebas Neue</option>
                              <option>Oswald</option>
                              <option>Barlow Condensed</option>
                              <option>Arial Narrow</option>
                              <option>Helvetica Neue</option>
                            </select>
                          </label>
                          <ColorField
                            label="Text color"
                            value={selectedTextComponent.color}
                            onChange={(value) => patchSelectedTextComponent((component) => (component.color = value))}
                          />
                          <NumberField
                            label="Font size"
                            unit="px"
                            value={selectedTextComponent.fontSize}
                            onChange={(value) => patchSelectedTextComponent((component) => (component.fontSize = value))}
                          />
                          <label>
                            Align
                            <select
                              value={selectedTextComponent.textAlign}
                              onChange={(event) =>
                                patchSelectedTextComponent(
                                  (component) => (component.textAlign = event.target.value as "left" | "center" | "right")
                                )
                              }
                            >
                              <option value="left">left</option>
                              <option value="center">center</option>
                              <option value="right">right</option>
                            </select>
                          </label>
                          <NumberField
                            label="Padding X"
                            unit="px"
                            value={selectedTextComponent.paddingX}
                            onChange={(value) => patchSelectedTextComponent((component) => (component.paddingX = value))}
                          />
                          <NumberField
                            label="Padding Y"
                            unit="px"
                            value={selectedTextComponent.paddingY}
                            onChange={(value) => patchSelectedTextComponent((component) => (component.paddingY = value))}
                          />
                          <NumberField
                            label="Offset X"
                            unit="px"
                            value={selectedTextComponent.offsetX}
                            onChange={(value) => patchSelectedTextComponent((component) => (component.offsetX = value))}
                          />
                          <NumberField
                            label="Offset Y"
                            unit="px"
                            value={selectedTextComponent.offsetY}
                            onChange={(value) => patchSelectedTextComponent((component) => (component.offsetY = value))}
                          />
                        </>
                      ) : null}
                      {selectedImageComponent ? (
                        <>
                          {selectedLogoContext ? (
                            <div className="block-editor-grid">
                              <div className="block-editor-card">
                                <strong>Live resolution</strong>
                                <span className="hint">
                                  {selectedLogoContext.match?.team?.canonicalName
                                    ? `${selectedLogoContext.match.team.canonicalName} · ${selectedLogoContext.match.status}`
                                    : `No matched team yet · ${selectedLogoContext.match?.status ?? "unmatched"}`}
                                </span>
                                <div className="team-logo-preview compact">
                                  {selectedLogoContext.effectiveAsset ? (
                                    <img
                                      src={selectedLogoContext.effectiveAsset.url}
                                      alt={selectedLogoContext.effectiveAsset.originalName}
                                      className="team-logo-image"
                                    />
                                  ) : (
                                    <span>No resolved logo</span>
                                  )}
                                </div>
                              </div>
                              <div className="block-editor-card">
                                <strong>Logo source order</strong>
                                <span className="hint">1. matched team registry logo</span>
                                <span className="hint">2. {teamLogoFallbackModeLabels[selectedImageComponent.teamLogoFallbackMode]}</span>
                                <span className="hint">Registry asset: {selectedLogoContext.registryAsset?.originalName ?? "none"}</span>
                                <span className="hint">Fallback asset: {selectedLogoContext.fallbackAsset?.originalName ?? "none"}</span>
                                <span className="hint">Event logo asset: {selectedLogoContext.eventAsset?.originalName ?? "none"}</span>
                              </div>
                            </div>
                          ) : null}
                          <label className="secondary-button">
                            {selectedIsTeamLogo ? "Upload fallback logo" : "Upload image"}
                            <input
                              hidden
                              type="file"
                              accept="image/*"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  void uploadAssetIntoTarget(file, "logo");
                                }
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <label>
                            {selectedIsTeamLogo ? "Fallback asset" : "Image asset"}
                            <select
                              value={selectedImageComponent.assetId ?? ""}
                              onChange={(event) =>
                                patchSelectedComponent((component) => {
                                  if (component.kind === "image") {
                                    component.assetId = event.target.value || null;
                                  }
                                })
                              }
                            >
                              <option value="">No logo</option>
                              {assets.data?.map((asset) => (
                                <option key={asset.id} value={asset.id}>
                                  {asset.originalName}
                                </option>
                              ))}
                            </select>
                          </label>
                          {selectedIsTeamLogo ? (
                            <label>
                              Fallback mode
                              <select
                                value={selectedImageComponent.teamLogoFallbackMode}
                                onChange={(event) =>
                                  patchSelectedComponent((component) => {
                                    if (component.kind === "image") {
                                      component.teamLogoFallbackMode =
                                        event.target.value as ThemeDefinition["components"]["homeTeamLogo"]["teamLogoFallbackMode"];
                                    }
                                  })
                                }
                              >
                                <option value="none">Registry only</option>
                                <option value="eventLogo">Use event logo</option>
                                <option value="slotFallback">Use slot fallback asset</option>
                                <option value="slotFallbackThenEventLogo">Use slot fallback, then event logo</option>
                              </select>
                            </label>
                          ) : null}
                          <label>
                            Image fit
                            <select
                              value={selectedImageComponent.backgroundImageFit}
                              onChange={(event) =>
                                patchSelectedComponent((component) => {
                                  if (component.kind === "image") {
                                    component.backgroundImageFit = event.target.value as "cover" | "contain" | "stretch";
                                  }
                                })
                              }
                            >
                              <option value="cover">cover</option>
                              <option value="contain">contain</option>
                              <option value="stretch">stretch</option>
                            </select>
                          </label>
                          <label>
                            Image position
                            <select
                              value={selectedImageComponent.backgroundImagePosition}
                              onChange={(event) =>
                                patchSelectedComponent((component) => {
                                  if (component.kind === "image") {
                                    component.backgroundImagePosition = event.target.value as "center" | "top" | "bottom" | "left" | "right";
                                  }
                                })
                              }
                            >
                              <option value="center">center</option>
                              <option value="top">top</option>
                              <option value="bottom">bottom</option>
                              <option value="left">left</option>
                              <option value="right">right</option>
                            </select>
                          </label>
                          <NumberField
                            label="Padding X"
                            unit="px"
                            value={selectedImageComponent.paddingX}
                            onChange={(value) =>
                              patchSelectedComponent((component) => {
                                if (component.kind === "image") {
                                  component.paddingX = value;
                                }
                              })
                            }
                          />
                          <NumberField
                            label="Padding Y"
                            unit="px"
                            value={selectedImageComponent.paddingY}
                            onChange={(value) =>
                              patchSelectedComponent((component) => {
                                if (component.kind === "image") {
                                  component.paddingY = value;
                                }
                              })
                            }
                          />
                          <NumberField
                            label="Offset X"
                            unit="px"
                            value={selectedImageComponent.offsetX}
                            onChange={(value) =>
                              patchSelectedComponent((component) => {
                                if (component.kind === "image") {
                                  component.offsetX = value;
                                }
                              })
                            }
                          />
                          <NumberField
                            label="Offset Y"
                            unit="px"
                            value={selectedImageComponent.offsetY}
                            onChange={(value) =>
                              patchSelectedComponent((component) => {
                                if (component.kind === "image") {
                                  component.offsetY = value;
                                }
                              })
                            }
                          />
                          {selectedIsTeamLogo ? <p className="hint">Team logos pull from `/admin/teams` first. Fallback mode decides what happens when no team logo resolves.</p> : null}
                        </>
                      ) : null}
                    </div>
                  </SectionCard>

                  {editorMode === "advanced" ? (
                    <>
                      <SectionCard title="Layout" description="Precise geometry for the selected component." defaultOpen={false}>
                        <div className="form-grid">
                          <NumberField label="X position" unit="px" value={selectedEditableComponent.x} onChange={(value) => patchSelectedComponent((component) => (component.x = value))} />
                          <NumberField label="Y position" unit="px" value={selectedEditableComponent.y} onChange={(value) => patchSelectedComponent((component) => (component.y = value))} />
                          <NumberField
                            label="Width"
                            unit="px"
                            value={selectedEditableComponent.width}
                            onChange={(value) => patchSelectedComponent((component) => (component.width = value))}
                          />
                          <NumberField
                            label="Height"
                            unit="px"
                            value={selectedEditableComponent.height}
                            onChange={(value) => patchSelectedComponent((component) => (component.height = value))}
                          />
                          <PercentField label="Opacity" value={selectedEditableComponent.opacity} onChange={(value) => patchSelectedComponent((component) => (component.opacity = value))} />
                          <NumberField
                            label="Padding X"
                            unit="px"
                            value={selectedEditableComponent.paddingX}
                            onChange={(value) => patchSelectedComponent((component) => (component.paddingX = value))}
                          />
                          <NumberField
                            label="Padding Y"
                            unit="px"
                            value={selectedEditableComponent.paddingY}
                            onChange={(value) => patchSelectedComponent((component) => (component.paddingY = value))}
                          />
                          <NumberField
                            label="Offset X"
                            unit="px"
                            value={selectedEditableComponent.offsetX}
                            onChange={(value) => patchSelectedComponent((component) => (component.offsetX = value))}
                          />
                          <NumberField
                            label="Offset Y"
                            unit="px"
                            value={selectedEditableComponent.offsetY}
                            onChange={(value) => patchSelectedComponent((component) => (component.offsetY = value))}
                          />
                        </div>
                      </SectionCard>

                      <SectionCard title="Surface" description="Refine borders, overlays, and image fitting." defaultOpen={false}>
                        <div className="form-grid">
                          <ColorField
                            label="Border color"
                            value={selectedEditableComponent.borderColor}
                            onChange={(value) => patchSelectedComponent((component) => (component.borderColor = value))}
                          />
                          <NumberField
                            label="Border width"
                            unit="px"
                            value={selectedEditableComponent.borderWidth}
                            onChange={(value) => patchSelectedComponent((component) => (component.borderWidth = value))}
                          />
                          <NumberField
                            label="Border radius"
                            unit="px"
                            value={selectedEditableComponent.borderRadius}
                            onChange={(value) => patchSelectedComponent((component) => (component.borderRadius = value))}
                          />
                          <label>
                            Background fit
                            <select
                              value={selectedEditableComponent.backgroundImageFit}
                              onChange={(event) =>
                                patchSelectedComponent(
                                  (component) => (component.backgroundImageFit = event.target.value as "cover" | "contain" | "stretch")
                                )
                              }
                            >
                              <option value="cover">cover</option>
                              <option value="contain">contain</option>
                              <option value="stretch">stretch</option>
                            </select>
                          </label>
                          <label>
                            Background position
                            <select
                              value={selectedEditableComponent.backgroundImagePosition}
                              onChange={(event) =>
                                patchSelectedComponent(
                                  (component) =>
                                    (component.backgroundImagePosition = event.target.value as
                                      | "center"
                                      | "top"
                                      | "bottom"
                                      | "left"
                                      | "right")
                                )
                              }
                            >
                              <option value="center">center</option>
                              <option value="top">top</option>
                              <option value="bottom">bottom</option>
                              <option value="left">left</option>
                              <option value="right">right</option>
                            </select>
                          </label>
                          <ColorField
                            label="Overlay color"
                            value={selectedEditableComponent.backgroundOverlayColor}
                            onChange={(value) => patchSelectedComponent((component) => (component.backgroundOverlayColor = value))}
                          />
                          <PercentField label="Overlay opacity" value={selectedEditableComponent.backgroundOverlayOpacity} onChange={(value) => patchSelectedComponent((component) => (component.backgroundOverlayOpacity = value))} />
                          <TextField
                            label="Shadow"
                            value={selectedEditableComponent.shadow}
                            onChange={(value) => patchSelectedComponent((component) => (component.shadow = value))}
                          />
                        </div>
                      </SectionCard>

                      {selectedTextComponent ? (
                        <SectionCard title="Typography" description="Fine-tune the text treatment." defaultOpen={false}>
                          <div className="form-grid">
                            <NumberField
                              label="Font weight"
                              value={selectedTextComponent.fontWeight}
                              onChange={(value) => patchSelectedTextComponent((component) => (component.fontWeight = value))}
                            />
                            <NumberField
                              label="Letter spacing"
                              unit="px"
                              value={selectedTextComponent.letterSpacing}
                              step={0.1}
                              onChange={(value) => patchSelectedTextComponent((component) => (component.letterSpacing = value))}
                            />
                            <NumberField
                              label="Line height"
                              value={selectedTextComponent.lineHeight}
                              step={0.1}
                              onChange={(value) => patchSelectedTextComponent((component) => (component.lineHeight = value))}
                            />
                          </div>
                        </SectionCard>
                      ) : null}
                    </>
                  ) : null}
                  </>
                ) : (
                  <SectionCard title="Component" description="Pick a scoreboard block from the structure cards or directly from the canvas." defaultOpen>
                    <p className="hint">Nothing selected yet.</p>
                  </SectionCard>
                )}
              </div>
            ) : null}

            {inspectorView === "concede" ? (
              <div className="inspector-stack">
                <SectionCard title="General Overlay" description="Shared layout, typography, border, and motion settings for all team overlay events." defaultOpen>
                  <div className="inline-action-grid">
                    {(
                      Object.entries(concedePresets) as Array<
                        [keyof typeof concedePresets, (typeof concedePresets)[keyof typeof concedePresets]]
                      >
                    ).map(([presetId, preset]) => (
                      <button key={presetId} type="button" className="secondary-button" onClick={() => applyConcedePreset(presetId)}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="form-grid">
                    <label className="checkbox">
                      <input type="checkbox" checked={theme.teamEventOverlay.general.enabled} onChange={(event) => patchOverlayGeneral((general) => (general.enabled = event.target.checked))} />
                      Enabled
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={theme.teamEventOverlay.general.teamSwitchEnabled}
                        onChange={(event) => patchOverlayGeneral((general) => (general.teamSwitchEnabled = event.target.checked))}
                      />
                      Team switch transition
                    </label>
                    <label>
                      Follow container
                      <select
                        value={theme.teamEventOverlay.general.followTarget}
                        onChange={(event) =>
                          patchOverlayGeneral(
                            (general) =>
                              (general.followTarget = event.target.value as ThemeDefinition["teamEventOverlay"]["general"]["followTarget"])
                          )
                        }
                      >
                        <option value="none">none</option>
                        <option value="logo">logo container</option>
                        <option value="name">name container</option>
                      </select>
                    </label>
                    <label>
                      Placement
                      <select value={theme.teamEventOverlay.general.placementMode} onChange={(event) => patchOverlayGeneral((general) => (general.placementMode = event.target.value as "full-panel" | "center-stamp" | "top-ribbon"))}>
                        <option value="center-stamp">center-stamp</option>
                        <option value="top-ribbon">top-ribbon</option>
                        <option value="full-panel">full-panel</option>
                      </select>
                    </label>
                    <label>
                      Position
                      <select value={theme.teamEventOverlay.general.position} onChange={(event) => patchOverlayGeneral((general) => (general.position = event.target.value as "above" | "overlapping-top"))}>
                        <option value="above">above</option>
                        <option value="overlapping-top">overlapping-top</option>
                      </select>
                    </label>
                    <label>
                      Animation
                      <select value={theme.teamEventOverlay.general.animationPreset} onChange={(event) => patchOverlayGeneral((general) => (general.animationPreset = event.target.value as "slide-horizontal" | "slide-vertical" | "none"))}>
                        <option value="slide-vertical">slide-vertical</option>
                        <option value="slide-horizontal">slide-horizontal</option>
                        <option value="none">none</option>
                      </select>
                    </label>
                    <NumberField label="Duration" unit="ms" value={theme.teamEventOverlay.general.durationMs} onChange={(value) => patchOverlayGeneral((general) => (general.durationMs = value))} />
                    <NumberField label="Font size" unit="px" value={theme.teamEventOverlay.general.fontSize} onChange={(value) => patchOverlayGeneral((general) => (general.fontSize = value))} />
                    <NumberField label="Font weight" value={theme.teamEventOverlay.general.fontWeight} onChange={(value) => patchOverlayGeneral((general) => (general.fontWeight = value))} />
                    <NumberField label="Letter spacing" unit="px" step={0.1} value={theme.teamEventOverlay.general.letterSpacing} onChange={(value) => patchOverlayGeneral((general) => (general.letterSpacing = value))} />
                    <NumberField label="Offset X" unit="px" value={theme.teamEventOverlay.general.offsetX} onChange={(value) => patchOverlayGeneral((general) => (general.offsetX = value))} />
                    <NumberField label="Offset Y" unit="px" value={theme.teamEventOverlay.general.offsetY} onChange={(value) => patchOverlayGeneral((general) => (general.offsetY = value))} />
                    <NumberField label="Height" unit="px" value={theme.teamEventOverlay.general.height} onChange={(value) => patchOverlayGeneral((general) => (general.height = value))} />
                    <NumberField label="Padding" unit="px" value={theme.teamEventOverlay.general.padding} onChange={(value) => patchOverlayGeneral((general) => (general.padding = value))} />
                    <NumberField label="Border width" unit="px" value={theme.teamEventOverlay.general.borderWidth} onChange={(value) => patchOverlayGeneral((general) => (general.borderWidth = value))} />
                    <NumberField label="Border radius" unit="px" value={theme.teamEventOverlay.general.borderRadius} onChange={(value) => patchOverlayGeneral((general) => (general.borderRadius = value))} />
                    <ColorField label="Border color" value={theme.teamEventOverlay.general.borderColor} onChange={(value) => patchOverlayGeneral((general) => (general.borderColor = value))} />
                    <label>
                      Font family
                      <select value={theme.teamEventOverlay.general.fontFamily} onChange={(event) => patchOverlayGeneral((general) => (general.fontFamily = event.target.value as ThemeDefinition["teamEventOverlay"]["general"]["fontFamily"]))}>
                        {fontFamilies.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Text align
                      <select value={theme.teamEventOverlay.general.textAlign} onChange={(event) => patchOverlayGeneral((general) => (general.textAlign = event.target.value as "left" | "center" | "right"))}>
                        <option value="left">left</option>
                        <option value="center">center</option>
                        <option value="right">right</option>
                      </select>
                    </label>
                    <label>
                      Background fit
                      <select value={theme.teamEventOverlay.general.backgroundImageFit} onChange={(event) => patchOverlayGeneral((general) => (general.backgroundImageFit = event.target.value as "cover" | "contain" | "stretch"))}>
                        <option value="cover">cover</option>
                        <option value="contain">contain</option>
                        <option value="stretch">stretch</option>
                      </select>
                    </label>
                    <label>
                      Background position
                      <select value={theme.teamEventOverlay.general.backgroundImagePosition} onChange={(event) => patchOverlayGeneral((general) => (general.backgroundImagePosition = event.target.value as "center" | "top" | "bottom" | "left" | "right"))}>
                        <option value="center">center</option>
                        <option value="top">top</option>
                        <option value="bottom">bottom</option>
                        <option value="left">left</option>
                        <option value="right">right</option>
                      </select>
                    </label>
                    <TextField label="Shadow" value={theme.teamEventOverlay.general.shadow} onChange={(value) => patchOverlayGeneral((general) => (general.shadow = value))} />
                  </div>
                </SectionCard>
                <SectionCard title="Concede Overlay" description="Text and surface styling specific to concede events." defaultOpen>
                  <div className="form-grid">
                    <TextField label="Text" value={theme.teamEventOverlay.concede.text} onChange={(value) => patchConcede((concede) => (concede.text = value))} />
                    <ColorField label="Text color" value={theme.teamEventOverlay.concede.color} onChange={(value) => patchConcede((concede) => (concede.color = value))} />
                    <ColorField label="Background" value={theme.teamEventOverlay.concede.backgroundColor} onChange={(value) => patchConcede((concede) => (concede.backgroundColor = value))} />
                    <ColorField label="Overlay color" value={theme.teamEventOverlay.concede.backgroundOverlayColor} onChange={(value) => patchConcede((concede) => (concede.backgroundOverlayColor = value))} />
                    <PercentField label="Overlay opacity" value={theme.teamEventOverlay.concede.backgroundOverlayOpacity} onChange={(value) => patchConcede((concede) => (concede.backgroundOverlayOpacity = value))} />
                    <label>
                      Background asset
                      <select value={theme.teamEventOverlay.concede.backgroundImageAssetId ?? ""} onChange={(event) => patchConcede((concede) => (concede.backgroundImageAssetId = event.target.value || null))}>
                        <option value="">None</option>
                        {assets.data?.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.originalName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="secondary-button">
                      Upload concede background
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void uploadAssetIntoTarget(file, "concede");
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                </SectionCard>
                <SectionCard title="Base Overlay" description="Text and surface styling specific to base events." defaultOpen={false}>
                  <div className="form-grid">
                    <TextField label="Text" value={theme.teamEventOverlay.base.text} onChange={(value) => patchBaseOverlay((base) => (base.text = value))} />
                    <ColorField label="Text color" value={theme.teamEventOverlay.base.color} onChange={(value) => patchBaseOverlay((base) => (base.color = value))} />
                    <ColorField label="Background" value={theme.teamEventOverlay.base.backgroundColor} onChange={(value) => patchBaseOverlay((base) => (base.backgroundColor = value))} />
                    <ColorField label="Overlay color" value={theme.teamEventOverlay.base.backgroundOverlayColor} onChange={(value) => patchBaseOverlay((base) => (base.backgroundOverlayColor = value))} />
                    <PercentField label="Overlay opacity" value={theme.teamEventOverlay.base.backgroundOverlayOpacity} onChange={(value) => patchBaseOverlay((base) => (base.backgroundOverlayOpacity = value))} />
                    <label>
                      Background asset
                      <select value={theme.teamEventOverlay.base.backgroundImageAssetId ?? ""} onChange={(event) => patchBaseOverlay((base) => (base.backgroundImageAssetId = event.target.value || null))}>
                        <option value="">None</option>
                        {assets.data?.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.originalName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="secondary-button">
                      Upload base background
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void uploadAssetIntoTarget(file, "base");
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                </SectionCard>
                <SectionCard title="Winner Overlay" description="Text and surface styling specific to winner reveal." defaultOpen={false}>
                  <div className="form-grid">
                    <TextField label="Text" value={theme.teamEventOverlay.winner.text} onChange={(value) => patchWinnerOverlay((winner) => (winner.text = value))} />
                    <ColorField label="Text color" value={theme.teamEventOverlay.winner.color} onChange={(value) => patchWinnerOverlay((winner) => (winner.color = value))} />
                    <ColorField label="Background" value={theme.teamEventOverlay.winner.backgroundColor} onChange={(value) => patchWinnerOverlay((winner) => (winner.backgroundColor = value))} />
                    <ColorField label="Overlay color" value={theme.teamEventOverlay.winner.backgroundOverlayColor} onChange={(value) => patchWinnerOverlay((winner) => (winner.backgroundOverlayColor = value))} />
                    <PercentField label="Overlay opacity" value={theme.teamEventOverlay.winner.backgroundOverlayOpacity} onChange={(value) => patchWinnerOverlay((winner) => (winner.backgroundOverlayOpacity = value))} />
                    <label>
                      Background asset
                      <select value={theme.teamEventOverlay.winner.backgroundImageAssetId ?? ""} onChange={(event) => patchWinnerOverlay((winner) => (winner.backgroundImageAssetId = event.target.value || null))}>
                        <option value="">None</option>
                        {assets.data?.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.originalName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="secondary-button">
                      Upload winner background
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void uploadAssetIntoTarget(file, "winner");
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                </SectionCard>
              </div>
            ) : null}

            </div>
          </div>
        </div>
      </div>
    </AdminPageFrame>
  );
}
