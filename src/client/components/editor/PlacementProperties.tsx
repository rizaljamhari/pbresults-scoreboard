import {
  DEFAULT_PLACEMENT_WIDTH,
  designBounds,
  placementPresetLabels,
  placementPresetValues,
  presetPlacement,
  resizedPlacement,
  thinOnAir
} from "../../../shared/placement";
import { fixedComponentLabels, isFixedComponentId } from "../../../shared/themeComponents";
import type { ThemeDefinition } from "../../../shared/theme";
import { Field, NumberInput, PanelSection, SwitchRow } from "./fields";

/**
 * Where the design lands on air. Designers build the scoreboard at a comfortable size; on air it is moved and scaled
 * as one piece. Nothing in the design changes, so switching between Design and On air never loses detail.
 */
export function PlacementProperties({
  theme,
  patchTheme,
  onShowOnAir
}: {
  theme: ThemeDefinition;
  patchTheme: (update: (draft: ThemeDefinition) => void) => void;
  /** Switches the canvas to the On air view. */
  onShowOnAir: () => void;
}) {
  const placement = theme.placement;
  const bounds = designBounds(theme);
  const widthShare = bounds ? (bounds.width * placement.scale) / theme.canvas.width : 1;
  const thin = thinOnAir(theme, (id, label) => (isFixedComponentId(id) ? fixedComponentLabels[id] : label));
  const staying = [...Object.values(theme.components), ...theme.freeComponents].filter((piece) => piece.visible && piece.stayInPlace).length;
  const set = (next: Partial<ThemeDefinition["placement"]>) => patchTheme((draft) => Object.assign(draft.placement, next));

  return (
    <PanelSection title="On-air placement" defaultOpen={false} aside={placement.enabled ? "On" : undefined}>
      <SwitchRow
        label="Place on air"
        hint={
          placement.enabled
            ? "On air, the design moves and scales into the dotted frame. The design itself is not changed."
            : "Design at any size, then set where the scoreboard shows on air and how big."
        }
        checked={placement.enabled}
        onChange={(checked) =>
          patchTheme((draft) => {
            draft.placement.enabled = checked;
            // First time on: start at the top centre, a typical broadcast size.
            const untouched = draft.placement.scale === 1 && draft.placement.offsetX === 0 && draft.placement.offsetY === 0;
            if (checked && untouched) Object.assign(draft.placement, presetPlacement(draft, "top-centre", DEFAULT_PLACEMENT_WIDTH));
          })
        }
      />
      {placement.enabled ? (
        <>
          <Field label="Position">
            <div className="te-preset-grid">
              {placementPresetValues.map((preset) => (
                <button key={preset} type="button" className="te-mini-btn" onClick={() => set(presetPlacement(theme, preset, widthShare))}>
                  {placementPresetLabels[preset]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Size on air" hint="How wide the scoreboard is on air, as a share of the frame. It never grows past the size it was designed at.">
            <NumberInput
              label="Size on air"
              value={Math.round(widthShare * 100)}
              min={5}
              max={100}
              unit="%"
              onChange={(value) => bounds && set(resizedPlacement(theme, ((value / 100) * theme.canvas.width) / bounds.width))}
            />
          </Field>
          <p className="te-field-hint">Or drag the dotted frame on the canvas: its label to move it, its corner to resize it.</p>
          <button type="button" className="te-mini-btn" onClick={onShowOnAir}>
            See it on air
          </button>
          {staying ? (
            <p className="te-field-hint">
              {staying === 1 ? "1 piece stays" : `${staying} pieces stay`} where designed on air (Stay in place on air, in each piece's Advanced).
            </p>
          ) : null}
          {thin.length ? (
            <p className="te-callout">
              Too thin to see on air at this size: {thin.join(", ")}. Their border or outline is under a pixel once scaled down; make it thicker in the
              design.
            </p>
          ) : null}
        </>
      ) : null}
    </PanelSection>
  );
}
