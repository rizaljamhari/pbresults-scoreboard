import { useEffect, useId, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import * as Switch from "@radix-ui/react-switch";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { ChevronRight } from "lucide-react";

/** A collapsible group of properties. Native <details> keeps it keyboard- and screen-reader-friendly. */
export function PanelSection({
  title,
  defaultOpen = true,
  children,
  aside
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <details className="te-section" open={defaultOpen}>
      <summary>
        <ChevronRight className="te-section-chevron" aria-hidden />
        <span className="te-section-title">{title}</span>
        {aside ? <span className="te-section-aside">{aside}</span> : null}
      </summary>
      <div className="te-section-body">{children}</div>
    </details>
  );
}

/** An always-open group with a small plain heading: the default for everyday properties. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="te-group" aria-label={title}>
      <h3 className="te-group-title">{title}</h3>
      <div className="te-group-body">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="te-field">
      <label className="te-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="te-field-hint">{hint}</p> : null}
    </div>
  );
}

/** Two or more fields side by side. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="te-field-row">{children}</div>;
}

/**
 * Numeric input with a short prefix label (X, Y, W…). Edits apply as you type; invalid or empty text is held
 * locally and only committed when it parses.
 */
export function NumberInput({
  label,
  prefix,
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
  precision = 0
}: {
  label: string;
  prefix?: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
}) {
  const format = (next: number) => (precision > 0 ? String(Number(next.toFixed(precision))) : String(Math.round(next)));
  const [text, setText] = useState(format(value));
  useEffect(() => {
    setText(format(value));
  }, [value]);

  function commit(raw: string) {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() === "" || Number.isNaN(parsed)) {
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    onChange(precision > 0 ? Number(clamped.toFixed(precision)) : Math.round(clamped));
  }

  return (
    <label className="te-number" title={label}>
      {prefix ? <span className="te-number-prefix" aria-hidden>{prefix}</span> : null}
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={text}
        step={step}
        min={min}
        max={max}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => setText(format(value))}
        onKeyDown={(event) => {
          // Shift + arrow steps by ten, like the canvas nudge.
          if ((event.key === "ArrowUp" || event.key === "ArrowDown") && event.shiftKey) {
            event.preventDefault();
            commit(String(value + (event.key === "ArrowUp" ? step * 10 : -step * 10)));
          }
        }}
      />
      {unit ? <span className="te-number-unit" aria-hidden>{unit}</span> : null}
    </label>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  maxLength,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} className="te-input" value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  const select = (
    <select id={id} className="te-select" value={value} aria-label={hideLabel ? label : undefined} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return hideLabel ? select : <Field label={label} htmlFor={id}>{select}</Field>;
}

/** Mutually exclusive choice shown as a row of buttons (text or icons). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className="te-segmented"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onChange(next as T);
        }
      }}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={option.icon ? "te-segmented-item te-segmented-item--icon" : "te-segmented-item"}
          aria-label={option.label}
          title={option.icon ? option.label : undefined}
        >
          {option.icon ?? option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function SwitchRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="te-switch-row">
      <label htmlFor={id}>
        {label}
        {hint ? <span className="te-field-hint">{hint}</span> : null}
      </label>
      <Switch.Root id={id} className="te-switch" checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb className="te-switch-thumb" />
      </Switch.Root>
    </div>
  );
}

/** 0–100 percentage with a slider and a number box. */
export function PercentSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={label}>
      <div className="te-slider-row">
        <Slider.Root className="te-slider" min={0} max={100} step={1} value={[value]} onValueChange={([next]) => onChange(next)} aria-label={label}>
          <Slider.Track className="te-slider-track">
            <Slider.Range className="te-slider-range" />
          </Slider.Track>
          <Slider.Thumb className="te-slider-thumb" aria-label={label} />
        </Slider.Root>
        <NumberInput label={label} value={value} min={0} max={100} unit="%" onChange={onChange} />
      </div>
    </Field>
  );
}

function normaliseHex(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/**
 * Colour swatch that opens a picker with alpha, a hex box, and the colours this theme already uses.
 * Theme colours are 6- or 8-digit hex (#rrggbbaa for transparency).
 */
export function ColorInput({
  label,
  value,
  onChange,
  swatches = []
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  swatches?: string[];
}) {
  // Themes may also hold CSS keywords such as "transparent"; those are shown and edited as written.
  const isHex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test((value || "").trim());
  const color = isHex ? normaliseHex(value) : value?.trim().toLowerCase() === "transparent" ? "#00000000" : "#000000";
  const current = (isHex ? color : value || "").toLowerCase();
  const presets = swatches.slice(0, 6);
  const isPreset = presets.some((swatch) => swatch.toLowerCase() === current);

  return (
    <Field label={label}>
      <div className="te-swatch-row" role="group" aria-label={`${label}: colours in this theme`}>
        {presets.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="te-color-swatch te-color-swatch--small"
            aria-label={swatch}
            aria-pressed={swatch.toLowerCase() === current}
            onClick={() => onChange(swatch)}
          >
            <span style={{ background: swatch }} />
          </button>
        ))}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="te-color-swatch te-color-swatch--small te-color-custom"
              aria-label={`${label}: pick a custom colour`}
              aria-pressed={!isPreset}
            >
              <span />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="te-popover te-color-popover" side="right" align="start" sideOffset={10}>
              <HexAlphaColorPicker color={color} onChange={onChange} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <label className="te-number te-color-value">
        <span className="te-color-chip" style={{ background: isHex ? color : value || "transparent" }} aria-hidden />
        {isHex ? (
          <>
            <span className="te-number-prefix" aria-hidden>#</span>
            <HexColorInput aria-label={`${label} hex`} color={color} alpha onChange={onChange} />
          </>
        ) : (
          <input aria-label={`${label} value`} value={value} onChange={(event) => onChange(event.target.value)} />
        )}
      </label>
    </Field>
  );
}
