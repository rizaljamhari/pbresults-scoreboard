import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useLiveState, useSettings, useTeams, useTheme } from "../hooks";
import { builtinThemes } from "../../shared/builtinThemes";
import { fontFamilies } from "../../shared/theme";
import { freeShapeComponentSchema, surfaceStyleDefaults, textStyleDefaults, type DesignBinding } from "../../shared/theme";
import type { ComponentId, FreeImageComponent, FreeTextComponent, NormalizedLiveState, TeamMatchResult, TeamRecord, TextThemeComponent, ThemeDefinition } from "../../shared/theme";
import {
  createFreeComponentId,
  fixedComponentLabels,
  getNextComponentZIndex,
  getThemeComponent,
  getThemeComponentEntry,
  isFixedComponentId,
  listThemeComponentEntries,
  type ThemeComponent
} from "../../shared/themeComponents";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  AlignHorizontalJustifyCenter,
  ArrowLeft,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Crosshair,
  ExternalLink,
  Hand,
  Image as ImageIcon,
  Lock,
  Magnet,
  Maximize,
  Menu,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  Play,
  SlidersHorizontal,
  PanelRightOpen,
  Plus,
  Redo2,
  RefreshCw,
  Square,
  SquareDashedMousePointer,
  Sun,
  Type,
  Undo2
} from "lucide-react";
import { SnapOptionsPanel, ThemeCanvasEditor } from "../components/ThemeCanvasEditor";
import { reconcileServerTheme } from "./themeAdminUtils";
import { ThemeColorsContext } from "../components/editor/fields";
import { bakeDesign, captureStyle, copyStyle, createDesignId, pasteStyle, reconcileDesign, surfaceStyleFields, textStyleFields } from "../../shared/design";
import { IconButton, Island, ShortcutsHelp } from "../components/editor/EditorChrome";
import { ArrangeMenuItems, ArrangePanel, type ArrangeActions } from "../components/editor/ArrangeControls";
import { LayersPanel } from "../components/editor/LayersPanel";
import { PieceProperties, themeSwatches } from "../components/editor/PieceProperties";
import { ThemeProperties } from "../components/editor/ThemeProperties";
import { EventOverlayProperties, type EventKind } from "../components/editor/EventOverlayProperties";
import { EVENT_CARD_ID, momentCardId, type OverlayTarget } from "../components/editor/MoveableLayer";
import { MomentCardProperties, MOMENT_NAMES, type MomentKind } from "../components/editor/MomentCardProperties";
import { resolveCenterSecondaryPresentation, resolveEventLabelRect, resolveMomentFrame } from "../components/OverlayRenderer";
import { PanelSection } from "../components/editor/fields";
import {
  alignPieces,
  distributePieces,
  matchSize as matchPieceSize,
  mirroredComponentPairs,
  setGapBetween,
  type ArrangeReference
} from "../../shared/themeArrange";
import { CentreLineProperties } from "../components/editor/CentreLineProperties";
import { PreviewDataProperties, type PreviewEventMode, type PreviewLogoMode, type PreviewNameMode, type PreviewPeriodMode, type PreviewSwitchMode } from "../components/editor/PreviewDataProperties";
import { showToast } from "../toast";
import { pieceName } from "../components/editor/pieceNames";
import { useAppEvents } from "../appEvents";
import { useAppearance } from "../appearance";
import { ResourceRefreshCoordinator } from "../resourceRefresh";


type EditorMode = "basic" | "advanced";
type InspectorView = "theme" | "component" | "concede" | "preview";
type SlotId = "left" | "center" | "right";
type PreviewPresetId = "live" | "game" | "break" | "towelHome" | "towelAway" | "baseHome" | "baseAway";
const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const safeAreaTopInset = 54;
const defaultTopInset = 24;

const componentLabels = fixedComponentLabels;

const homeBlockIds: ComponentId[] = ["homeTeamLogo", "homeName", "homeScore"];
const awayBlockIds: ComponentId[] = ["awayScore", "awayName", "awayTeamLogo"];
const centerBlockIds: ComponentId[] = ["gameTime", "breakTime", "eventLogo"];
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
        padding: 10
      },
      motionPreset: "drop-in" as const,
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
        padding: 8
      },
      motionPreset: "glide-in" as const,
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
        padding: 14
      },
      motionPreset: "glide-in" as const,
      concede: {
        backgroundColor: "#181311d6",
        color: "#fff7ed"
      }
    }
  }
} as const;


function slotForComponent(id: string | null): SlotId | null {
  if (!id || !isFixedComponentId(id)) {
    return null;
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

// Tab cycles canvas pieces only while focus is on the canvas (or nowhere); elsewhere it keeps moving focus.
function isCanvasFocusTarget(target: EventTarget | null) {
  if (target === document.body || target === document.documentElement) {
    return true;
  }
  return target instanceof HTMLElement && Boolean(target.closest(".canvas-pan-layer"));
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // Keys pressed inside an open menu, popover or tooltip belong to it (Esc closes it, not the selection).
  if (target.closest("[data-radix-popper-content-wrapper]")) {
    return true;
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
    resolutionSource: "automatic",
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
    resolutionSource: "automatic",
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

  for (const { component } of listThemeComponentEntries(next)) {
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
  
  if (sourceComponent.borderRadius && targetComponent.borderRadius) {
    targetComponent.borderRadius = [
      sourceComponent.borderRadius[1],
      sourceComponent.borderRadius[0],
      sourceComponent.borderRadius[3],
      sourceComponent.borderRadius[2]
    ];
  }

  if (sourceComponent.kind === "text" && targetComponent.kind === "text") {
    targetComponent.textAlign = mirrorTextAlign(sourceComponent.textAlign);
  }
}

function mirroredPairForComponent(id: ComponentId) {
  return mirroredComponentPairs.find(([leftId, rightId]) => leftId === id || rightId === id) ?? null;
}

type LayoutScopeEntry = {
  id: string;
  component: ThemeComponent;
};

function getOrderedComponentIds(theme: ThemeDefinition) {
  return listThemeComponentEntries(theme).sort((left, right) => {
    const zIndexDifference = left.component.zIndex - right.component.zIndex;
    if (zIndexDifference !== 0) {
      return zIndexDifference;
    }
    return left.id.localeCompare(right.id);
  }).map((entry) => entry.id);
}

function reorderComponentStack(
  draft: ThemeDefinition,
  selectedId: string,
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
    const component = getThemeComponent(draft, id);
    if (component) {
      component.zIndex = index + 1;
    }
  });

  return true;
}

// Space the floating islands cover; the frame fits into what is left. Layers hides at 1100px and below.
const EDITOR_FIT_INSETS = { top: 100, right: 260, bottom: 72, left: 288 };
const EDITOR_FIT_INSETS_NO_LAYERS = { ...EDITOR_FIT_INSETS, right: 14 };
const LAYERS_HIDDEN_QUERY = "(max-width: 1100px)";

// Locks are an editing aid, not theme data: kept per theme in this browser only.
function lockStorageKey(themeId: string | undefined) {
  return `pbresults.themeEditor.locks.${themeId ?? "none"}`;
}

function readLocks(themeId: string | undefined): Set<string> {
  try {
    const raw = window.localStorage.getItem(lockStorageKey(themeId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function ThemeEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const themeResource = useTheme(id);
  const appEvents = useAppEvents();
  const assets = useAssets();
  const teams = useTeams();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const [selected, setSelected] = useState<string | null>("homeName");
  const [selectedIds, setSelectedIds] = useState<string[]>(["homeName"]);
  const [selectedSlot, setSelectedSlot] = useState<SlotId>("left");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tool, setTool] = useState<"select" | "hand">("select");
  const appearance = useAppearance();
  const [arrangeReference, setArrangeReference] = useState<ArrangeReference>("selection");
  // Properties shows the selection (or the theme); the two older settings views are reached from the theme panel.
  const [propsView, setPropsView] = useState<"auto" | "preview">("auto");
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const selectionKey = selectedIds.join("|") + (selected ?? "");
  useEffect(() => {
    if (selectionKey) {
      setPropsView("auto");
    }
  }, [selectionKey]);
  const [lockedIds, setLockedIds] = useState<Set<string>>(() => readLocks(id));
  useEffect(() => {
    setLockedIds(readLocks(id));
  }, [id]);
  const [layersHidden, setLayersHidden] = useState(() => window.matchMedia(LAYERS_HIDDEN_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(LAYERS_HIDDEN_QUERY);
    const update = () => setLayersHidden(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  // Saving the on-air theme changes the broadcast; ask once per editing session, then trust the header's On air badge.
  const liveSaveConfirmedRef = useRef(false);
  const [history, setHistory] = useState<ThemeDefinition[]>([]);
  const [future, setFuture] = useState<ThemeDefinition[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<ThemeDefinition | null>(null);
  const [externalTheme, setExternalTheme] = useState<ThemeDefinition | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("basic");
  const [inspectorView, setInspectorView] = useState<InspectorView>("component");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [selectAllMode, setSelectAllMode] = useState(false);
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
  // "Preview as": which broadcast state the canvas shows, and for event states, which team it is for.
  const [previewMode, setPreviewMode] = useState<"live" | "game" | "break" | "timeout" | "finished" | "towel" | "base" | "winner">("live");
  // The timeout is a 1.2 s flash on air; the editor holds it so it can be designed, and Play shows one real flash.
  const [previewTimeout, setPreviewTimeout] = useState<"hold" | "flash" | null>(null);
  const [replayChange, setReplayChange] = useState<{ id: string; token: number } | null>(null);
  const [entranceToken, setEntranceToken] = useState<number | null>(null);
  const previewTimeoutTimerRef = useRef<number | null>(null);
  const [previewSide, setPreviewSide] = useState<"left" | "right">("left");
  const [previewFinished, setPreviewFinished] = useState(false);
  const [overlayKey, setOverlayKey] = useState(0);
  const [overlaySelected, setOverlaySelected] = useState(false);
  const theme = themeResource.data;
  const themeRef = useRef(theme);
  const savedSnapshotRef = useRef(savedSnapshot);
  themeRef.current = theme;
  savedSnapshotRef.current = savedSnapshot;

  const selectedEntry = theme && selected ? getThemeComponentEntry(theme, selected) : null;
  const selectedEditableComponent = selectedEntry?.component ?? null;

  const selectedImageComponent = selectedEditableComponent?.kind === "image" ? selectedEditableComponent : null;
  const selectedIsTeamLogo = selected === "homeTeamLogo" || selected === "awayTeamLogo";
  const selectedSlotConfig = slotConfig[selectedSlot];
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

    // A finished match: the overlay reveals the winner during the break after the final whistle.
    if (previewFinished) {
      next.state = "END";
      next.period = "BREAK";
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

  function selectOverlayCard() {
    setSelectedIds([]);
    setSelected(null);
    setSelectAllMode(false);
    setOverlaySelected(true);
  }

  function applyPreviewMode(mode: typeof previewMode, side: "left" | "right" = previewSide) {
    setPreviewMode(mode);
    setPreviewSide(side);
    setPreviewFinished(false);
    setPreviewTimeout(null);
    if (previewTimeoutTimerRef.current !== null) {
      window.clearTimeout(previewTimeoutTimerRef.current);
      previewTimeoutTimerRef.current = null;
    }
    if (mode === "live") {
      resetPreviewState();
      setOverlaySelected(false);
      return;
    }
    if (mode === "game" || mode === "break") {
      applyPreviewPreset(mode);
      setOverlaySelected(false);
      return;
    }
    if (mode === "timeout") {
      applyPreviewPreset("break");
      setPreviewBreakTimerValue(60);
      setPreviewTimeout("hold");
      selectOverlayCard();
      return;
    }
    if (mode === "finished") {
      applyPreviewPreset("break");
      setPreviewFinished(true);
      setPreviewLeftScore(3);
      setPreviewRightScore(1);
      selectOverlayCard();
      return;
    }
    // Events are recorded against home/away; which of those is on the left depends on the side switch.
    const leftIsHome = (live.data?.sidesSwitched ?? 0) !== 1;
    const home = side === "left" ? leftIsHome : !leftIsHome;
    if (mode === "towel" || mode === "base") {
      applyPreviewPreset(mode === "towel" ? (home ? "towelHome" : "towelAway") : home ? "baseHome" : "baseAway");
    } else {
      applyPreviewPreset("break");
      setPreviewFinished(true);
      setPreviewLeftScore(side === "left" ? 3 : 1);
      setPreviewRightScore(side === "left" ? 1 : 3);
    }
    // Entering an event state selects its card, so Properties shows what can be changed.
    selectOverlayCard();
  }

  function replayPreviewEntrance() {
    if (previewMode === "timeout") {
      const duration = themeResource.data?.momentOverlays.timeout.durationMs ?? 1200;
      setPreviewTimeout("flash");
      if (previewTimeoutTimerRef.current !== null) {
        window.clearTimeout(previewTimeoutTimerRef.current);
      }
      previewTimeoutTimerRef.current = window.setTimeout(() => {
        previewTimeoutTimerRef.current = null;
        setPreviewTimeout("hold");
      }, duration + 400);
    }
    setOverlayKey((key) => key + 1);
  }

  useEffect(
    () => () => {
      if (previewTimeoutTimerRef.current !== null) {
        window.clearTimeout(previewTimeoutTimerRef.current);
      }
    },
    []
  );

  const selectedLogoContext =
    selectedIsTeamLogo && selectedImageComponent
      ? (() => {
          const match = selected === "homeTeamLogo" ? previewLive?.displayLeftTeamMatch : previewLive?.displayRightTeamMatch;
          const registryAssetId = match?.team?.logoAssetId ?? match?.team?.alternateLogoAssetId ?? null;
          const registryAsset = registryAssetId ? assets.data?.find((asset) => asset.id === registryAssetId) ?? null : null;
          const fallbackAsset = selectedImageComponent.assetId
            ? assets.data?.find((asset) => asset.id === selectedImageComponent.assetId) ?? null
            : null;
          const eventAssetId = theme?.components.eventLogo.assetId ?? null;
          const eventAsset = eventAssetId
            ? assets.data?.find((asset) => asset.id === eventAssetId) ?? null
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
  const selectedMirroredPair = selected && isFixedComponentId(selected) ? mirroredPairForComponent(selected) : null;
  const hasUnsavedChanges = savedSnapshot && theme ? !sameTheme(savedSnapshot, theme) : false;
  const isOnAir = Boolean(theme && settings.data?.publishedThemeId === theme.id);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);
  function sameTheme(left: ThemeDefinition, right: ThemeDefinition) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function applyServerTheme(next: ThemeDefinition) {
    const normalized = clampThemeToCanvas(next);
    themeResource.setData(structuredClone(normalized));
    setSavedSnapshot(structuredClone(normalized));
    setHistory([structuredClone(normalized)]);
    setFuture([]);
    setExternalTheme(null);
  }

  useEffect(() => {
    if (!id || !appEvents) return;
    const coordinator = new ResourceRefreshCoordinator(async (_token, shouldApply) => {
      try {
        // Compare in the form the baseline is stored in, so an unchanged server copy never looks like an edit.
        const next = clampThemeToCanvas(await api.getTheme(id));
        if (!shouldApply()) return;
        const outcome = reconcileServerTheme(themeRef.current, savedSnapshotRef.current, next);
        if (outcome === "apply") {
          applyServerTheme(next);
        } else if (outcome === "conflict") {
          setExternalTheme(next);
        } else {
          // The server is back to the version this draft started from: any earlier warning no longer applies.
          setExternalTheme(null);
        }
      } catch {
        // Keep the current draft if the external version cannot be loaded.
      }
    });
    const unsubscribe = appEvents.subscribe("themes", (invalidation) => {
      if (invalidation.resourceIds && !invalidation.resourceIds.includes(id)) return;
      coordinator.invalidate(invalidation.cacheToken);
    });
    return () => {
      unsubscribe();
      coordinator.dispose();
    };
  }, [appEvents?.subscribe, id]);

  function updateTheme(next: ThemeDefinition, options?: { recordHistory?: boolean }) {
    // Theme colours and styles: a manual edit unbinds or overrides, then bound values follow their colour or style.
    const usesDesign = (theme: ThemeDefinition) => theme.tokens.colors.length > 0 || theme.styles.text.length > 0 || theme.styles.surface.length > 0;
    const designed = themeResource.data && (usesDesign(themeResource.data) || usesDesign(next)) ? bakeDesign(reconcileDesign(themeResource.data, next)) : next;
    const normalizedNext = clampThemeToCanvas(designed);
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

  function patchSelectedComponent(mutator: (component: ThemeComponent) => void) {
    if (!selected) {
      return;
    }
    patchTheme((draft) => {
      const component = getThemeComponent(draft, selected);
      if (component) {
        mutator(component);
      }
    });
  }

  const copiedStyleRef = useRef<Record<string, unknown> | null>(null);
  const [hasCopiedStyle, setHasCopiedStyle] = useState(false);

  /** Copies the selected piece's look (type, box, effects, motion and linked styles), not its content or position. */
  function copySelectedStyle() {
    const component = selected && themeResource.data ? getThemeComponent(themeResource.data, selected) : null;
    if (!component) {
      return;
    }
    copiedStyleRef.current = copyStyle(component as unknown as Record<string, unknown>);
    setHasCopiedStyle(true);
    showToast({ kind: "success", message: "Style copied. Select pieces and paste with ⌘/Ctrl Alt V." });
  }

  /** Pastes the copied look onto every selected piece, field by field where the piece has the field. */
  function pasteStyleToSelection() {
    const style = copiedStyleRef.current;
    const ids = selectedIds.length ? selectedIds : selected ? [selected] : [];
    if (!style || ids.length === 0) {
      return;
    }
    patchTheme((draft) => {
      for (const id of ids) {
        const component = getThemeComponent(draft, id);
        if (component) {
          pasteStyle(component as unknown as Record<string, unknown>, style);
        }
      }
    });
  }

  /** Saves the selected piece's type or box as a new style and links the piece to it. */
  function saveSelectedAsStyle(kind: "text" | "surface") {
    if (!selected || !selectedEntry) {
      return;
    }
    const id = createDesignId(kind);
    const name = `${pieceName(selectedEntry)} ${kind === "text" ? "type" : "box"}`.slice(0, 40);
    patchTheme((draft) => {
      const component = getThemeComponent(draft, selected) as unknown as (Record<string, unknown> & { design: DesignBinding }) | null;
      if (!component) {
        return;
      }
      if (kind === "text") {
        draft.styles.text.push(captureStyle(textStyleDefaults(id, name), component, textStyleFields));
        component.design.textStyleId = id;
      } else {
        draft.styles.surface.push(captureStyle(surfaceStyleDefaults(id, name), component, surfaceStyleFields));
        component.design.surfaceStyleId = id;
      }
    });
    showToast({ kind: "success", message: `Saved “${name}”. Edit it under Text styles or Surface styles on the theme panel.` });
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

  function patchMoments(mutator: (moments: ThemeDefinition["momentOverlays"]) => void) {
    patchTheme((draft) => {
      mutator(draft.momentOverlays);
    });
  }

  function patchWinnerOverlay(mutator: (winner: ThemeDefinition["teamEventOverlay"]["winner"]) => void) {
    patchTeamEventOverlay((overlay) => {
      mutator(overlay.winner);
    });
  }

  function selectComponent(id: string, options?: { additive?: boolean }) {
    setOverlaySelected(false);
    setSelectAllMode(false);
    const additive = options?.additive === true;

    if (additive) {
      setSelectedIds((current) => {
        const exists = current.includes(id);
        const next = exists ? current.filter((entry) => entry !== id) : [...current, id];
        setSelected(next.length > 0 ? next[next.length - 1] : null);
        return next;
      });
      const slot = slotForComponent(id);
      if (slot) {
        setSelectedSlot(slot);
      }
    } else {
      setSelected(id);
      setSelectedIds([id]);
      const slot = slotForComponent(id);
      if (slot) {
        setSelectedSlot(slot);
      }
    }

    setInspectorView("component");
  }

  function selectComponents(ids: string[], options?: { additive?: boolean }) {
    setOverlaySelected(false);
    setSelectAllMode(false);

    const unique = Array.from(new Set(ids));
    if (options?.additive) {
      setSelectedIds((current) => {
        const next = Array.from(new Set([...current, ...unique]));
        setSelected(next.length > 0 ? next[next.length - 1] : null);
        if (next.length > 0) {
          const slot = slotForComponent(next[next.length - 1]);
          if (slot) {
            setSelectedSlot(slot);
          }
        }
        return next;
      });
    } else {
      setSelectedIds(unique);
      setSelected(unique.length > 0 ? unique[unique.length - 1] : null);
      if (unique.length > 0) {
        const slot = slotForComponent(unique[unique.length - 1]);
        if (slot) {
          setSelectedSlot(slot);
        }
      }
    }

    setInspectorView("component");
  }

  function selectAllComponents() {
    setSelectAllMode(true);
    if (themeResource.data) {
      const ids = listThemeComponentEntries(themeResource.data).map((entry) => entry.id);
      setSelectedIds(ids);
    }
    setInspectorView("component");
  }


  function applyConcedePreset(presetId: keyof typeof concedePresets) {
    const preset = concedePresets[presetId].values;
    patchTeamEventOverlay((overlay) => {
      Object.assign(overlay.general, preset.general);
      overlay.general.motion.preset = preset.motionPreset;
      Object.assign(overlay.concede, preset.concede);
    });
  }

  function undo() {
    if (history.length <= 1 || !themeResource.data) {
      return;
    }
    const currentTheme = themeResource.data;
    const previous = history[history.length - 2];
    setFuture((current) => [structuredClone(currentTheme), ...current]);
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
      const component = getThemeComponent(draft, selected);
      if (!component) {
        return;
      }
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
      const components = listThemeComponentEntries(draft).map((entry) => entry.component);
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

      for (const { component } of listThemeComponentEntries(draft)) {
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
        Object.assign(draft.components[targetId], sourceComponent, { x: mirroredX });
      }
    });

    if (selected) {
      const nextSelected =
        direction === "leftToRight"
          ? mirroredComponentPairs.find(([leftId]) => leftId === selected)?.[1] ?? selected
          : mirroredComponentPairs.find(([, rightId]) => rightId === selected)?.[0] ?? selected;
      setSelected(nextSelected);
      setSelectedIds([nextSelected]);
      const slot = slotForComponent(nextSelected);
      if (slot) {
        setSelectedSlot(slot);
      }
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
      const slot = slotForComponent(nextSelected);
      if (slot) {
        setSelectedSlot(slot);
      }
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
      const component = getThemeComponent(draft, selected);
      if (component) {
        component.x += dx;
        component.y += dy;
      }
    });
  }

  function nudgeActiveSelection(dx: number, dy: number) {
    if (!themeResource.data) {
      return;
    }

    if (selectAllMode) {
      patchTheme((draft) => {
        for (const { id: pieceId, component } of listThemeComponentEntries(draft)) {
          if (lockedIds.has(pieceId)) {
            continue;
          }
          component.x += dx;
          component.y += dy;
        }
      });
      return;
    }

    if (selected && selectedIds.length <= 1 && lockedIds.has(selected)) {
      return;
    }

    if (selectedIds.length > 1) {
      patchTheme((draft) => {
        for (const id of selectedIds.filter((pieceId) => !lockedIds.has(pieceId))) {
          const component = getThemeComponent(draft, id);
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
    setOverlaySelected(false);
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
      if (isFixedComponentId(selected)) {
        Object.assign(draft.components[selected], structuredClone(savedSnapshot.components[selected]));
        return;
      }
      const savedComponent = savedSnapshot.freeComponents.find((component) => component.id === selected);
      const index = draft.freeComponents.findIndex((component) => component.id === selected);
      if (savedComponent && index >= 0) {
        draft.freeComponents[index] = structuredClone(savedComponent);
      }
    });
  }

  function nextFreeComponentLabel(prefix: string) {
    const used = new Set((themeResource.data?.freeComponents ?? []).map((component) => component.label));
    let index = 1;
    while (used.has(`${prefix} ${index}`)) {
      index += 1;
    }
    return `${prefix} ${index}`;
  }

  function addFreeTextComponent() {
    if (!themeResource.data) {
      return;
    }
    const id = createFreeComponentId();
    patchTheme((draft) => {
      const base = structuredClone(draft.components.homeName);
      const width = 440;
      const height = 54;
      const component: FreeTextComponent = {
        ...base,
        id,
        label: nextFreeComponentLabel("Custom Text"),
        contentMode: "static",
        defaultText: "Custom text",
        maxLength: 120,
        multiline: false,
        x: Math.round((draft.canvas.width - width) / 2),
        y: Math.round((draft.canvas.height - height) / 2),
        width,
        height,
        zIndex: getNextComponentZIndex(draft),
        visible: true
      };
      draft.freeComponents.push(component);
    });
    selectComponent(id);
  }

  function addFreeShapeComponent() {
    if (!themeResource.data) {
      return;
    }
    const id = createFreeComponentId();
    patchTheme((draft) => {
      const width = 360;
      const height = 60;
      draft.freeComponents.push(
        freeShapeComponentSchema.parse({
          kind: "shape",
          id,
          label: nextFreeComponentLabel("Shape"),
          x: Math.round((draft.canvas.width - width) / 2),
          y: Math.round((draft.canvas.height - height) / 2),
          width,
          height,
          zIndex: getNextComponentZIndex(draft),
          visible: true,
          opacity: 1,
          backgroundColor: "#1b1b1b",
          borderColor: "#00000000",
          borderWidth: 0,
          borderRadius: [0, 0, 0, 0],
          paddingX: 0,
          paddingY: 0,
          offsetX: 0,
          offsetY: 0,
          shadow: "none"
        })
      );
    });
    selectComponent(id);
  }

  function addFreeImageComponent() {
    if (!themeResource.data) {
      return;
    }
    const id = createFreeComponentId();
    patchTheme((draft) => {
      const base = structuredClone(draft.components.eventLogo);
      const width = 180;
      const height = 120;
      const component: FreeImageComponent = {
        ...base,
        id,
        label: nextFreeComponentLabel("Custom Image"),
        assetId: null,
        x: Math.round((draft.canvas.width - width) / 2),
        y: Math.round((draft.canvas.height - height) / 2),
        width,
        height,
        zIndex: getNextComponentZIndex(draft),
        visible: true
      };
      draft.freeComponents.push(component);
    });
    selectComponent(id);
  }

  function duplicateSelectedFreeComponent() {
    if (!themeResource.data || !selectedEntry || selectedEntry.source !== "free") {
      return;
    }
    const id = createFreeComponentId();
    patchTheme((draft) => {
      const source = draft.freeComponents.find((component) => component.id === selectedEntry.id);
      if (!source) {
        return;
      }
      const copy = structuredClone(source);
      copy.id = id;
      copy.label = `${source.label} Copy`.slice(0, 80);
      copy.x = clamp(source.x + 24, 0, Math.max(0, draft.canvas.width - source.width));
      copy.y = clamp(source.y + 24, 0, Math.max(0, draft.canvas.height - source.height));
      copy.zIndex = getNextComponentZIndex(draft);
      draft.freeComponents.push(copy);
    });
    selectComponent(id);
  }

  function deleteSelectedFreeComponent() {
    if (!selectedEntry || selectedEntry.source !== "free") {
      return;
    }
    if (!window.confirm(`Delete ${selectedEntry.label}?`)) {
      return;
    }
    patchTheme((draft) => {
      draft.freeComponents = draft.freeComponents.filter((component) => component.id !== selectedEntry.id);
    });
    clearSelectionState();
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
  }

  function cycleSelectedPiece(direction: 1 | -1) {
    const ids = selectedSlotConfig.ids;
    if (ids.length === 0) {
      return;
    }

    setSelectAllMode(false);
    setInspectorView("component");

    if (!selected || !isFixedComponentId(selected) || !ids.includes(selected)) {
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

  async function save(options?: { skipBuiltinConfirm?: boolean; skipOnAirConfirm?: boolean; silent?: boolean }) {
    if (!themeResource.data || saving) {
      return false;
    }
    if (themeResource.data.builtin && !options?.skipBuiltinConfirm) {
      const confirmed = window.confirm(
        "You are about to update a built-in theme. This will affect all users of this built-in. Continue?"
      );
      if (!confirmed) {
        return false;
      }
    }
    if (isOnAir && !options?.skipOnAirConfirm && !liveSaveConfirmedRef.current) {
      const confirmed = window.confirm(
        `“${themeResource.data.name}” is on air. Saving updates the live broadcast immediately.\n\nYou won't be asked again while this editor stays open.`
      );
      if (!confirmed) {
        return false;
      }
      liveSaveConfirmedRef.current = true;
    }
    setSaving(true);
    try {
      const saved = await api.saveTheme(themeResource.data);
      themeResource.setData(saved);
      setSavedSnapshot(structuredClone(saved));
      setHistory([structuredClone(saved)]);
      setFuture([]);
      setExternalTheme(null);
      if (!options?.silent) {
        showToast({ kind: "success", message: isOnAir ? "Saved. The live overlay is updated." : "Theme saved." });
      }
      return true;
    } catch (error) {
      showToast({
        kind: "error",
        message: `Save failed: ${error instanceof Error ? error.message : "unknown error"}. Your changes are still here.`
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAsCopy() {
    if (!themeResource.data || saving) {
      return;
    }
    setSaving(true);
    try {
      // The server numbers the copy ("… 2") so it never repeats an existing name.
      const clone = await api.createTheme(themeResource.data.id, themeResource.data.name);
      const draft = structuredClone(themeResource.data);
      draft.id = clone.id;
      draft.builtin = false;
      draft.archived = false;
      draft.name = clone.name;
      const saved = await api.saveTheme(draft);
      themeResource.setData(saved);
      setSavedSnapshot(structuredClone(saved));
      setHistory([structuredClone(saved)]);
      setFuture([]);
      setExternalTheme(null);
      showToast({ kind: "success", message: `Saved as “${saved.name}”. The original theme is unchanged.` });
      navigate(`/admin/themes/${saved.id}`);
    } catch (error) {
      showToast({
        kind: "error",
        message: `Save as copy failed: ${error instanceof Error ? error.message : "unknown error"}. Your changes are still here.`
      });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const current = themeResource.data;
    if (!current || publishing || saving) {
      return;
    }
    if (isOnAir) {
      await save();
      return;
    }
    const notes = [
      hasUnsavedChanges ? "Your unsaved changes are saved first." : null,
      current.builtin ? "This is a built-in theme; saving also updates it for every user of it." : null
    ].filter(Boolean);
    const confirmed = window.confirm(
      [`Put “${current.name}” on air?`, "The live overlay switches to this theme immediately, replacing the one on air now.", ...notes].join("\n\n")
    );
    if (!confirmed) {
      return;
    }
    setPublishing(true);
    try {
      if (hasUnsavedChanges || current.builtin) {
        const saved = await save({ skipBuiltinConfirm: true, skipOnAirConfirm: true, silent: true });
        if (!saved) {
          return;
        }
      }
      await api.publishTheme(current.id);
      settings.setData((previous) => (previous ? { ...previous, publishedThemeId: current.id } : previous));
      liveSaveConfirmedRef.current = true;
      showToast({ kind: "success", message: `“${current.name}” is now on air.` });
    } catch (error) {
      showToast({
        kind: "error",
        message: `Publish failed: ${error instanceof Error ? error.message : "unknown error"}. The previous theme is still on air.`
      });
    } finally {
      setPublishing(false);
    }
  }

  function activePieceIds() {
    if (!themeResource.data) {
      return [];
    }
    if (selectAllMode) {
      return listThemeComponentEntries(themeResource.data).map((entry) => entry.id);
    }
    if (selectedIds.length > 0) {
      return selectedIds;
    }
    return selected ? [selected] : [];
  }

  // Arrange commands leave locked pieces where they are.
  function arrangeSelection(run: (draft: ThemeDefinition, ids: string[]) => void) {
    const ids = activePieceIds().filter((pieceId) => !lockedIds.has(pieceId));
    if (ids.length === 0) {
      return;
    }
    patchTheme((draft) => run(draft, ids));
  }

  function toggleLockForSelection() {
    toggleLock(activePieceIds());
  }

  function toggleLock(ids: string[]) {
    if (ids.length === 0) {
      return;
    }
    setLockedIds((current) => {
      const next = new Set(current);
      const lockAll = ids.some((pieceId) => !current.has(pieceId));
      for (const pieceId of ids) {
        if (lockAll) {
          next.add(pieceId);
        } else {
          next.delete(pieceId);
        }
      }
      try {
        window.localStorage.setItem(lockStorageKey(id), JSON.stringify(Array.from(next)));
      } catch {
        // Locks still work for this session when storage is unavailable.
      }
      return next;
    });
  }

  function reloadServerTheme() {
    if (!externalTheme) {
      return;
    }
    if (hasUnsavedChanges && !window.confirm("Discard your draft and load the server version?")) {
      return;
    }
    applyServerTheme(externalTheme);
  }

  function leaveEditor() {
    if (hasUnsavedChanges && !window.confirm("Leave without saving? Your unsaved changes will be lost.")) {
      return;
    }
    navigate("/admin/themes");
  }

  async function uploadAssetIntoTarget(file: File, target: "logo" | "surface" | "concede" | "base" | "winner" | MomentKind) {
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
      if (selectedEntry?.source === "free" && selectedImageComponent) {
        patchSelectedComponent((component) => {
          if (component.kind === "image") {
            component.assetId = asset.id;
          }
        });
        return;
      }
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

    if (target === "timeout" || target === "gameFinished") {
      patchMoments((moments) => {
        moments[target].backgroundImageAssetId = asset.id;
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
        if (document.querySelector("[data-radix-popper-content-wrapper]")) {
          return;
        }
        event.preventDefault();
        clearSelectionState();
        return;
      }

      // Prefer event.code: Alt changes the typed character on macOS. Fall back to the key when no code is given.
      const styleKey = event.code ? event.code.replace(/^Key/, "").toLowerCase() : event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && event.altKey && (styleKey === "c" || styleKey === "v")) {
        event.preventDefault();
        if (styleKey === "c") {
          copySelectedStyle();
        } else {
          pasteStyleToSelection();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedFreeComponent();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && (event.code === "BracketRight" || event.code === "BracketLeft")) {
        event.preventDefault();
        const forward = event.code === "BracketRight";
        reorderSelectedComponent(forward ? (event.shiftKey ? "sendToFront" : "bringForward") : event.shiftKey ? "sendToBack" : "bringBackward");
        return;
      }

      if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey && (event.code === "KeyH" || event.code === "KeyV")) {
        event.preventDefault();
        arrangeSelection((draft, ids) => distributePieces(draft, ids, event.code === "KeyH" ? "x" : "y"));
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "v" || key === "h") {
          event.preventDefault();
          setTool(key === "v" ? "select" : "hand");
          return;
        }
        if (key === "t") {
          event.preventDefault();
          addFreeTextComponent();
          return;
        }
        if (key === "i") {
          event.preventDefault();
          addFreeImageComponent();
          return;
        }
        if (key === "r") {
          event.preventDefault();
          addFreeShapeComponent();
          return;
        }
      }

      if (event.key === "Tab") {
        if (!isCanvasFocusTarget(event.target)) {
          return;
        }
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
  }, [future, history, lockedIds, selectAllMode, selected, selectedIds, selectedSlotConfig.ids, themeResource.data]);

  if (!theme) {
    return (
      <div className="te-shell te-loading" role="status">
        Loading theme…
      </div>
    );
  }

  const eventKind: EventKind | null =
    previewMode === "towel" ? "concede" : previewMode === "base" ? "base" : previewMode === "winner" ? "winner" : null;
  const momentKind: MomentKind | null = previewMode === "timeout" ? "timeout" : previewMode === "finished" ? "gameFinished" : null;
  const momentFrame = momentKind ? resolveMomentFrame(momentKind, theme, theme.components.breakTime.visible) : null;
  const momentTarget: OverlayTarget | null =
    momentKind && momentFrame
      ? {
          id: momentCardId(momentKind),
          rect: { x: momentFrame.x, y: momentFrame.y, width: momentFrame.width, height: momentFrame.height },
          movable: !momentFrame.following,
          resizable: !momentFrame.following,
          label: `${MOMENT_NAMES[momentKind]} card`,
          badge: momentFrame.following ? "Follows centre line" : null,
          onBadgeClick: momentFrame.following ? () => selectComponent("breakTime") : undefined,
          commit: (draft, _start, end) => {
            const card = draft.momentOverlays[momentKind];
            card.x = Math.round(end.x);
            card.y = Math.round(end.y);
            card.width = Math.max(1, Math.round(end.width));
            card.height = Math.max(1, Math.round(end.height));
          }
        }
      : null;
  const eventCard: OverlayTarget | null = (() => {
    if (!eventKind) {
      return null;
    }
    const general = theme.teamEventOverlay.general;
    const followed =
      general.followTarget === "logo"
        ? { id: previewSide === "left" ? "homeTeamLogo" : "awayTeamLogo", component: previewSide === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo, word: "logo" }
        : general.followTarget === "name"
          ? { id: previewSide === "left" ? "homeName" : "awayName", component: previewSide === "left" ? theme.components.homeName : theme.components.awayName, word: "name" }
          : null;
    const following = Boolean(followed && followed.component.visible);
    const rect = resolveEventLabelRect(previewSide, theme, general);
    return {
      id: EVENT_CARD_ID,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      movable: !following,
      resizable: false,
      commit: (draft, start, end) => {
        draft.teamEventOverlay.general.offsetX = Math.round(draft.teamEventOverlay.general.offsetX + (end.x - start.x));
        draft.teamEventOverlay.general.offsetY = Math.round(draft.teamEventOverlay.general.offsetY + (end.y - start.y));
      },
      label: `${eventKind === "concede" ? "Towel" : eventKind === "base" ? "Base" : "Winner"} card`,
      badge: followed
        ? following
          ? `Follows ${previewSide} ${followed.word}`
          : `${followed.word === "logo" ? "Logo" : "Name"} hidden, using own placement`
        : null,
      onBadgeClick: followed && following ? () => selectComponent(followed.id) : undefined
    };
  })();
  const patchEventSettings = (update: (settings: ThemeDefinition["teamEventOverlay"]["concede"]) => void) => {
    if (eventKind) {
      patchTheme((draft) => update(draft.teamEventOverlay[eventKind]));
    }
  };

  const overlayTarget = eventCard ?? momentTarget;
  const centreLineEmpty = !resolveCenterSecondaryPresentation(theme, previewLive).content;
  const arrangeIds = overlaySelected ? [] : activePieceIds();
  const singleSelectedId = arrangeIds.length === 1 ? arrangeIds[0] : null;
  const mirrorPair = singleSelectedId && isFixedComponentId(singleSelectedId) ? mirroredPairForComponent(singleSelectedId) : null;
  const arrangeActions: ArrangeActions | null =
    arrangeIds.length > 0
      ? {
          count: arrangeIds.length,
          reference: arrangeReference,
          setReference: setArrangeReference,
          align: (edge) => arrangeSelection((draft, ids) => alignPieces(draft, ids, edge, arrangeReference)),
          distribute: (axis) => arrangeSelection((draft, ids) => distributePieces(draft, ids, axis)),
          setGap: (axis, gap) => arrangeSelection((draft, ids) => setGapBetween(draft, ids, axis, gap)),
          matchSize: (dimension) => arrangeSelection((draft, ids) => matchPieceSize(draft, ids, dimension)),
          mirror: mirrorPair
            ? {
                label: singleSelectedId === mirrorPair[0] ? "Mirror to right team" : "Mirror to left team",
                run: mirrorSelectedPieceLayout
              }
            : undefined,
          locked: arrangeIds.every((pieceId) => lockedIds.has(pieceId)),
          toggleLock: toggleLockForSelection,
          canReorder: Boolean(singleSelectedId),
          reorder: reorderSelectedComponent,
          duplicate: selectedEntry?.source === "free" && singleSelectedId ? duplicateSelectedFreeComponent : undefined,
          remove: selectedEntry?.source === "free" && singleSelectedId ? deleteSelectedFreeComponent : undefined
        }
      : null;

  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
    <div className="te-shell">
      <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
      <div className="te-canvas-host">
      <ThemeCanvasEditor
        layout="fullscreen"
        lockedIds={lockedIds}
        fitInsets={layersHidden || layersCollapsed ? EDITOR_FIT_INSETS_NO_LAYERS : EDITOR_FIT_INSETS}
        panMode={tool === "hand"}
        theme={theme}
        live={previewLive}
        assets={assets.data ?? []}
        selectedId={overlaySelected ? null : selected}
        selectedIds={overlaySelected ? (overlayTarget ? [overlayTarget.id] : []) : selectedIds}
        overlayTarget={overlayTarget}
        previewTimeout={previewMode === "timeout" ? previewTimeout : null}
        replayChange={replayChange}
        entranceToken={entranceToken}
        overlayKey={overlayKey}
        selectAll={selectAllMode}
        zoom={canvasZoom}
        onZoomChange={setCanvasZoom}
        onSelect={(pieceId, options) => {
          if (overlayTarget && pieceId === overlayTarget.id) {
            setSelectedIds([]);
            setSelected(null);
            setSelectAllMode(false);
            setOverlaySelected(true);
            return;
          }
          selectComponent(pieceId, options);
        }}
        onMarqueeSelect={selectComponents}
        onSelectAll={selectAllComponents}
        onUpdate={updateTheme}
        renderChrome={(canvas) => (
          <>
            <Island className="te-ident">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="te-icon-btn" aria-label="Theme menu">
                    <Menu />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="te-menu" align="start" sideOffset={8}>
                    <DropdownMenu.Item className="te-menu-item" onSelect={leaveEditor}>
                      <ArrowLeft /> Back to themes
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="te-menu-item" onSelect={() => window.open(`/overlay/preview/${theme.id}`, "_blank", "noreferrer")}>
                      <ExternalLink /> Open preview in a new tab
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="te-menu-sep" />
                    <DropdownMenu.Item className="te-menu-item" onSelect={selectAllComponents}>
                      <SquareDashedMousePointer /> Select all pieces
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="te-menu-item" onSelect={centerAllComponents}>
                      <AlignHorizontalJustifyCenter /> Center everything in the frame
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="te-menu-sep" />
                    <DropdownMenu.Item className="te-menu-item" disabled={saving} onSelect={() => void saveAsCopy()}>
                      <Copy /> Save as a copy
                    </DropdownMenu.Item>
                    {externalTheme ? (
                      <DropdownMenu.Item className="te-menu-item" onSelect={reloadServerTheme}>
                        <RefreshCw /> Reload server version
                      </DropdownMenu.Item>
                    ) : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <span className="te-theme-name" title={theme.name}>
                {theme.name}
              </span>
              {isOnAir ? (
                <span className="te-chip te-chip--air">
                  <span className="te-tally" aria-hidden />
                  On air
                </span>
              ) : null}
              {theme.builtin ? <span className="te-chip">Built-in</span> : null}
              <span className={hasUnsavedChanges ? "te-chip te-chip--draft" : "te-chip te-chip--quiet"} role="status">
                {saving ? "Saving…" : hasUnsavedChanges ? (isOnAir ? "Unsaved, not on air yet" : "Unsaved changes") : "Saved"}
              </span>
            </Island>

            <Island className="te-tools" role="toolbar" aria-label="Tools">
              <IconButton label="Select" shortcut="V" pressed={tool === "select"} onClick={() => setTool("select")}>
                <MousePointer2 />
              </IconButton>
              <IconButton label="Hand" shortcut="H" pressed={tool === "hand"} onClick={() => setTool("hand")}>
                <Hand />
              </IconButton>
              <span className="te-sep" aria-hidden />
              <IconButton label="Add text" shortcut="T" onClick={addFreeTextComponent}>
                <Type />
              </IconButton>
              <IconButton label="Add image" shortcut="I" onClick={addFreeImageComponent}>
                <ImageIcon />
              </IconButton>
              <IconButton label="Add shape" shortcut="R" onClick={addFreeShapeComponent}>
                <Square />
              </IconButton>
              <span className="te-sep" aria-hidden />
              <IconButton
                label={canvas.snapSettings.enabled ? "Snapping on" : "Snapping off"}
                shortcut="S"
                pressed={canvas.snapSettings.enabled}
                onClick={() => canvas.setSnapSettings((current) => ({ ...current, enabled: !current.enabled }))}
              >
                <Magnet />
              </IconButton>
              <Popover.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Popover.Trigger asChild>
                      <button type="button" className="te-icon-btn te-icon-btn--narrow" aria-label="Snap options">
                        <ChevronDown />
                      </button>
                    </Popover.Trigger>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="te-tooltip" side="bottom" sideOffset={6}>
                      Snap options
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
                <Popover.Portal>
                  <Popover.Content className="te-popover" side="bottom" align="end" sideOffset={10}>
                    <h3>Snap to</h3>
                    <SnapOptionsPanel settings={canvas.snapSettings} onChange={canvas.setSnapSettings} />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </Island>
            <p className="te-hint">
              {tool === "hand"
                ? "Drag to pan · press V to go back to Select"
                : "Click to select · drag empty canvas to select many · Space-drag pans · right-click for more"}
            </p>

            {externalTheme ? (
              <Island className="te-banner" role="alert">
                <span>This theme was changed somewhere else.</span>
                <button type="button" className="te-text-btn" onClick={reloadServerTheme}>
                  Reload server version
                </button>
                <button type="button" className="te-text-btn" onClick={() => setExternalTheme(null)}>
                  Keep editing
                </button>
              </Island>
            ) : null}

            <div className="te-actions" onContextMenu={(event) => event.stopPropagation()}>
              <a className="te-btn" href={`/overlay/preview/${theme.id}`} target="_blank" rel="noreferrer">
                <ExternalLink /> Preview
              </a>
              <button
                type="button"
                className={isOnAir ? "te-btn te-btn--primary" : "te-btn"}
                onClick={() => void save()}
                disabled={saving || publishing}
                title={isOnAir ? "This theme is on air. Saving updates the live broadcast." : undefined}
              >
                {isOnAir ? <span className="te-tally te-tally--on-primary" aria-hidden /> : null}
                {saving && !publishing ? "Saving…" : isOnAir ? "Save to air" : "Save"}
              </button>
              {isOnAir ? null : (
                <button type="button" className="te-btn te-btn--primary" onClick={() => void publish()} disabled={saving || publishing}>
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              )}
            </div>

            <Island className="te-zoom">
              <IconButton label="Zoom out" shortcut="−" onClick={canvas.zoomOut} disabled={!canvas.canZoomOut}>
                <Minus />
              </IconButton>
              <output className="te-zoom-readout" aria-live="polite" aria-label="Zoom level">
                {canvas.zoomPercent}%
              </output>
              <IconButton label="Zoom in" shortcut="+" onClick={canvas.zoomIn} disabled={!canvas.canZoomIn}>
                <Plus />
              </IconButton>
              <IconButton label="Fit frame" shortcut="0" onClick={canvas.fit}>
                <Maximize />
              </IconButton>
              <IconButton label="Focus selected piece" shortcut="F" onClick={canvas.focusSelected} disabled={!canvas.canFocus}>
                <Crosshair />
              </IconButton>
              <span className="te-sep" aria-hidden />
              <IconButton label="Undo" shortcut="⌘Z" onClick={undo} disabled={history.length <= 1}>
                <Undo2 />
              </IconButton>
              <IconButton label="Redo" shortcut="⌘⇧Z" onClick={redo} disabled={future.length === 0}>
                <Redo2 />
              </IconButton>
            </Island>

            <Island className="te-preview-bar" role="group" aria-label="Preview the overlay as">
              <span className="te-preview-label">Preview as</span>
              <div className="te-preview-modes" role="radiogroup" aria-label="Broadcast state">
                {(
                  [
                    ["live", "Live feed"],
                    ["game", "Game"],
                    ["break", "Break"],
                    ["timeout", "Timeout"],
                    ["finished", "Finished"],
                    ["towel", "Towel"],
                    ["base", "Base"],
                    ["winner", "Winner"]
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={previewMode === mode}
                    className="te-preview-mode"
                    onClick={() => applyPreviewMode(mode)}
                  >
                    {mode === "live" ? <span className={live.data?.sourceStatus === "ok" ? "te-live-dot" : "te-live-dot te-live-dot--off"} aria-hidden /> : null}
                    {label}
                  </button>
                ))}
              </div>
              {eventKind || momentKind ? <span className="te-sep" aria-hidden /> : null}
              {eventKind ? (
                <>
                  <div className="te-preview-modes" role="radiogroup" aria-label="Which team">
                    {(["left", "right"] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        role="radio"
                        aria-checked={previewSide === side}
                        className="te-preview-mode"
                        onClick={() => applyPreviewMode(previewMode, side)}
                      >
                        {side === "left" ? "Left team" : "Right team"}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {eventKind || momentKind ? (
                <IconButton label={previewMode === "timeout" ? "Play the timeout flash" : "Play the entrance again"} onClick={replayPreviewEntrance}>
                  <Play />
                </IconButton>
              ) : null}
              <span className="te-sep" aria-hidden />
              <IconButton
                label="Preview data: scores, clocks, names and logos"
                pressed={propsView === "preview"}
                onClick={() => setPropsView((view) => (view === "preview" ? "auto" : "preview"))}
              >
                <SlidersHorizontal />
              </IconButton>
            </Island>

            <Island className="te-corner">
              <IconButton
                label={`Appearance: ${appearance.preference === "system" ? `system (${appearance.resolved})` : appearance.preference}. Click to change`}
                onClick={() =>
                  appearance.setPreference(appearance.preference === "system" ? "light" : appearance.preference === "light" ? "dark" : "system")
                }
              >
                {appearance.preference === "system" ? <Monitor /> : appearance.preference === "light" ? <Sun /> : <Moon />}
              </IconButton>
              <ShortcutsHelp />
            </Island>
          </>
        )}
      />
      </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="te-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
          {arrangeActions ? (
            <>
              <ArrangeMenuItems actions={arrangeActions} />
              <ContextMenu.Separator className="te-menu-sep" />
              <ContextMenu.Item className="te-menu-item" disabled={!selected} onSelect={copySelectedStyle}>
                <Copy /> <span className="te-menu-label">Copy style</span>
                <kbd className="te-menu-kbd">⌥⌘C</kbd>
              </ContextMenu.Item>
              <ContextMenu.Item className="te-menu-item" disabled={!hasCopiedStyle} onSelect={pasteStyleToSelection}>
                <ClipboardPaste /> <span className="te-menu-label">Paste style</span>
                <kbd className="te-menu-kbd">⌥⌘V</kbd>
              </ContextMenu.Item>
            </>
          ) : (
            <>
              <ContextMenu.Item className="te-menu-item" onSelect={selectAllComponents}>
                <SquareDashedMousePointer /> <span className="te-menu-label">Select all pieces</span>
              </ContextMenu.Item>
              <ContextMenu.Item className="te-menu-item" onSelect={addFreeTextComponent}>
                <Type /> <span className="te-menu-label">Add text</span>
                <kbd className="te-menu-kbd">T</kbd>
              </ContextMenu.Item>
              <ContextMenu.Item className="te-menu-item" onSelect={addFreeImageComponent}>
                <ImageIcon /> <span className="te-menu-label">Add image</span>
                <kbd className="te-menu-kbd">I</kbd>
              </ContextMenu.Item>
              <ContextMenu.Item className="te-menu-item" onSelect={addFreeShapeComponent}>
                <Square /> <span className="te-menu-label">Add shape</span>
                <kbd className="te-menu-kbd">R</kbd>
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
      </ContextMenu.Root>

      {layersCollapsed ? (
        <Island className="te-layers-pill">
          <button type="button" className="te-text-btn" onClick={() => setLayersCollapsed(false)}>
            <PanelRightOpen aria-hidden /> Layers
          </button>
        </Island>
      ) : (
        <aside className="te-island te-layers" aria-label="Layers">
          <LayersPanel
            theme={theme}
            groups={editorRailGroups}
            selectedIds={new Set(selectAllMode ? listThemeComponentEntries(theme).map((entry) => entry.id) : selectedIds.length ? selectedIds : selected ? [selected] : [])}
            lockedIds={lockedIds}
            onSelect={(pieceId, additive) => selectComponent(pieceId, { additive })}
            onToggleVisible={(pieceId) =>
              patchTheme((draft) => {
                const component = getThemeComponent(draft, pieceId);
                if (component) {
                  component.visible = !component.visible;
                }
              })
            }
            onToggleLock={(pieceId) => toggleLock([pieceId])}
            onToggleTeamLogos={(visible) =>
              patchTheme((draft) => {
                draft.components.homeTeamLogo.visible = visible;
                draft.components.awayTeamLogo.visible = visible;
              })
            }
            moments={(["timeout", "gameFinished"] as const).map((kind) => ({
              kind,
              name: `${MOMENT_NAMES[kind]} card`,
              enabled: theme.momentOverlays[kind].enabled,
              placement: theme.momentOverlays[kind].placement,
              selected: overlaySelected && momentKind === kind
            }))}
            onSelectMoment={(kind) => applyPreviewMode(kind === "timeout" ? "timeout" : "finished")}
            onToggleMoment={(kind) => patchMoments((moments) => (moments[kind].enabled = !moments[kind].enabled))}
            onCollapse={() => setLayersCollapsed(true)}
          />
        </aside>
      )}

      <ThemeColorsContext.Provider value={theme.tokens.colors}>
      <aside className="te-island te-props" aria-label="Properties">
        {propsView !== "auto" ? (
          <div className="te-subview">
            <header className="te-subview-head">
              <IconButton label="Back to properties" onClick={() => setPropsView("auto")}>
                <ArrowLeft />
              </IconButton>
              <h2>Preview data</h2>
            </header>
            <div className="te-subview-body">
              <PreviewDataProperties
                data={{
                  enabled: previewEnabled,
                  period: previewPeriod,
                  event: previewEvent,
                  sidesSwitched: previewSidesSwitched,
                  names: previewNameMode,
                  leftLogo: previewLeftLogoMode,
                  rightLogo: previewRightLogoMode,
                  leftScore: previewLeftScore,
                  rightScore: previewRightScore,
                  gameClock: previewGameTimerValue,
                  breakClock: previewBreakTimerValue
                }}
                onChange={(next) => {
                  if (next.enabled !== undefined) setPreviewEnabled(next.enabled);
                  if (next.period !== undefined) setPreviewPeriod(next.period);
                  if (next.event !== undefined) setPreviewEvent(next.event);
                  if (next.sidesSwitched !== undefined) setPreviewSidesSwitched(next.sidesSwitched);
                  if (next.names !== undefined) setPreviewNameMode(next.names);
                  if (next.leftLogo !== undefined) setPreviewLeftLogoMode(next.leftLogo);
                  if (next.rightLogo !== undefined) setPreviewRightLogoMode(next.rightLogo);
                  if (next.leftScore !== undefined) setPreviewLeftScore(next.leftScore);
                  if (next.rightScore !== undefined) setPreviewRightScore(next.rightScore);
                  if (next.gameClock !== undefined) setPreviewGameTimerValue(next.gameClock);
                  if (next.breakClock !== undefined) setPreviewBreakTimerValue(next.breakClock);
                }}
                onReset={() => applyPreviewMode("live")}
              />
            </div>
          </div>
        ) : (
          <>
            {arrangeActions && arrangeActions.count > 1 ? <ArrangePanel actions={arrangeActions} /> : null}
            {overlaySelected && momentKind ? (
              <MomentCardProperties
                theme={theme}
                kind={momentKind}
                assets={assets.data ?? []}
                swatches={themeSwatches(theme)}
                currentRect={momentTarget?.rect ?? null}
                patch={patchMoments}
                onUpload={(file) => void uploadAssetIntoTarget(file, momentKind)}
                onSelectCentreLine={() => selectComponent("breakTime")}
              />
            ) : overlaySelected && eventKind ? (
              <EventOverlayProperties
                theme={theme}
                kind={eventKind}
                side={previewSide}
                assets={assets.data ?? []}
                swatches={Array.from(
                  new Set(
                    listThemeComponentEntries(theme)
                      .flatMap(({ component }) => [component.backgroundColor, component.borderColor, "color" in component ? component.color : ""])
                      .filter((value) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) && !(value.length === 9 && value.toLowerCase().endsWith("00")))
                      .map((value) => value.toLowerCase())
                  )
                ).slice(0, 12)}
                presets={Object.entries(concedePresets).map(([presetId, preset]) => ({ id: presetId, label: preset.label }))}
                patchGeneral={patchOverlayGeneral}
                patchEvent={patchEventSettings}
                patchTeamSwitchMotion={(next) => patchTheme((draft) => Object.assign(draft.motion.teamSwitch, next))}
                onApplyPreset={(presetId) => applyConcedePreset(presetId as keyof typeof concedePresets)}
                onUpload={(file) => void uploadAssetIntoTarget(file, eventKind)}
                onSelectFollowed={() => eventCard?.onBadgeClick?.()}
              />
            ) : selectAllMode ? (
              <p className="te-note">All pieces are selected. Drag any of them to move the whole scoreboard, or use Arrange above.</p>
            ) : selectedIds.length > 1 ? (
              <p className="te-note">
                {selectedIds.length} pieces selected. Arrange applies to all of them; select a single piece to edit its style.
              </p>
            ) : selectedEntry ? (
              <>
              <PieceProperties
                entry={selectedEntry}
                theme={theme}
                assets={assets.data ?? []}
                logoContext={selectedLogoContext}
                canReset={Boolean(savedSnapshot)}
                patch={(update) => patchSelectedComponent(update as (component: ThemeComponent) => void)}
                onUpload={(file, target) => void uploadAssetIntoTarget(file, target)}
                onResetToSaved={resetSelectedPieceToSaved}
                onBringIntoFrame={bringSelectedIntoView}
                onReplayChange={() => setReplayChange({ id: selectedEntry.id, token: Date.now() })}
                onSaveStyle={saveSelectedAsStyle}
                onPlayEntrance={() => setEntranceToken(Date.now())}
                onPreviewLastSeconds={(seconds) => {
                  setPreviewEnabled(true);
                  if (selectedEntry.id === "breakTime") {
                    setPreviewPeriod("BREAK");
                    setPreviewBreakTimerValue(seconds);
                  } else {
                    setPreviewPeriod("GAME");
                    setPreviewGameTimerValue(seconds);
                  }
                }}
                centreLine={
                  selected === "breakTime" ? (
                    <CentreLineProperties
                      line={theme.centerSecondary}
                      moments={theme.momentOverlays}
                      align={theme.components.breakTime.textAlign}
                      swatches={themeSwatches(theme)}
                      notShownNow={centreLineEmpty}
                      patch={(update) => patchTheme((draft) => update(draft.centerSecondary))}
                      onAlign={(value) => patchTheme((draft) => (draft.components.breakTime.textAlign = value))}
                      fit={theme.components.breakTime}
                      onFit={(next) => patchTheme((draft) => Object.assign(draft.components.breakTime, next))}
                      onPreviewBreak={previewLive.period !== "BREAK" && theme.centerSecondary.breakMode !== "hidden" ? () => applyPreviewMode("break") : undefined}
                      onOpenMoment={(kind) => applyPreviewMode(kind === "timeout" ? "timeout" : "finished")}
                    />
                  ) : null
                }
              />
              {arrangeActions ? <ArrangePanel actions={arrangeActions} /> : null}
              </>
            ) : (
              <ThemeProperties
                theme={theme}
                patchTheme={patchTheme}
                layoutPresets={builtinThemes.map((preset) => ({ id: preset.id, name: preset.name }))}
                onSyncTeams={syncTeamSlot}
                onMirrorTeams={mirrorTeamSlotLayout}
                onApplyPreset={applyLayoutPreset}
                onOpenEventOverlay={() => applyPreviewMode("towel")}
                onOpenPreviewData={() => setPropsView("preview")}
                onPlayEntrance={() => setEntranceToken(Date.now())}
                onSelectPieces={(ids) => selectComponents(ids)}
              />
            )}
          </>
        )}
      </aside>
      </ThemeColorsContext.Provider>
    </div>
    </Tooltip.Provider>
  );
}
