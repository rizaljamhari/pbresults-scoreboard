import { useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Link2, Upload } from "lucide-react";
import type { MotionSettings } from "../../../shared/motion";
import { fontFamilies, type StoredAsset, type ThemeDefinition } from "../../../shared/theme";
import { AssetLibraryPicker } from "../AssetLibraryPicker";
import { FillInput } from "./FillInput";
import { MotionFields } from "./MotionFields";
import { ShadowInput, TextEffectFields } from "./ShadowInput";
import { ColorInput, Field, FieldRow, NumberInput, PanelSection, Segmented, SelectInput, SwitchRow, TextFitFields, TextInput } from "./fields";

export type EventKind = "concede" | "base" | "winner";

type General = ThemeDefinition["teamEventOverlay"]["general"];
type EventSettings = ThemeDefinition["teamEventOverlay"]["concede"];

const EVENT_NAMES: Record<EventKind, string> = {
  concede: "Towel",
  base: "Base",
  winner: "Winner"
};

const FONT_WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"].map((value) => ({
  value,
  label: { "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra bold", "900": "Black" }[value] as string
}));

/**
 * Properties for the event card on the canvas. Settings split into this event's own look and the shared
 * card layout, which is labelled so a shared change is never a surprise.
 */
export function EventOverlayProperties({
  theme,
  kind,
  side,
  assets,
  swatches,
  presets,
  patchGeneral,
  patchEvent,
  patchTeamSwitchMotion,
  onApplyPreset,
  onUpload,
  onSelectFollowed
}: {
  theme: ThemeDefinition;
  kind: EventKind;
  side: "left" | "right";
  assets: StoredAsset[];
  swatches: string[];
  presets: Array<{ id: string; label: string }>;
  patchGeneral: (update: (general: General) => void) => void;
  patchEvent: (update: (settings: EventSettings) => void) => void;
  patchTeamSwitchMotion: (next: Partial<MotionSettings>) => void;
  onApplyPreset: (presetId: string) => void;
  onUpload: (file: File) => void;
  onSelectFollowed: () => void;
}) {
  const general = theme.teamEventOverlay.general;
  const settings = theme.teamEventOverlay[kind];
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const sideName = side === "left" ? "left" : "right";
  const logo = side === "left" ? theme.components.homeTeamLogo : theme.components.awayTeamLogo;
  const name = side === "left" ? theme.components.homeName : theme.components.awayName;
  const followed = general.followTarget === "logo" ? logo : general.followTarget === "name" ? name : null;
  const followFallsBack = followed !== null && !followed.visible;
  const radius = general.borderRadius;

  return (
    <div className="te-piece">
      <header className="te-piece-head">
        <div className="te-piece-title">
          <h2>{EVENT_NAMES[kind]} card</h2>
          <p>Shown over the {sideName} team when the feed reports this event.</p>
        </div>
      </header>

      {!general.enabled ? (
        <p className="te-callout">Event cards are switched off for this theme. Turn them on under “Shared by all events”.</p>
      ) : null}

      <PanelSection title={`${EVENT_NAMES[kind]} only`}>
        <SwitchRow label={`Show the ${EVENT_NAMES[kind].toLowerCase()} card`} checked={settings.enabled} onChange={(checked) => patchEvent((draft) => (draft.enabled = checked))} />
        <TextInput label="Text" value={settings.text} maxLength={60} onChange={(value) => patchEvent((draft) => (draft.text = value))} />
        <ColorInput label="Text colour" value={settings.color} swatches={swatches} onChange={(value) => patchEvent((draft) => (draft.color = value))} />
        <FillInput
          label="Background"
          color={settings.backgroundColor}
          fill={settings.fill}
          swatches={swatches}
          onColor={(value) => patchEvent((draft) => (draft.backgroundColor = value))}
          onFill={(next) => patchEvent((draft) => Object.assign(draft.fill, next))}
        />
        <Field label="Background image">
          <div className="te-asset-row">
            <AssetLibraryPicker
              label="Background image"
              value={settings.backgroundImageAssetId ?? null}
              assets={assets}
              onChange={(value) => patchEvent((draft) => (draft.backgroundImageAssetId = value))}
              onUpload={onUpload}
              triggerClassName="te-select"
            />
            <label className="te-mini-btn" title="Upload an image">
              <Upload aria-hidden />
              <span>Upload</span>
              <input
                hidden
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onUpload(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </Field>
        <FillInput
          label="Tint"
          color={settings.backgroundOverlayColor}
          fill={settings.tintFill}
          swatches={swatches}
          onColor={(value) => patchEvent((draft) => (draft.backgroundOverlayColor = value))}
          onFill={(next) => patchEvent((draft) => Object.assign(draft.tintFill, next))}
        />
        <Field label="Tint strength">
            <NumberInput
              label="Tint strength"
              value={Math.round(settings.backgroundOverlayOpacity * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(value) => patchEvent((draft) => (draft.backgroundOverlayOpacity = value / 100))}
            />
          </Field>
      </PanelSection>

      <PanelSection title="Shared by all events">
        <p className="te-field-hint">Changes here apply to the towel, base and winner cards.</p>
        <SwitchRow label="Event cards" hint="Master switch for every event card in this theme." checked={general.enabled} onChange={(checked) => patchGeneral((draft) => (draft.enabled = checked))} />

        <Field label="Card sits">
          <Segmented
            label="Where the card sits"
            value={general.followTarget}
            options={[
              { value: "logo", label: "On logo" },
              { value: "name", label: "On name" },
              { value: "none", label: "Free" }
            ]}
            onChange={(value) => patchGeneral((draft) => (draft.followTarget = value))}
          />
        </Field>

        {followed ? (
          followFallsBack ? (
            <p className="te-callout">
              The {general.followTarget === "logo" ? "logo" : "team name"} is hidden, so the card uses its own placement below.
            </p>
          ) : (
            <button type="button" className="te-follow-link" onClick={onSelectFollowed}>
              <Link2 aria-hidden />
              <span>
                Sits exactly on the {sideName} team {general.followTarget === "logo" ? "logo" : "name"}. Select it to move the card.
              </span>
            </button>
          )
        ) : null}

        {!followed || followFallsBack ? (
          <>
            <FieldRow>
              <SelectInput
                label="Placement"
                value={general.placementMode}
                options={[
                  { value: "center-stamp", label: "Centre stamp" },
                  { value: "top-ribbon", label: "Top ribbon" },
                  { value: "full-panel", label: "Full team panel" }
                ]}
                onChange={(value) => patchGeneral((draft) => (draft.placementMode = value))}
              />
              <SelectInput
                label="Anchor"
                value={general.position}
                options={[
                  { value: "above", label: "Above the team" },
                  { value: "overlapping-top", label: "Over the top edge" }
                ]}
                onChange={(value) => patchGeneral((draft) => (draft.position = value))}
              />
            </FieldRow>
            <Field label="Offset" hint="Or drag the card on the canvas.">
              <div className="te-grid-2">
                <NumberInput label="Horizontal offset" prefix="X" value={general.offsetX} onChange={(value) => patchGeneral((draft) => (draft.offsetX = value))} />
                <NumberInput label="Vertical offset" prefix="Y" value={general.offsetY} onChange={(value) => patchGeneral((draft) => (draft.offsetY = value))} />
              </div>
            </Field>
            <div className="te-grid-2">
              <Field label="Height">
                <NumberInput label="Card height" value={general.height} min={1} unit="px" onChange={(value) => patchGeneral((draft) => (draft.height = value))} />
              </Field>
              <Field label="Padding">
                <NumberInput label="Card padding" value={general.padding} min={0} unit="px" onChange={(value) => patchGeneral((draft) => (draft.padding = value))} />
              </Field>
            </div>
          </>
        ) : null}

        <FieldRow>
          <SelectInput
            label="Font"
            value={general.fontFamily}
            options={fontFamilies.map((font) => ({ value: font, label: font }))}
            onChange={(value) => patchGeneral((draft) => (draft.fontFamily = value))}
          />
          <Field label="Size">
            <NumberInput label="Card font size" value={general.fontSize} min={1} unit="px" onChange={(value) => patchGeneral((draft) => (draft.fontSize = value))} />
          </Field>
        </FieldRow>
        <FieldRow>
          <SelectInput
            label="Weight"
            value={String(Math.round(general.fontWeight / 100) * 100)}
            options={FONT_WEIGHTS}
            onChange={(value) => patchGeneral((draft) => (draft.fontWeight = Number(value)))}
          />
          <Field label="Align">
            <Segmented
              label="Card text alignment"
              value={general.textAlign}
              options={[
                { value: "left", label: "Align left", icon: <AlignLeft /> },
                { value: "center", label: "Align centre", icon: <AlignCenter /> },
                { value: "right", label: "Align right", icon: <AlignRight /> }
              ]}
              onChange={(value) => patchGeneral((draft) => (draft.textAlign = value))}
            />
          </Field>
        </FieldRow>
        <Field label="Letter spacing">
          <NumberInput label="Card letter spacing" value={general.letterSpacing} step={0.1} precision={1} unit="px" onChange={(value) => patchGeneral((draft) => (draft.letterSpacing = value))} />
        </Field>
        <TextFitFields value={general} onChange={(next) => patchGeneral((draft) => Object.assign(draft, next))} />
        <TextEffectFields value={general} swatches={swatches} onChange={(next) => patchGeneral((draft) => Object.assign(draft, next))} />
        <ColorInput label="Border" value={general.borderColor} swatches={swatches} onChange={(value) => patchGeneral((draft) => (draft.borderColor = value))} />
        <Field label="Border width">
            <NumberInput label="Card border width" value={general.borderWidth} min={0} unit="px" onChange={(value) => patchGeneral((draft) => (draft.borderWidth = value))} />
          </Field>
        <Field label="Corner radius">
          <NumberInput
            label="Card corner radius"
            value={radius[0]}
            min={0}
            unit="px"
            onChange={(value) => patchGeneral((draft) => (draft.borderRadius = [value, value, value, value]))}
          />
        </Field>
        <p className="te-field-hint">Motion repeats while the card is on screen: it comes in, holds, then goes out.</p>
        <MotionFields
          name="Event card"
          value={general.motion}
          durationLabel="Loop length"
          onChange={(next) => patchGeneral((draft) => Object.assign(draft.motion, next))}
        />
        <SwitchRow
          label="Animate team switches"
          hint="Old names and logos leave as the new ones arrive."
          checked={general.teamSwitchEnabled}
          onChange={(checked) => patchGeneral((draft) => (draft.teamSwitchEnabled = checked))}
        />
        {general.teamSwitchEnabled ? (
          <MotionFields
            name="Team switch"
            value={theme.motion.teamSwitch}
            presets={["none", "fade", "scale", "slide-up", "slide-down", "slide-left", "slide-right"]}
            showDelay={false}
            onChange={patchTeamSwitchMotion}
          />
        ) : null}
        <FieldRow>
          <Field label="Background image fit">
            <Segmented
              label="Background image fit"
              value={general.backgroundImageFit}
              options={[
                { value: "cover", label: "Fill" },
                { value: "contain", label: "Fit" },
                { value: "stretch", label: "Stretch" }
              ]}
              onChange={(value) => patchGeneral((draft) => (draft.backgroundImageFit = value))}
            />
          </Field>
          <SelectInput
            label="Anchor"
            value={general.backgroundImagePosition}
            options={[
              { value: "center", label: "Centre" },
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
              { value: "left", label: "Left" },
              { value: "right", label: "Right" }
            ]}
            onChange={(value) => patchGeneral((draft) => (draft.backgroundImagePosition = value))}
          />
        </FieldRow>
        <ShadowInput label="Shadow" kind="box" value={general.shadow} swatches={swatches} onChange={(value) => patchGeneral((draft) => (draft.shadow = value))} />
        {presets.length ? (
          <Field label="Start from a style" hint="Sets shared layout and type, and the towel colours. Undo reverts it.">
            <div className="te-asset-row">
              <SelectInput label="Card style" hideLabel value={presetId} options={presets.map((preset) => ({ value: preset.id, label: preset.label }))} onChange={setPresetId} />
              <button type="button" className="te-mini-btn" onClick={() => onApplyPreset(presetId)} disabled={!presetId}>
                Apply
              </button>
            </div>
          </Field>
        ) : null}
      </PanelSection>
    </div>
  );
}
