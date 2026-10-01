import { Link2 } from "lucide-react";
import { fontFamilies, type ThemeDefinition } from "../../../shared/theme";
import { ColorInput, Field, FieldRow, Group, NumberInput, SelectInput, TextInput } from "./fields";

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
 * The line under the clock: what it shows during play and breaks and how it changes, with links to the
 * timeout and game finished cards that cover it. Shown inside the centre piece's properties.
 */
export function CentreLineProperties({
  line,
  moments,
  swatches,
  patch,
  onOpenMoment
}: {
  line: CentreLine;
  moments: Moments;
  swatches: string[];
  patch: (update: (line: CentreLine) => void) => void;
  /** Previews that moment and selects its card. */
  onOpenMoment: (kind: "timeout" | "gameFinished") => void;
}) {
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

      <Group title="Cards that cover this line">
        {(["timeout", "gameFinished"] as const).map((kind) => {
          const card = moments[kind];
          const where = card.placement === "centreLine" ? "On this line" : "Placed freely";
          return (
            <button key={kind} type="button" className="te-follow-link" onClick={() => onOpenMoment(kind)}>
              <Link2 aria-hidden />
              <span>
                {kind === "timeout" ? "Timeout card" : "Game finished card"} · {card.enabled ? where : "Off"}
              </span>
            </button>
          );
        })}
      </Group>
    </>
  );
}
