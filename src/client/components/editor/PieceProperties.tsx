import { useMemo, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, Link2, RotateCcw, Scan, Unlink2, Upload } from "lucide-react";
import { fontFamilies, type StoredAsset, type ThemeDefinition } from "../../../shared/theme";
import { listThemeComponentEntries, type ThemeComponentEntry } from "../../../shared/themeComponents";
import { AssetLibraryPicker } from "../AssetLibraryPicker";
import { VisibleContentImage } from "../VisibleContentImage";
import { IconButton } from "./EditorChrome";
import { pieceName } from "./pieceNames";
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
  breakTime: "Live: centre line (clock or text)",
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
  return "Image";
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

      {isText ? (
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
          </Group>
          <ColorInput label="Text colour" value={String(component.color)} swatches={swatches} onChange={(value) => patch((draft) => (draft.color = value))} />
        </>
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

      <ColorInput label="Fill" value={String(component.backgroundColor)} swatches={swatches} onChange={(value) => patch((draft) => (draft.backgroundColor = value))} />

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
        <ColorInput label="Tint over background" value={String(component.backgroundOverlayColor)} swatches={swatches} onChange={(value) => patch((draft) => (draft.backgroundOverlayColor = value))} />
        <PercentSlider
          label="Tint strength"
          value={Math.round(Number(component.backgroundOverlayOpacity) * 100)}
          onChange={(value) => patch((draft) => (draft.backgroundOverlayOpacity = value / 100))}
        />
        <TextInput label="Shadow (CSS)" value={String(component.shadow)} placeholder="none" onChange={(value) => patch((draft) => (draft.shadow = value))} />
      </PanelSection>
    </div>
  );
}
