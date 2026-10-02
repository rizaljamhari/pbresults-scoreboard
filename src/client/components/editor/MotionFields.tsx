import {
  motionEasingLabels,
  motionEasingValues,
  motionPresetLabels,
  motionPresetValues,
  type MotionPreset,
  type MotionSettings
} from "../../../shared/motion";
import { Field, FieldRow, NumberInput, SelectInput } from "./fields";

const EASING_OPTIONS = motionEasingValues.map((value) => ({ value, label: motionEasingLabels[value] }));

/**
 * The shared motion setting: preset, duration, easing and delay. Used by the centre line, the event cards and the
 * team switch; each says in `durationLabel` what the duration covers.
 */
export function MotionFields({
  name,
  value,
  onChange,
  presets = motionPresetValues,
  durationLabel = "Duration",
  showDelay = true
}: {
  /** Prefix for accessible names, e.g. "Centre line". */
  name: string;
  value: MotionSettings;
  onChange: (next: Partial<MotionSettings>) => void;
  presets?: readonly MotionPreset[];
  durationLabel?: string;
  showDelay?: boolean;
}) {
  const still = value.preset === "none";
  return (
    <>
      <FieldRow>
        <SelectInput
          label="Animation"
          value={value.preset}
          options={presets.map((preset) => ({ value: preset, label: motionPresetLabels[preset] }))}
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
