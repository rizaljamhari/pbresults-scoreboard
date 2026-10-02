import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { describeMotion, motionEnter, motionLeave, motionLoop, motionSwap, motionTotalMs } from "./motion";
import { defaultCentreLineMotion, defaultEventCardMotion, defaultTeamSwitchMotion, themeSchema } from "./theme";

describe("motion strings", () => {
  it("reproduces the centre line's old change animation", () => {
    expect(motionEnter(defaultCentreLineMotion)).toBe("motion-fade 250ms ease");
    expect(motionLeave(defaultCentreLineMotion)).toBe("motion-fade 250ms ease reverse");
  });

  it("reproduces the event card's old loop", () => {
    expect(motionLoop(defaultEventCardMotion)).toBe("motion-drop-in-loop 2000ms ease-in-out infinite alternate");
  });

  it("reproduces the old team switch, the outgoing half accelerating away", () => {
    expect(motionSwap(defaultTeamSwitchMotion)).toEqual({
      out: "motion-scale 600ms ease-out reverse both",
      in: "motion-scale 600ms cubic-bezier(0, 0, 0.2, 1) both"
    });
  });

  it("adds a delay only to arriving motion, and nothing at all for none", () => {
    const delayed = { ...defaultCentreLineMotion, delayMs: 100 };
    expect(motionEnter(delayed)).toBe("motion-fade 250ms ease 100ms both");
    expect(motionLeave(delayed)).toBe("motion-fade 250ms ease reverse");
    expect(motionTotalMs(delayed)).toBe(350);
    const none = { ...delayed, preset: "none" as const };
    expect([motionEnter(none), motionLeave(none), motionLoop(none), motionSwap(none), motionTotalMs(none)]).toEqual([undefined, undefined, undefined, null, 0]);
    expect(describeMotion(delayed)).toBe("fade, 250 ms after 100 ms");
  });
});

describe("motion migration", () => {
  function storedTheme(adjust: (theme: Record<string, any>) => void) {
    const theme = structuredClone(builtinThemes[0]) as unknown as Record<string, any>;
    delete theme.motion;
    delete theme.centerSecondary.motion;
    delete theme.teamEventOverlay.general.motion;
    adjust(theme);
    return themeSchema.parse(theme);
  }

  it("turns the event card's preset and duration into its motion", () => {
    const sideways = storedTheme((theme) => Object.assign(theme.teamEventOverlay.general, { animationPreset: "slide-horizontal", durationMs: 1500 }));
    expect(sideways.teamEventOverlay.general.motion).toEqual({ preset: "glide-in", durationMs: 1500, easing: "ease-in-out", delayMs: 0 });
    expect(sideways.teamEventOverlay.general).not.toHaveProperty("animationPreset");

    const still = storedTheme((theme) => Object.assign(theme.teamEventOverlay.general, { animationPreset: "none", durationMs: 900 }));
    expect(still.teamEventOverlay.general.motion.preset).toBe("none");

    const untouched = storedTheme(() => undefined);
    expect(untouched.teamEventOverlay.general.motion).toEqual(defaultEventCardMotion);
  });

  it("migrates the oldest flat event overlay too", () => {
    const theme = storedTheme((stored) => {
      stored.teamEventOverlay = {
        enabled: true,
        text: "Towel",
        color: "#ffffff",
        backgroundColor: "#000000",
        baseText: "Base",
        baseColor: "#ffffff",
        baseBackgroundColor: "#000000",
        animationPreset: "slide-horizontal",
        durationMs: 1800
      };
    });
    expect(theme.teamEventOverlay.general.motion).toMatchObject({ preset: "glide-in", durationMs: 1800 });
  });

  it("turns the centre line's transition into its motion", () => {
    const theme = storedTheme((stored) => {
      stored.centerSecondary.transition = { animation: "slide-left", durationMs: 400 };
    });
    expect(theme.centerSecondary.motion).toEqual({ preset: "slide-left", durationMs: 400, easing: "ease", delayMs: 0 });
    expect(theme.centerSecondary).not.toHaveProperty("transition");
  });

  it("gives older themes today's team switch", () => {
    expect(storedTheme(() => undefined).motion.teamSwitch).toEqual(defaultTeamSwitchMotion);
  });
});
