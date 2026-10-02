import { useMemo, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, Link2, Play, RotateCcw, Scan, Unlink2, Upload } from "lucide-react";
import { fontFamilies, type LiveTextSettings, type shapeValues, type StoredAsset, type TextEffectSettings, type TextFitSettings, type ThemeDefinition } from "../../../shared/theme";
import { listThemeComponentEntries, type ThemeComponentEntry } from "../../../shared/themeComponents";
import { AssetLibraryPicker } from "../AssetLibraryPicker";
import { VisibleContentImage } from "../VisibleContentImage";
import { IconButton } from "./EditorChrome";
import { pieceName } from "./pieceNames";
import { FillInput } from "./FillInput";
import { MotionFields } from "./MotionFields";
import type { FillSettings } from "../../../shared/fill";
import { ShadowInput, TextEffectFields } from "./ShadowInput";
import { changeMotionPresetLabels, changeMotionPresetValues, exitMotionPresetValues, type MotionSettings } from "../../../shared/motion";
import {
  ColorInput,
  Field,
  FieldRow,
  Group,
  NumberInput,
  PanelSection,
  PercentSlider,
  Segmented,
  SelectInput,
  SwitchRow,
  TextFitFields,
  TextInput
} from "./fields";

type LogoContext = {
  match?: { team?: { canonicalName?: string } | null; status?: string } | null;
  effectiveAsset?: StoredAsset | null;
} | null;

type AnyComponent = ThemeComponentEntry["component"] & Record<string, unknown>;

const FONT_WEIGHTS = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra bold" },
  { value: "900", label: "Black" }
] as const;

const FIT_OPTIONS = [
  { value: "cover", label: "Fill" },
  { value: "contain", label: "Fit" },
  { value: "stretch", label: "Stretch" }
] as const;

const POSITION_OPTIONS = [
  { value: "center", label: "Centre" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
] as const;

const FALLBACK_OPTIONS = [
  { value: "none", label: "Team logo only" },
  { value: "eventLogo", label: "Event logo" },
  { value: "slotFallback", label: "This slot's fallback image" },
  { value: "slotFallbackThenEventLogo", label: "Slot fallback, then event logo" }
] as const;

const FIXED_BINDINGS: Record<string, string> = {
  homeName: "Live: left team name",
  homeTeamLogo: "Live: left team logo",
  homeScore: "Live: left score",
  awayName: "Live: right team name",
  awayTeamLogo: "Live: right team logo",
  awayScore: "Live: right score",
  gameTime: "Live: game clock",
  breakTime: "Live: break clock, or text during play",
  eventLogo: "Theme image"
};

function bindingFor(entry: ThemeComponentEntry) {
  if (entry.source === "fixed") {
    return FIXED_BINDINGS[entry.id] ?? "";
  }
  const component = entry.component as AnyComponent;
  if (component.kind === "text") {
    return component.contentMode === "operator" ? "Operator text, set live on Operations" : "Static text";
  }
  return component.kind === "shape" ? "Shape" : "Image";
}

/** Colours already used in the theme, offered as one-click swatches. */
export function themeSwatches(theme: ThemeDefinition) {
  const colours = new Set<string>();
  for (const { component } of listThemeComponentEntries(theme)) {
    const candidate = component as AnyComponent;
    for (const key of ["color", "backgroundColor", "borderColor"]) {
      const value = candidate[key];
      const fullyTransparent = typeof value === "string" && value.length === 9 && value.toLowerCase().endsWith("00");
      if (typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) && !fullyTransparent) {
        colours.add(value.toLowerCase());
      }
    }
  }
  return Array.from(colours).slice(0, 12);
}

function AssetPicker({
  label,
  value,
  assets,
  onChange,
  onUpload
}: {
  label: string;
  value: string | null;
  assets: StoredAsset[];
  onChange: (value: string | null) => void;
  onUpload?: (file: File) => void;
}) {
  return (
    <Field label={label}>
      <div className="te-asset-row">
        <AssetLibraryPicker label={label} value={value} assets={assets} onChange={onChange} onUpload={onUpload} triggerClassName="te-select" />
        {onUpload ? (
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
        ) : null}
      </div>
    </Field>
  );
}

export function PieceProperties({
  entry,
  theme,
  assets,
  logoContext,
  canReset,
  patch,
  onUpload,
  onResetToSaved,
  onBringIntoFrame,
  onReplayChange,
  onPreviewLastSeconds,
  onPlayEntrance,
  centreLine
}: {
  entry: ThemeComponentEntry;
  theme: ThemeDefinition;
  assets: StoredAsset[];
  logoContext: LogoContext;
  canReset: boolean;
  patch: (update: (component: AnyComponent) => void) => void;
  onUpload: (file: File, target: "logo" | "surface") => void;
  onResetToSaved: () => void;
  onBringIntoFrame: () => void;
  /** Plays this piece's change motion on the canvas. */
  onReplayChange: () => void;
  /** Shows the clock in its last seconds on the canvas. */
  onPreviewLastSeconds: (seconds: number) => void;
  /** Plays the scoreboard's entrance on the canvas. */
  onPlayEntrance: () => void;
  centreLine?: ReactNode;
}) {
  const component = entry.component as AnyComponent;
  const isText = component.kind === "text";
  const isImage = component.kind === "image";
  const isFree = entry.source === "free";
  const isTeamLogo = entry.id === "homeTeamLogo" || entry.id === "awayTeamLogo";
  const swatches = useMemo(() => themeSwatches(theme), [theme]);
  const radius = component.borderRadius as [number, number, number, number];
  const [linkedCorners, setLinkedCorners] = useState(() => radius.every((value) => value === radius[0]));
  const liveText = component as unknown as LiveTextSettings;
  const motion = component as unknown as { enterMotion: MotionSettings; exitMotion: MotionSettings };
  const surface = component as unknown as { fill: FillSettings; tintFill: FillSettings };
  const imageAsset = isImage
    ? logoContext?.effectiveAsset ?? assets.find((asset) => asset.id === component.assetId) ?? null
    : null;

  return (
    <div className="te-piece">
      <header className="te-piece-head">
        <div className="te-piece-title">
          <h2>{pieceName(entry)}</h2>
          <p>{bindingFor(entry)}</p>
        </div>
        <div className="te-piece-actions">
          <IconButton
            label={component.visible ? "Hide on the overlay" : "Show on the overlay"}
            pressed={!component.visible}
            onClick={() => patch((draft) => (draft.visible = !draft.visible))}
          >
            {component.visible ? <Eye /> : <EyeOff />}
          </IconButton>
          <IconButton label="Bring back inside the frame" onClick={onBringIntoFrame}>
            <Scan />
          </IconButton>
          <IconButton label="Reset to last saved" onClick={onResetToSaved} disabled={!canReset}>
            <RotateCcw />
          </IconButton>
        </div>
      </header>

      {isFree ? (
        <Group title="Content">
          <TextInput label="Layer name" value={String(component.label ?? "")} maxLength={80} onChange={(value) => patch((draft) => (draft.label = value))} />
          {isText ? (
            <>
              <Field label="Who sets the text">
                <Segmented
                  label="Who sets the text"
                  value={component.contentMode === "operator" ? "operator" : "static"}
                  options={[
                    { value: "static", label: "Fixed in theme" },
                    { value: "operator", label: "Operator, live" }
                  ]}
                  onChange={(value) => patch((draft) => (draft.contentMode = value))}
                />
              </Field>
              <Field label={component.contentMode === "operator" ? "Default text" : "Text"}>
                {component.multiline ? (
                  <textarea
                    className="te-input te-textarea"
                    rows={3}
                    aria-label="Text"
                    value={String(component.defaultText ?? "")}
                    maxLength={Number(component.maxLength)}
                    onChange={(event) => patch((draft) => (draft.defaultText = event.target.value))}
                  />
                ) : (
                  <input
                    className="te-input"
                    aria-label="Text"
                    value={String(component.defaultText ?? "")}
                    maxLength={Number(component.maxLength)}
                    onChange={(event) => patch((draft) => (draft.defaultText = event.target.value.replace(/[\r\n]+/g, " ")))}
                  />
                )}
              </Field>
              <FieldRow>
                <Field label="Max characters">
                  <NumberInput
                    label="Maximum characters"
                    value={Number(component.maxLength)}
                    min={1}
                    max={500}
                    onChange={(value) =>
                      patch((draft) => {
                        draft.maxLength = value;
                        draft.defaultText = String(draft.defaultText ?? "").slice(0, value);
                      })
                    }
                  />
                </Field>
              </FieldRow>
              <SwitchRow
                label="Allow line breaks"
                checked={Boolean(component.multiline)}
                onChange={(checked) =>
                  patch((draft) => {
                    draft.multiline = checked;
                    if (!checked) {
                      draft.defaultText = String(draft.defaultText ?? "").replace(/[\r\n]+/g, " ");
                    }
                  })
                }
              />
            </>
          ) : null}
        </Group>
      ) : null}

      {/* The centre line's type comes from its break clock and play text styles, set in its own section. */}
      {isText && entry.id !== "breakTime" ? (
        <>
          <Group title="Text">
            <div className="te-row te-row--font">
              <SelectInput
                label="Font"
                hideLabel
                value={String(component.fontFamily) as (typeof fontFamilies)[number]}
                options={fontFamilies.map((font) => ({ value: font, label: font }))}
                onChange={(value) => patch((draft) => (draft.fontFamily = value))}
              />
              <NumberInput label="Font size" value={Number(component.fontSize)} min={1} unit="px" onChange={(value) => patch((draft) => (draft.fontSize = value))} />
            </div>
            <div className="te-row">
              <SelectInput
                label="Weight"
                hideLabel
                value={String(Math.round(Number(component.fontWeight) / 100) * 100) as (typeof FONT_WEIGHTS)[number]["value"]}
                options={FONT_WEIGHTS}
                onChange={(value) => patch((draft) => (draft.fontWeight = Number(value)))}
              />
              <Segmented
                label="Text alignment"
                value={String(component.textAlign) as "left" | "center" | "right"}
                options={[
                  { value: "left", label: "Align left", icon: <AlignLeft /> },
                  { value: "center", label: "Align centre", icon: <AlignCenter /> },
                  { value: "right", label: "Align right", icon: <AlignRight /> }
                ]}
                onChange={(value) => patch((draft) => (draft.textAlign = value))}
              />
            </div>
            <TextFitFields value={component as unknown as TextFitSettings} onChange={(next) => patch((draft) => Object.assign(draft, next))} />
          </Group>
          <ColorInput label="Text colour" value={String(component.color)} swatches={swatches} onChange={(value) => patch((draft) => (draft.color = value))} />
        </>
      ) : null}

      {component.kind === "shape" ? (
        <Group title="Shape">
          <Segmented
            label="Shape"
            value={String(component.shape) as (typeof shapeValues)[number]}
            options={[
              { value: "rectangle", label: "Rectangle" },
              { value: "pill", label: "Pill" },
              { value: "ellipse", label: "Ellipse" }
            ]}
            onChange={(value) => patch((draft) => (draft.shape = value))}
          />
          <Field label="Slant" hint="Leans the shape sideways; positive leans the top to the right.">
            <NumberInput label="Slant" value={Number(component.skewX)} min={-30} max={30} unit="°" onChange={(value) => patch((draft) => (draft.skewX = Math.min(30, Math.max(-30, value))))} />
          </Field>
        </Group>
      ) : null}

      {isText && (entry.id === "homeScore" || entry.id === "awayScore" || isFree) ? (
        <PanelSection title="When it changes" defaultOpen={liveText.changeMotion.preset !== "none"}>
          <p className="te-field-hint">
            {isFree
              ? component.contentMode === "operator"
                ? "Plays when the operator takes new text."
                : "Plays when the text changes."
              : "Plays when the score changes. A team change or side switch uses the team switch instead."}
          </p>
          <MotionFields
            name="Change"
            value={liveText.changeMotion}
            presets={changeMotionPresetValues}
            labels={changeMotionPresetLabels}
            onChange={(next) => patch((draft) => Object.assign(draft.changeMotion as LiveTextSettings["changeMotion"], next))}
          />
          {liveText.changeMotion.preset !== "none" ? (
            <button type="button" className="te-mini-btn te-play-btn" onClick={onReplayChange}>
              <Play aria-hidden />
              Play
            </button>
          ) : null}
        </PanelSection>
      ) : null}

      {isText && (entry.id === "gameTime" || entry.id === "breakTime") ? (
        <PanelSection title="Last seconds" defaultOpen={liveText.clockWarning.belowSeconds > 0}>
          <Field label="Warn from" hint={liveText.clockWarning.belowSeconds > 0 ? "Seconds left when the warning starts." : "0 turns the warning off."}>
            <NumberInput
              label="Warn from, seconds left"
              value={liveText.clockWarning.belowSeconds}
              min={0}
              max={600}
              unit="s"
              onChange={(value) => patch((draft) => ((draft.clockWarning as LiveTextSettings["clockWarning"]).belowSeconds = value))}
            />
          </Field>
          {liveText.clockWarning.belowSeconds > 0 ? (
            <>
              <SwitchRow
                label="Pulse"
                checked={liveText.clockWarning.pulse}
                onChange={(pulse) => patch((draft) => ((draft.clockWarning as LiveTextSettings["clockWarning"]).pulse = pulse))}
              />
              <ColorInput
                label="Warning colour"
                value={liveText.clockWarning.color || String(component.color)}
                swatches={swatches}
                onChange={(value) => patch((draft) => ((draft.clockWarning as LiveTextSettings["clockWarning"]).color = value))}
              />
              <div className="te-button-pair">
                <button type="button" className="te-mini-btn" onClick={() => onPreviewLastSeconds(Math.max(1, liveText.clockWarning.belowSeconds - 1))}>
                  <Play aria-hidden />
                  Preview
                </button>
                {liveText.clockWarning.color ? (
                  <button type="button" className="te-mini-btn" onClick={() => patch((draft) => ((draft.clockWarning as LiveTextSettings["clockWarning"]).color = ""))}>
                    Keep own colour
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </PanelSection>
      ) : null}

      {isImage ? (
        <Group title={isTeamLogo ? "Team logo" : "Image"}>
          {isTeamLogo ? (
            <>
              <div className="te-logo-preview">
                <div className="te-logo-preview-box">
                  {logoContext?.effectiveAsset ? (
                    <VisibleContentImage
                      asset={logoContext.effectiveAsset}
                      alt=""
                      mode={component.imageContentMode as "full-canvas" | "visible-pixels"}
                      paddingPct={Number(component.visibleContentPaddingPct)}
                      fit="contain"
                      position="center"
                    />
                  ) : (
                    <span>No logo resolved</span>
                  )}
                </div>
                <p>
                  {logoContext?.match?.team?.canonicalName
                    ? `Showing ${logoContext.match.team.canonicalName}`
                    : "No team matched yet"}
                </p>
              </div>
              <SelectInput
                label="When the team has no logo, show"
                value={String(component.teamLogoFallbackMode) as (typeof FALLBACK_OPTIONS)[number]["value"]}
                options={FALLBACK_OPTIONS}
                onChange={(value) => patch((draft) => (draft.teamLogoFallbackMode = value))}
              />
            </>
          ) : null}
          <AssetPicker
            label={isTeamLogo ? "Fallback image" : "Image"}
            value={(component.assetId as string | null) ?? null}
            assets={assets}
            onChange={(value) => patch((draft) => (draft.assetId = value))}
            onUpload={(file) => onUpload(file, "logo")}
          />
                      <Field label="Fit">
              <Segmented
                label="Image fit"
                value={String(component.backgroundImageFit) as "cover" | "contain" | "stretch"}
                options={FIT_OPTIONS}
                onChange={(value) => patch((draft) => (draft.backgroundImageFit = value))}
              />
            </Field>
            <SelectInput
              label="Anchor"
              value={String(component.backgroundImagePosition) as (typeof POSITION_OPTIONS)[number]["value"]}
              options={POSITION_OPTIONS}
              onChange={(value) => patch((draft) => (draft.backgroundImagePosition = value))}
            />
          <SwitchRow
            label="Fit to visible pixels"
            hint="Ignores transparent margins in the image file."
            checked={component.imageContentMode === "visible-pixels"}
            onChange={(checked) => patch((draft) => (draft.imageContentMode = checked ? "visible-pixels" : "full-canvas"))}
          />
          {component.imageContentMode === "visible-pixels" ? (
            <Field label="Breathing room" hint={imageAsset?.visibleContent?.status === "ready" ? undefined : "Visible-pixel data is not ready for this image; the whole image is used."}>
              <NumberInput
                label="Breathing room around visible pixels"
                value={Number(component.visibleContentPaddingPct)}
                min={0}
                max={25}
                unit="%"
                onChange={(value) => patch((draft) => (draft.visibleContentPaddingPct = value))}
              />
            </Field>
          ) : null}
        </Group>
      ) : null}

      {centreLine}

      <FillInput
        label="Fill"
        color={String(component.backgroundColor)}
        fill={surface.fill}
        swatches={swatches}
        onColor={(value) => patch((draft) => (draft.backgroundColor = value))}
        onFill={(next) => patch((draft) => Object.assign(draft.fill as FillSettings, next))}
      />

      <Group title="Position and size">
        <div className="te-grid-2">
          <NumberInput label="X position" prefix="X" value={component.x} onChange={(value) => patch((draft) => (draft.x = value))} />
          <NumberInput label="Y position" prefix="Y" value={component.y} onChange={(value) => patch((draft) => (draft.y = value))} />
          <NumberInput label="Width" prefix="W" value={component.width} min={1} onChange={(value) => patch((draft) => (draft.width = value))} />
          <NumberInput label="Height" prefix="H" value={component.height} min={1} onChange={(value) => patch((draft) => (draft.height = value))} />
        </div>
      </Group>
      <PercentSlider label="Opacity" value={Math.round(Number(component.opacity) * 100)} onChange={(value) => patch((draft) => (draft.opacity = value / 100))} />

      <PanelSection title="Background image" defaultOpen={false}>
        <SelectInput
          label="Background image"
          value={component.backgroundImageMode === "asset" ? (component.backgroundImageAssetId ? "asset" : "none") : String(component.backgroundImageMode)}
          options={[
            { value: "none", label: "None" },
            { value: "asset", label: "Image from library" },
            { value: "homeTeamLogo", label: "Left team logo" },
            { value: "awayTeamLogo", label: "Right team logo" }
          ]}
          onChange={(value) =>
            patch((draft) => {
              if (value === "none") {
                draft.backgroundImageMode = "asset";
                draft.backgroundImageAssetId = null;
              } else {
                draft.backgroundImageMode = value as "asset" | "homeTeamLogo" | "awayTeamLogo";
              }
            })
          }
        />
        {component.backgroundImageMode === "asset" ? (
          <AssetPicker
            label="Library image"
            value={(component.backgroundImageAssetId as string | null) ?? null}
            assets={assets}
            onChange={(value) => patch((draft) => (draft.backgroundImageAssetId = value))}
            onUpload={(file) => onUpload(file, "surface")}
          />
        ) : null}
        {component.backgroundImageMode !== "asset" || component.backgroundImageAssetId ? (
          <>
            <Field label="Fit">
              <Segmented
                label="Background fit"
                value={String(component.backgroundImageFit) as "cover" | "contain" | "stretch"}
                options={FIT_OPTIONS}
                onChange={(value) => patch((draft) => (draft.backgroundImageFit = value))}
              />
            </Field>
            <SelectInput
              label="Anchor"
              value={String(component.backgroundImagePosition) as (typeof POSITION_OPTIONS)[number]["value"]}
              options={POSITION_OPTIONS}
              onChange={(value) => patch((draft) => (draft.backgroundImagePosition = value))}
            />
          </>
        ) : null}
      </PanelSection>

      <PanelSection title="Border" defaultOpen={false}>
        <ColorInput label="Colour" value={String(component.borderColor)} swatches={swatches} onChange={(value) => patch((draft) => (draft.borderColor = value))} />
        <Field label="Width">
            <NumberInput label="Border width" value={Number(component.borderWidth)} min={0} unit="px" onChange={(value) => patch((draft) => (draft.borderWidth = value))} />
          </Field>
        <div className="te-field">
          <div className="te-field-label te-field-label--with-action">
            <span>Corner radius</span>
            <IconButton
              label={linkedCorners ? "Set corners separately" : "Use one radius for all corners"}
              pressed={linkedCorners}
              onClick={() => setLinkedCorners((current) => !current)}
            >
              {linkedCorners ? <Link2 /> : <Unlink2 />}
            </IconButton>
          </div>
          {linkedCorners ? (
            <NumberInput
              label="Corner radius, all corners"
              value={radius[0]}
              min={0}
              unit="px"
              onChange={(value) => patch((draft) => (draft.borderRadius = [value, value, value, value]))}
            />
          ) : (
            <div className="te-grid-2">
              {/* Laid out like the box itself; the schema stores corners clockwise (TL, TR, BR, BL). */}
              {([
                { corner: "Top left", index: 0, prefix: "↖" },
                { corner: "Top right", index: 1, prefix: "↗" },
                { corner: "Bottom left", index: 3, prefix: "↙" },
                { corner: "Bottom right", index: 2, prefix: "↘" }
              ] as const).map(({ corner, index, prefix }) => (
                <NumberInput
                  key={corner}
                  label={`Corner radius, ${corner.toLowerCase()}`}
                  prefix={prefix}
                  value={radius[index]}
                  min={0}
                  onChange={(value) =>
                    patch((draft) => {
                      const next = [...(draft.borderRadius as [number, number, number, number])] as [number, number, number, number];
                      next[index] = value;
                      draft.borderRadius = next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Entrance and exit" defaultOpen={motion.enterMotion.preset !== "none" || motion.exitMotion.preset !== "none"}>
        <p className="te-field-hint">Enters when the overlay loads, when it is shown, and when the operator plays the entrance. Exits when it is hidden.</p>
        <Group title="Entrance">
          <MotionFields name="Entrance" value={motion.enterMotion} onChange={(next) => patch((draft) => Object.assign(draft.enterMotion as MotionSettings, next))} />
        </Group>
        <Group title="Exit">
          <MotionFields
            name="Exit"
            value={motion.exitMotion}
            presets={exitMotionPresetValues}
            onChange={(next) => patch((draft) => Object.assign(draft.exitMotion as MotionSettings, next))}
          />
        </Group>
        {motion.enterMotion.preset !== "none" ? (
          <button type="button" className="te-mini-btn te-play-btn" onClick={onPlayEntrance}>
            <Play aria-hidden />
            Play entrance
          </button>
        ) : null}
      </PanelSection>

      <PanelSection title="Shadow" defaultOpen={false}>
        <ShadowInput label="Shadow" kind="box" value={String(component.shadow)} swatches={swatches} onChange={(value) => patch((draft) => (draft.shadow = value))} />
      </PanelSection>

      {isText && entry.id !== "breakTime" ? (
        <PanelSection title="Text effects" defaultOpen={false}>
          <TextEffectFields value={component as unknown as TextEffectSettings} swatches={swatches} onChange={(next) => patch((draft) => Object.assign(draft, next))} />
        </PanelSection>
      ) : null}

      <PanelSection title="Advanced" defaultOpen={false}>
        {isText ? (
          <div className="te-grid-2">
            <Field label="Letter spacing">
              <NumberInput label="Letter spacing" value={Number(component.letterSpacing)} step={0.1} precision={1} unit="px" onChange={(value) => patch((draft) => (draft.letterSpacing = value))} />
            </Field>
            <Field label="Line height">
              <NumberInput label="Line height" value={Number(component.lineHeight)} step={0.05} precision={2} min={0.5} onChange={(value) => patch((draft) => (draft.lineHeight = value))} />
            </Field>
          </div>
        ) : null}
        <Field label="Inner padding">
          <div className="te-grid-2">
            <NumberInput label="Horizontal padding" prefix="↔" value={Number(component.paddingX)} min={0} onChange={(value) => patch((draft) => (draft.paddingX = value))} />
            <NumberInput label="Vertical padding" prefix="↕" value={Number(component.paddingY)} min={0} onChange={(value) => patch((draft) => (draft.paddingY = value))} />
          </div>
        </Field>
        <Field label="Content offset" hint="Moves the content inside its box without moving the box.">
          <div className="te-grid-2">
            <NumberInput label="Horizontal offset" prefix="X" value={Number(component.offsetX)} onChange={(value) => patch((draft) => (draft.offsetX = value))} />
            <NumberInput label="Vertical offset" prefix="Y" value={Number(component.offsetY)} onChange={(value) => patch((draft) => (draft.offsetY = value))} />
          </div>
        </Field>
        <FillInput
          label="Tint over background"
          color={String(component.backgroundOverlayColor)}
          fill={surface.tintFill}
          swatches={swatches}
          onColor={(value) => patch((draft) => (draft.backgroundOverlayColor = value))}
          onFill={(next) => patch((draft) => Object.assign(draft.tintFill as FillSettings, next))}
        />
        <PercentSlider
          label="Tint strength"
          value={Math.round(Number(component.backgroundOverlayOpacity) * 100)}
          onChange={(value) => patch((draft) => (draft.backgroundOverlayOpacity = value / 100))}
        />
      </PanelSection>
    </div>
  );
}
