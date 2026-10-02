import { AlignCenter, AlignLeft, AlignRight, Link2, Upload } from "lucide-react";
import { fontFamilies, type ColorToken, type StoredAsset, type ThemeDefinition } from "../../../shared/theme";
import { AssetLibraryPicker } from "../AssetLibraryPicker";
import { FillInput } from "./FillInput";
import { StylePicker } from "./DesignSystemProperties";
import { surfaceStyleFields, textStyleFields } from "../../../shared/design";
import { ShadowInput, TextEffectFields } from "./ShadowInput";
import { ColorInput, Field, FieldRow, NumberInput, PanelSection, Segmented, SelectInput, SwitchRow, TextFitFields, TextInput } from "./fields";

export type MomentKind = "timeout" | "gameFinished";

type Moments = ThemeDefinition["momentOverlays"];
type Card = Moments["timeout"] | Moments["gameFinished"];

export const MOMENT_NAMES: Record<MomentKind, string> = {
  timeout: "Timeout",
  gameFinished: "Game finished"
};

const FONT_WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"].map((value) => ({
  value,
  label: { "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra bold", "900": "Black" }[value] as string
}));

/**
 * Properties for a moment card. What triggers it and how it moves are fixed; where it sits and how it looks
 * are the card's own.
 */
export function MomentCardProperties({
  theme,
  kind,
  assets,
  swatches,
  currentRect,
  patch,
  onUpload,
  onSelectCentreLine
}: {
  theme: ThemeDefinition;
  kind: MomentKind;
  assets: StoredAsset[];
  swatches: string[];
  /** Where the card is drawn right now; switching to Free starts from here so the card does not jump. */
  currentRect: { x: number; y: number; width: number; height: number } | null;
  patch: (update: (moments: Moments) => void) => void;
  onUpload: (file: File) => void;
  onSelectCentreLine: () => void;
}) {
  const card: Card = theme.momentOverlays[kind];
  const timeout = theme.momentOverlays.timeout;
  const name = MOMENT_NAMES[kind];
  const set = (update: (draft: Card) => void) => patch((draft) => update(draft[kind]));
  /** Binding props for a colour field: picking a theme colour links the field to it. */
  const bindColor = (field: "color" | "backgroundColor" | "backgroundOverlayColor" | "borderColor") => ({
    tokenId: card.design.tokenBindings[field] ?? null,
    onToken: (token: ColorToken) =>
      set((draft) => {
        draft[field] = token.value;
        draft.design.tokenBindings[field] = token.id;
      })
  });
  const following = card.placement === "centreLine";
  const lineHidden = !theme.components.breakTime.visible;
  const radius = card.borderRadius;

  return (
    <div className="te-piece">
      <header className="te-piece-head">
        <div className="te-piece-title">
          <h2>{name} card</h2>
          <p>{kind === "timeout" ? "Shown when break time jumps up during a break." : "Shown when the feed reports the game ended."}</p>
        </div>
      </header>

      {following && lineHidden ? (
        <p className="te-callout">The centre line is hidden, so this card is hidden too. Show the centre line, or place the card freely.</p>
      ) : null}

      <PanelSection title="This card">
        <SwitchRow label={`Show the ${name.toLowerCase()} card`} checked={card.enabled} onChange={(checked) => set((draft) => (draft.enabled = checked))} />
        <TextInput label="Text" value={card.text} maxLength={60} onChange={(value) => set((draft) => (draft.text = value))} />
        {kind === "timeout" ? (
          <FieldRow>
            <Field label="Shows for">
              <NumberInput
                label="Timeout duration"
                value={timeout.durationMs}
                min={100}
                step={100}
                unit="ms"
                onChange={(value) => patch((draft) => (draft.timeout.durationMs = value))}
              />
            </Field>
            <Field label="When time jumps by">
              <NumberInput
                label="Trigger increase"
                value={timeout.minIncreaseSeconds}
                min={1}
                unit="s"
                onChange={(value) => patch((draft) => (draft.timeout.minIncreaseSeconds = value))}
              />
            </Field>
          </FieldRow>
        ) : (
          <p className="te-field-hint">Appears as the game ends and stays until the next game starts.</p>
        )}
      </PanelSection>

      <PanelSection title="Placement">
        <Field label="Card sits">
          <Segmented
            label="Where the card sits"
            value={card.placement}
            options={[
              { value: "centreLine", label: "On centre line" },
              { value: "free", label: "Free" }
            ]}
            onChange={(value) =>
              set((draft) => {
                if (value === "free" && draft.placement !== "free" && currentRect) {
                  Object.assign(draft, currentRect);
                }
                draft.placement = value;
              })
            }
          />
        </Field>
        {following ? (
          lineHidden ? null : (
            <button type="button" className="te-follow-link" onClick={onSelectCentreLine}>
              <Link2 aria-hidden />
              <span>Sits exactly on the centre line, using its padding. Select it to move the card.</span>
            </button>
          )
        ) : (
          <>
            <Field label="Position" hint="Or drag the card on the canvas.">
              <div className="te-grid-2">
                <NumberInput label="Card X" prefix="X" value={card.x} onChange={(value) => set((draft) => (draft.x = value))} />
                <NumberInput label="Card Y" prefix="Y" value={card.y} onChange={(value) => set((draft) => (draft.y = value))} />
              </div>
            </Field>
            <Field label="Size">
              <div className="te-grid-2">
                <NumberInput label="Card width" prefix="W" value={card.width} min={1} onChange={(value) => set((draft) => (draft.width = value))} />
                <NumberInput label="Card height" prefix="H" value={card.height} min={1} onChange={(value) => set((draft) => (draft.height = value))} />
              </div>
            </Field>
            <Field label="Inner padding">
              <div className="te-grid-2">
                <NumberInput label="Horizontal padding" prefix="↔" value={card.paddingX} min={0} onChange={(value) => set((draft) => (draft.paddingX = value))} />
                <NumberInput label="Vertical padding" prefix="↕" value={card.paddingY} min={0} onChange={(value) => set((draft) => (draft.paddingY = value))} />
              </div>
            </Field>
          </>
        )}
        <SwitchRow
          label="Hide centre line text"
          hint={kind === "timeout" ? "Off: the card covers the break clock. On: the clock is cleared while it shows." : "On: the break clock is cleared while the card shows."}
          checked={card.hideCentreLineContent}
          onChange={(checked) => set((draft) => (draft.hideCentreLineContent = checked))}
        />
      </PanelSection>

      <PanelSection title="Type">
        <StylePicker
          label="Text style"
          styles={theme.styles.text}
          styleId={card.design.textStyleId}
          overrides={card.design.overrides.filter((field) => (textStyleFields as readonly string[]).includes(field))}
          onChoose={(styleId) => set((draft) => (draft.design.textStyleId = styleId))}
          onReset={() => set((draft) => (draft.design.overrides = draft.design.overrides.filter((field) => !(textStyleFields as readonly string[]).includes(field))))}
        />
        <FieldRow>
          <SelectInput
            label="Font"
            value={card.fontFamily}
            options={fontFamilies.map((font) => ({ value: font, label: font }))}
            onChange={(value) => set((draft) => (draft.fontFamily = value))}
          />
          <Field label="Size">
            <NumberInput label="Card font size" value={card.fontSize} min={1} unit="px" onChange={(value) => set((draft) => (draft.fontSize = value))} />
          </Field>
        </FieldRow>
        <FieldRow>
          <SelectInput
            label="Weight"
            value={String(Math.round(card.fontWeight / 100) * 100)}
            options={FONT_WEIGHTS}
            onChange={(value) => set((draft) => (draft.fontWeight = Number(value)))}
          />
          <Field label="Align">
            <Segmented
              label="Card text alignment"
              value={card.textAlign}
              options={[
                { value: "left", label: "Align left", icon: <AlignLeft /> },
                { value: "center", label: "Align centre", icon: <AlignCenter /> },
                { value: "right", label: "Align right", icon: <AlignRight /> }
              ]}
              onChange={(value) => set((draft) => (draft.textAlign = value))}
            />
          </Field>
        </FieldRow>
        <Field label="Letter spacing">
          <NumberInput
            label="Card letter spacing"
            value={card.letterSpacing}
            step={0.1}
            precision={1}
            unit="px"
            onChange={(value) => set((draft) => (draft.letterSpacing = value))}
          />
        </Field>
        <TextFitFields value={card} onChange={(next) => set((draft) => Object.assign(draft, next))} />
        <TextEffectFields value={card} swatches={swatches} onChange={(next) => set((draft) => Object.assign(draft, next))} />
        <ColorInput label="Text colour" value={card.color} swatches={swatches} onChange={(value) => set((draft) => (draft.color = value))} {...bindColor("color")} />
      </PanelSection>

      <PanelSection title="Card">
        <StylePicker
          label="Surface style"
          styles={theme.styles.surface}
          styleId={card.design.surfaceStyleId}
          overrides={card.design.overrides.filter((field) => (surfaceStyleFields as readonly string[]).includes(field))}
          onChoose={(styleId) => set((draft) => (draft.design.surfaceStyleId = styleId))}
          onReset={() => set((draft) => (draft.design.overrides = draft.design.overrides.filter((field) => !(surfaceStyleFields as readonly string[]).includes(field))))}
        />
        <FillInput
          label="Fill"
          color={card.backgroundColor}
          fill={card.fill}
          swatches={swatches}
          onColor={(value) => set((draft) => (draft.backgroundColor = value))}
          {...bindColor("backgroundColor")}
          onFill={(next) => set((draft) => Object.assign(draft.fill, next))}
        />
        <Field label="Background image">
          <div className="te-asset-row">
            <AssetLibraryPicker
              label="Background image"
              value={card.backgroundImageAssetId ?? null}
              assets={assets}
              onChange={(value) => set((draft) => (draft.backgroundImageAssetId = value))}
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
        {card.backgroundImageAssetId ? (
          <FieldRow>
            <Field label="Image fit">
              <Segmented
                label="Background image fit"
                value={card.backgroundImageFit}
                options={[
                  { value: "cover", label: "Fill" },
                  { value: "contain", label: "Fit" },
                  { value: "stretch", label: "Stretch" }
                ]}
                onChange={(value) => set((draft) => (draft.backgroundImageFit = value))}
              />
            </Field>
            <SelectInput
              label="Anchor"
              value={card.backgroundImagePosition}
              options={[
                { value: "center", label: "Centre" },
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" }
              ]}
              onChange={(value) => set((draft) => (draft.backgroundImagePosition = value))}
            />
          </FieldRow>
        ) : null}
        <FillInput
          label="Tint"
          color={card.backgroundOverlayColor}
          fill={card.tintFill}
          swatches={swatches}
          onColor={(value) => set((draft) => (draft.backgroundOverlayColor = value))}
          {...bindColor("backgroundOverlayColor")}
          onFill={(next) => set((draft) => Object.assign(draft.tintFill, next))}
        />
        <Field label="Tint strength">
          <NumberInput
            label="Tint strength"
            value={Math.round(card.backgroundOverlayOpacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(value) => set((draft) => (draft.backgroundOverlayOpacity = value / 100))}
          />
        </Field>
        <ColorInput label="Border" value={card.borderColor} swatches={swatches} onChange={(value) => set((draft) => (draft.borderColor = value))} {...bindColor("borderColor")} />
        <FieldRow>
          <Field label="Border width">
            <NumberInput label="Card border width" value={card.borderWidth} min={0} unit="px" onChange={(value) => set((draft) => (draft.borderWidth = value))} />
          </Field>
          <Field label="Corner radius" hint={following ? "On the centre line the line's corners apply." : undefined}>
            <NumberInput
              label="Card corner radius"
              value={radius[0]}
              min={0}
              unit="px"
              onChange={(value) => set((draft) => (draft.borderRadius = [value, value, value, value]))}
            />
          </Field>
        </FieldRow>
        <ShadowInput label="Shadow" kind="box" value={card.shadow} swatches={swatches} onChange={(value) => set((draft) => (draft.shadow = value))} />
      </PanelSection>

      <PanelSection title="Motion">
        <p className="te-field-hint">
          {kind === "timeout"
            ? `Flashes in, holds and fades out over ${timeout.durationMs} ms. The editor holds it on screen; press Play to see the flash.`
            : "Slides up as the game ends. Motion follows the broadcast rules and is not configurable."}
        </p>
      </PanelSection>
    </div>
  );
}
