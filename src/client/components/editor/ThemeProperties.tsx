import { useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import { enterOrderLabels, enterOrderValues } from "../../../shared/motion";
import { DesignSystemProperties } from "./DesignSystemProperties";
import { themeSwatches } from "./PieceProperties";
import type { StoredAsset, ThemeDefinition } from "../../../shared/theme";
import { FontsProperties } from "./FontsProperties";
import { VersionsProperties } from "./VersionsProperties";
import { TransitionProperties } from "./TransitionProperties";
import { ColorInput, Field, FieldRow, Group, NumberInput, PanelSection, SelectInput, SwitchRow, TextInput } from "./fields";

/** What Properties shows when nothing is selected: the theme and its canvas. */
export function ThemeProperties({
  theme,
  patchTheme,
  layoutPresets,
  onSyncTeams,
  onMirrorTeams,
  onApplyPreset,
  onOpenEventOverlay,
  onOpenPreviewData,
  onPlayEntrance,
  previewScoreboardVisible,
  onPreviewScoreboard,
  onSelectPieces,
  assets,
  onUploadFont,
  onAddLibraryFont,
  versions
}: {
  theme: ThemeDefinition;
  patchTheme: (update: (draft: ThemeDefinition) => void) => void;
  layoutPresets: Array<{ id: string; name: string }>;
  onSyncTeams: (direction: "leftToRight" | "rightToLeft") => void;
  onMirrorTeams: (direction: "leftToRight" | "rightToLeft") => void;
  onApplyPreset: (presetId: string) => void;
  onOpenEventOverlay: () => void;
  onOpenPreviewData: () => void;
  /** Plays every piece's entrance on the canvas, built in as on air. */
  onPlayEntrance: () => void;
  /** Whether the canvas shows the scoreboard, and plays Show / Hide on it. */
  previewScoreboardVisible: boolean;
  onPreviewScoreboard: (visible: boolean) => void;
  /** Selects these pieces on the canvas (from a colour's or style's "Select"). */
  onSelectPieces: (pieceIds: string[]) => void;
  assets: StoredAsset[];
  onUploadFont: (file: File) => void;
  onAddLibraryFont: (asset: StoredAsset) => void;
  versions: Omit<Parameters<typeof VersionsProperties>[0], "theme">;
}) {
  const entering = [...Object.values(theme.components), ...theme.freeComponents].filter(
    (component) => component.visible && component.enterMotion.preset !== "none"
  ).length;
  const [presetId, setPresetId] = useState(layoutPresets[0]?.id ?? "");

  return (
    <div className="te-piece">
      <header className="te-piece-head">
        <div className="te-piece-title">
          <h2>Theme</h2>
          <p>Nothing selected. Click a piece on the canvas or in Layers to edit it.</p>
        </div>
      </header>

      <Group title="Theme">
        <TextInput label="Name" value={theme.name} maxLength={80} onChange={(value) => patchTheme((draft) => (draft.name = value))} />
        <Field label="Acronym" hint="Up to 6 letters, shown in front of the name in the theme list, e.g. SL.">
          <input
            className="te-input"
            aria-label="Acronym"
            value={theme.acronym}
            maxLength={6}
            placeholder="SL"
            onChange={(event) => patchTheme((draft) => (draft.acronym = event.target.value.replace(/\s+/g, "").toUpperCase().slice(0, 6)))}
          />
        </Field>
        <TextInput label="Description" value={theme.description} onChange={(value) => patchTheme((draft) => (draft.description = value))} />
      </Group>

      <Group title="Canvas">
        <ColorInput
          label="Canvas background"
          value={theme.canvas.backgroundColor}
          onChange={(value) => patchTheme((draft) => (draft.canvas.backgroundColor = value))}
        />
        <SwitchRow
          label="Show safe area"
          hint="Dashed guide for the area TVs never crop."
          checked={theme.canvas.safeArea}
          onChange={(checked) => patchTheme((draft) => (draft.canvas.safeArea = checked))}
        />
        <SwitchRow
          label="Transparent preview"
          hint="Shows a checkerboard instead of the canvas background in the editor and the preview page. The live overlay always keeps its background."
          checked={theme.canvas.transparentPreview}
          onChange={(checked) => patchTheme((draft) => (draft.canvas.transparentPreview = checked))}
        />
      </Group>

      <DesignSystemProperties theme={theme} swatches={themeSwatches(theme)} patchTheme={patchTheme} onSelectPieces={onSelectPieces} />

      <FontsProperties theme={theme} assets={assets} patchTheme={patchTheme} onUpload={onUploadFont} onAddFromLibrary={onAddLibraryFont} />

      <VersionsProperties theme={theme} {...versions} />

      <PanelSection title="Build-in" defaultOpen={entering > 0}>
        <p className="te-field-hint">
          {entering === 0
            ? "No piece has an entrance yet. Give pieces one under Entrance and exit, then build them in here."
            : `${entering} ${entering === 1 ? "piece enters" : "pieces enter"} when the overlay loads and when the operator plays the entrance.`}
        </p>
        <FieldRow>
          <Field label="Gap between pieces">
            <NumberInput
              label="Gap between pieces"
              value={theme.motion.enterStaggerMs}
              min={0}
              max={2000}
              step={20}
              unit="ms"
              onChange={(value) => patchTheme((draft) => (draft.motion.enterStaggerMs = value))}
            />
          </Field>
          <SelectInput
            label="Order"
            value={theme.motion.enterOrder}
            options={enterOrderValues.map((value) => ({ value, label: enterOrderLabels[value] }))}
            onChange={(value) => patchTheme((draft) => (draft.motion.enterOrder = value))}
          />
        </FieldRow>
        <button type="button" className="te-mini-btn te-play-btn" disabled={entering === 0} onClick={onPlayEntrance}>
          <Play aria-hidden />
          Play entrance
        </button>
      </PanelSection>

      <TransitionProperties
        theme={theme}
        patchTheme={patchTheme}
        assets={assets}
        swatches={themeSwatches(theme)}
        previewVisible={previewScoreboardVisible}
        onPreview={onPreviewScoreboard}
      />

      <PanelSection title="Team layout" defaultOpen={false}>
        <Field label="Copy everything to the other side" hint="Layout, style, visibility and images. The copy is independent afterwards.">
          <div className="te-button-pair">
            <button type="button" className="te-mini-btn" onClick={() => onSyncTeams("leftToRight")}>
              Left → right
            </button>
            <button type="button" className="te-mini-btn" onClick={() => onSyncTeams("rightToLeft")}>
              Right → left
            </button>
          </div>
        </Field>
        <Field label="Mirror positions only" hint="Reflects position, size and spacing across the centre; keeps each side's style.">
          <div className="te-button-pair">
            <button type="button" className="te-mini-btn" onClick={() => onMirrorTeams("leftToRight")}>
              Left → right
            </button>
            <button type="button" className="te-mini-btn" onClick={() => onMirrorTeams("rightToLeft")}>
              Right → left
            </button>
          </div>
        </Field>
        {layoutPresets.length ? (
          <Field label="Start from a built-in layout" hint="Replaces the position, size and visibility of the scoreboard pieces; styles stay. Undo reverts it.">
            <div className="te-asset-row">
              <SelectInput
                label="Built-in layout"
                hideLabel
                value={presetId}
                options={layoutPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
                onChange={setPresetId}
              />
              <button type="button" className="te-mini-btn" onClick={() => onApplyPreset(presetId)} disabled={!presetId}>
                Apply
              </button>
            </div>
          </Field>
        ) : null}
      </PanelSection>

      <nav className="te-subviews" aria-label="More theme settings">
        <button type="button" className="te-subview-link" onClick={onOpenEventOverlay}>
          <span>
            <strong>Event cards</strong>
            <small>Towel, base and winner, edited on the canvas</small>
          </span>
          <ChevronRight aria-hidden />
        </button>
        <button type="button" className="te-subview-link" onClick={onOpenPreviewData}>
          <span>
            <strong>Preview data</strong>
            <small>Scores, clocks and states for the canvas</small>
          </span>
          <ChevronRight aria-hidden />
        </button>
      </nav>
    </div>
  );
}
