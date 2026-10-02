import { Plus, X } from "lucide-react";
import {
  boxShadowPresets,
  emptyShadowLayer,
  matchShadowPreset,
  parseShadow,
  serializeShadow,
  textShadowPresets,
  type ShadowKind,
  type ShadowLayer
} from "../../../shared/shadow";
import type { ColorToken } from "../../../shared/theme";
import { IconButton } from "./EditorChrome";
import { ColorInput, Field, NumberInput, SelectInput, SwitchRow, TextInput } from "./fields";

const CUSTOM = "custom";

/**
 * Visual editor for a CSS box or text shadow: a preset, then each layer's offset, blur, spread and colour. The value
 * stays a CSS string; one the editor can't read is kept and shown as custom CSS.
 */
export function ShadowInput({
  label,
  kind,
  value,
  swatches,
  onChange
}: {
  label: string;
  kind: ShadowKind;
  value: string;
  swatches: string[];
  onChange: (css: string) => void;
}) {
  const presets = kind === "box" ? boxShadowPresets : textShadowPresets;
  const layers = parseShadow(value, kind);
  const presetId = layers ? matchShadowPreset(layers, kind, presets) ?? CUSTOM : CUSTOM;
  const presetOptions = [
    ...presets.map((preset) => ({ value: preset.id, label: preset.label })),
    ...(presetId === CUSTOM ? [{ value: CUSTOM, label: layers ? "Custom" : "Custom CSS" }] : [])
  ];

  const write = (next: ShadowLayer[]) => onChange(serializeShadow(next, kind));
  const patchLayer = (index: number, patch: Partial<ShadowLayer>) =>
    layers && write(layers.map((layer, current) => (current === index ? { ...layer, ...patch } : layer)));

  return (
    <div className="te-shadow">
      <div className="te-shadow-head">
        <SelectInput
          label={label}
          value={presetId}
          options={presetOptions}
          onChange={(id) => {
            const preset = presets.find((candidate) => candidate.id === id);
            if (preset) {
              write(preset.layers);
            }
          }}
        />
        <span className="te-shadow-sample" aria-hidden>
          {kind === "box" ? <span className="te-shadow-sample-box" style={{ boxShadow: value }} /> : <span style={{ textShadow: value }}>Ag</span>}
        </span>
      </div>

      {layers === null ? (
        <TextInput label={`${label} (CSS)`} value={value} onChange={onChange} />
      ) : (
        layers.map((layer, index) => (
          <fieldset key={index} className="te-shadow-layer">
            <legend className="te-shadow-layer-title">
              {layers.length > 1 ? `Layer ${index + 1}` : "Layer"}
              <IconButton label={`Remove ${label.toLowerCase()} layer ${index + 1}`} onClick={() => write(layers.filter((_, current) => current !== index))}>
                <X />
              </IconButton>
            </legend>
            <div className="te-grid-2">
              <Field label="Across">
                <NumberInput label={`${label} layer ${index + 1}, horizontal offset`} value={layer.x} unit="px" onChange={(x) => patchLayer(index, { x })} />
              </Field>
              <Field label="Down">
                <NumberInput label={`${label} layer ${index + 1}, vertical offset`} value={layer.y} unit="px" onChange={(y) => patchLayer(index, { y })} />
              </Field>
              <Field label="Blur">
                <NumberInput label={`${label} layer ${index + 1}, blur`} value={layer.blur} min={0} unit="px" onChange={(blur) => patchLayer(index, { blur })} />
              </Field>
              {kind === "box" ? (
                <Field label="Spread">
                  <NumberInput label={`${label} layer ${index + 1}, spread`} value={layer.spread} unit="px" onChange={(spread) => patchLayer(index, { spread })} />
                </Field>
              ) : null}
            </div>
            <ColorInput label="Colour" value={layer.color} swatches={swatches} onChange={(color) => patchLayer(index, { color })} />
            {kind === "box" ? <SwitchRow label="Inside the box" checked={layer.inset} onChange={(inset) => patchLayer(index, { inset })} /> : null}
          </fieldset>
        ))
      )}

      {layers !== null ? (
        <button type="button" className="te-mini-btn" onClick={() => write([...layers, { ...emptyShadowLayer, inset: false }])}>
          <Plus aria-hidden />
          {layers.length === 0 ? `Add ${label.toLowerCase()}` : "Add layer"}
        </button>
      ) : null}
    </div>
  );
}

/** Shadow and outline on the letters. Shared by pieces, the centre line, event and moment cards. */
export function TextEffectFields({
  value,
  swatches,
  onChange,
  strokeTokenId = null,
  onStrokeToken
}: {
  value: { textShadow: string; textStrokeWidth: number; textStrokeColor: string };
  swatches: string[];
  onChange: (next: Partial<{ textShadow: string; textStrokeWidth: number; textStrokeColor: string }>) => void;
  /** Theme colour binding for the outline colour. */
  strokeTokenId?: string | null;
  onStrokeToken?: (token: ColorToken) => void;
}) {
  return (
    <>
      <ShadowInput label="Text shadow" kind="text" value={value.textShadow} swatches={swatches} onChange={(textShadow) => onChange({ textShadow })} />
      <Field label="Outline" hint="Drawn outside the letters, so they keep their weight.">
        <NumberInput label="Outline width" value={value.textStrokeWidth} min={0} max={20} step={0.5} precision={1} unit="px" onChange={(textStrokeWidth) => onChange({ textStrokeWidth })} />
      </Field>
      {value.textStrokeWidth > 0 ? (
        <ColorInput
          label="Outline colour"
          value={value.textStrokeColor}
          swatches={swatches}
          onChange={(textStrokeColor) => onChange({ textStrokeColor })}
          tokenId={strokeTokenId}
          onToken={onStrokeToken}
        />
      ) : null}
    </>
  );
}
