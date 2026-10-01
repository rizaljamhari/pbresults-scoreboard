import { describe, expect, it } from "vitest";
import type { AssetLibraryEntry, AssetUsage } from "../../shared/theme";
import { assetName, filterAndSortAssets, formatBytes, groupUsages, usagePlace, usageSummary } from "./assetAdminUtils";

function entry(id: string, patch: Partial<AssetLibraryEntry> = {}): AssetLibraryEntry {
  return {
    id,
    originalName: `${id}.png`,
    mimeType: "image/png",
    url: `/uploads/${id}.png`,
    createdAt: "2026-09-01T00:00:00.000Z",
    role: "original",
    sourceAssetId: null,
    hiddenFromPicker: false,
    contentHash: null,
    visibleContent: null,
    displayName: null,
    updatedAt: null,
    byteSize: 100,
    usages: [],
    original: null,
    backgroundRemoved: false,
    fileMissing: false,
    ...patch
  };
}

const themeUsage = (themeName: string, location: Extract<AssetUsage, { kind: "theme" }>["location"]): AssetUsage => ({
  kind: "theme",
  themeId: `theme-${themeName}`,
  themeName,
  builtin: false,
  published: false,
  location
});

describe("asset admin helpers", () => {
  it("prefers the display name", () => {
    expect(assetName(entry("a", { displayName: "Sponsor" }))).toBe("Sponsor");
    expect(assetName(entry("a", { displayName: "  " }))).toBe("a.png");
  });

  it("filters by usage, cut-out state and search, including owner names", () => {
    const used = entry("used", { usages: [themeUsage("Finals", { type: "component", key: "eventLogo" })] });
    const cut = entry("cut", { backgroundRemoved: true });
    const all = [used, cut, entry("plain")];
    expect(filterAndSortAssets(all, "", "used", "newest").map((item) => item.id)).toEqual(["used"]);
    expect(filterAndSortAssets(all, "", "unused", "name").map((item) => item.id)).toEqual(["cut", "plain"]);
    expect(filterAndSortAssets(all, "", "processed", "newest").map((item) => item.id)).toEqual(["cut"]);
    expect(filterAndSortAssets(all, "finals", "all", "newest").map((item) => item.id)).toEqual(["used"]);
  });

  it("sorts by newest, name and size", () => {
    const all = [
      entry("b", { createdAt: "2026-09-02T00:00:00.000Z", byteSize: 10 }),
      entry("a", { createdAt: "2026-09-01T00:00:00.000Z", byteSize: 30 }),
      entry("c", { createdAt: "2026-09-03T00:00:00.000Z", byteSize: null })
    ];
    expect(filterAndSortAssets(all, "", "all", "newest").map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(filterAndSortAssets(all, "", "all", "name").map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(filterAndSortAssets(all, "", "all", "size").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("names places the way the editor does and groups them per owner", () => {
    const usages: AssetUsage[] = [
      themeUsage("Finals", { type: "component", key: "homeTeamLogo" }),
      themeUsage("Finals", { type: "surface", key: "homeScore", label: "homeScore" }),
      themeUsage("Finals", { type: "eventOverlay", which: "concede" }),
      { kind: "team", teamId: "team-1", teamName: "Rangers", slot: "alternate" }
    ];
    expect(usages.map(usagePlace)).toEqual(["Left team logo", "Left score background", "Concede overlay background", "Alternate logo"]);
    expect(groupUsages(usages).map((group) => group.places.length)).toEqual([3, 1]);
    expect(usageSummary(usages)).toBe("Used in 2 places");
    expect(usageSummary(usages.slice(0, 2))).toBe("Used in Finals");
    expect(usageSummary([])).toBe("Unused");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});
