import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gameHasPlaceholder } from "../shared/matchList";
import { SchedulePdfError, parseSchedulePdf } from "./schedulePdf";

const fixture = fs.readFileSync(path.join(import.meta.dirname, "__fixtures__", "smpl-saturday.pdf"));

describe("parseSchedulePdf", () => {
  it("reads every row of the SMPL Saturday schedule", async () => {
    const schedule = await parseSchedulePdf(fixture);
    expect(schedule.title).toBe("STRAITS OF MALACCA PAINTBALL LEAGUE (SMPL) - GRAND FINALE - MELAKA");
    expect(schedule.date).toBe("Saturday, 24 October 2026");
    expect(schedule.warnings).toEqual([]);
    expect(schedule.games).toHaveLength(75);

    const games = schedule.games.filter((game) => game.kind === "game");
    expect(games).toHaveLength(70);
    expect(games.map((game) => game.gameId)).toEqual(Array.from({ length: 70 }, (_, index) => index + 1));
    expect(schedule.games.filter((game) => game.kind === "break")).toHaveLength(5);
  });

  it("joins names that wrap onto a second line", async () => {
    const { games } = await parseSchedulePdf(fixture);
    const byId = (id: number) => games.find((game) => game.gameId === id)!;
    expect(byId(1)).toMatchObject({ time: "07:30", minutes: 5, division: "Premier", stage: "Prelim Level 1", notes: "" });
    expect(byId(1).home.label).toBe("KOVRA UD");
    expect(byId(1).away.label).toBe("K INTIKAM");
    expect(byId(3).home.label).toBe("COMRADES OF DARKNESS “COD”");
    expect(byId(13).away.label).toBe("COMRADES OF DARKNESS “COD”");
    expect(byId(63).home.label).toBe("Highest-ranked Round of 16 winner");
    expect(byId(67).home.label).toBe("Highest-ranked Quarter-Final winner");
    expect(byId(70).home.label).toBe("Winner SF1");
    // The last row on the last page stops before the page footer.
    expect(byId(70).away.label).toBe("Winner SF2");
    expect(byId(15).away.label).toBe("SOUTHERN X");
  });

  it("takes best-of from the notes: knockouts from the quarters are best of 3", async () => {
    const { games } = await parseSchedulePdf(fixture);
    const bestOf = (from: number, to: number) => games.filter((game) => game.gameId !== null && game.gameId >= from && game.gameId <= to).map((game) => game.bestOf);
    expect(new Set(bestOf(1, 62))).toEqual(new Set([1]));
    expect(new Set(bestOf(63, 70))).toEqual(new Set([3]));
    expect(games.filter(gameHasPlaceholder).map((game) => game.gameId)).toEqual(Array.from({ length: 16 }, (_, index) => index + 55));
  });

  it("keeps a break's description as its note", async () => {
    const { games } = await parseSchedulePdf(fixture);
    const lunch = games.find((game) => game.stage === "Lunch")!;
    expect(lunch).toMatchObject({ kind: "break", gameId: null, time: "13:10", minutes: 60, notes: "Lunch Break" });
    expect(games.find((game) => game.time === "17:02")?.notes).toBe("Break after Semi-Final");
  });

  it("refuses a file that is not a schedule", async () => {
    await expect(parseSchedulePdf(Buffer.from("not a pdf"))).rejects.toBeInstanceOf(SchedulePdfError);
  });
});
