import { describe, expect, it } from "vitest";
import { controlAllowed, controlForAction, guidedBlockMessage, manualMoment } from "./manualGuide";

describe("manualMoment", () => {
  it("names the moment from the phase and whether the clock runs", () => {
    expect(manualMoment("idle", false)).toBe("ready");
    expect(manualMoment("idle", true)).toBe("playing");
    expect(manualMoment("game", true)).toBe("playing");
    expect(manualMoment("game", false)).toBe("stopped");
    expect(manualMoment("break", false)).toBe("break");
    expect(manualMoment("finished", true)).toBe("finished");
  });
});

describe("guided controls", () => {
  it("offers points and towel/base only while play runs", () => {
    expect(controlAllowed("scoreUp", "playing", "guided")).toBe(true);
    expect(controlAllowed("towelBase", "playing", "guided")).toBe(true);
    for (const moment of ["ready", "stopped", "break", "finished"] as const) {
      expect(controlAllowed("scoreUp", moment, "guided")).toBe(false);
      expect(controlAllowed("towelBase", moment, "guided")).toBe(false);
    }
  });

  it("does not offer a break or timeout during play", () => {
    expect(controlAllowed("startBreak", "playing", "guided")).toBe(false);
    expect(controlAllowed("timeout", "playing", "guided")).toBe(false);
    expect(controlAllowed("startBreak", "stopped", "guided")).toBe(true);
    expect(controlAllowed("timeout", "stopped", "guided")).toBe(true);
  });

  it("allows a countdown break before the first point, but no timeout", () => {
    expect(controlAllowed("startBreak", "ready", "guided")).toBe(true);
    expect(controlAllowed("timeout", "ready", "guided")).toBe(false);
  });

  it("leaves taking a point back to Undo, and only offers Next match after the match", () => {
    for (const moment of ["ready", "playing", "stopped", "break", "finished"] as const) {
      expect(controlAllowed("scoreDown", moment, "guided")).toBe(false);
      expect(controlAllowed("next", moment, "guided")).toBe(moment === "finished");
    }
  });

  it("offers everything in Full", () => {
    expect(controlAllowed("scoreDown", "finished", "full")).toBe(true);
    expect(controlAllowed("startBreak", "playing", "full")).toBe(true);
  });
});

describe("controlForAction", () => {
  const context = { breakResumable: false };

  it("maps actions to the control that offers them", () => {
    expect(controlForAction({ type: "adjustScore", side: "left", delta: 1 }, context)).toBe("scoreUp");
    expect(controlForAction({ type: "adjustScore", side: "left", delta: -1 }, context)).toBe("scoreDown");
    expect(controlForAction({ type: "startBreak" }, context)).toBe("startBreak");
    expect(controlForAction({ type: "startBreak" }, { breakResumable: true })).toBe("resumeBreak");
    expect(controlForAction({ type: "teamEvent", kind: "towel", side: "right" }, context)).toBe("towelBase");
  });

  it("leaves team changes, Undo and Adjust clocks always available", () => {
    expect(controlForAction({ type: "setTeam", side: "left", teamId: "t", name: "" }, context)).toBeNull();
    expect(controlForAction({ type: "undo" }, context)).toBeNull();
    expect(controlForAction({ type: "setGameClock", seconds: 300 }, context)).toBeNull();
    expect(controlForAction({ type: "startBreak", seconds: 15 }, context)).toBeNull();
  });

  it("explains a blocked key in the operator's words", () => {
    expect(guidedBlockMessage("playing")).toBe("Not available while play is running. Switch the panel to Full for every control.");
  });
});
