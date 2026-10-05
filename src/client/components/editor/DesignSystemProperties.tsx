import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { HexAlphaColorPicker } from "react-colorful";
import { Plus, X } from "lucide-react";
import { createDesignId, designUsage, paletteFromColors, removeDesignItem, type StyledEntry } from "../../../shared/design";
import {
  fontFamilies,
  surfaceStyleDefaults,
  textStyleDefaults,
  type ColorToken,
  type SurfaceStyle,
  type TextStyle,
  type ThemeDefinition
} from "../../../shared/theme";
import { IconButton } from "./EditorChrome";
import { FillInput } from "./FillInput";
import { ColorInput, Field, FieldRow, NumberInput, PanelSection, SelectInput, TextFitFields, useFontOptions } from "./fields";
import { ShadowInput } from "./ShadowInput";
import { confirmAction } from "../../confirm";

const FONT_WEIGHTS = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra bold" },
  { value: "900", label: "Black" }
] as const;

/** "Used by 3 pieces · select": selects the pieces among them on the canvas. */
function UsageLine({ entries, styleCount = 0, onSelect }: { entries: StyledEntry[]; styleCount?: number; onSelect: (pieceIds: string[]) => void }) {
  const pieceIds = entries.flatMap((entry) => (entry.pieceId ? [entry.pieceId] : []));
  const cards = entries.length - pieceIds.length;
  const parts = [
    pieceIds.length ? `${pieceIds.length} ${pieceIds.length === 1 ? "piece" : "pieces"}` : null,
    cards ? `${cards} ${cards === 1 ? "card" : "cards"}` : null,
    styleCount ? `${styleCount} ${styleCount === 1 ? "style" : "styles"}` : null
  ].filter(Boolean);
  return (
    <span className="te-usage">
      {parts.length ? `Used by ${parts.join(", ")}` : "Not used yet"}
      {pieceIds.length ? (
        <button type="button" className="te-text-btn" onClick={() => onSelect(pieceIds)}>
          Select
        </button>
      ) : null}
    </span>
  );
}

function TokenRow({
  token,
  onChange,
  onRemove,
  usage
}: {
  token: ColorToken;
  onChange: (next: Partial<ColorToken>) => void;
  onRemove: () => void;
  usage: ReactNode;
}) {
  return (
    <div className="te-token">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="te-color-swatch te-token-swatch" aria-label={`${token.name}: change colour`}>
            <span style={{ background: token.value }} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="te-popover te-color-popover" side="right" align="start" sideOffset={10}>
            <HexAlphaColorPicker color={token.value} onChange={(value) => onChange({ value })} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <div className="te-token-body">
        <input className="te-input" aria-label="Colour name" value={token.name} maxLength={40} onChange={(event) => onChange({ name: event.target.value })} />
        {usage}
      </div>
      <IconButton label={`Remove ${token.name}`} onClick={onRemove}>
        <X />
      </IconButton>
    </div>
  );
}

/**
 * The theme's design system, shown on the theme panel: named colours, text styles and surface styles. Editing one
 * updates everything linked to it; removing one leaves its users as they look now, unlinked.
 */
export function DesignSystemProperties({
  theme,
  swatches,
  patchTheme,
  onSelectPieces
}: {
  theme: ThemeDefinition;
  swatches: string[];
  patchTheme: (update: (draft: ThemeDefinition) => void) => void;
  onSelectPieces: (pieceIds: string[]) => void;
}) {
  const usage = designUsage(theme);
  const fontOptions = useFontOptions();
  const colors = theme.tokens.colors;
  const remove = async (id: string, name: string) => {
    const users = usage.entries(id).length + usage.styleCount(id);
    if (
      users > 0 &&
      !(await confirmAction({
        title: `Remove “${name}”?`,
        message: `The ${users} ${users === 1 ? "thing" : "things"} using it keep their current look and stop following it.`,
        confirmLabel: "Remove",
        tone: "danger"
      }))
    ) {
      return;
    }
    patchTheme((draft) => Object.assign(draft, removeDesignItem(draft, id)));
  };
  const patchText = (id: string, update: (style: TextStyle) => void) =>
    patchTheme((draft) => {
      const style = draft.styles.text.find((candidate) => candidate.id === id);
      if (style) update(style);
    });
  const patchSurface = (id: string, update: (style: SurfaceStyle) => void) =>
    patchTheme((draft) => {
      const style = draft.styles.surface.find((candidate) => candidate.id === id);
      if (style) update(style);
    });
  const bindStyleColor = <S extends TextStyle | SurfaceStyle>(style: S, field: string, patchStyle: (update: (style: S) => void) => void) => ({
    tokenId: style.tokenBindings[field] ?? null,
    onToken: (token: ColorToken) =>
      patchStyle((draft) => {
        (draft as unknown as Record<string, unknown>)[field] = token.value;
        draft.tokenBindings[field] = token.id;
      })
  });

  return (
    <>
      <PanelSection title="Theme colours" defaultOpen={colors.length > 0}>
        <p className="te-field-hint">Named colours every colour picker offers first. Change one here and everything linked to it follows.</p>
        {colors.map((token) => (
          <TokenRow
            key={token.id}
            token={token}
            onChange={(next) =>
              patchTheme((draft) => {
                const target = draft.tokens.colors.find((candidate) => candidate.id === token.id);
                if (target) Object.assign(target, next);
              })
            }
            onRemove={() => remove(token.id, token.name)}
            usage={<UsageLine entries={usage.entries(token.id)} styleCount={usage.styleCount(token.id)} onSelect={onSelectPieces} />}
          />
        ))}
        <div className="te-button-pair">
          <button
            type="button"
            className="te-mini-btn"
            onClick={() =>
              patchTheme((draft) => {
                draft.tokens.colors.push({ id: createDesignId("color"), name: `Colour ${draft.tokens.colors.length + 1}`, value: "#ffffff" });
              })
            }
          >
            <Plus aria-hidden />
            Add colour
          </button>
          {colors.length === 0 && swatches.length > 0 ? (
            <button type="button" className="te-mini-btn" onClick={() => patchTheme((draft) => (draft.tokens.colors = paletteFromColors(swatches)))}>
              From this theme
            </button>
          ) : null}
        </div>
      </PanelSection>

      <PanelSection title="Text styles" defaultOpen={theme.styles.text.length > 0}>
        <p className="te-field-hint">Reusable type for names, scores, clocks and cards. Pick one in a piece's Text group, or save one from a piece.</p>
        {theme.styles.text.map((style) => (
          <PanelSection key={style.id} title={style.name} defaultOpen={false}>
            <UsageLine entries={usage.entries(style.id)} onSelect={onSelectPieces} />
            <FieldRow>
              <Field label="Name">
                <input className="te-input" aria-label="Text style name" value={style.name} maxLength={40} onChange={(event) => patchText(style.id, (draft) => (draft.name = event.target.value))} />
              </Field>
              <Field label="Size">
                <NumberInput label={`${style.name} font size`} value={style.fontSize} min={1} unit="px" onChange={(value) => patchText(style.id, (draft) => (draft.fontSize = value))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <SelectInput
                label="Font"
                value={style.fontFamily}
                options={fontOptions}
                onChange={(value) => patchText(style.id, (draft) => (draft.fontFamily = value))}
              />
              <SelectInput
                label="Weight"
                value={String(Math.round(style.fontWeight / 100) * 100) as (typeof FONT_WEIGHTS)[number]["value"]}
                options={FONT_WEIGHTS}
                onChange={(value) => patchText(style.id, (draft) => (draft.fontWeight = Number(value)))}
              />
            </FieldRow>
            <FieldRow>
              <Field label="Letter spacing">
                <NumberInput label={`${style.name} letter spacing`} value={style.letterSpacing} step={0.1} precision={1} unit="px" onChange={(value) => patchText(style.id, (draft) => (draft.letterSpacing = value))} />
              </Field>
              <Field label="Line height">
                <NumberInput label={`${style.name} line height`} value={style.lineHeight} step={0.05} precision={2} min={0.5} onChange={(value) => patchText(style.id, (draft) => (draft.lineHeight = value))} />
              </Field>
            </FieldRow>
            <TextFitFields value={style} onChange={(next) => patchText(style.id, (draft) => Object.assign(draft, next))} />
            <ColorInput
              label="Colour"
              value={style.color}
              swatches={swatches}
              onChange={(value) => patchText(style.id, (draft) => (draft.color = value))}
              {...bindStyleColor(style, "color", (update) => patchText(style.id, update))}
            />
            <ShadowInput label="Text shadow" kind="text" value={style.textShadow} swatches={swatches} onChange={(value) => patchText(style.id, (draft) => (draft.textShadow = value))} />
            <button type="button" className="te-mini-btn te-danger-btn" onClick={() => remove(style.id, style.name)}>
              Remove style
            </button>
          </PanelSection>
        ))}
        <button
          type="button"
          className="te-mini-btn te-fill-add"
          onClick={() => patchTheme((draft) => void draft.styles.text.push(textStyleDefaults(createDesignId("text"), `Text style ${draft.styles.text.length + 1}`)))}
        >
          <Plus aria-hidden />
          Add text style
        </button>
      </PanelSection>

      <PanelSection title="Surface styles" defaultOpen={theme.styles.surface.length > 0}>
        <p className="te-field-hint">Reusable boxes: fill, border, corners and shadow for plates, cards and badges.</p>
        {theme.styles.surface.map((style) => (
          <PanelSection key={style.id} title={style.name} defaultOpen={false}>
            <UsageLine entries={usage.entries(style.id)} onSelect={onSelectPieces} />
            <Field label="Name">
              <input className="te-input" aria-label="Surface style name" value={style.name} maxLength={40} onChange={(event) => patchSurface(style.id, (draft) => (draft.name = event.target.value))} />
            </Field>
            <FillInput
              label="Fill"
              color={style.backgroundColor}
              fill={style.fill}
              swatches={swatches}
              onColor={(value) => patchSurface(style.id, (draft) => (draft.backgroundColor = value))}
              onFill={(next) => patchSurface(style.id, (draft) => Object.assign(draft.fill, next))}
              {...bindStyleColor(style, "backgroundColor", (update) => patchSurface(style.id, update))}
            />
            <ColorInput
              label="Border"
              value={style.borderColor}
              swatches={swatches}
              onChange={(value) => patchSurface(style.id, (draft) => (draft.borderColor = value))}
              {...bindStyleColor(style, "borderColor", (update) => patchSurface(style.id, update))}
            />
            <FieldRow>
              <Field label="Border width">
                <NumberInput label={`${style.name} border width`} value={style.borderWidth} min={0} unit="px" onChange={(value) => patchSurface(style.id, (draft) => (draft.borderWidth = value))} />
              </Field>
              <Field label="Corners">
                <NumberInput
                  label={`${style.name} corner radius`}
                  value={style.borderRadius[0]}
                  min={0}
                  unit="px"
                  onChange={(value) => patchSurface(style.id, (draft) => (draft.borderRadius = [value, value, value, value]))}
                />
              </Field>
            </FieldRow>
            <ShadowInput label="Shadow" kind="box" value={style.shadow} swatches={swatches} onChange={(value) => patchSurface(style.id, (draft) => (draft.shadow = value))} />
            <button type="button" className="te-mini-btn te-danger-btn" onClick={() => remove(style.id, style.name)}>
              Remove style
            </button>
          </PanelSection>
        ))}
        <button
          type="button"
          className="te-mini-btn te-fill-add"
          onClick={() => patchTheme((draft) => void draft.styles.surface.push(surfaceStyleDefaults(createDesignId("surface"), `Surface style ${draft.styles.surface.length + 1}`)))}
        >
          <Plus aria-hidden />
          Add surface style
        </button>
      </PanelSection>
    </>
  );
}

/** Style picker for a piece or card: choose, reset changed fields, or save the current look as a new style. */
export function StylePicker({
  label,
  styles,
  styleId,
  overrides,
  onChoose,
  onReset,
  onSave
}: {
  label: string;
  styles: Array<{ id: string; name: string }>;
  styleId: string | null;
  /** Fields changed on this piece while it uses the style. */
  overrides: string[];
  onChoose: (styleId: string | null) => void;
  onReset: () => void;
  onSave?: () => void;
}) {
  return (
    <div className="te-style-picker">
      <div className="te-row">
        <SelectInput
          label={label}
          hideLabel
          value={styleId ?? ""}
          options={[{ value: "", label: styles.length ? `No ${label.toLowerCase()}` : `No ${label.toLowerCase()}s yet` }, ...styles.map((style) => ({ value: style.id, label: style.name }))]}
          onChange={(value) => onChoose(value || null)}
        />
        {onSave ? (
          <button type="button" className="te-mini-btn" title={`Save this look as a new ${label.toLowerCase()} and link it`} onClick={onSave}>
            Save as style
          </button>
        ) : null}
      </div>
      {styleId && overrides.length ? (
        <span className="te-usage">
          {overrides.length} {overrides.length === 1 ? "setting" : "settings"} changed here
          <button type="button" className="te-text-btn" onClick={onReset}>
            Reset to style
          </button>
        </span>
      ) : null}
    </div>
  );
}
