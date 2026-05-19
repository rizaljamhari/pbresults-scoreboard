import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useLiveState, useSettings, useTeams, useTheme } from "../hooks";
import { builtinThemes } from "../../shared/builtinThemes";
import { fontFamilies } from "../../shared/theme";
import type { ComponentId, NormalizedLiveState, TeamMatchResult, TeamRecord, ThemeDefinition } from "../../shared/theme";
import { ThemeCanvasEditor } from "../components/ThemeCanvasEditor";
import { Badge, Button, FieldHint, buttonVariants } from "../components/ui";

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
const nudgePresets = [1, 5, 10] as const;
const safeAreaTopInset = 54;
const defaultTopInset = 24;

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

function SectionCard(props: { title: string; description?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="editor-section-card" open={props.defaultOpen ?? true}>
      <summary className="editor-section-header">
        <div>
          <h3>{props.title}</h3>
          {props.description ? <FieldHint>{props.description}</FieldHint> : null}
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

function mirroredPairForComponent(id: ComponentId) {
  return mirroredComponentPairs.find(([leftId, rightId]) => leftId === id || rightId === id) ?? null;
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
  const [nudgeStep, setNudgeStep] = useState<(typeof nudgePresets)[number]>(1);
  const [previewEnabled, setPreviewEnabled] = useState(false);
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

  function selectComponent(id: ComponentId) {
    setActiveMenu(null);
    setSelectAllMode(false);
    setSelected(id);
    setSelectedSlot(slotForComponent(id));
    setInspectorView("component");
  }

  function selectSlot(slot: SlotId) {
    setActiveMenu(null);
    setSelectAllMode(false);
    setSelectedSlot(slot);
    if (!selected || !slotConfig[slot].ids.includes(selected)) {
      setSelected(slotConfig[slot].ids[0]);
    }
    setInspectorView("component");
  }

  function selectAllComponents() {
    setActiveMenu(null);
    setSelectAllMode(true);
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
        targetComponent.x = mirrorX(draft.canvas.width, sourceComponent.x, sourceComponent.width);
        targetComponent.y = sourceComponent.y;
        targetComponent.width = sourceComponent.width;
        targetComponent.height = sourceComponent.height;
      }
    });

    if (selected) {
      const nextSelected =
        direction === "leftToRight"
          ? mirroredComponentPairs.find(([leftId]) => leftId === selected)?.[1] ?? selected
          : mirroredComponentPairs.find(([, rightId]) => rightId === selected)?.[0] ?? selected;
      setSelected(nextSelected);
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
      targetComponent.x = mirrorX(draft.canvas.width, sourceComponent.x, sourceComponent.width);
      targetComponent.y = sourceComponent.y;
      targetComponent.width = sourceComponent.width;
      targetComponent.height = sourceComponent.height;
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

    nudgeSelected(dx, dy);
  }

  function clearSelectionState() {
    setActiveMenu(null);
    setSelectAllMode(false);
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
      setSelected(direction > 0 ? ids[0] : ids[ids.length - 1]);
      return;
    }

    const index = ids.indexOf(selected);
    const nextIndex = (index + direction + ids.length) % ids.length;
    setSelected(ids[nextIndex]);
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

  async function uploadAssetIntoTarget(file: File, target: "logo" | "surface" | "concede" | "base") {
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

    patchBaseOverlay((base) => {
      base.backgroundImageAssetId = asset.id;
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

      if (event.key === "0" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setCanvasZoom(1);
        return;
      }

      if (!selectAllMode && !selected) {
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
  }, [activeMenu, future, history, nudgeStep, selectAllMode, selected, selectedSlotConfig.ids, themeResource.data]);

  if (!theme) {
    return <section className="panel"><FieldHint>Loading theme...</FieldHint></section>;
  }

  const selectedSummaryLabel = selectAllMode ? "Editing all components" : selected ? `Editing ${selectedSlotConfig.title} > ${selectedShortLabel}` : "No piece selected";

  return (
    <section className="admin-page panel-stack editor-layout">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Theme Editor</p>
            <h2>{theme.name}</h2>
            <div className="editor-title-meta">
              <FieldHint>{theme.builtin ? "Built-in theme. Saving and publishing require confirmation." : "Custom theme draft."}</FieldHint>
              {hasUnsavedChanges ? <Badge variant="warning">Unsaved changes</Badge> : null}
            </div>
          </div>
          <div className="editor-header-actions">
            <div className="editor-header-cluster">
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

            <div className="editor-header-cluster editor-header-cluster--utility">
              <details className="row-action-menu row-action-menu--header" open={activeMenu === "header-canvas-tools"}>
                <summary className={buttonVariants({ variant: "secondary" })} onClick={(event) => { event.preventDefault(); toggleMenu("header-canvas-tools"); }}>Canvas tools</summary>
                <div className="row-action-menu-list">
                  <button className={buttonVariants({ variant: "secondary" })} onClick={() => { undo(); closeMenus(); }} disabled={history.length <= 1}>
                    Undo
                  </button>
                  <button className={buttonVariants({ variant: "secondary" })} onClick={() => { redo(); closeMenus(); }} disabled={future.length === 0}>
                    Redo
                  </button>
                  <label className="inline-select">
                    <FieldHint>Zoom</FieldHint>
                    <select value={String(canvasZoom)} onChange={(event) => setCanvasZoom(Number(event.target.value))}>
                      {zoomPresets.map((preset) => (
                        <option key={preset} value={String(preset)}>
                          {Math.round(preset * 100)}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className={buttonVariants({ variant: "secondary" })} onClick={() => { setCanvasZoom(1); closeMenus(); }} disabled={canvasZoom === 1}>
                    Reset zoom
                  </button>
                </div>
              </details>
            </div>

            <div className="editor-header-cluster editor-header-cluster--primary">
              <Button variant="secondary" onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button onClick={() => void publish()}>Publish</Button>
              <details className="row-action-menu row-action-menu--header" open={activeMenu === "header-more"}>
                <summary className={buttonVariants({ variant: "secondary" })} onClick={(event) => { event.preventDefault(); toggleMenu("header-more"); }}>More</summary>
                <div className="row-action-menu-list">
                  <button className={buttonVariants({ variant: "secondary" })} onClick={() => { navigate("/admin/themes"); closeMenus(); }}>
                    Back
                  </button>
                  {theme.builtin ? (
                    <button className={buttonVariants({ variant: "secondary" })} onClick={() => { void saveAsCopy(); closeMenus(); }}>
                      {saving ? "Saving…" : "Save as Copy"}
                    </button>
                  ) : null}
                  <a className={buttonVariants({ variant: "secondary" })} href={`/overlay/preview/${theme.id}`} target="_blank" rel="noreferrer" onClick={closeMenus}>
                    Open preview
                  </a>
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="editor-summary-grid">
          <div className="editor-summary-card">
            <strong>Mode</strong>
            <span>{editorMode === "basic" ? "Operator-friendly" : "Full controls"}</span>
          </div>
          <div className={`editor-summary-card ${selectAllMode || selected ? "editor-summary-card--active" : ""}`}>
            <strong>Selected</strong>
            <span>{selectedSummaryLabel}</span>
            <small>Tab cycle · Arrows move · Shift jump · Alt fine</small>
          </div>
          <div className="editor-summary-card">
            <strong>Canvas</strong>
            <span>
              {theme.canvas.width} x {theme.canvas.height}
            </span>
            <small>+ / - zoom · 0 reset</small>
          </div>
          <div className={`editor-summary-card ${previewEnabled ? "editor-summary-card--active" : ""}`}>
            <strong>Preview</strong>
            <span>{previewEnabled ? `${previewLive.period} · ${previewLive.teamEvent}` : "Live feed"}</span>
            <small>{previewEnabled ? "Editor-only preview overrides active" : "Using current live state"}</small>
          </div>
          <div className="editor-summary-card">
            <strong>Concede</strong>
            <span>
              {theme.teamEventOverlay.general.enabled
                ? `${theme.teamEventOverlay.concede.text} / ${theme.teamEventOverlay.general.durationMs}ms`
                : "Disabled"}
            </span>
          </div>
        </div>

        <div className="editor-workspace">
          <div className="canvas-preview-column">
            <div className="canvas-preview-wrapper">
            <ThemeCanvasEditor
              theme={theme}
              live={previewLive}
              assets={assets.data ?? []}
              selectedId={selected}
              selectAll={selectAllMode}
              zoom={canvasZoom}
              toolbar={
                <>
                  <div className="canvas-shortcut-bar" aria-label="Editor keyboard shortcuts">
                    <span className="canvas-shortcut-pill"><kbd>Tab</kbd> next piece</span>
                    <span className="canvas-shortcut-pill"><kbd>Shift</kbd> + <kbd>Tab</kbd> previous</span>
                    <span className="canvas-shortcut-pill"><kbd>↑↓←→</kbd> move</span>
                    <span className="canvas-shortcut-pill"><kbd>Shift</kbd> + <kbd>Arrow</kbd> jump</span>
                    <span className="canvas-shortcut-pill"><kbd>Alt</kbd> + <kbd>Arrow</kbd> fine</span>
                    <span className="canvas-shortcut-pill"><kbd>+</kbd> <kbd>-</kbd> zoom</span>
                    <span className="canvas-shortcut-pill"><kbd>0</kbd> reset zoom</span>
                    <span className="canvas-shortcut-pill"><kbd>Esc</kbd> clear</span>
                  </div>
                  <div className="canvas-preview-bar" aria-label="Editor preview states">
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
                          Towel home
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("towelAway"); closeMenus(); }}>
                          Towel away
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("baseHome"); closeMenus(); }}>
                          Base home
                        </button>
                        <button type="button" className={buttonVariants({ variant: "secondary" })} onClick={() => { applyPreviewPreset("baseAway"); closeMenus(); }}>
                          Base away
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
                </>
              }
              onSelect={selectComponent}
              onSelectAll={selectAllComponents}
              onUpdate={updateTheme}
            />
            </div>
          </div>

          <div className="inspector-column">
            <div className="inspector v2-inspector">
            <div className="inspector-toolbar">
              <div className="segmented-control">
                <button
                  className={inspectorView === "theme" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setInspectorView("theme")}
                  type="button"
                >
                  Theme
                </button>
                <button
                  className={inspectorView === "component" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setInspectorView("component")}
                  type="button"
                >
                  Scoreboard
                </button>
                <button
                  className={inspectorView === "concede" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setInspectorView("concede")}
                  type="button"
                >
                  Overlay
                </button>
              </div>
            </div>

            {inspectorView === "theme" ? (
              <div className="inspector-stack">
                <SectionCard title="Theme Basics" description="Core identity and canvas options." defaultOpen>
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

                <SectionCard title="Working Model" description="Use drag on canvas for placement. Switch to advanced for exact geometry and low-level tuning." defaultOpen={false}>
                  <div className="editor-notes">
                    <p>`Theme` is for page-level settings only.</p>
                    <p>`Scoreboard` is where you choose and style the visible blocks.</p>
                    <p>`Overlay` is where you style the concede/team-state treatment.</p>
                  </div>
                </SectionCard>
              </div>
            ) : null}

            {inspectorView === "component" ? (
              <div className="inspector-stack">
                <SectionCard title="Scoreboard Structure" description="Choose the slot you want to edit. Then pick the piece inside that slot below." defaultOpen>
                  <div className="block-editor-grid">
                    {(Object.entries(slotConfig) as Array<[SlotId, (typeof slotConfig)[SlotId]]>).map(([slot, config]) => (
                      <button
                        key={slot}
                        type="button"
                        className={selectedSlot === slot ? "block-editor-card selected" : "block-editor-card"}
                        onClick={() => selectSlot(slot)}
                      >
                        <strong>{config.title}</strong>
                        <span className="hint">{config.description}</span>
                      </button>
                    ))}
                  </div>
                  <div className="inline-action-grid">
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
                    <button type="button" className={selectAllMode ? "secondary-button active-utility" : "secondary-button"} onClick={selectAllComponents}>
                      Select all
                    </button>
                    <button type="button" className="secondary-button" onClick={centerAllComponents}>
                      Center all on canvas
                    </button>
                    <details className="row-action-menu" open={activeMenu === "layout-tools"}>
                      <summary className="secondary-button" onClick={(event) => { event.preventDefault(); toggleMenu("layout-tools"); }}>Layout tools</summary>
                      <div className="row-action-menu-list">
                        <button type="button" className="secondary-button" onClick={() => { syncTeamSlot("leftToRight"); closeMenus(); }}>
                          Sync left to right
                        </button>
                        <button type="button" className="secondary-button" onClick={() => { syncTeamSlot("rightToLeft"); closeMenus(); }}>
                          Sync right to left
                        </button>
                        <button type="button" className="secondary-button" onClick={() => { mirrorTeamSlotLayout("leftToRight"); closeMenus(); }}>
                          Mirror left layout
                        </button>
                        <button type="button" className="secondary-button" onClick={() => { mirrorTeamSlotLayout("rightToLeft"); closeMenus(); }}>
                          Mirror right layout
                        </button>
                        <button type="button" className="secondary-button" onClick={resetSelectedSlotToSaved} disabled={!savedSnapshot}>
                          Reset slot to saved
                        </button>
                        <button type="button" className="secondary-button" onClick={() => applyLayoutPreset(builtinThemes[0].id)}>
                          Apply {builtinThemes[0].name} layout
                        </button>
                        <button type="button" className="secondary-button" onClick={() => applyLayoutPreset(builtinThemes[1].id)}>
                          Apply {builtinThemes[1].name} layout
                        </button>
                      </div>
                    </details>
                  </div>
                  <div className="operator-guide-card">
                    <strong>Tool guide</strong>
                    <div className="operator-guide-grid">
                      <p>
                        <span>Sync</span>
                        Copy the full component setup to the opposite side: layout, styling, visibility, and assets.
                      </p>
                      <p>
                        <span>Mirror</span>
                        Copy only layout geometry to the opposite side: position and size, while keeping that side’s own style.
                      </p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title={`${selectedSlotConfig.title} Pieces`} description="Choose the piece inside this slot that you want to style." defaultOpen>
                  <ComponentPillRow
                    ids={selectedSlotConfig.ids}
                    selected={selected}
                    onSelect={selectComponent}
                    labels={componentShortLabels}
                  />
                </SectionCard>

                {selectedSlot === "center" ? (
                  <SectionCard title="Center Behavior" description="Choose what the lower center line shows during game time and during breaks." defaultOpen={false}>
                    <div className="form-grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
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
                          <option>Bebas Neue</option>
                          <option>Oswald</option>
                          <option>Barlow Condensed</option>
                          <option>Arial Narrow</option>
                          <option>Helvetica Neue</option>
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
                          <option>Bebas Neue</option>
                          <option>Oswald</option>
                          <option>Barlow Condensed</option>
                          <option>Arial Narrow</option>
                          <option>Helvetica Neue</option>
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
                      <label className="inline-select">
                        <span className="hint">Nudge</span>
                        <select value={String(nudgeStep)} onChange={(event) => setNudgeStep(Number(event.target.value) as (typeof nudgePresets)[number])}>
                          {nudgePresets.map((preset) => (
                            <option key={preset} value={String(preset)}>
                              {preset}px
                            </option>
                          ))}
                        </select>
                      </label>
                      <details className="row-action-menu row-action-menu--up" open={activeMenu === "nudge-pad"}>
                        <summary className="secondary-button" onClick={(event) => { event.preventDefault(); toggleMenu("nudge-pad"); }}>Nudge pad</summary>
                        <div className="row-action-menu-list">
                          <div className="nudge-controls nudge-controls--menu">
                            <button type="button" className="secondary-button nudge-button" onClick={() => nudgeSelected(0, -nudgeStep)}>
                              ↑
                            </button>
                            <div className="nudge-row">
                              <button type="button" className="secondary-button nudge-button" onClick={() => nudgeSelected(-nudgeStep, 0)}>
                                ←
                              </button>
                              <button type="button" className="secondary-button nudge-button" onClick={() => nudgeSelected(nudgeStep, 0)}>
                                →
                              </button>
                            </div>
                            <button type="button" className="secondary-button nudge-button" onClick={() => nudgeSelected(0, nudgeStep)}>
                              ↓
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                    {selectedMirroredPair ? (
                      <p className="hint">
                        `Mirror piece layout` only copies X, Y, width, and height to the opposite side. It keeps colors, fonts, and assets unchanged.
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
                            label="Padding"
                            unit="px"
                            value={selectedEditableComponent.padding}
                            onChange={(value) => patchSelectedComponent((component) => (component.padding = value))}
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
                      <input type="checkbox" checked={!!theme.teamEventOverlay.general.followLogoSize} onChange={(event) => patchOverlayGeneral((general) => (general.followLogoSize = event.target.checked))} />
                      Match logo size/position
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
              </div>
            ) : null}

            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
