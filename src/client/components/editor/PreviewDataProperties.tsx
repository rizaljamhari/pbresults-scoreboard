import { RotateCcw } from "lucide-react";
import type { NormalizedLiveState } from "../../../shared/theme";
import { Field, FieldRow, Group, NumberInput, SelectInput, SwitchRow } from "./fields";

export type PreviewNameMode = "live" | "short" | "long";
export type PreviewLogoMode = "live" | "matched" | "missing" | "unmatched";
export type PreviewPeriodMode = "live" | "GAME" | "BREAK";
export type PreviewEventMode = "live" | NormalizedLiveState["teamEvent"];
export type PreviewSwitchMode = "live" | "0" | "1";

export type PreviewData = {
  enabled: boolean;
  period: PreviewPeriodMode;
  event: PreviewEventMode;
  sidesSwitched: PreviewSwitchMode;
  names: PreviewNameMode;
  leftLogo: PreviewLogoMode;
  rightLogo: PreviewLogoMode;
  leftScore: number;
  rightScore: number;
  gameClock: number;
  breakClock: number;
};

const LOGO_OPTIONS: ReadonlyArray<{ value: PreviewLogoMode; label: string }> = [
  { value: "live", label: "Live" },
  { value: "matched", label: "Team logo" },
  { value: "missing", label: "No logo" },
  { value: "unmatched", label: "Unmatched team" }
];

/**
 * Stand-in scoreboard data for designing: long names, missing logos, scores and clocks. Only the canvas uses it;
 * the live overlay never does.
 */
export function PreviewDataProperties({
  data,
  onChange,
  onReset
}: {
  data: PreviewData;
  onChange: (next: Partial<PreviewData>) => void;
  onReset: () => void;
}) {
  const off = !data.enabled;
  return (
    <>
      <SwitchRow
        label="Use preview data"
        hint="Off shows the live feed. Preview as, below the canvas, also turns this on."
        checked={data.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      <fieldset className="te-fieldset" disabled={off}>
        <Group title="Match">
          <FieldRow>
            <SelectInput
              label="Period"
              value={data.period}
              options={[
                { value: "live", label: "Live" },
                { value: "GAME", label: "Game" },
                { value: "BREAK", label: "Break" }
              ]}
              onChange={(period) => onChange({ period })}
            />
            <SelectInput
              label="Event"
              value={data.event}
              options={[
                { value: "live", label: "Live" },
                { value: "none", label: "None" },
                { value: "towel-home", label: "Towel, left" },
                { value: "towel-away", label: "Towel, right" },
                { value: "base-home", label: "Base, left" },
                { value: "base-away", label: "Base, right" }
              ]}
              onChange={(event) => onChange({ event })}
            />
          </FieldRow>
          <FieldRow>
            <SelectInput
              label="Sides switched"
              value={data.sidesSwitched}
              options={[
                { value: "live", label: "Live" },
                { value: "0", label: "No" },
                { value: "1", label: "Yes" }
              ]}
              onChange={(sidesSwitched) => onChange({ sidesSwitched })}
            />
            <SelectInput
              label="Team names"
              value={data.names}
              options={[
                { value: "live", label: "Live" },
                { value: "short", label: "Short" },
                { value: "long", label: "Long" }
              ]}
              onChange={(names) => onChange({ names })}
            />
          </FieldRow>
        </Group>

        <Group title="Logos">
          <FieldRow>
            <SelectInput label="Left logo" value={data.leftLogo} options={LOGO_OPTIONS} onChange={(leftLogo) => onChange({ leftLogo })} />
            <SelectInput label="Right logo" value={data.rightLogo} options={LOGO_OPTIONS} onChange={(rightLogo) => onChange({ rightLogo })} />
          </FieldRow>
        </Group>

        <Group title="Score and clocks">
          <FieldRow>
            <Field label="Left score">
              <NumberInput label="Left score" value={data.leftScore} min={0} onChange={(leftScore) => onChange({ leftScore })} />
            </Field>
            <Field label="Right score">
              <NumberInput label="Right score" value={data.rightScore} min={0} onChange={(rightScore) => onChange({ rightScore })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Game clock">
              <NumberInput label="Game clock in seconds" value={data.gameClock} min={0} unit="s" onChange={(gameClock) => onChange({ gameClock })} />
            </Field>
            <Field label="Break clock">
              <NumberInput label="Break clock in seconds" value={data.breakClock} min={0} unit="s" onChange={(breakClock) => onChange({ breakClock })} />
            </Field>
          </FieldRow>
        </Group>
      </fieldset>

      <button type="button" className="te-mini-btn te-reset-preview" onClick={onReset}>
        <RotateCcw aria-hidden />
        Back to the live feed
      </button>
    </>
  );
}
