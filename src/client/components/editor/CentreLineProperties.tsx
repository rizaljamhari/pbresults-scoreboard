import { fontFamilies, type ThemeDefinition } from "../../../shared/theme";
import { ColorInput, Field, FieldRow, Group, NumberInput, SelectInput, SwitchRow, TextInput } from "./fields";

type CentreLine = ThemeDefinition["centerSecondary"];
type Moments = ThemeDefinition["momentOverlays"];
type LineMode = CentreLine["gameMode"];
type FontFamily = CentreLine["timerStyle"]["fontFamily"];

const MODE_OPTIONS: ReadonlyArray<{ value: LineMode; label: string }> = [
  { value: "timer", label: "Break timer" },
  { value: "staticText", label: "Text" },
  { value: "hidden", label: "Hidden" }
];

const TRANSITION_OPTIONS: ReadonlyArray<{ value: CentreLine["transition"]["animation"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" }
];

const FONT_OPTIONS = fontFamilies.map((font) => ({ value: font as FontFamily, label: font }));

/**
 * The line under the clock: what it shows during play and breaks, how it changes, and the Game finished and
 * Timeout treatments. Shown inside the centre piece's properties.
 */
export function CentreLineProperties({
  line,
  moments,
  swatches,
  patch,
  patchMoments
}: {
  line: CentreLine;
  moments: Moments;
  swatches: string[];
  patch: (update: (line: CentreLine) => void) => void;
  patchMoments: (update: (moments: Moments) => void) => void;
}) {
  const timeout = moments.timeout;
  return (
    <>
      <Group title="What it shows">
        <FieldRow>
          <SelectInput label="During play" value={line.gameMode} options={MODE_OPTIONS} onChange={(value) => patch((draft) => (draft.gameMode = value))} />
          <SelectInput label="During breaks" value={line.breakMode} options={MODE_OPTIONS} onChange={(value) => patch((draft) => (draft.breakMode = value))} />
        </FieldRow>
        {line.gameMode === "staticText" ? (
          <TextInput label="Text during play" value={line.gameText} onChange={(value) => patch((draft) => (draft.gameText = value))} />
        ) : null}
        {line.breakMode === "staticText" ? (
          <TextInput label="Text during breaks" value={line.breakText} onChange={(value) => patch((draft) => (draft.breakText = value))} />
        ) : null}
        <FieldRow>
          <SelectInput
            label="Change animation"
            value={line.transition.animation}
            options={TRANSITION_OPTIONS}
            onChange={(value) => patch((draft) => (draft.transition.animation = value))}
          />
          <Field label="Duration">
            <NumberInput label="Change duration" value={line.transition.durationMs} min={0} step={50} unit="ms" onChange={(value) => patch((draft) => (draft.transition.durationMs = value))} />
          </Field>
        </FieldRow>
      </Group>

      <Group title="Timer style">
        <FieldRow>
          <SelectInput label="Font" value={line.timerStyle.fontFamily} options={FONT_OPTIONS} onChange={(value) => patch((draft) => (draft.timerStyle.fontFamily = value))} />
          <Field label="Size">
            <NumberInput label="Timer size" value={line.timerStyle.fontSize} min={1} unit="px" onChange={(value) => patch((draft) => (draft.timerStyle.fontSize = value))} />
          </Field>
        </FieldRow>
        <ColorInput label="Colour" value={line.timerStyle.color} swatches={swatches} onChange={(value) => patch((draft) => (draft.timerStyle.color = value))} />
      </Group>

      <Group title="Text style">
        <FieldRow>
          <SelectInput label="Font" value={line.staticStyle.fontFamily} options={FONT_OPTIONS} onChange={(value) => patch((draft) => (draft.staticStyle.fontFamily = value))} />
          <Field label="Size">
            <NumberInput label="Text size" value={line.staticStyle.fontSize} min={1} unit="px" onChange={(value) => patch((draft) => (draft.staticStyle.fontSize = value))} />
          </Field>
        </FieldRow>
        <ColorInput label="Colour" value={line.staticStyle.color} swatches={swatches} onChange={(value) => patch((draft) => (draft.staticStyle.color = value))} />
      </Group>

      <Group title="Game finished">
        <SwitchRow
          label="Show GAME FINISHED"
          hint="Replaces this line when a game ends. The winner card is set separately."
          checked={moments.gameFinished.enabled}
          onChange={(checked) => patchMoments((draft) => (draft.gameFinished.enabled = checked))}
        />
      </Group>

      <Group title="Timeout">
        <SwitchRow
          label="Flash a timeout"
          hint="Shows once over the break timer when break time jumps up."
          checked={timeout.enabled}
          onChange={(checked) => patchMoments((draft) => (draft.timeout.enabled = checked))}
        />
        {timeout.enabled ? (
          <>
            <TextInput label="Text" value={timeout.text} onChange={(value) => patchMoments((draft) => (draft.timeout.text = value))} />
            <FieldRow>
              <Field label="Shows for">
                <NumberInput label="Timeout duration" value={timeout.durationMs} min={0} step={100} unit="ms" onChange={(value) => patchMoments((draft) => (draft.timeout.durationMs = value))} />
              </Field>
              <Field label="When time jumps by">
                <NumberInput
                  label="Trigger increase"
                  value={timeout.minIncreaseSeconds}
                  min={0}
                  unit="s"
                  onChange={(value) => patchMoments((draft) => (draft.timeout.minIncreaseSeconds = value))}
                />
              </Field>
            </FieldRow>
            <SelectInput label="Font" value={timeout.fontFamily} options={FONT_OPTIONS} onChange={(value) => patchMoments((draft) => (draft.timeout.fontFamily = value))} />
            <FieldRow>
              <Field label="Size">
                <NumberInput label="Timeout size" value={timeout.fontSize} min={1} unit="px" onChange={(value) => patchMoments((draft) => (draft.timeout.fontSize = value))} />
              </Field>
              <Field label="Weight">
                <NumberInput label="Timeout weight" value={timeout.fontWeight} min={100} max={900} step={100} onChange={(value) => patchMoments((draft) => (draft.timeout.fontWeight = value))} />
              </Field>
            </FieldRow>
            <Field label="Letter spacing">
              <NumberInput
                label="Timeout letter spacing"
                value={timeout.letterSpacing}
                step={0.1}
                precision={1}
                unit="px"
                onChange={(value) => patchMoments((draft) => (draft.timeout.letterSpacing = value))}
              />
            </Field>
            <ColorInput label="Text colour" value={timeout.color} swatches={swatches} onChange={(value) => patchMoments((draft) => (draft.timeout.color = value))} />
            <ColorInput label="Background" value={timeout.backgroundColor} swatches={swatches} onChange={(value) => patchMoments((draft) => (draft.timeout.backgroundColor = value))} />
          </>
        ) : null}
      </Group>
    </>
  );
}
