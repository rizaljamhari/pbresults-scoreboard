import { AlignCenter, AlignLeft, AlignRight, Link2 } from "lucide-react";
import { fontFamilies, type TextFitSettings, type ThemeDefinition } from "../../../shared/theme";
import { ColorInput, Field, FieldRow, Group, NumberInput, PanelSection, Segmented, SelectInput, TextFitFields, TextInput } from "./fields";

type CentreLine = ThemeDefinition["centerSecondary"];
type Moments = ThemeDefinition["momentOverlays"];
type LineMode = CentreLine["gameMode"];
type LineStyle = CentreLine["timerStyle"];
type FontFamily = LineStyle["fontFamily"];
type Align = ThemeDefinition["components"]["breakTime"]["textAlign"];

const BREAK_OPTIONS: ReadonlyArray<{ value: LineMode; label: string }> = [
  { value: "timer", label: "Break clock" },
  { value: "staticText", label: "Text" },
  { value: "hidden", label: "Hidden" }
];

const PLAY_OPTIONS: ReadonlyArray<{ value: LineMode; label: string }> = [
  { value: "hidden", label: "Hidden" },
  { value: "staticText", label: "Text" },
  { value: "timer", label: "Break clock" }
];

const TRANSITION_OPTIONS: ReadonlyArray<{ value: CentreLine["transition"]["animation"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" }
];

const FONT_OPTIONS = fontFamilies.map((font) => ({ value: font as FontFamily, label: font }));

const FONT_WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"].map((value) => ({
  value,
  label: { "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra bold", "900": "Black" }[value] as string
}));

/** Font, size, weight and colour for one of the line's two looks. */
function LineStyleFields({
  name,
  style,
  swatches,
  align,
  onAlign,
  patch
}: {
  name: string;
  style: LineStyle;
  swatches: string[];
  align?: Align;
  onAlign?: (value: Align) => void;
  patch: (update: (style: LineStyle) => void) => void;
}) {
  return (
    <>
      <FieldRow>
        <SelectInput label="Font" value={style.fontFamily} options={FONT_OPTIONS} onChange={(value) => patch((draft) => (draft.fontFamily = value))} />
        <Field label="Size">
          <NumberInput label={`${name} size`} value={style.fontSize} min={1} unit="px" onChange={(value) => patch((draft) => (draft.fontSize = value))} />
        </Field>
      </FieldRow>
      <FieldRow>
        <SelectInput
          label="Weight"
          value={String(Math.round(style.fontWeight / 100) * 100)}
          options={FONT_WEIGHTS}
          onChange={(value) => patch((draft) => (draft.fontWeight = Number(value)))}
        />
        {align && onAlign ? (
          <Field label="Align">
            <Segmented
              label="Centre line alignment"
              value={align}
              options={[
                { value: "left", label: "Align left", icon: <AlignLeft /> },
                { value: "center", label: "Align centre", icon: <AlignCenter /> },
                { value: "right", label: "Align right", icon: <AlignRight /> }
              ]}
              onChange={onAlign}
            />
          </Field>
        ) : null}
      </FieldRow>
      <ColorInput label="Colour" value={style.color} swatches={swatches} onChange={(value) => patch((draft) => (draft.color = value))} />
    </>
  );
}

/**
 * The line under the clock. It is the break clock first; during play it shows text or nothing. Links to the
 * timeout and game finished cards that cover it. Shown in place of the piece's own type settings.
 */
export function CentreLineProperties({
  line,
  moments,
  align,
  fit,
  swatches,
  notShownNow,
  patch,
  onAlign,
  onFit,
  onPreviewBreak,
  onOpenMoment
}: {
  line: CentreLine;
  moments: Moments;
  /** Alignment belongs to the piece and applies to both looks. */
  align: Align;
  /** Case and long-text handling also belong to the piece. */
  fit: TextFitSettings;
  swatches: string[];
  /** The line has nothing to show in the previewed state. */
  notShownNow: boolean;
  patch: (update: (line: CentreLine) => void) => void;
  onAlign: (value: Align) => void;
  onFit: (next: Partial<TextFitSettings>) => void;
  /** Present when previewing a break would show the clock. */
  onPreviewBreak?: () => void;
  /** Previews that moment and selects its card. */
  onOpenMoment: (kind: "timeout" | "gameFinished") => void;
}) {
  const showsText = line.gameMode === "staticText" || line.breakMode === "staticText";

  return (
    <>
      {notShownNow ? (
        <div className="te-callout te-callout--action">
          <span>Nothing shows on this line in this preview.</span>
          {onPreviewBreak ? (
            <button type="button" className="te-mini-btn" onClick={onPreviewBreak}>
              Preview Break
            </button>
          ) : null}
        </div>
      ) : null}

      <Group title="Break clock">
        <LineStyleFields
          name="Break clock"
          style={line.timerStyle}
          swatches={swatches}
          align={align}
          onAlign={onAlign}
          patch={(update) => patch((draft) => update(draft.timerStyle))}
        />
        {line.breakMode !== "timer" ? <p className="te-field-hint">Breaks are set to {line.breakMode === "hidden" ? "hidden" : "text"} under More.</p> : null}
      </Group>

      <Group title="During play">
        <Segmented label="What the line shows during play" value={line.gameMode} options={PLAY_OPTIONS} onChange={(value) => patch((draft) => (draft.gameMode = value))} />
        {line.gameMode === "staticText" ? (
          <TextInput label="Text during play" value={line.gameText} onChange={(value) => patch((draft) => (draft.gameText = value))} />
        ) : null}
      </Group>

      {showsText ? (
        <Group title="Text style">
          <LineStyleFields name="Text" style={line.staticStyle} swatches={swatches} patch={(update) => patch((draft) => update(draft.staticStyle))} />
        </Group>
      ) : null}

      <Group title="Long text">
        <TextFitFields value={fit} onChange={onFit} />
      </Group>

      <Group title="Change animation">
        <FieldRow>
          <SelectInput
            label="Animation"
            value={line.transition.animation}
            options={TRANSITION_OPTIONS}
            onChange={(value) => patch((draft) => (draft.transition.animation = value))}
          />
          <Field label="Duration">
            <NumberInput label="Change duration" value={line.transition.durationMs} min={0} step={50} unit="ms" onChange={(value) => patch((draft) => (draft.transition.durationMs = value))} />
          </Field>
        </FieldRow>
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

      <PanelSection title="More" defaultOpen={line.breakMode !== "timer"}>
        <SelectInput label="During breaks" value={line.breakMode} options={BREAK_OPTIONS} onChange={(value) => patch((draft) => (draft.breakMode = value))} />
        {line.breakMode === "staticText" ? (
          <TextInput label="Text during breaks" value={line.breakText} onChange={(value) => patch((draft) => (draft.breakText = value))} />
        ) : null}
        <p className="te-field-hint">Most themes keep the clock during breaks.</p>
      </PanelSection>
    </>
  );
}
