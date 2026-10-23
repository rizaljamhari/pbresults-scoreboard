import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScheduledGame } from "../shared/matchList";

let tempRoot = "";
let storage: typeof import("./storage");
let matchLists: typeof import("./matchLists");

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-matchlists-"));
  process.env.APP_ROOT_DIR = tempRoot;
  process.env.APP_DATA_DIR = path.join(tempRoot, "data");
  process.env.APP_UPLOADS_DIR = path.join(tempRoot, "data", "uploads");
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  vi.resetModules();
  storage = await import("./storage");
  matchLists = await import("./matchLists");
});

afterAll(() => {
  delete process.env.APP_ROOT_DIR;
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_UPLOADS_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function game(gameId: number, home: string, away: string): ScheduledGame {
  return {
    id: `g${gameId}`,
    gameId,
    time: "",
    minutes: 5,
    division: "",
    stage: "",
    kind: "game",
    home: { label: home, teamId: null, name: "" },
    away: { label: away, teamId: null, name: "" },
    bestOf: 1,
    notes: ""
  };
}

describe("match lists", () => {
  it("links only exact matches on create, and maps a printed name across the list", () => {
    const anarki = storage.createTeamRecord({ canonicalName: "ANARKI LEGION" });
    const spunky = storage.saveTeamRecord({ ...storage.createTeamRecord({ canonicalName: "SPUNKY" }), active: false });

    const list = matchLists.createMatchList({
      name: "Day 1",
      games: [game(1, "Anarki Legion", "Loco Legion"), game(2, "Spunky", "Rank 1"), game(3, "Loco Legion", "3Q")]
    });
    const [g1, g2, g3] = list.games;
    expect(g1.home.teamId).toBe(anarki.id);
    // Close is not enough: "Loco Legion" must not become Anarki Legion.
    expect(g1.away.teamId).toBeNull();
    // Inactive teams are left for the operator to confirm.
    expect(g2.home.teamId).toBeNull();

    // Linking an inactive team switches it back on and remembers the printed name.
    const linked = matchLists.applyTeamMapping(list.id, { action: "link", label: "Spunky", teamId: spunky.id });
    expect(linked.list.games[1].home.teamId).toBe(spunky.id);
    expect(storage.getTeamRecord(spunky.id)).toMatchObject({ active: true });

    // Creating a team maps every game that prints the name.
    const created = matchLists.applyTeamMapping(list.id, { action: "create", label: "Loco Legion" });
    const loco = created.changedTeamIds[0];
    expect(storage.getTeamRecord(loco)?.canonicalName).toBe("Loco Legion");
    expect([created.list.games[0].away.teamId, created.list.games[2].home.teamId]).toEqual([loco, loco]);

    const text = matchLists.applyTeamMapping(list.id, { action: "text", label: "3Q" });
    expect(text.list.games[2].away).toEqual({ label: "3Q", teamId: null, name: "3Q" });
    expect(g3.id).toBe(text.list.games[2].id);

    expect(() => matchLists.applyTeamMapping(list.id, { action: "text", label: "Rank 1" })).toThrow(matchLists.MatchListError);
  });

  it("never links on a name the matcher only derives, like a last word", () => {
    storage.createTeamRecord({ canonicalName: "CHAOS BANDITS" });
    const list = matchLists.createMatchList({ name: "Derived", games: [game(1, "Bandits", "Legion")] });
    expect(list.games[0].home.teamId).toBeNull();
    expect(list.games[0].away.teamId).toBeNull();
    matchLists.deleteMatchList(list.id);
  });

  it("adding a name that is already in Teams reuses that team", () => {
    const list = matchLists.createMatchList({ name: "Twins", games: [game(1, "Mischief", "Spartan")] });
    const first = matchLists.applyTeamMapping(list.id, { action: "create", label: "Mischief" });
    const again = matchLists.applyTeamMapping(list.id, { action: "create", label: "Mischief" });
    expect(again.changedTeamIds).toEqual(first.changedTeamIds);
    expect(storage.listTeamRecords().filter((team) => team.canonicalName === "Mischief")).toHaveLength(1);
    matchLists.deleteMatchList(list.id);
  });

  it("a list made from a PDF the second time links the names learned the first time", () => {
    const list = matchLists.createMatchList({ name: "Day 2", games: [game(1, "Spunky", "Loco Legion")] });
    expect(list.games[0].home.teamId).not.toBeNull();
    expect(list.games[0].away.teamId).not.toBeNull();
  });

  it("keeps lists and the active list in the operations data, and forgets the active one when deleted", () => {
    const [first] = storage.getMatchListsState().lists;
    matchLists.setActiveMatchList(first.id);
    expect(storage.getOperationsState().matchLists.activeListId).toBe(first.id);
    matchLists.deleteMatchList(first.id);
    expect(storage.getMatchListsState().activeListId).toBeNull();
    expect(storage.getMatchListsState().lists.map((list) => list.name)).toEqual(["Day 2"]);
  });
});
