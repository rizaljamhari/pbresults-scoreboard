import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { appEventSchema } from "../../shared/appEvents";
import { builtinThemes } from "../../shared/builtinThemes";
import { enterSequence, motionExit } from "../../shared/motion";
import { normalizeLiveState } from "../../shared/normalize";
import { themeSchema, type ThemeDefinition } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";

const live = normalizeLiveState(
  { state: "RUNNING", period: "GAME", round: 1, gameTimer: { value: 300, state: 2 }, mainGame: [{ name: "Left", score: 1 }, { name: "Right", score: 0 }] },
  { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
);

function render(adjust: (theme: ThemeDefinition) => void, reduceMotion = false) {
  const theme = structuredClone(builtinThemes[0]);
  adjust(theme);
  return renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} reduceMotion={reduceMotion} />);
}

/** The style attribute of the slot that holds `text`. */
function slotStyle(markup: string, text: string) {
  const at = markup.indexOf(`>${text}<`);
  const start = markup.lastIndexOf('<button type="button" class="component-slot"', at);
  return markup.slice(start, markup.indexOf(">", start));
}

describe("build-in order", () => {
  const pieces = [
    { id: "rightName", x: 1400, width: 300, zIndex: 1 },
    { id: "clock", x: 900, width: 120, zIndex: 3 },
    { id: "leftName", x: 220, width: 300, zIndex: 2 }
  ];

  it("orders left to right by each piece's centre", () => {
    expect(enterSequence(pieces, "left-to-right", 1920)).toEqual({ leftName: 0, clock: 1, rightName: 2 });
  });

  it("brings mirrored pieces in together from the centre out", () => {
    expect(enterSequence(pieces, "centre-out", 1920)).toEqual({ clock: 0, leftName: 1, rightName: 1 });
  });

  it("orders back to front by layer", () => {
    expect(enterSequence(pieces, "layers", 1920)).toEqual({ rightName: 0, leftName: 1, clock: 2 });
  });
});

describe("exit motion", () => {
  it("leaves in the direction it is named for, and holds its last frame", () => {
    const base = { durationMs: 300, easing: "ease" as const, delayMs: 0 };
    expect(motionExit({ ...base, preset: "slide-up" })).toBe("motion-slide-down 300ms ease reverse both");
    expect(motionExit({ ...base, preset: "fade" })).toBe("motion-fade 300ms ease reverse both");
    expect(motionExit({ ...base, preset: "none" })).toBeUndefined();
  });
});

describe("piece entrances", () => {
  it("leave older themes and the default untouched", () => {
    const stored = structuredClone(builtinThemes[0]) as unknown as Record<string, any>;
    delete stored.components.homeName.enterMotion;
    delete stored.motion.enterStaggerMs;
    const theme = themeSchema.parse(stored);
    expect(theme.components.homeName.enterMotion.preset).toBe("none");
    expect(theme.motion).toMatchObject({ enterStaggerMs: 0, enterOrder: "left-to-right" });
    const style = slotStyle(render(() => undefined), "Left");
    expect(style).toContain("component-slot");
    expect(style).not.toContain("animation");
  });

  it("builds pieces in with the stagger, in order", () => {
    const markup = render((theme) => {
      theme.motion.enterStaggerMs = 100;
      for (const id of ["homeScore", "awayScore"] as const) {
        theme.components[id].enterMotion = { preset: "fade", durationMs: 300, easing: "ease", delayMs: 0 };
      }
    });
    const left = slotStyle(markup, "1");
    const right = slotStyle(markup, "0");
    expect(left).toContain("animation:motion-fade 300ms ease");
    expect(left).not.toContain("100ms both");
    expect(right).toContain("animation:motion-fade 300ms ease 100ms both");
  });

  it("keeps a see-through piece's opacity while it animates", () => {
    const markup = render((theme) => {
      theme.components.homeScore.opacity = 0.8;
      theme.components.homeScore.enterMotion = { preset: "slide-up", durationMs: 300, easing: "ease", delayMs: 0 };
    });
    const style = slotStyle(markup, "1");
    expect(style).toContain("opacity:1");
    expect(style).toContain("filter:opacity(0.8)");
  });

  it("appears without its entrance while motion is reduced", () => {
    const markup = render((theme) => {
      theme.components.homeScore.enterMotion = { preset: "fade", durationMs: 300, easing: "ease", delayMs: 0 };
    }, true);
    expect(slotStyle(markup, "1")).not.toContain("motion-fade");
  });
});

describe("entrance cue event", () => {
  it("is a valid realtime event", () => {
    const event = appEventSchema.parse({
      protocol: 1,
      instanceId: "i",
      sequence: 4,
      occurredAt: "2026-10-02T05:00:00.000Z",
      type: "overlay.cue",
      cue: "entrance",
      token: 123
    });
    expect(event.type).toBe("overlay.cue");
  });
});
