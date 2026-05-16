import type { ThemeDefinition } from "../../shared/theme";

export type ThemeKindFilter = "all" | "builtin" | "custom";
export type ThemeSort = "nameAsc" | "nameDesc";

export function filterAndSortThemes(
  themes: ThemeDefinition[],
  search: string,
  kindFilter: ThemeKindFilter,
  sortBy: ThemeSort
): ThemeDefinition[] {
  const query = search.trim().toLowerCase();
  const base = [...themes].filter((theme) => {
    if (kindFilter === "builtin" && !theme.builtin) {
      return false;
    }
    if (kindFilter === "custom" && theme.builtin) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [theme.name, theme.description, theme.id].some((value) => value.toLowerCase().includes(query));
  });

  base.sort((left, right) => {
    return sortBy === "nameAsc"
      ? left.name.localeCompare(right.name)
      : right.name.localeCompare(left.name);
  });

  return base;
}
