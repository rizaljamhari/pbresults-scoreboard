import { Plus, X } from "lucide-react";
import { fillTypeLabels, fillTypeValues, gradientCss, gradientFromColor, type FillSettings } from "../../../shared/fill";
import { IconButton } from "./EditorChrome";
import { ColorInput, Field, NumberInput, Segmented } from "./fields";

const TYPE_OPTIONS = fillTypeValues.map((value) => ({ value, label: fillTypeLabels[value] }));

/**
 * A surface's fill: a solid colour (the existing colour field) or a linear or radial gradient with up to 8 stops.
 * Switching to a gradient starts from the solid colour fading to transparent.
 */
export function FillInput({
  label,
  color,
  fill,
  swatches,
  onColor,
  onFill
}: {
  label: string;
  /** The solid colour, used when the fill is solid. */
  color: string;
  fill: FillSettings;
  swatches: string[];
  onColor: (color: string) => void;
  onFill: (next: Partial<FillSettings>) => void;
}) {
  const gradient = gradientCss(fill);
  const setStop = (index: number, patch: Partial<FillSettings["stops"][number]>) =>
    onFill({ stops: fill.stops.map((stop, current) => (current === index ? { ...stop, ...patch } : stop)) });

  return (
    <div className="te-fill">
      <Field label={label}>
        <Segmented
          label={`${label} type`}
          value={fill.type}
          options={TYPE_OPTIONS}
          onChange={(type) => onFill(type !== "solid" && fill.type === "solid" ? { type, stops: gradientFromColor(color) } : { type })}
        />
      </Field>

      {fill.type === "solid" ? (
        <ColorInput label={`${label} colour`} value={color} swatches={swatches} onChange={onColor} />
      ) : (
        <>
          <span className="te-fill-preview" aria-hidden style={{ backgroundImage: gradient ?? undefined }} />
          {fill.type === "linear" ? (
            <Field label="Angle" hint="0° runs bottom to top, 90° left to right, 180° top to bottom.">
              <NumberInput label={`${label} angle`} value={fill.angle} min={0} max={360} step={15} unit="°" onChange={(angle) => onFill({ angle })} />
            </Field>
          ) : null}
          {fill.stops.map((stop, index) => (
            <fieldset key={index} className="te-shadow-layer">
              <legend className="te-shadow-layer-title">
                {`Stop ${index + 1}`}
                {fill.stops.length > 2 ? (
                  <IconButton label={`Remove ${label.toLowerCase()} stop ${index + 1}`} onClick={() => onFill({ stops: fill.stops.filter((_, current) => current !== index) })}>
                    <X />
                  </IconButton>
                ) : null}
              </legend>
              <ColorInput label="Colour" value={stop.color} swatches={swatches} onChange={(value) => setStop(index, { color: value })} />
              <Field label="Position">
                <NumberInput
                  label={`${label} stop ${index + 1} position`}
                  value={Math.round(stop.position * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(value) => setStop(index, { position: Math.min(100, Math.max(0, value)) / 100 })}
                />
              </Field>
            </fieldset>
          ))}
          {fill.stops.length < 8 ? (
            <button
              type="button"
              className="te-mini-btn te-fill-add"
              onClick={() => {
                const last = [...fill.stops].sort((a, b) => a.position - b.position).at(-1);
                onFill({ stops: [...fill.stops, { color: last?.color ?? "#000000", position: 1 }] });
              }}
            >
              <Plus aria-hidden />
              Add stop
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
