import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import type { ThemeDefinition } from "../../shared/theme";
import type { NormalizedLiveState, StoredAsset } from "../../shared/theme";
import { getThemeComponent, listThemeComponentEntries, type ThemeComponent } from "../../shared/themeComponents";
import { OverlayRenderer } from "./OverlayRenderer";
import { ScaledCanvasFrame } from "./ScaledCanvasFrame";
import * as Slider from "@radix-ui/react-slider";
import { MoveableLayer, type OverlayTarget } from "./editor/MoveableLayer";
import { Field, SwitchRow } from "./editor/fields";

type ThemeCanvasEditorProps = {
  theme: ThemeDefinition;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
  selectedId: string | null;
  selectedIds?: string[];
  selectAll?: boolean;
  zoom?: number;
  onZoomChange?: (nextZoom: number) => void;
  /** "fullscreen" drops the built-in toolbar, fits the frame between floating chrome, and hands controls to renderChrome. */
  layout?: "embedded" | "fullscreen";
  fitInsets?: FitInsets;
  /** Hand tool: plain drags pan instead of selecting. */
  panMode?: boolean;
  /** Pieces that stay put: not draggable, still snap targets. Editor-only, not part of the theme. */
  lockedIds?: ReadonlySet<string>;
  /** The event or moment card shown by the current preview state, selectable on the canvas. */
  overlayTarget?: OverlayTarget | null;
  /** Editor-only: show the timeout card without waiting for the feed (held, or one full flash). */
  previewTimeout?: "hold" | "flash" | null;
  /** Changing this remounts the overlay render, replaying entrance animations. */
  overlayKey?: number;
  renderChrome?: (api: CanvasChromeApi) => ReactNode;
  onSelect: (id: string, options?: { additive?: boolean }) => void;
  onMarqueeSelect?: (ids: string[], options?: { additive?: boolean }) => void;
  onSelectAll?: () => void;
  onUpdate: (theme: ThemeDefinition) => void;
};

const CAMERA_MIN_ZOOM = 0.25;
const CAMERA_MAX_ZOOM = 6;




type FitInsets = { top: number; right: number; bottom: number; left: number };

export type CanvasChromeApi = {
  /** Real on-screen scale of the 1920×1080 frame, as a percentage. */
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  focusSelected: () => void;
  canFocus: boolean;
  snapSettings: SnapSettings;
  setSnapSettings: (update: (current: SnapSettings) => SnapSettings) => void;
};

export type SnapSettings = {
  enabled: boolean;
  threshold: number;
  canvasEdges: boolean;
  safeArea: boolean;
  componentEdges: boolean;
  gridEnabled: boolean;
  gridSize: number;
  showDistanceLabels: boolean;
};

type MarqueeSelectionState = {
  pointerId: number;
  /** Shift-drag adds to the current selection. */
  additive: boolean;
  startViewportX: number;
  startViewportY: number;
  currentViewportX: number;
  currentViewportY: number;
};

/** The Snap menu's options: what pieces snap to, how close counts, and the pixel grid. */
export function SnapOptionsPanel({
  settings,
  onChange
}: {
  settings: SnapSettings;
  onChange: (update: (current: SnapSettings) => SnapSettings) => void;
}) {
  const set = <K extends keyof SnapSettings>(key: K, value: SnapSettings[K]) => onChange((current) => ({ ...current, [key]: value }));
  return (
    <div className="te-snap-options">
      <SwitchRow label="Frame edges and centre" checked={settings.canvasEdges} onChange={(value) => set("canvasEdges", value)} />
      <SwitchRow label="Safe area" checked={settings.safeArea} onChange={(value) => set("safeArea", value)} />
      <SwitchRow label="Other pieces" checked={settings.componentEdges} onChange={(value) => set("componentEdges", value)} />
      <SwitchRow label="Show distances" checked={settings.showDistanceLabels} onChange={(value) => set("showDistanceLabels", value)} />
      <RangeRow label="Snaps within" value={settings.threshold} min={4} max={32} step={1} onChange={(value) => set("threshold", value)} />
      <SwitchRow label="Pixel grid" checked={settings.gridEnabled} onChange={(value) => set("gridEnabled", value)} />
      {settings.gridEnabled ? (
        <RangeRow label="Grid size" value={settings.gridSize} min={2} max={32} step={2} onChange={(value) => set("gridSize", value)} />
      ) : null}
      <p className="te-field-hint">Hold Shift while resizing to keep the aspect ratio.</p>
    </div>
  );
}

function RangeRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <Field label={`${label} ${value}px`}>
      <Slider.Root className="te-slider" min={min} max={max} step={step} value={[value]} onValueChange={([next]) => onChange(next)} aria-label={label}>
        <Slider.Track className="te-slider-track">
          <Slider.Range className="te-slider-range" />
        </Slider.Track>
        <Slider.Thumb className="te-slider-thumb" aria-label={label} />
      </Slider.Root>
    </Field>
  );
}

export function ThemeCanvasEditor({
  theme,
  live,
  assets,
  selectedId,
  selectedIds,
  selectAll = false,
  zoom = 1,
  onZoomChange,
  layout = "embedded",
  fitInsets,
  panMode = false,
  lockedIds,
  overlayTarget,
  previewTimeout,
  overlayKey,
  renderChrome,
  onSelect,
  onMarqueeSelect,
  onSelectAll,
  onUpdate
}: ThemeCanvasEditorProps) {
  const fullscreen = layout === "fullscreen";
  const [appliedScale, setAppliedScale] = useState(1);
  // True until the viewer pans or zooms; while true, resizes keep the frame fitted.
  const fittedRef = useRef(false);
  const needsInitialFitRef = useRef(false);
  // Read through a ref so resize and timer callbacks always fit against the current chrome.
  const fitInsetsRef = useRef(fitInsets);
  fitInsetsRef.current = fitInsets;
  const [snapSettings, setSnapSettings] = useState<SnapSettings>({
    enabled: true,
    threshold: 6,
    canvasEdges: true,
    safeArea: true,
    componentEdges: true,
    gridEnabled: false,
    gridSize: 8,
    showDistanceLabels: true
  });
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpacePressed] = useState(false);
  const spacePressed = spaceHeld || panMode;
  const [shiftPressed, setShiftPressed] = useState(false);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cameraX: number;
    cameraY: number;
  } | null>(null);
  const stageScaleRef = useRef(1);
  const panLayerRef = useRef<HTMLDivElement | null>(null);
  const themeId = (theme as { id?: string }).id ?? "default";
  // v3: v2 could hold a pre-fit {0,0} written before the restore landed.
  const cameraStorageKey = `pbresults.themeEditor.camera.${fullscreen ? "v3." : ""}${themeId}`;
  const skipCameraSaveRef = useRef(false);
  const selectedIdSet = new Set(selectedIds ?? (selectedId ? [selectedId] : []));

  function getMarqueeWorldRect(selection: MarqueeSelectionState) {
    const scale = stageScaleRef.current || 1;
    const leftViewport = Math.min(selection.startViewportX, selection.currentViewportX);
    const topViewport = Math.min(selection.startViewportY, selection.currentViewportY);
    const rightViewport = Math.max(selection.startViewportX, selection.currentViewportX);
    const bottomViewport = Math.max(selection.startViewportY, selection.currentViewportY);

    const left = (leftViewport - camera.x) / scale;
    const top = (topViewport - camera.y) / scale;
    const right = (rightViewport - camera.x) / scale;
    const bottom = (bottomViewport - camera.y) / scale;

    return {
      x: Math.max(0, Math.min(theme.canvas.width, Math.round(left))),
      y: Math.max(0, Math.min(theme.canvas.height, Math.round(top))),
      width: Math.max(0, Math.round(Math.max(0, right - left))),
      height: Math.max(0, Math.round(Math.max(0, bottom - top)))
    };
  }

  function clampZoom(nextZoom: number) {
    return Math.min(CAMERA_MAX_ZOOM, Math.max(CAMERA_MIN_ZOOM, nextZoom));
  }

  function clampCameraToViewport(nextCamera: { x: number; y: number }, scale: number) {
    const frameRect = panLayerRef.current?.getBoundingClientRect();
    if (!frameRect || scale <= 0) {
      return {
        x: Math.round(nextCamera.x),
        y: Math.round(nextCamera.y)
      };
    }

    const scaledCanvasWidth = theme.canvas.width * scale;
    const scaledCanvasHeight = theme.canvas.height * scale;
    const viewportWidth = frameRect.width;
    const viewportHeight = frameRect.height;

    const minX = Math.round(Math.min(0, viewportWidth - scaledCanvasWidth));
    const maxX = Math.round(Math.max(0, viewportWidth - scaledCanvasWidth));
    const minY = Math.round(Math.min(0, viewportHeight - scaledCanvasHeight));
    const maxY = Math.round(Math.max(0, viewportHeight - scaledCanvasHeight));

    return {
      x: Math.round(Math.min(maxX, Math.max(minX, nextCamera.x))),
      y: Math.round(Math.min(maxY, Math.max(minY, nextCamera.y)))
    };
  }

  function fitCanvas() {
    fittedRef.current = true;
    if (onZoomChange) {
      onZoomChange(1);
    }
    const frameRect = panLayerRef.current?.getBoundingClientRect();
    if (!fullscreen || !frameRect) {
      setCamera({ x: 0, y: 0 });
      return;
    }
    // Centre the fitted frame in the space the floating chrome leaves free.
    const insets = fitInsetsRef.current ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const availableWidth = Math.max(1, frameRect.width - insets.left - insets.right);
    const availableHeight = Math.max(1, frameRect.height - insets.top - insets.bottom);
    const fitScale = Math.min(1, availableWidth / theme.canvas.width, availableHeight / theme.canvas.height);
    setCamera({
      x: Math.round(insets.left + (availableWidth - theme.canvas.width * fitScale) / 2),
      y: Math.round(insets.top + (availableHeight - theme.canvas.height * fitScale) / 2)
    });
  }

  function focusSelectedComponent() {
    fittedRef.current = false;
    if (!selectedId) {
      fitCanvas();
      return;
    }

    const frameRect = panLayerRef.current?.getBoundingClientRect();
    if (!frameRect) {
      return;
    }

    const component = getThemeComponent(theme, selectedId);
    if (!component) {
      return;
    }
    const currentScale = stageScaleRef.current || 1;
    const worldCenterX = component.x + component.width / 2;
    const worldCenterY = component.y + component.height / 2;
    const targetCenterX = frameRect.width / 2;
    const targetCenterY = frameRect.height / 2;

    const nextCamera = clampCameraToViewport(
      {
      x: Math.round(targetCenterX - worldCenterX * currentScale),
      y: Math.round(targetCenterY - worldCenterY * currentScale)
      },
      currentScale
    );
    setCamera((current) => (current.x === nextCamera.x && current.y === nextCamera.y ? current : nextCamera));
  }

  function isTextEditingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    // Keys pressed inside an open menu, popover or tooltip belong to it (Esc closes it, not the selection).
    if (target.closest("[data-radix-popper-content-wrapper]")) {
      return true;
    }
    if (target.isContentEditable) {
      return true;
    }
    const field = target.closest("input, textarea, select");
    return field !== null;
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Space") {
        setSpacePressed(true);
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        setShiftPressed(true);
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        setShiftPressed(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // The save effect below runs in this same commit with the camera from before the restore; skip that write.
    skipCameraSaveRef.current = true;
    try {
      const raw = window.localStorage.getItem(cameraStorageKey);
      if (!raw) {
        setCamera({ x: 0, y: 0 });
        needsInitialFitRef.current = fullscreen;
        return;
      }

      const parsed = JSON.parse(raw) as { camera?: { x?: number; y?: number }; zoom?: number };
      setCamera({
        x: Math.round(parsed.camera?.x ?? 0),
        y: Math.round(parsed.camera?.y ?? 0)
      });

      if (onZoomChange && typeof parsed.zoom === "number") {
        onZoomChange(clampZoom(parsed.zoom));
      }
    } catch {
      setCamera({ x: 0, y: 0 });
    }
  }, [cameraStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (skipCameraSaveRef.current) {
      skipCameraSaveRef.current = false;
      return;
    }
    if (needsInitialFitRef.current) {
      return;
    }

    window.localStorage.setItem(
      cameraStorageKey,
      JSON.stringify({
        camera,
        zoom
      })
    );
  }, [cameraStorageKey, camera, zoom]);

  // Re-clamp only when zoom or frame size really changes. On mount the stage has not measured its scale yet,
  // and clamping at the fallback scale of 1 would throw away the restored or fitted camera.
  const clampKey = `${zoom}|${theme.canvas.width}|${theme.canvas.height}`;
  const lastClampKeyRef = useRef(clampKey);
  useEffect(() => {
    if (lastClampKeyRef.current === clampKey) {
      return;
    }
    lastClampKeyRef.current = clampKey;
    const scale = stageScaleRef.current || 1;
    setCamera((current) => {
      const clamped = clampCameraToViewport(current, scale);
      if (current.x === clamped.x && current.y === clamped.y) {
        return current;
      }
      return clamped;
    });
  }, [clampKey]);

  useEffect(() => {
    if (!fullscreen || !needsInitialFitRef.current || !panLayerRef.current) {
      return;
    }
    // Fit once the scale has settled after mount, so the mount-time clamp cannot undo it. A timer, not
    // requestAnimationFrame: rAF never fires while the tab is in the background.
    // The flag clears only when the fit really runs, so a cancelled attempt retries on the next scale change.
    const timer = window.setTimeout(() => {
      needsInitialFitRef.current = false;
      fitCanvas();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [appliedScale, fullscreen]);

  useEffect(() => {
    if (fullscreen && fittedRef.current) {
      fitCanvas();
    }
  }, [fitInsets?.top, fitInsets?.right, fitInsets?.bottom, fitInsets?.left]);

  useEffect(() => {
    function handleResize() {
      if (fullscreen && fittedRef.current) {
        fitCanvas();
        return;
      }
      const scale = stageScaleRef.current || 1;
      setCamera((current) => {
        const clamped = clampCameraToViewport(current, scale);
        if (current.x === clamped.x && current.y === clamped.y) {
          return current;
        }
        return clamped;
      });
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [zoom, theme.canvas.width, theme.canvas.height]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTextEditingTarget(event.target)) {
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        fitCanvas();
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        if (onZoomChange) {
          onZoomChange(1);
        }
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusSelectedComponent();
        return;
      }

      if (event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setSnapSettings((current) => ({ ...current, enabled: !current.enabled }));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onZoomChange, selectedId, theme]);

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const isFormControl = target.closest("input, select, textarea, button");
    const isComponentInteractionTarget = target.closest(
      ".editor-hitbox, .mv-piece, .moveable-control-box"
    );
    const canPanWithLeft = event.button === 0 && spacePressed;
    const canPanWithMiddle = event.button === 1;
    const canPanWithPlainLeft = false;
    const canMarqueeSelect = event.button === 0 && !spacePressed && !isFormControl && !isComponentInteractionTarget;

    if (canMarqueeSelect) {
      event.preventDefault();
      const frameRect = event.currentTarget.getBoundingClientRect();
      setMarqueeSelection({
        pointerId: event.pointerId,
        additive: event.shiftKey,
        startViewportX: event.clientX - frameRect.left,
        startViewportY: event.clientY - frameRect.top,
        currentViewportX: event.clientX - frameRect.left,
        currentViewportY: event.clientY - frameRect.top
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (!canPanWithLeft && !canPanWithMiddle && !canPanWithPlainLeft) {
      return;
    }

    if ((isFormControl || isComponentInteractionTarget) && !canPanWithMiddle) {
      return;
    }

    event.preventDefault();
    setIsPanning(true);
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (marqueeSelection && marqueeSelection.pointerId === event.pointerId) {
      const frameRect = event.currentTarget.getBoundingClientRect();
      setMarqueeSelection((current) =>
        current && current.pointerId === event.pointerId
          ? {
              ...current,
              currentViewportX: event.clientX - frameRect.left,
              currentViewportY: event.clientY - frameRect.top
            }
          : current
      );
      return;
    }

    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    fittedRef.current = false;
    const nextCamera = clampCameraToViewport(
      {
        x: Math.round(panState.cameraX + deltaX),
        y: Math.round(panState.cameraY + deltaY)
      },
      stageScaleRef.current || 1
    );
    setCamera((current) => (current.x === nextCamera.x && current.y === nextCamera.y ? current : nextCamera));
  }

  function handleStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (marqueeSelection && marqueeSelection.pointerId === event.pointerId) {
      const worldRect = getMarqueeWorldRect(marqueeSelection);
      if (worldRect.width < 3 && worldRect.height < 3 && !marqueeSelection.additive) {
        // A plain click on empty canvas clears the selection.
        onMarqueeSelect?.([], { additive: false });
      } else if (worldRect.width >= 3 || worldRect.height >= 3) {
        const intersectingIds = listThemeComponentEntries(theme)
          .filter(({ component }) => component.visible)
          .filter(({ component }) => {
            const componentRight = component.x + component.width;
            const componentBottom = component.y + component.height;
            const rectRight = worldRect.x + worldRect.width;
            const rectBottom = worldRect.y + worldRect.height;
            return (
              component.x < rectRight &&
              componentRight > worldRect.x &&
              component.y < rectBottom &&
              componentBottom > worldRect.y
            );
          })
          .map(({ id }) => id);

        onMarqueeSelect?.(intersectingIds, { additive: marqueeSelection.additive });
      }

      setMarqueeSelection(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    panStateRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleStageWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey) || !onZoomChange) {
      return;
    }

    event.preventDefault();
    fittedRef.current = false;
    const currentScale = stageScaleRef.current || 1;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = clampZoom(zoom * factor);
    const zoomRatio = zoom === 0 ? 1 : nextZoom / zoom;
    const nextScale = currentScale * zoomRatio;
    const frameRect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - frameRect.left;
    const cursorY = event.clientY - frameRect.top;
    const worldX = (cursorX - camera.x) / currentScale;
    const worldY = (cursorY - camera.y) / currentScale;

    const nextCamera = clampCameraToViewport(
      {
        x: Math.round(cursorX - worldX * nextScale),
        y: Math.round(cursorY - worldY * nextScale)
      },
      nextScale
    );
    setCamera((current) => (current.x === nextCamera.x && current.y === nextCamera.y ? current : nextCamera));
    onZoomChange(Math.round(nextZoom * 1000) / 1000);
  }

  function stepZoom(delta: -0.1 | 0.1) {
    if (!onZoomChange) {
      return;
    }

    fittedRef.current = false;
    const nextZoom = clampZoom(Math.round((zoom + delta) * 1000) / 1000);
    onZoomChange(nextZoom);
  }

  return (
    <div className={fullscreen ? "canvas-editor-shell canvas-editor-shell--fullscreen" : "canvas-editor-shell"}>
      <div
        className={`canvas-pan-layer ${isPanning ? "is-panning" : spacePressed ? "can-pan" : ""}`}
        ref={panLayerRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onWheel={handleStageWheel}
      >
        <ScaledCanvasFrame
          width={theme.canvas.width}
          height={theme.canvas.height}
          className="canvas-stage-frame"
          innerClassName="canvas-stage"
          mode={fullscreen ? "contain" : "width"}
          fill={fullscreen}
          insets={fullscreen ? fitInsets : undefined}
          onScaleChange={setAppliedScale}
          zoom={zoom}
          camera={camera}
        >
          {(stageScale) => {
            stageScaleRef.current = stageScale;
            return (
              <>
            {fullscreen ? (
              <div className="te-frame-label" style={{ transform: `scale(${stageScale > 0 ? 1 / stageScale : 1})` }}>
                <strong>Broadcast frame</strong> · {theme.canvas.width} × {theme.canvas.height} ·{" "}
                {theme.canvas.transparentPreview ? "transparent preview" : "theme background"}
              </div>
            ) : null}
            <OverlayRenderer
              key={overlayKey}
              theme={theme}
              transparentBackground={fullscreen && theme.canvas.transparentPreview}
              live={live}
              assets={assets}
              previewTimeout={previewTimeout}
              editable
              selectedComponentId={selectAll ? null : selectedId}
              onSelectComponent={onSelect}
            />

            {marqueeSelection ? (
              <span
                className="canvas-marquee"
                style={getMarqueeWorldRect(marqueeSelection)}
              />
            ) : null}

            <MoveableLayer
              theme={theme}
              selectedIds={selectAll ? listThemeComponentEntries(theme).map((entry) => entry.id) : Array.from(selectedIdSet)}
              scale={stageScale}
              snapSettings={snapSettings}
              lockedIds={lockedIds}
              overlayTarget={overlayTarget}
              viewKey={`${camera.x},${camera.y},${stageScale}`}
              onSelect={onSelect}
              onCommit={onUpdate}
            />

              </>
            );
          }}
        </ScaledCanvasFrame>
      </div>
      {renderChrome
        ? renderChrome({
            zoomPercent: Math.round(appliedScale * 100),
            canZoomIn: zoom < CAMERA_MAX_ZOOM,
            canZoomOut: zoom > CAMERA_MIN_ZOOM,
            zoomIn: () => stepZoom(0.1),
            zoomOut: () => stepZoom(-0.1),
            fit: fitCanvas,
            focusSelected: focusSelectedComponent,
            canFocus: Boolean(selectedId),
            snapSettings,
            setSnapSettings
          })
        : null}
    </div>
  );
}
