import { useEffect, useMemo, useReducer } from "react";
import { displayName } from "../../../shared/rehearsalCases";
import type { TeamRecord, ThemeDefinition } from "../../../shared/theme";

export type TeamNameSlot = "homeName" | "awayName";

/** The longest team name in Teams that is cut off in a team name piece, or null when every name fits. */
export type NameClip = { name: string; overflowPx: number } | null;

type NameBox = Pick<
  ThemeDefinition["components"]["homeName"],
  "width" | "borderWidth" | "paddingX" | "fontFamily" | "fontSize" | "fontWeight" | "letterSpacing" | "textTransform"
>;

// Long names are tried by length first; measuring a handful is enough to find the widest one.
const CANDIDATES = 6;

function measure(text: string, box: NameBox) {
  const span = document.createElement("span");
  Object.assign(span.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "nowrap",
    fontFamily: `"${box.fontFamily}", sans-serif`,
    fontSize: `${box.fontSize}px`,
    fontWeight: String(box.fontWeight),
    letterSpacing: `${box.letterSpacing}px`,
    textTransform: box.textTransform
  });
  span.textContent = text;
  document.body.appendChild(span);
  const width = span.getBoundingClientRect().width;
  span.remove();
  return width;
}

function widestClip(names: string[], box: NameBox): NameClip {
  const room = box.width - box.borderWidth * 2 - box.paddingX * 2;
  let worst: NameClip = null;
  for (const name of names) {
    const overflowPx = measure(name, box) - room;
    if (overflowPx > 0.5 && (!worst || overflowPx > worst.overflowPx)) {
      worst = { name, overflowPx };
    }
  }
  return worst;
}

/**
 * For each team name piece set to "Cut off", the longest active team name in Teams that would be cut off on air.
 * Re-measures when a web font finishes loading, since that changes text widths without a render.
 */
export function useTeamNameClips(theme: ThemeDefinition | null | undefined, teams: TeamRecord[] | null | undefined): Record<TeamNameSlot, NameClip> {
  const [fontTick, bump] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    document.fonts.addEventListener("loadingdone", bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);

  const names = useMemo(
    () =>
      (teams ?? [])
        .filter((team) => team.active)
        .map((team) => displayName(team).trim())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length)
        .slice(0, CANDIDATES),
    [teams]
  );

  const home = theme?.components.homeName;
  const away = theme?.components.awayName;
  return useMemo(() => {
    const check = (box: (NameBox & { textFit: string; visible: boolean }) | undefined) =>
      box && box.visible && box.textFit === "clip" && names.length && typeof document !== "undefined" ? widestClip(names, box) : null;
    return { homeName: check(home), awayName: check(away) };
    // fontTick is only a trigger: it re-runs the measurement after fonts load.
  }, [home, away, names, fontTick]);
}
