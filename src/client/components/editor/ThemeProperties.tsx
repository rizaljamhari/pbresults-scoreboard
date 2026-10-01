import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ThemeDefinition } from "../../../shared/theme";
import { ColorInput, Field, Group, PanelSection, SelectInput, SwitchRow, TextInput } from "./fields";

/** What Properties shows when nothing is selected: the theme and its canvas. */
export function ThemeProperties({
  theme,
  patchTheme,
  layoutPresets,
  onSyncTeams,
  onMirrorTeams,
  onApplyPreset,
  onOpenEventOverlay,
  onOpenPreviewData
}: {
  theme: ThemeDefinition;
  patchTheme: (update: (draft: ThemeDefinition) => void) => void;
  layoutPresets: Array<{ id: string; name: string }>;
  onSyncTeams: (direction: "leftToRight" | "rightToLeft") => void;
  onMirrorTeams: (direction: "leftToRight" | "rightToLeft") => void;
  onApplyPreset: (presetId: string) => void;
  onOpenEventOverlay: () => void;
  onOpenPreviewData: () => void;
}) {
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
