import { useEffect, useState } from "react";

/** Faces already added to the page, by family and file, so re-renders never add a font twice. */
const registered = new Map<string, FontFace>();

/** How long the live overlay waits for custom fonts before showing anyway, so a broken file never blanks the show. */
export const FONT_WAIT_LIMIT_MS = 3000;

/**
 * Registers the theme's custom fonts with the page and reports when they have loaded (or the wait limit passed).
 * Each file covers every weight, so the browser never fakes a bold from it.
 */
export function useThemeFonts(faces: Array<{ family: string; url: string }>): boolean {
  const key = faces.map((face) => `${face.family}|${face.url}`).join(",");
  const [readyKey, setReadyKey] = useState<string | null>(faces.length === 0 ? key : null);

  useEffect(() => {
    if (faces.length === 0 || typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) {
      setReadyKey(key);
      return;
    }
    let cancelled = false;
    const loads = faces.map(({ family, url }) => {
      const id = `${family}|${url}`;
      let face = registered.get(id);
      if (!face) {
        face = new FontFace(family, `url("${encodeURI(url)}")`, { weight: "100 900", style: "normal" });
        document.fonts.add(face);
        registered.set(id, face);
      }
      return face.load().catch(() => undefined);
    });
    const timeout = window.setTimeout(() => {
      if (!cancelled) setReadyKey(key);
    }, FONT_WAIT_LIMIT_MS);
    void Promise.all(loads).then(() => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      setReadyKey(key);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
    // The key captures every face; the array itself is rebuilt each render.
  }, [key]);

  return readyKey === key;
}
