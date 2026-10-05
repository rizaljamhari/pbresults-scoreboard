import { Eye, EyeOff } from "lucide-react";
import { sweepWidthValues, transitionDirectionValues, type StoredAsset, type ThemeDefinition } from "../../../shared/theme";
import { AssetLibraryPicker } from "../AssetLibraryPicker";
import { MotionFields } from "./MotionFields";
import { ColorInput, Field, FieldRow, NumberInput, PanelSection, SelectInput, SwitchRow, TextInput, useFontOptions } from "./fields";

const SWEEP_WIDTH_LABELS: Record<(typeof sweepWidthValues)[number], string> = {
  full: "Full screen",
  scoreboard: "Scoreboard only"
};

const DIRECTION_LABELS: Record<(typeof transitionDirectionValues)[number], string> = {
  "right-to-left": "Right to left",
  "left-to-right": "Left to right"
};

/** The operator's Show / Hide: the band that sweeps across, and how the contents build in behind it. */
export function TransitionProperties({
  theme,
  patchTheme,
  assets,
  swatches,
  previewVisible,
  onPreview
}: {
  theme: ThemeDefinition;
  patchTheme: (update: (draft: ThemeDefinition) => void) => void;
  assets: StoredAsset[];
  swatches: string[];
  /** Whether the canvas shows the scoreboard; the buttons play Show and Hide on it. */
  previewVisible: boolean;
  onPreview: (visible: boolean) => void;
}) {
  const transition = theme.transition;
  const fontOptions = useFontOptions();
  const set = (update: (draft: ThemeDefinition["transition"]) => void) => patchTheme((draft) => update(draft.transition));
  const fallbackText = theme.centerSecondary.gameText.trim() || theme.name;
  const usesImage = Boolean(transition.bandImageAssetId);

  return (
    <PanelSection title="Show and hide">
      <p className="te-field-hint">
        Plays when the operator presses Show or Hide on Operations. Loading the overlay and Replay entrance still use each piece's own entrance.
      </p>
      <div className="te-button-pair">
        <button type="button" className="te-mini-btn te-play-btn" disabled={previewVisible} onClick={() => onPreview(true)}>
          <Eye aria-hidden />
          Show
        </button>
        <button type="button" className="te-mini-btn te-play-btn" disabled={!previewVisible} onClick={() => onPreview(false)}>
          <EyeOff aria-hidden />
          Hide
        </button>
      </div>
      <SwitchRow
        label="Band sweep"
        hint={transition.enabled ? "A band sweeps across and uncovers the scoreboard, then the contents build in." : "Off: Show plays each piece's entrance, Hide each piece's exit."}
        checked={transition.enabled}
        onChange={(checked) => set((draft) => (draft.enabled = checked))}
      />
      {transition.enabled ? (
        <>
          <FieldRow>
            <SelectInput
              label="Direction"
              value={transition.direction}
              options={transitionDirectionValues.map((value) => ({ value, label: DIRECTION_LABELS[value] }))}
              onChange={(value) => set((draft) => (draft.direction = value))}
            />
            <Field label="Sweep time">
              <NumberInput label="Sweep time" value={transition.sweepMs} min={200} max={3000} step={50} unit="ms" onChange={(value) => set((draft) => (draft.sweepMs = value))} />
            </Field>
          </FieldRow>

          <SelectInput
            label="Sweep width"
            value={transition.sweepWidth}
            options={sweepWidthValues.map((value) => ({ value, label: SWEEP_WIDTH_LABELS[value] }))}
            onChange={(value) => set((draft) => (draft.sweepWidth = value))}
          />
          {transition.sweepWidth === "scoreboard" ? (
            <Field label="Side room" hint="Extra room each side of the scoreboard. 0% keeps the whole sweep inside a tight crop.">
              <NumberInput
                label="Side room"
                value={Math.round(transition.sweepRoom * 1000) / 10}
                min={0}
                max={30}
                step={2.5}
                precision={1}
                unit="%"
                onChange={(value) => set((draft) => (draft.sweepRoom = value / 100))}
              />
            </Field>
          ) : null}
          <p className="te-field-hint">
            {transition.sweepWidth === "full"
              ? "The band crosses the whole screen. Use the overlay full frame in vMix or OBS; a crop would cut the band off."
              : "The band only crosses the scoreboard, with some room each side, so a crop around the scoreboard shows all of it."}
          </p>
          <Field label="Band image" hint="An image from the library fills the band instead of the colour, logo and text.">
            <AssetLibraryPicker
              label="Band image"
              value={transition.bandImageAssetId}
              assets={assets}
              onChange={(value) => set((draft) => (draft.bandImageAssetId = value))}
              triggerClassName="te-select"
            />
          </Field>
          {usesImage ? null : (
            <>
              <ColorInput label="Strip colour" value={transition.bandColor} swatches={swatches} onChange={(value) => set((draft) => (draft.bandColor = value))} />
              <TextInput label="Band text" value={transition.bandText} maxLength={80} placeholder={fallbackText} onChange={(value) => set((draft) => (draft.bandText = value))} />
              <FieldRow>
                <SelectInput label="Band font" value={transition.bandFontFamily} options={fontOptions} onChange={(value) => set((draft) => (draft.bandFontFamily = value))} />
                <ColorInput label="Text colour" value={transition.bandTextColor} swatches={swatches} onChange={(value) => set((draft) => (draft.bandTextColor = value))} />
              </FieldRow>
              <SwitchRow
                label="Event logo on the band"
                hint="Uses the image in the Event logo piece."
                checked={transition.bandShowLogo}
                onChange={(checked) => set((draft) => (draft.bandShowLogo = checked))}
              />
            </>
          )}
          <Field label="Band size" hint="100% just covers the scoreboard with a little room; text and logo scale with it.">
            <NumberInput
              label="Band size"
              value={Math.round(transition.bandScale * 100)}
              min={20}
              max={200}
              step={5}
              unit="%"
              onChange={(value) => set((draft) => (draft.bandScale = value / 100))}
            />
          </Field>
          <ColorInput
            label="Edge colour"
            value={transition.bandEdgeColor}
            swatches={swatches}
            onChange={(value) => set((draft) => (draft.bandEdgeColor = value))}
          />
          <p className="te-field-hint">The narrow block at the band's tail; the scoreboard appears behind it.</p>
          <SwitchRow label="Motion blur" hint="A light sideways blur while the band moves." checked={transition.motionBlur} onChange={(checked) => set((draft) => (draft.motionBlur = checked))} />

          <h3 className="te-group-title">Contents</h3>
          <p className="te-field-hint">Boxes come in with the band. What is in them builds in behind it, in the Build-in order.</p>
          <MotionFields name="Contents" value={transition.contentMotion} onChange={(next) => set((draft) => Object.assign(draft.contentMotion, next))} />
          <h3 className="te-group-title">Logos</h3>
          <MotionFields name="Logos" value={transition.logoMotion} onChange={(next) => set((draft) => Object.assign(draft.logoMotion, next))} />
          <Field label="Contents start" hint="How far through the sweep contents start building in. 100% waits for the band to stop.">
            <NumberInput
              label="Contents start"
              value={transition.contentsStart}
              min={30}
              max={100}
              step={5}
              unit="%"
              onChange={(value) => set((draft) => (draft.contentsStart = value))}
            />
          </Field>
          <FieldRow>
            <Field label="Gap between contents">
              <NumberInput label="Gap between contents" value={transition.contentGapMs} min={0} max={1000} step={10} unit="ms" onChange={(value) => set((draft) => (draft.contentGapMs = value))} />
            </Field>
            <Field label="Centre line intro" hint="Shows the band text first; 0 skips it.">
              <NumberInput
                label="Centre line intro"
                value={transition.centreLineIntroMs}
                min={0}
                max={10000}
                step={100}
                unit="ms"
                onChange={(value) => set((draft) => (draft.centreLineIntroMs = value))}
              />
            </Field>
          </FieldRow>
        </>
      ) : null}
    </PanelSection>
  );
}
