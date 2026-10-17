import { describe, expect, it } from "vitest";
import { stripGhostShown } from "./OnAirStrip";

describe("stripGhostShown", () => {
  it("shows the faint copy only once a hide has finished playing", () => {
    expect(stripGhostShown(false, "hidden")).toBe(true);
    expect(stripGhostShown(false, "leaving-contents")).toBe(false);
    expect(stripGhostShown(false, "leaving-wipe")).toBe(false);
    expect(stripGhostShown(false, "leaving-plain")).toBe(false);
    expect(stripGhostShown(false, null)).toBe(false);
  });

  it("drops it the moment Show is pressed, before the show transition plays", () => {
    expect(stripGhostShown(true, "hidden")).toBe(false);
    expect(stripGhostShown(true, "entering")).toBe(false);
    expect(stripGhostShown(true, "shown")).toBe(false);
  });
});
