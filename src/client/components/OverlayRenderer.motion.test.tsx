import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { motionChange, motionUnderLoop } from "../../shared/motion";
import { normalizeLiveState } from "../../shared/normalize";
import { themeSchema, type ThemeDefinition } from "../../shared/theme";
import { changedValues, eventCardAnimation, OverlayRenderer } from "./OverlayRenderer";

function liveAt(gameClock: number) {
  return normalizeLiveState(
    {
      state: "RUNNING",
      period: "GAME",
      round: 1,
      gameTimer: { value: gameClock, state: 2 },
      mainGame: [{ name: "Left", score: 3 }, { name: "Right", score: 2 }]
    },
    { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
  );
}

function render(adjust: (theme: ThemeDefinition) => void, live = liveAt(8), reduceMotion = false) {
  const theme = structuredClone(builtinThemes[0]);
  adjust(theme);
  return renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} reduceMotion={reduceMotion} />);
}

describe("value change detection", () => {
  it("reports a value that changed in place, with its old value", () => {
    expect(changedValues({ homeScore: "2", awayScore: "1" }, { homeScore: "3", awayScore: "1" }, false)).toEqual([["homeScore", "2"]]);
  });

  it("ignores side moves, first sightings, and values appearing or blanking", () => {
    expect(changedValues({ homeScore: "2" }, { homeScore: "3" }, true)).toEqual([]);
    expect(changedValues({}, { homeScore: "3" }, false)).toEqual([]);
    expect(changedValues({ note: "" }, { note: "Hi" }, false)).toEqual([]);
    expect(changedValues({ note: "Hi" }, { note: "" }, false)).toEqual([]);
  });

  it("builds pop, flash and roll animations", () => {
    const base = { durationMs: 450, easing: "snappy" as const, delayMs: 0 };
    expect(motionChange({ ...base, preset: "pop" })).toEqual({ in: "motion-change-pop 450ms cubic-bezier(0, 0, 0.2, 1) both", out: null });
    expect(motionChange({ ...base, preset: "roll" })?.out).toBe("motion-change-roll-out 450ms cubic-bezier(0, 0, 0.2, 1) both");
    expect(motionChange({ ...base, preset: "none" })).toBeNull();
  });
});

describe("clock warning", () => {
  it("is off by default, and older themes get it off", () => {
    expect(render(() => undefined)).not.toContain("clock-pulse");
    const stored = structuredClone(builtinThemes[0]) as unknown as { components: { gameTime: Record<string, unknown> } };
    delete stored.components.gameTime.clockWarning;
    delete stored.components.gameTime.changeMotion;
    const theme = themeSchema.parse(stored);
    expect(theme.components.gameTime.clockWarning.belowSeconds).toBe(0);
    expect(theme.components.gameTime.changeMotion.preset).toBe("none");
  });

  it("pulses and recolours the game clock in its last seconds", () => {
    const markup = render((theme) => Object.assign(theme.components.gameTime.clockWarning, { belowSeconds: 10, color: "#ff3b30" }));
    expect(markup).toContain('class="clock-pulse"');
    expect(markup).toContain("motion-pulse 1000ms");
    expect(markup).toContain("color:#ff3b30");
  });

  it("waits until the clock reaches the threshold", () => {
    const markup = render((theme) => Object.assign(theme.components.gameTime.clockWarning, { belowSeconds: 10, color: "#ff3b30" }), liveAt(42));
    expect(markup).not.toContain("clock-pulse");
    expect(markup).not.toContain("#ff3b30");
  });

  it("keeps the colour but drops the pulse while motion is reduced", () => {
    const markup = render((theme) => Object.assign(theme.components.gameTime.clockWarning, { belowSeconds: 10, color: "#ff3b30" }), liveAt(8), true);
    expect(markup).not.toContain("clock-pulse");
    expect(markup).toContain("color:#ff3b30");
  });
});

describe("team name under an event card", () => {
  const finished = normalizeLiveState(
    {
      state: "END",
      period: "BREAK",
      round: 1,
      gameTimer: { value: 0, state: 0 },
      mainGame: [{ name: "Left", score: 3 }, { name: "Right", score: 2 }]
    },
    { sourceStatus: "ok", fetchedAt: "2026-10-02T05:00:00.000Z", errorMessage: null }
  );
  const coverName = (theme: ThemeDefinition) => {
    Object.assign(theme.teamEventOverlay.general, { enabled: true, followTarget: "name", placementMode: "full-panel" });
    theme.teamEventOverlay.winner.enabled = true;
  };

  it("does the card's loop inside out, so it steps away while the card shows", () => {
    expect(motionUnderLoop({ preset: "drop-in", durationMs: 2000, easing: "ease-in-out", delayMs: 0 })).toBe(
      "motion-under-loop 2000ms ease-in-out infinite alternate"
    );
    expect(motionUnderLoop({ preset: "none", durationMs: 2000, easing: "ease", delayMs: 0 })).toBe("motion-under-loop-away 1ms linear forwards");
  });

  it("only moves the name the winner card covers", () => {
    const markup = render(coverName, finished);
    expect(markup.match(/motion-under-loop /g)).toHaveLength(1);
    const winnerName = markup.indexOf("motion-under-loop ");
    expect(markup.slice(winnerName, winnerName + 400)).toContain(">Left<");
  });

  it("leaves the name alone when the card sits on the logo", () => {
    const markup = render((theme) => {
      coverName(theme);
      theme.teamEventOverlay.general.followTarget = "logo";
    }, finished);
    expect(markup).not.toContain("motion-under-loop");
  });

  it("fades the name away once while motion is reduced", () => {
    expect(render(coverName, finished, true)).toContain("motion-under-loop-away 200ms ease forwards");
  });
});

describe("reduced motion", () => {
  it("shows the event card with one short fade instead of its loop", () => {
    const motion = builtinThemes[0].teamEventOverlay.general.motion;
    expect(eventCardAnimation(motion, false)).toBe("motion-glide-in-loop 2000ms ease-in-out infinite alternate");
    expect(eventCardAnimation(motion, true)).toBe("motion-fade 200ms ease");
  });
});
