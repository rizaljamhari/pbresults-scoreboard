import { componentIds, type ComponentId, type FreeComponent, type FreeTextComponent, type ThemeDefinition } from "./theme.js";

export type ThemeComponent = ThemeDefinition["components"][ComponentId] | FreeComponent;
export type ThemeComponentEntry = {
  id: string;
  label: string;
  source: "fixed" | "free";
  component: ThemeComponent;
};

export const fixedComponentLabels: Record<ComponentId, string> = {
  homeName: "Left Name",
  homeTeamLogo: "Left Logo",
  homeScore: "Left Score",
  awayName: "Right Name",
  awayTeamLogo: "Right Logo",
  awayScore: "Right Score",
  gameTime: "Center Primary",
  breakTime: "Center Secondary",
  eventLogo: "Event Logo"
};

const fixedComponentIdSet = new Set<string>(componentIds);

export function isFixedComponentId(id: string): id is ComponentId {
  return fixedComponentIdSet.has(id);
}

export function listThemeComponentEntries(theme: ThemeDefinition): ThemeComponentEntry[] {
  const fixed = componentIds.map((id) => ({
    id,
    label: fixedComponentLabels[id],
    source: "fixed" as const,
    component: theme.components[id]
  }));
  const free = theme.freeComponents.map((component) => ({
    id: component.id,
    label: component.label,
    source: "free" as const,
    component
  }));
  return [...fixed, ...free];
}

export function getThemeComponentEntry(theme: ThemeDefinition, id: string): ThemeComponentEntry | null {
  if (isFixedComponentId(id)) {
    return {
      id,
      label: fixedComponentLabels[id],
      source: "fixed",
      component: theme.components[id]
    };
  }
  const component = theme.freeComponents.find((candidate) => candidate.id === id);
  return component
    ? {
        id: component.id,
        label: component.label,
        source: "free",
        component
      }
    : null;
}

export function getThemeComponent(theme: ThemeDefinition, id: string): ThemeComponent | null {
  return getThemeComponentEntry(theme, id)?.component ?? null;
}

export function listOperatorTextComponents(theme: ThemeDefinition): FreeTextComponent[] {
  return theme.freeComponents.filter(
    (component): component is FreeTextComponent => component.kind === "text" && component.contentMode === "operator"
  );
}

export function getNextComponentZIndex(theme: ThemeDefinition): number {
  return Math.max(0, ...listThemeComponentEntries(theme).map((entry) => entry.component.zIndex)) + 1;
}

export function createFreeComponentId(): string {
  return `free-${crypto.randomUUID()}`;
}
