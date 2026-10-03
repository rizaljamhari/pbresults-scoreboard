import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { designBounds } from "../../../shared/placement";
import type { PlacementSettings, ThemeDefinition } from "../../../shared/theme";

type Move = Pick<PlacementSettings, "scale" | "offsetX" | "offsetY">;

/**
 * The dotted frame in the editor's Design view: where the design lands on air. Drag its label to move it, and its
 * corner to resize it (the shape stays the design's). The change is saved when the pointer lets go, so one drag is
 * one undo step. Both handles are buttons, so the canvas does not start a marquee under them.
 */
export function PlacementFrame({ theme, stageScale, onCommit }: { theme: ThemeDefinition; stageScale: number; onCommit: (next: Move) => void }) {
  const [draft, setDraft] = useState<Move | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; start: Move; mode: "move" | "resize" } | null>(null);
  const found = designBounds(theme);
  if (!found) return null;
  const bounds = found;
  const current: Move = draft ?? { scale: theme.placement.scale, offsetX: theme.placement.offsetX, offsetY: theme.placement.offsetY };
  const frame = {
    x: bounds.x * current.scale + current.offsetX,
    y: bounds.y * current.scale + current.offsetY,
    width: bounds.width * current.scale,
    height: bounds.height * current.scale
  };
  const px = 1 / (stageScale || 1);
  const widthShare = Math.round(((bounds.width * current.scale) / theme.canvas.width) * 100);

  function begin(mode: "move" | "resize", event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: current, mode };
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) * px;
    const dy = (event.clientY - drag.startY) * px;
    if (drag.mode === "move") {
      setDraft({ ...drag.start, offsetX: Math.round(drag.start.offsetX + dx), offsetY: Math.round(drag.start.offsetY + dy) });
      return;
    }
    // Resize from the bottom-right corner, keeping the top-left where it is and the design's shape.
    const startWidth = bounds.width * drag.start.scale;
    const scale = Math.min(1, Math.max(0.05, (drag.start.scale * Math.max(20, startWidth + dx)) / startWidth));
    const left = bounds.x * drag.start.scale + drag.start.offsetX;
    const top = bounds.y * drag.start.scale + drag.start.offsetY;
    const rounded = Math.round(scale * 1000) / 1000;
    setDraft({ scale: rounded, offsetX: Math.round(left - bounds.x * rounded), offsetY: Math.round(top - bounds.y * rounded) });
  }

  function end(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (draft && (draft.scale !== drag.start.scale || draft.offsetX !== drag.start.offsetX || draft.offsetY !== drag.start.offsetY)) {
      onCommit(draft);
    }
    setDraft(null);
  }

  return (
    <div
      className="placement-frame"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, borderWidth: 2 * px }}
      aria-hidden
    >
      <button
        type="button"
        tabIndex={-1}
        className="placement-frame-label"
        style={{ transform: `scale(${px})` }}
        title="Drag to move where the scoreboard shows on air"
        onPointerDown={(event) => begin("move", event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        On air · {widthShare}% wide
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="placement-frame-corner"
        style={{ width: 14 * px, height: 14 * px, right: -7 * px, bottom: -7 * px, borderWidth: 2 * px }}
        title="Drag to resize the scoreboard on air"
        onPointerDown={(event) => begin("resize", event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}
