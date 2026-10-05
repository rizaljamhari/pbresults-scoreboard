import { afterEach, describe, expect, it } from "vitest";
import { applyConsoleTitle } from "./consoleTitle";

const originalTitle = process.title;

afterEach(() => {
  process.title = originalTitle;
});

describe("applyConsoleTitle", () => {
  it("names the Windows console after the brand, or the default name", () => {
    applyConsoleTitle({ brandName: "Media Crew" }, "win32");
    expect(process.title).toBe("Media Crew");
    applyConsoleTitle({ brandName: "  " }, "win32");
    expect(process.title).toBe("PBResults Scoreboard");
  });

  it("leaves the process name alone on other platforms", () => {
    applyConsoleTitle({ brandName: "Media Crew" }, "darwin");
    expect(process.title).toBe(originalTitle);
  });
});
