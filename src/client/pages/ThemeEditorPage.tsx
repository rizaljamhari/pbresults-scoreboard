import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useLiveState, useSettings, useTheme } from "../hooks";
import type { ComponentId, ThemeDefinition } from "../../shared/theme";
import { ThemeCanvasEditor } from "../components/ThemeCanvasEditor";

type EditorMode = "basic" | "advanced";
type InspectorView = "theme" | "component" | "concede";
type SlotId = "left" | "center" | "right";
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

const homeBlockIds: ComponentId[] = ["homeTeamLogo", "homeName", "homeScore"];
const awayBlockIds: ComponentId[] = ["awayScore", "awayName", "awayTeamLogo"];
const centerBlockIds: ComponentId[] = ["gameTime", "breakTime", "eventLogo"];
const mirroredComponentPairs: Array<[ComponentId, ComponentId]> = [
  ["homeTeamLogo", "awayTeamLogo"],
  ["homeName", "awayName"],
  ["homeScore", "awayScore"]
];

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
      placementMode: "center-stamp" as const,
      backgroundColor: "#171311dd",
      borderColor: "#f6f1e8",
      color: "#ffffff",
      fontFamily: "Bebas Neue" as const,
      fontSize: 34,
      fontWeight: 700,
      letterSpacing: 1.5,
      height: 56,
      padding: 10,
      animationPreset: "slide-vertical" as const
    }
  },
  ribbonLight: {
    label: "Light Ribbon",
    values: {
      placementMode: "top-ribbon" as const,
      backgroundColor: "#f6f1e8",
      borderColor: "#111111",
      color: "#111111",
      fontFamily: "Bebas Neue" as const,
      fontSize: 32,
      fontWeight: 700,
      letterSpacing: 1.1,
      height: 48,
      padding: 8,
      animationPreset: "slide-horizontal" as const
    }
  },
  panelAlert: {
    label: "Full Panel",
    values: {
      placementMode: "full-panel" as const,
      backgroundColor: "#181311d6",
      borderColor: "#f0d7b0",
      color: "#fff7ed",
      fontFamily: "Bebas Neue" as const,
      fontSize: 32,
      fontWeight: 700,
      letterSpacing: 1.8,
      height: 64,
      padding: 14,
      animationPreset: "slide-horizontal" as const
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
        {props.unit ? <span className="field-unit">{props.unit}</span> : null}
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
      <div className="color-field">
        <input
          type="color"
          value={normalizePickerColor(props.value)}
          onChange={(event) => props.onChange(mergePickerColor(props.value, event.target.value))}
        />
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
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
          {props.description ? <p className="hint">{props.description}</p> : null}
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
          className={props.selected === id ? "chip-button active" : "chip-button"}
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

export function ThemeEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const themeResource = useTheme(id);
  const assets = useAssets();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const [selected, setSelected] = useState<ComponentId | null>("homeName");
  const [selectedSlot, setSelectedSlot] = useState<SlotId>("left");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<ThemeDefinition[]>([]);
  const [future, setFuture] = useState<ThemeDefinition[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("basic");
  const [inspectorView, setInspectorView] = useState<InspectorView>("component");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [nudgeStep, setNudgeStep] = useState<(typeof nudgePresets)[number]>(1);
  const theme = themeResource.data;

  const selectedEditableComponent = theme && selected ? theme.components[selected] : null;

  const selectedTextComponent = selectedEditableComponent?.kind === "text" ? selectedEditableComponent : null;
  const selectedImageComponent = selectedEditableComponent?.kind === "image" ? selectedEditableComponent : null;
  const selectedIsTeamLogo = selected === "homeTeamLogo" || selected === "awayTeamLogo";
  const selectedSlotConfig = slotConfig[selectedSlot];
  const selectedShortLabel = selected ? componentShortLabels[selected] : "No piece";

  const selectedLogoContext =
    selectedIsTeamLogo && selectedImageComponent
      ? (() => {
          const match = selected === "homeTeamLogo" ? live.data?.displayLeftTeamMatch : live.data?.displayRightTeamMatch;
          const registryAssetId = match?.team?.logoAssetId ?? match?.team?.alternateLogoAssetId ?? null;
          const registryAsset = registryAssetId ? assets.data?.find((asset) => asset.id === registryAssetId) ?? null : null;
          const fallbackAsset = selectedImageComponent.assetId
            ? assets.data?.find((asset) => asset.id === selectedImageComponent.assetId) ?? null
            : null;
          return {
            sideLabel: selected === "homeTeamLogo" ? "Left display team" : "Right display team",
            match,
            registryAsset,
            fallbackAsset,
            effectiveAsset: registryAsset ?? fallbackAsset
          };
        })()
      : null;

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

  function patchConcede(mutator: (concede: ThemeDefinition["concedeState"]) => void) {
    patchTheme((draft) => {
      mutator(draft.concedeState);
    });
  }

  function selectComponent(id: ComponentId) {
    setSelectAllMode(false);
    setSelected(id);
    setSelectedSlot(slotForComponent(id));
    setInspectorView("component");
  }

  function selectSlot(slot: SlotId) {
    setSelectAllMode(false);
    setSelectedSlot(slot);
    if (!selected || !slotConfig[slot].ids.includes(selected)) {
      setSelected(slotConfig[slot].ids[0]);
    }
    setInspectorView("component");
  }

  function selectAllComponents() {
    setSelectAllMode(true);
    setInspectorView("component");
  }

  function applyConcedePreset(presetId: keyof typeof concedePresets) {
    const preset = concedePresets[presetId].values;
    patchConcede((concede) => Object.assign(concede, preset));
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

  async function save() {
    if (!themeResource.data) {
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveTheme(themeResource.data);
      themeResource.setData(saved);
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
    await save();
    await api.publishTheme(themeResource.data.id);
  }

  async function uploadAssetIntoTarget(file: File, target: "logo" | "surface" | "concede") {
    const asset = await api.uploadAsset(file);
    assets.setData([asset, ...(assets.data ?? [])]);

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

    patchConcede((concede) => {
      concede.backgroundImageAssetId = asset.id;
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
      return;
    }
    setHistory([structuredClone(theme)]);
    setFuture([]);
  }, [theme?.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [future, history, themeResource.data]);

  if (!theme) {
    return <section className="panel">Loading theme…</section>;
  }

  const selectedSummaryLabel = selectAllMode ? "All components" : selected ? `${selectedSlotConfig.title} > ${selectedShortLabel}` : "No component";

  return (
    <section className="admin-page panel-stack editor-layout">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Theme Editor</p>
            <h2>{theme.name}</h2>
            <p className="hint">{theme.builtin ? "Built-in template. Save a copy before publishing edits." : "Custom theme draft."}</p>
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
              <button className="secondary-button" onClick={() => navigate("/admin/themes")}>
                Back
              </button>
            </div>

            <div className="editor-header-cluster editor-header-cluster--utility">
              <details className="row-action-menu row-action-menu--header">
                <summary className="secondary-button">Canvas tools</summary>
                <div className="row-action-menu-list">
                  <button className="secondary-button" onClick={() => undo()} disabled={history.length <= 1}>
                    Undo
                  </button>
                  <button className="secondary-button" onClick={() => redo()} disabled={future.length === 0}>
                    Redo
                  </button>
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
                  <button className="secondary-button" onClick={() => setCanvasZoom(1)} disabled={canvasZoom === 1}>
                    Reset zoom
                  </button>
                </div>
              </details>
            </div>

            <div className="editor-header-cluster editor-header-cluster--primary">
              {!theme.builtin ? (
                <>
                  <button className="secondary-button" onClick={() => void save()}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => void publish()}>Publish</button>
                </>
              ) : (
                <button className="secondary-button" onClick={() => void saveAsCopy()}>
                  {saving ? "Saving…" : "Save as Copy"}
                </button>
              )}
              <a className="secondary-button" href={`/overlay/preview/${theme.id}`} target="_blank" rel="noreferrer">
                Open preview
              </a>
            </div>
          </div>
        </div>

        <div className="editor-summary-grid">
          <div className="editor-summary-card">
            <strong>Mode</strong>
            <span>{editorMode === "basic" ? "Operator-friendly" : "Full controls"}</span>
          </div>
          <div className="editor-summary-card">
            <strong>Selected</strong>
            <span>{selectedSummaryLabel}</span>
          </div>
          <div className="editor-summary-card">
            <strong>Canvas</strong>
            <span>
              {theme.canvas.width} x {theme.canvas.height}
            </span>
          </div>
          <div className="editor-summary-card">
            <strong>Concede</strong>
            <span>{theme.concedeState.enabled ? `${theme.concedeState.text} / ${theme.concedeState.durationMs}ms` : "Disabled"}</span>
          </div>
        </div>

        <div className="editor-workspace">
          <div className="canvas-preview-column">
            <div className="canvas-preview-wrapper">
            <ThemeCanvasEditor
              theme={theme}
              live={live.data}
              assets={assets.data ?? []}
              selectedId={selected}
              selectAll={selectAllMode}
              zoom={canvasZoom}
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
                    <button type="button" className="secondary-button" onClick={() => syncTeamSlot("leftToRight")}>
                      Sync left to right
                    </button>
                    <button type="button" className="secondary-button" onClick={() => syncTeamSlot("rightToLeft")}>
                      Sync right to left
                    </button>
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
                    <div className="form-grid two-column-grid">
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
                      <button type="button" className="secondary-button" onClick={bringSelectedIntoView}>
                        Bring into view
                      </button>
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
                      <div className="nudge-controls">
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
                                <span className="hint">2. fallback asset from this theme</span>
                                <span className="hint">Registry asset: {selectedLogoContext.registryAsset?.originalName ?? "none"}</span>
                                <span className="hint">Fallback asset: {selectedLogoContext.fallbackAsset?.originalName ?? "none"}</span>
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
                          {selectedIsTeamLogo ? <p className="hint">Team logos pull from `/admin/teams` first. Use the fallback only when no live match resolves.</p> : null}
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
                <SectionCard title="Team Overlay" description="Configure the concede overlay that renders inside the affected team panel." defaultOpen>
                  <div className="preset-button-row">
                    {Object.entries(concedePresets).map(([presetId, preset]) => (
                      <button
                        key={presetId}
                        type="button"
                        className="secondary-button"
                        onClick={() => applyConcedePreset(presetId as keyof typeof concedePresets)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="form-grid">
                    <label className="checkbox">
                      <input type="checkbox" checked={theme.concedeState.enabled} onChange={(event) => patchConcede((concede) => (concede.enabled = event.target.checked))} />
                      Enabled
                    </label>
                    <TextField label="Text" value={theme.concedeState.text} onChange={(value) => patchConcede((concede) => (concede.text = value))} />
                    <label>
                      Placement
                      <select
                        value={theme.concedeState.placementMode}
                        onChange={(event) =>
                          patchConcede(
                            (concede) =>
                              (concede.placementMode = event.target.value as "full-panel" | "center-stamp" | "top-ribbon")
                          )
                        }
                      >
                        <option value="center-stamp">center-stamp</option>
                        <option value="top-ribbon">top-ribbon</option>
                        <option value="full-panel">full-panel</option>
                      </select>
                    </label>
                    <label>
                      Position
                      <select
                        value={theme.concedeState.position}
                        onChange={(event) => patchConcede((concede) => (concede.position = event.target.value as "above" | "overlapping-top"))}
                      >
                        <option value="above">above</option>
                        <option value="overlapping-top">overlapping-top</option>
                      </select>
                    </label>
                    <label>
                      Animation
                      <select
                        value={theme.concedeState.animationPreset}
                        onChange={(event) =>
                          patchConcede(
                            (concede) =>
                              (concede.animationPreset = event.target.value as "slide-horizontal" | "slide-vertical" | "none")
                          )
                        }
                      >
                        <option value="slide-vertical">slide-vertical</option>
                        <option value="slide-horizontal">slide-horizontal</option>
                        <option value="none">none</option>
                      </select>
                    </label>
                    <NumberField label="Duration" unit="ms" value={theme.concedeState.durationMs} onChange={(value) => patchConcede((concede) => (concede.durationMs = value))} />
                    <ColorField
                      label="Background"
                      value={theme.concedeState.backgroundColor}
                      onChange={(value) => patchConcede((concede) => (concede.backgroundColor = value))}
                    />
                    <ColorField
                      label="Text color"
                      value={theme.concedeState.color}
                      onChange={(value) => patchConcede((concede) => (concede.color = value))}
                    />
                    <NumberField label="Font size" unit="px" value={theme.concedeState.fontSize} onChange={(value) => patchConcede((concede) => (concede.fontSize = value))} />
                    <label>
                      Background asset
                      <select
                        value={theme.concedeState.backgroundImageAssetId ?? ""}
                        onChange={(event) => patchConcede((concede) => (concede.backgroundImageAssetId = event.target.value || null))}
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
                      Upload concede asset
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

                {editorMode === "advanced" ? (
                  <>
                    <SectionCard title="Layout and timing" description="Fine placement and size controls for the team-state overlay." defaultOpen={false}>
                      <div className="form-grid">
                        <NumberField label="Offset X" unit="px" value={theme.concedeState.offsetX} onChange={(value) => patchConcede((concede) => (concede.offsetX = value))} />
                        <NumberField label="Offset Y" unit="px" value={theme.concedeState.offsetY} onChange={(value) => patchConcede((concede) => (concede.offsetY = value))} />
                        <NumberField label="Height" unit="px" value={theme.concedeState.height} onChange={(value) => patchConcede((concede) => (concede.height = value))} />
                        <NumberField label="Padding" unit="px" value={theme.concedeState.padding} onChange={(value) => patchConcede((concede) => (concede.padding = value))} />
                        <NumberField label="Border width" unit="px" value={theme.concedeState.borderWidth} onChange={(value) => patchConcede((concede) => (concede.borderWidth = value))} />
                        <NumberField label="Border radius" unit="px" value={theme.concedeState.borderRadius} onChange={(value) => patchConcede((concede) => (concede.borderRadius = value))} />
                      </div>
                    </SectionCard>

                    <SectionCard title="Surface and typography" description="Advanced surface and type controls for the team-state overlay." defaultOpen={false}>
                      <div className="form-grid">
                        <ColorField
                          label="Border color"
                          value={theme.concedeState.borderColor}
                          onChange={(value) => patchConcede((concede) => (concede.borderColor = value))}
                        />
                        <label>
                          Background fit
                          <select
                            value={theme.concedeState.backgroundImageFit}
                            onChange={(event) =>
                              patchConcede((concede) => (concede.backgroundImageFit = event.target.value as "cover" | "contain" | "stretch"))
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
                            value={theme.concedeState.backgroundImagePosition}
                            onChange={(event) =>
                              patchConcede(
                                (concede) =>
                                  (concede.backgroundImagePosition = event.target.value as "center" | "top" | "bottom" | "left" | "right")
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
                          value={theme.concedeState.backgroundOverlayColor}
                          onChange={(value) => patchConcede((concede) => (concede.backgroundOverlayColor = value))}
                        />
                        <PercentField label="Overlay opacity" value={theme.concedeState.backgroundOverlayOpacity} onChange={(value) => patchConcede((concede) => (concede.backgroundOverlayOpacity = value))} />
                        <label>
                          Font
                          <select
                            value={theme.concedeState.fontFamily}
                            onChange={(event) =>
                              patchConcede(
                                (concede) =>
                                  (concede.fontFamily = event.target.value as ThemeDefinition["components"]["homeName"]["fontFamily"])
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
                        <NumberField
                          label="Font weight"
                          value={theme.concedeState.fontWeight}
                          onChange={(value) => patchConcede((concede) => (concede.fontWeight = value))}
                        />
                        <NumberField
                          label="Letter spacing"
                          unit="px"
                          value={theme.concedeState.letterSpacing}
                          step={0.1}
                          onChange={(value) => patchConcede((concede) => (concede.letterSpacing = value))}
                        />
                        <label>
                          Text align
                          <select
                            value={theme.concedeState.textAlign}
                            onChange={(event) =>
                              patchConcede((concede) => (concede.textAlign = event.target.value as "left" | "center" | "right"))
                            }
                          >
                            <option value="left">left</option>
                            <option value="center">center</option>
                            <option value="right">right</option>
                          </select>
                        </label>
                        <TextField label="Shadow" value={theme.concedeState.shadow} onChange={(value) => patchConcede((concede) => (concede.shadow = value))} />
                      </div>
                    </SectionCard>
                  </>
                ) : null}
              </div>
            ) : null}

            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
