import type { AssetLibraryEntry, AssetUsage, StoredAsset } from "../../shared/theme";

export type AssetFilter = "all" | "used" | "unused" | "processed";
export type AssetSort = "newest" | "name" | "size";

const FIXED_PIECE_NAMES: Record<string, string> = {
  homeName: "Left team name",
  homeTeamLogo: "Left team logo",
  homeScore: "Left score",
  awayName: "Right team name",
  awayTeamLogo: "Right team logo",
  awayScore: "Right score",
  gameTime: "Game clock",
  breakTime: "Centre line",
  eventLogo: "Event logo"
};

const EVENT_OVERLAY_NAMES = {
  concede: "Concede overlay",
  base: "Base overlay",
  winner: "Winner overlay"
} as const;

export function assetName(asset: Pick<StoredAsset, "displayName" | "originalName">): string {
  return asset.displayName?.trim() || asset.originalName;
}

export function filterAndSortAssets(assets: AssetLibraryEntry[], search: string, filter: AssetFilter, sort: AssetSort): AssetLibraryEntry[] {
  const query = search.trim().toLowerCase();
  const filtered = assets.filter((asset) => {
    if (filter === "used" && asset.usages.length === 0) return false;
    if (filter === "unused" && asset.usages.length > 0) return false;
    if (filter === "processed" && !asset.backgroundRemoved) return false;
    if (!query) return true;
    return [assetName(asset), asset.originalName, ...asset.usages.map(usageOwnerName)].some((value) => value.toLowerCase().includes(query));
  });
  return filtered.sort((left, right) => {
    if (sort === "name") return assetName(left).localeCompare(assetName(right), undefined, { sensitivity: "base" });
    if (sort === "size") return (right.byteSize ?? 0) - (left.byteSize ?? 0);
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function usageOwnerName(usage: AssetUsage): string {
  return usage.kind === "theme" ? usage.themeName : usage.teamName;
}

/** Where inside its theme or team the asset sits, in the words the editor uses. */
export function usagePlace(usage: AssetUsage): string {
  if (usage.kind === "team") {
    return usage.slot === "primary" ? "Logo" : "Alternate logo";
  }
  const location = usage.location;
  switch (location.type) {
    case "component":
      return FIXED_PIECE_NAMES[location.key] ?? location.key;
    case "free":
      return location.label;
    case "surface":
      return `${FIXED_PIECE_NAMES[location.label] ?? location.label} background`;
    case "eventOverlay":
      return `${EVENT_OVERLAY_NAMES[location.which]} background`;
    case "momentOverlay":
      return location.which === "timeout" ? "Timeout card background" : "Game finished card background";
    case "font":
      return `Font “${location.family}”`;
    case "version":
      return `Saved version “${location.name}”`;
  }
}

export function usageHref(usage: AssetUsage): string {
  return usage.kind === "theme" ? `/admin/themes/${usage.themeId}` : `/admin/teams/${usage.teamId}`;
}

/** Usages grouped by the theme or team they live in, so one theme shows once with its places. */
export function groupUsages(usages: AssetUsage[]): Array<{ key: string; usage: AssetUsage; places: string[] }> {
  const groups = new Map<string, { key: string; usage: AssetUsage; places: string[] }>();
  for (const usage of usages) {
    const key = usage.kind === "theme" ? `theme:${usage.themeId}` : `team:${usage.teamId}`;
    const group = groups.get(key);
    if (group) {
      group.places.push(usagePlace(usage));
    } else {
      groups.set(key, { key, usage, places: [usagePlace(usage)] });
    }
  }
  return [...groups.values()];
}

export function usageSummary(usages: AssetUsage[]): string {
  if (usages.length === 0) return "Unused";
  const owners = groupUsages(usages).length;
  return owners === 1 ? `Used in ${usageOwnerName(usages[0])}` : `Used in ${owners} places`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function assetDimensions(asset: Pick<StoredAsset, "visibleContent">): string | null {
  const analysis = asset.visibleContent;
  if (analysis && (analysis.status === "ready" || analysis.status === "empty")) {
    return `${analysis.sourceWidth} × ${analysis.sourceHeight}`;
  }
  return null;
}

export function assetTypeLabel(mimeType: string): string {
  const subtype = mimeType.split("/")[1] ?? mimeType;
  return subtype === "jpeg" ? "JPG" : subtype.toUpperCase();
}
