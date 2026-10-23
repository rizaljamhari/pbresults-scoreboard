import { describe, expect, it } from "vitest";
import { defaultListName } from "./MatchesPage";

describe("defaultListName", () => {
  it("uses the league's acronym and the short day", () => {
    expect(defaultListName("STRAITS OF MALACCA PAINTBALL LEAGUE (SMPL) - GRAND FINALE - MELAKA", "Saturday, 24 October 2026", "x.pdf")).toBe(
      "SMPL - GRAND FINALE - MELAKA · Sat 24 Oct"
    );
  });

  it("cuts a long name at a word and falls back to the file name", () => {
    expect(defaultListName("A VERY LONG TOURNAMENT NAME THAT GOES ON AND ON FOR MANY WORDS INDEED", "", "x.pdf")).toBe(
      "A VERY LONG TOURNAMENT NAME THAT GOES ON AND ON FOR"
    );
    expect(defaultListName("", "", "Day 2 schedule.pdf")).toBe("Day 2 schedule");
  });
});
