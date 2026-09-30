import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Moveable, { type OnDrag, type OnResize } from "react-moveable";
import type { ThemeDefinition } from "../../../shared/theme";
import { mirrorCounterpartId, mirroredX } from "../../../shared/themeArrange";
import {
  createFreeComponentId,
  getNextComponentZIndex,
  getThemeComponent,
  listThemeComponentEntries
} from "../../../shared/themeComponents";
import type { SnapSettings } from "../ThemeCanvasEditor";

// Safe-area insets in frame pixels, matching the overlay's safe-area guide.
const SAFE_AREA_TOP = 54;
const SAFE_AREA_SIDE = 96;
/** Selection id for the event card, which is part of the theme's event overlay rather than a piece. */
export const EVENT_CARD_ID = "__event-card";

export type EventCardTarget = {
  rect: { x: number; y: number; width: number; height: number };
  /** False while the card follows a logo or name: its position comes from that piece. */
  movable: boolean;
  label: string;
  badge?: string | null;
  onBadgeClick?: () => void;
};

const ALL_DIRECTIONS = { top: true, left: true, bottom: true, right: true, center: true, middle: true };

type MoveableLayerProps = {
  theme: ThemeDefinition;
  selectedIds: string[];
  /** On-screen scale of the frame. */
  scale: number;
  snapSettings: SnapSettings;
  lockedIds?: ReadonlySet<string>;
  /** Changes whenever the canvas pans or zooms, so the control box can follow the pieces on screen. */
  viewKey?: string;
  eventCard?: EventCardTarget | null;
  onSelect: (id: string, options?: { additive?: boolean }) => void;
  onCommit: (theme: ThemeDefinition) => void;
};

type Box = { x: number; y: number; width: number; height: number };
type Modifiers = { shift: boolean; noSnap: boolean; alt: boolean };

function readTranslate(transform: string | undefined) {
  const match = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(transform ?? "");
  return match ? { tx: Number(match[1]), ty: Number(match[2]) } : { tx: 0, ty: 0 };
}

/** Shift locks a drag to its dominant axis. */
function lockAxis(tx: number, ty: number, shift: boolean) {
  if (!shift) {
    return { tx, ty };
  }
  return Math.abs(tx) >= Math.abs(ty) ? { tx, ty: 0 } : { tx: 0, ty };
}

export function MoveableLayer({ theme, selectedIds, scale, snapSettings, lockedIds, viewKey, eventCard, onSelect, onCommit }: MoveableLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  // Moveable renders outside the CSS-scaled stage: inside it, snap corrections get scaled down and never land.
  const [controlHost, setControlHost] = useState<HTMLElement | null>(null);
  const [modifiers, setModifiers] = useState<Modifiers>({ shift: false, noSnap: false, alt: false });
  const modifiersRef = useRef(modifiers);
  modifiersRef.current = modifiers;
  const startBoxesRef = useRef<Map<string, Box>>(new Map());
  const sizeMatchRef = useRef<string | null>(null);
  // Set by any real drag or resize, so the click that follows it does not narrow the selection.
  const gestureMovedRef = useRef(false);

  const entries = useMemo(() => listThemeComponentEntries(theme), [theme]);
  const selectedKey = selectedIds.join("|");
  const { width: frameWidth, height: frameHeight } = theme.canvas;

  useEffect(() => {
    setControlHost(layerRef.current?.closest<HTMLElement>(".canvas-pan-layer") ?? null);
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) {
      return;
    }
    const next = selectedIds
      .filter((id) => !lockedIds?.has(id) && !(id === EVENT_CARD_ID && !eventCard?.movable))
      .map((id) => layer.querySelector<HTMLElement>(`[data-piece-id="${CSS.escape(id)}"]`))
      .filter((element): element is HTMLElement => Boolean(element));
    setTargets(next);
  }, [selectedKey, lockedIds, entries, eventCard?.movable, Boolean(eventCard)]);

  // Pieces move through React (left/top), not through Moveable; re-measure the control box after every change.
  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [entries, scale, targets, viewKey, eventCard?.rect.x, eventCard?.rect.y, eventCard?.rect.width, eventCard?.rect.height]);

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      const next = { shift: event.shiftKey, noSnap: event.metaKey || event.ctrlKey, alt: event.altKey };
      const current = modifiersRef.current;
      if (current.shift !== next.shift || current.noSnap !== next.noSnap || current.alt !== next.alt) {
        setModifiers(next);
      }
    };
    const reset = () => setModifiers({ shift: false, noSnap: false, alt: false });
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", reset);
    };
  }, []);

  // The mirror ghost: where the selected team piece's counterpart sits, reflected across the frame centre.
  const mirrorGhost = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null;
    }
    const counterpartId = mirrorCounterpartId(selectedIds[0]);
    const counterpart = counterpartId ? getThemeComponent(theme, counterpartId) : null;
    if (!counterpart) {
      return null;
    }
    return {
      x: mirroredX(frameWidth, counterpart.x, counterpart.width),
      y: counterpart.y,
      width: counterpart.width,
      height: counterpart.height
    };
  }, [selectedKey, theme, frameWidth]);

  const verticalGuides = [
    ...(snapSettings.canvasEdges ? [0, frameWidth / 2, frameWidth] : []),
    ...(snapSettings.safeArea ? [SAFE_AREA_SIDE, frameWidth - SAFE_AREA_SIDE] : [])
  ];
  const horizontalGuides = [
    ...(snapSettings.canvasEdges ? [0, frameHeight / 2, frameHeight] : []),
    ...(snapSettings.safeArea ? [SAFE_AREA_TOP, frameHeight - SAFE_AREA_TOP] : [])
  ];
  const guideKey = `${verticalGuides.join(",")}|${horizontalGuides.join(",")}|${mirrorGhost ? Object.values(mirrorGhost).join(",") : ""}`;

  // Everything Moveable may snap to. Frame lines and the mirror ghost are elements too: numeric guidelines
  // do not snap inside our scaled stage, element guidelines do.
  const guideElements = useMemo(() => {
    const layer = layerRef.current;
    if (!layer) {
      return [];
    }
    const selected = new Set(selectedIds);
    const pieces = snapSettings.componentEdges
      ? Array.from(layer.querySelectorAll<HTMLElement>("[data-piece-id]")).filter(
          (element) => !selected.has(element.dataset.pieceId ?? "") && element.dataset.visible === "true"
        )
      : [];
    return [...pieces, ...Array.from(layer.querySelectorAll<HTMLElement>("[data-guide]"))];
  }, [selectedKey, entries, snapSettings.componentEdges, guideKey, targets]);

  function rememberStart(ids: string[]) {
    const map = new Map<string, Box>();
    if (eventCard && ids.includes(EVENT_CARD_ID)) {
      map.set(EVENT_CARD_ID, { ...eventCard.rect });
    }
    for (const id of ids) {
      const component = getThemeComponent(theme, id);
      if (component) {
        map.set(id, { x: component.x, y: component.y, width: component.width, height: component.height });
      }
    }
    startBoxesRef.current = map;
    sizeMatchRef.current = null;
    gestureMovedRef.current = false;
  }

  function showHud(target: Element) {
    gestureMovedRef.current = true;
    const hud = hudRef.current;
    const host = controlHost;
    const element = target as HTMLElement;
    const id = element.dataset.pieceId;
    const start = id ? startBoxesRef.current.get(id) : undefined;
    if (!hud || !host || !start) {
      return;
    }
    const { tx, ty } = readTranslate(element.style.transform);
    const match = sizeMatchRef.current ? ` · ${sizeMatchRef.current}` : "";
    hud.textContent = `${Math.round(element.offsetWidth)} × ${Math.round(element.offsetHeight)} · x ${Math.round(start.x + tx)} y ${Math.round(start.y + ty)}${match}`;
    const rect = element.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    hud.style.left = `${rect.left - hostRect.left + rect.width / 2}px`;
    hud.style.top = `${rect.bottom - hostRect.top + 14}px`;
    hud.hidden = false;
  }

  function hideHud() {
    if (hudRef.current) {
      hudRef.current.hidden = true;
    }
  }

  // One commit per gesture: the drag moves DOM transforms; the theme changes once, on release.
  function commit(boxes: Array<{ id: string; box: Box }>, duplicate: boolean) {
    const next = structuredClone(theme);
    for (const { id, box } of boxes) {
      if (id === EVENT_CARD_ID) {
        const start = startBoxesRef.current.get(id);
        if (start) {
          next.teamEventOverlay.general.offsetX = Math.round(next.teamEventOverlay.general.offsetX + (box.x - start.x));
          next.teamEventOverlay.general.offsetY = Math.round(next.teamEventOverlay.general.offsetY + (box.y - start.y));
        }
        const element = layerRef.current?.querySelector<HTMLElement>(`[data-piece-id="${EVENT_CARD_ID}"]`);
        if (element) {
          element.style.transform = "";
        }
        continue;
      }
      const component = getThemeComponent(next, id);
      if (!component) {
        continue;
      }
      // Alt-drag leaves a copy of a custom piece where it started; fixed slots cannot be duplicated.
      if (duplicate) {
        const source = next.freeComponents.find((candidate) => candidate.id === id);
        if (source) {
          const copy = structuredClone(source);
          copy.id = createFreeComponentId();
          copy.label = `${source.label} Copy`.slice(0, 80);
          copy.zIndex = getNextComponentZIndex(next);
          next.freeComponents.push(copy);
        }
      }
      component.x = Math.round(box.x);
      component.y = Math.round(box.y);
      component.width = Math.max(1, Math.round(box.width));
      component.height = Math.max(1, Math.round(box.height));
      // Write the committed box straight onto the hit area. Clearing the inline size instead would leave it at
      // zero whenever React sees an unchanged value and skips re-applying it.
      const element = layerRef.current?.querySelector<HTMLElement>(`[data-piece-id="${CSS.escape(id)}"]`);
      if (element) {
        element.style.transform = "";
        element.style.left = `${component.x}px`;
        element.style.top = `${component.y}px`;
        element.style.width = `${component.width}px`;
        element.style.height = `${component.height}px`;
      }
    }
    hideHud();
    onCommit(next);
  }

  function boxesFromTargets(elements: Array<HTMLElement | SVGElement>, withSize: boolean) {
    return elements.flatMap((target) => {
      const element = target as HTMLElement;
      const id = element.dataset.pieceId;
      const start = id ? startBoxesRef.current.get(id) : undefined;
      if (!id || !start) {
        return [];
      }
      const { tx, ty } = readTranslate(element.style.transform);
      return [
        {
          id,
          box: withSize
            ? { x: start.x + tx, y: start.y + ty, width: element.offsetWidth, height: element.offsetHeight }
            : { ...start, x: start.x + tx, y: start.y + ty }
        }
      ];
    });
  }

  function applyDrag(event: OnDrag) {
    const [tx, ty] = event.beforeTranslate;
    const locked = lockAxis(tx, ty, modifiersRef.current.shift);
    event.target.style.transform = `translate(${locked.tx}px, ${locked.ty}px)`;
  }

  // Resizing from the right or bottom edge snaps to another piece's width or height.
  function matchSizeWhileResizing(event: OnResize) {
    const [dirX, dirY] = event.direction;
    const tolerance = scale > 0 ? snapSettings.threshold / scale : snapSettings.threshold;
    let width = event.width;
    let height = event.height;
    sizeMatchRef.current = null;
    if (!snapSettings.enabled || modifiersRef.current.noSnap) {
      return { width, height };
    }
    const selected = new Set(selectedIds);
    const others = entries.filter(({ id, component }) => !selected.has(id) && component.visible);
    if (dirX === 1 && dirY === 0) {
      const match = others.find(({ component }) => Math.abs(component.width - width) <= tolerance);
      if (match) {
        width = match.component.width;
        sizeMatchRef.current = `width of ${match.label}`;
      }
    }
    if (dirY === 1 && dirX === 0) {
      const match = others.find(({ component }) => Math.abs(component.height - height) <= tolerance);
      if (match) {
        height = match.component.height;
        sizeMatchRef.current = `height of ${match.label}`;
      }
    }
    return { width, height };
  }

  const snapOn = snapSettings.enabled && !modifiers.noSnap;

  return (
    <div ref={layerRef} className="mv-layer">
      {verticalGuides.map((x, index) => (
        <div key={`v${index}-${x}`} data-guide="v" className="mv-guide" style={{ left: x, top: 0, width: 0, height: frameHeight }} />
      ))}
      {horizontalGuides.map((y, index) => (
        <div key={`h${index}-${y}`} data-guide="h" className="mv-guide" style={{ left: 0, top: y, width: frameWidth, height: 0 }} />
      ))}
      {mirrorGhost ? (
        <div
          data-guide="mirror"
          className="mv-mirror-ghost"
          style={{ left: mirrorGhost.x, top: mirrorGhost.y, width: mirrorGhost.width, height: mirrorGhost.height }}
          aria-hidden
        />
      ) : null}
      {entries.map(({ id, label, component }) => {
        const locked = lockedIds?.has(id) ?? false;
        return (
          <div
            key={id}
            data-piece-id={id}
            data-visible={component.visible ? "true" : "false"}
            className={["mv-piece", selectedIds.includes(id) ? "mv-piece--selected" : "", locked ? "mv-piece--locked" : ""].join(" ")}
            style={{ left: component.x, top: component.y, width: component.width, height: component.height, zIndex: component.zIndex }}
            aria-label={label}
            title={locked ? `${label} (locked)` : undefined}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              if (!selectedIds.includes(id) || event.shiftKey) {
                onSelect(id, { additive: event.shiftKey });
              }
            }}
            onClick={(event) => {
              // A plain click on a piece inside a group selection narrows the selection to that piece.
              if (gestureMovedRef.current) {
                gestureMovedRef.current = false;
                return;
              }
              if (!event.shiftKey && selectedIds.length > 1 && selectedIds.includes(id)) {
                onSelect(id, { additive: false });
              }
            }}
            onContextMenu={() => {
              if (!selectedIds.includes(id)) {
                onSelect(id, { additive: false });
              }
            }}
          />
        );
      })}
      {eventCard ? (
        <div
          data-piece-id={EVENT_CARD_ID}
          data-visible="true"
          className={["mv-piece", "mv-event-card", selectedIds.includes(EVENT_CARD_ID) ? "mv-piece--selected" : "", eventCard.movable ? "" : "mv-piece--locked"].join(" ")}
          style={{ left: eventCard.rect.x, top: eventCard.rect.y, width: eventCard.rect.width, height: eventCard.rect.height, zIndex: 10000 }}
          aria-label={eventCard.label}
          onPointerDown={(event) => {
            if (event.button === 0 && !selectedIds.includes(EVENT_CARD_ID)) {
              onSelect(EVENT_CARD_ID, { additive: false });
            }
          }}
          onContextMenu={() => onSelect(EVENT_CARD_ID, { additive: false })}
        />
      ) : null}
      {eventCard?.badge ? (
        <button
          type="button"
          className="mv-event-badge"
          style={{ left: eventCard.rect.x, top: eventCard.rect.y + eventCard.rect.height, transform: `scale(${scale > 0 ? 1 / scale : 1})` }}
          onClick={eventCard.onBadgeClick}
        >
          {eventCard.badge}
        </button>
      ) : null}
      {controlHost ? createPortal(<div ref={hudRef} className="mv-hud" hidden />, controlHost) : null}
      {targets.length && controlHost
        ? createPortal(
            <Moveable
              ref={moveableRef}
              target={targets.length === 1 ? targets[0] : targets}
              draggable
              resizable={!selectedIds.includes(EVENT_CARD_ID)}
              keepRatio={modifiers.shift}
              throttleDrag={0}
              throttleResize={0}
              origin={false}
              snappable={snapOn}
              snapContainer={layerRef.current}
              snapGap={snapOn}
              snapThreshold={snapSettings.threshold}
              isDisplaySnapDigit={snapSettings.showDistanceLabels}
              snapDistFormat={(value) => Math.round(scale > 0 ? value / scale : value)}
              snapDirections={ALL_DIRECTIONS}
              elementSnapDirections={ALL_DIRECTIONS}
              elementGuidelines={guideElements}
              snapGridWidth={snapSettings.gridEnabled ? snapSettings.gridSize * scale : 0}
              snapGridHeight={snapSettings.gridEnabled ? snapSettings.gridSize * scale : 0}
              onDragStart={() => rememberStart(selectedIds)}
              onDrag={(event) => {
                applyDrag(event);
                showHud(event.target);
              }}
              onDragEnd={(event) => {
                if (!event.isDrag) {
                  hideHud();
                  return;
                }
                commit(boxesFromTargets([event.target], false), modifiersRef.current.alt);
              }}
              onResizeStart={() => rememberStart(selectedIds)}
              onResize={(event) => {
                const { width, height } = matchSizeWhileResizing(event);
                event.target.style.width = `${width}px`;
                event.target.style.height = `${height}px`;
                event.target.style.transform = event.drag.transform;
                showHud(event.target);
              }}
              onResizeEnd={(event) => {
                if (!event.isDrag) {
                  hideHud();
                  return;
                }
                commit(boxesFromTargets([event.target], true), false);
              }}
              onClickGroup={(event) => {
                // Moveable reports only clicks without a drag: narrow the group to the piece under the pointer.
                const element = event.inputTarget as HTMLElement | null;
                const pieceId =
                  element?.closest<HTMLElement>("[data-piece-id]")?.dataset.pieceId ??
                  (event.targetIndex >= 0 ? (targets[event.targetIndex] as HTMLElement | undefined)?.dataset.pieceId : undefined);
                if (pieceId && !event.inputEvent?.shiftKey) {
                  onSelect(pieceId, { additive: false });
                }
              }}
              onDragGroupStart={() => rememberStart(selectedIds)}
              onDragGroup={(event) => {
                const [tx, ty] = event.beforeTranslate;
                const locked = lockAxis(tx, ty, modifiersRef.current.shift);
                for (const child of event.events) {
                  child.target.style.transform = `translate(${locked.tx}px, ${locked.ty}px)`;
                }
                showHud(event.events[0].target);
              }}
              onDragGroupEnd={(event) => {
                if (!event.isDrag) {
                  hideHud();
                  return;
                }
                commit(boxesFromTargets(event.targets, false), modifiersRef.current.alt);
              }}
              onResizeGroupStart={() => rememberStart(selectedIds)}
              onResizeGroup={(event) => {
                for (const child of event.events) {
                  child.target.style.width = `${child.width}px`;
                  child.target.style.height = `${child.height}px`;
                  child.target.style.transform = child.drag.transform;
                }
                showHud(event.events[0].target);
              }}
              onResizeGroupEnd={(event) => {
                if (!event.isDrag) {
                  hideHud();
                  return;
                }
                commit(boxesFromTargets(event.targets, true), false);
              }}
            />,
            controlHost
          )
        : null}
    </div>
  );
}
