import { useEffect, useLayoutEffect, useReducer, useRef, type CSSProperties, type ReactNode } from "react";
import type { TextFitSettings } from "../../shared/theme";

const TOLERANCE_PX = 0.5;
/** Fit a pixel short of the box: widths are measured in whole pixels, and an exact fit can still trip the ellipsis. */
const FIT_MARGIN_PX = 1;
const MULTILINE_STEPS = 7;

function overflows(element: HTMLElement) {
  return element.scrollWidth > element.clientWidth + TOLERANCE_PX || element.scrollHeight > element.clientHeight + TOLERANCE_PX;
}

/**
 * Shrinks the text inside `element` until it fits its box, never below `minScale` of the inherited size. Writes the
 * size straight to the element before paint, so the overlay never shows a frame of overflowing text.
 */
export function fitTextToBox(element: HTMLElement, minScale: number, multiline: boolean) {
  element.style.fontSize = "";
  if (element.clientWidth === 0 || !overflows(element)) {
    return;
  }
  const baseSize = Number.parseFloat(getComputedStyle(element).fontSize);
  if (!Number.isFinite(baseSize) || baseSize <= 0) {
    return;
  }
  const apply = (scale: number) => {
    element.style.fontSize = `${baseSize * scale}px`;
  };

  if (!multiline) {
    // Width scales almost linearly with size; a second pass corrects for letter spacing, which does not.
    let scale = Math.max(minScale, (element.clientWidth - FIT_MARGIN_PX) / element.scrollWidth);
    apply(scale);
    if (scale > minScale && overflows(element)) {
      scale = Math.max(minScale, (scale * (element.clientWidth - FIT_MARGIN_PX)) / element.scrollWidth);
      apply(scale);
    }
    return;
  }

  // Wrapped text reflows as it shrinks, so search for the largest size that fits.
  let low = minScale;
  let high = 1;
  for (let step = 0; step < MULTILINE_STEPS; step += 1) {
    const middle = (low + high) / 2;
    apply(middle);
    if (overflows(element)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  apply(low);
}

/**
 * Text content that follows a theme's fit setting. "clip" renders the text as before; "ellipsis" ends long text in
 * "…"; "shrink" scales it down to fit, then ends in "…" past the minimum size.
 */
export function FitText({
  settings,
  multiline = false,
  textAlign,
  children
}: {
  settings: Pick<TextFitSettings, "textFit" | "textFitMinScale">;
  multiline?: boolean;
  textAlign?: CSSProperties["textAlign"];
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [, remeasure] = useReducer((tick: number) => tick + 1, 0);
  const shrink = settings.textFit === "shrink";

  // Runs after every render: content, font and box changes all arrive as renders, and measuring a few spans is cheap.
  useLayoutEffect(() => {
    if (ref.current && shrink) {
      fitTextToBox(ref.current, settings.textFitMinScale, multiline);
    } else if (ref.current) {
      ref.current.style.fontSize = "";
    }
  });

  // A web font that finishes loading changes the text's width without a render.
  useEffect(() => {
    if (!shrink || typeof document === "undefined" || !document.fonts) {
      return;
    }
    document.fonts.addEventListener("loadingdone", remeasure);
    return () => document.fonts.removeEventListener("loadingdone", remeasure);
  }, [shrink]);

  // The box can also change size without this component rendering (e.g. resized in the editor).
  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!shrink || !box || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => remeasure());
    observer.observe(box);
    return () => observer.disconnect();
  }, [shrink]);

  if (settings.textFit === "clip") {
    return <>{children}</>;
  }
  return (
    <span
      ref={ref}
      className={multiline ? "text-fit text-fit--multiline" : "text-fit"}
      style={textAlign ? { textAlign } : undefined}
    >
      {children}
    </span>
  );
}
