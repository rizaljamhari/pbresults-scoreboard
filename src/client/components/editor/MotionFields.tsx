import { motionEasingLabels, motionEasingValues, motionPresetLabels, motionPresetValues, type MotionEasing } from "../../../shared/motion";
import { Field, FieldRow, NumberInput, SelectInput } from "./fields";

// Long lists are split into short named groups; the stored values are unchanged.
const PRESET_GROUPS: Partial<Record<string, string>> = {
  fade: "Fade and scale",
  scale: "Fade and scale",
  "pop-in": "Fade and scale",
  "slide-up": "Move in",
  "slide-down": "Move in",
  "slide-left": "Move in",
  "slide-right": "Move in",
  "drop-in": "Move in",
  "glide-in": "Move in"
};

const EASING_GROUPS: Record<MotionEasing, string> = {
  "ease-out": "Slows to a stop",
  "expo-out": "Slows to a stop",
  snappy: "Slows to a stop",
  ease: "Other",
  "ease-in-out": "Other",
  "ease-in": "Other",
  linear: "Other"
};

const EASING_OPTIONS = motionEasingValues.map((value) => ({ value, label: motionEasingLabels[value], group: EASING_GROUPS[value] }));

type Motion<P extends string> = { preset: P; durationMs: number; easing: MotionEasing; delayMs: number };

/**
 * The shared motion setting: preset, duration, easing and delay. Used by the centre line, the event cards, the
 * team switch and value changes; each says in `durationLabel` what the duration covers. `presets` and `labels`
 * default to the entrance presets.
 */
export function MotionFields<P extends string>({
  name,
  value,
  onChange,
  presets = motionPresetValues as unknown as readonly P[],
  labels = motionPresetLabels as unknown as Record<P, string>,
  durationLabel = "Duration",
  showDelay = true
}: {
  /** Prefix for accessible names, e.g. "Centre line". */
  name: string;
  value: Motion<P>;
  onChange: (next: Partial<Motion<P>>) => void;
  presets?: readonly P[];
  labels?: Record<P, string>;
  durationLabel?: string;
  showDelay?: boolean;
}) {
  const still = value.preset === ("none" as P);
  return (
    <>
      <FieldRow>
        <SelectInput
          label="Animation"
          value={value.preset}
          options={presets.map((preset) => ({ value: preset, label: labels[preset], group: PRESET_GROUPS[preset] }))}
          onChange={(preset) => onChange({ preset })}
        />
        {still ? null : (
          <Field label={durationLabel}>
            <NumberInput label={`${name} ${durationLabel.toLowerCase()}`} value={value.durationMs} min={0} max={10000} step={50} unit="ms" onChange={(durationMs) => onChange({ durationMs })} />
          </Field>
        )}
      </FieldRow>
      {still ? null : (
        <FieldRow>
          <SelectInput label="Easing" value={value.easing} options={EASING_OPTIONS} onChange={(easing) => onChange({ easing })} />
          {showDelay ? (
            <Field label="Delay">
              <NumberInput label={`${name} delay`} value={value.delayMs} min={0} max={5000} step={50} unit="ms" onChange={(delayMs) => onChange({ delayMs })} />
            </Field>
          ) : null}
        </FieldRow>
      )}
    </>
  );
}
