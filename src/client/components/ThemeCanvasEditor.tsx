import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { Rnd } from "react-rnd";
import type { ThemeDefinition, ComponentId } from "../../shared/theme";
import type { NormalizedLiveState, StoredAsset } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";
import { ScaledCanvasFrame } from "./ScaledCanvasFrame";

type ThemeCanvasEditorProps = {
  theme: ThemeDefinition;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
  selectedId: ComponentId | null;
  selectedIds?: ComponentId[];
  selectAll?: boolean;
  zoom?: number;
  onZoomChange?: (nextZoom: number) => void;
  toolbar?: ReactNode;
  onSelect: (id: ComponentId, options?: { additive?: boolean }) => void;
  onMarqueeSelect?: (ids: ComponentId[], options?: { additive?: boolean }) => void;
  onSelectAll?: () => void;
  onUpdate: (theme: ThemeDefinition) => void;
};

const SAFE_AREA_TOP = 54;
const SAFE_AREA_SIDE = 96;
const SNAP_THRESHOLD = 14;
const CAMERA_MIN_ZOOM = 0.25;
const CAMERA_MAX_ZOOM = 6;
const MEASURE_LABEL_TOP_OFFSET = 40;
const MEASURE_LABEL_LEFT_OFFSET = 58;
const HUD_ESTIMATED_WIDTH = 230;
const HUD_MARGIN = 6;

type GuideState = {
  vertical: number[];
  horizontal: number[];
};

type InteractionState = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  guides: GuideState;
};

type Rect = Pick<InteractionState, "x" | "y" | "width" | "height">;

type SnapSettings = {
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
  startViewportX: number;
  startViewportY: number;
  currentViewportX: number;
  currentViewportY: number;
};

function hasShiftModifier(event: unknown) {
  return typeof event === "object" && event !== null && "shiftKey" in event && Boolean((event as { shiftKey?: boolean }).shiftKey);
}

function roundRect(rect: Rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function measureGroup(theme: ThemeDefinition) {
  const components = Object.values(theme.components);
  const visibleComponents = components.filter((component) => component.visible);
  const source = visibleComponents.length > 0 ? visibleComponents : components;
  const minX = Math.min(...source.map((component) => component.x));
  const minY = Math.min(...source.map((component) => component.y));
  const maxX = Math.max(...source.map((component) => component.x + component.width));
  const maxY = Math.max(...source.map((component) => component.y + component.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function collectOthers(theme: ThemeDefinition, currentId: ComponentId | null) {
  const components = Object.entries(theme.components) as Array<[ComponentId, ThemeDefinition["components"][ComponentId]]>;
  const visibleComponents = components.filter(([, component]) => component.visible);
  const source = visibleComponents.length > 0 ? visibleComponents : components;
  return source.filter(([id]) => id !== currentId).map(([, component]) => component);
}

function collectAxisGuides(
  limit: number,
  safeInset: number,
  others: Array<ThemeDefinition["components"][ComponentId]>,
  axis: "x" | "y",
  options: {
    includeCanvas: boolean;
    includeSafeArea: boolean;
    includeComponents: boolean;
  }
) {
  const otherGuides = options.includeComponents
    ? others.flatMap((component) => {
    const start = axis === "x" ? component.x : component.y;
    const length = axis === "x" ? component.width : component.height;
    const end = start + length;
    const center = start + length / 2;
    return [start, center, end];
      })
    : [];

  const baseGuides: number[] = [];
  if (options.includeCanvas) {
    baseGuides.push(0, limit / 2, limit);
  }
  if (options.includeSafeArea) {
    baseGuides.push(safeInset, limit - safeInset);
  }

  return Array.from(new Set([...baseGuides, ...otherGuides]));
}

function findNearestGuide(value: number, guides: number[], threshold: number) {
  const nearest = guides
    .map((guide) => ({ guide, distance: Math.abs(guide - value) }))
    .filter((candidate) => candidate.distance <= threshold)
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearest) {
    return null;
  }

  return Math.round(nearest.guide);
}

function snapToGrid(value: number, gridSize: number) {
  if (gridSize <= 1) {
    return Math.round(value);
  }
  return Math.round(value / gridSize) * gridSize;
}

function snapMoveRect(
  rect: Rect,
  theme: ThemeDefinition,
  currentId: ComponentId | null,
  snapSettings: SnapSettings
) {
  if (!snapSettings.enabled) {
    return {
      ...roundRect(rect),
      guides: { vertical: [], horizontal: [] }
    };
  }

  const others = collectOthers(theme, currentId);
  const horizontalGuides = collectAxisGuides(theme.canvas.width, SAFE_AREA_SIDE, others, "x", {
    includeCanvas: snapSettings.canvasEdges,
    includeSafeArea: snapSettings.safeArea,
    includeComponents: snapSettings.componentEdges
  });
  const verticalGuides = collectAxisGuides(theme.canvas.height, SAFE_AREA_TOP, others, "y", {
    includeCanvas: snapSettings.canvasEdges,
    includeSafeArea: snapSettings.safeArea,
    includeComponents: snapSettings.componentEdges
  });

  const horizontalCandidates = [
    {
      kind: "edge" as const,
      value: rect.x,
      apply: (guide: number) => ({ x: guide, vertical: [guide] })
    },
    {
      kind: "center" as const,
      value: rect.x + rect.width / 2,
      apply: (guide: number) => ({ x: guide - rect.width / 2, vertical: [guide] })
    },
    {
      kind: "edge" as const,
      value: rect.x + rect.width,
      apply: (guide: number) => ({ x: guide - rect.width, vertical: [guide] })
    }
  ];

  const verticalCandidates = [
    {
      kind: "edge" as const,
      value: rect.y,
      apply: (guide: number) => ({ y: guide, horizontal: [guide] })
    },
    {
      kind: "center" as const,
      value: rect.y + rect.height / 2,
      apply: (guide: number) => ({ y: guide - rect.height / 2, horizontal: [guide] })
    },
    {
      kind: "edge" as const,
      value: rect.y + rect.height,
      apply: (guide: number) => ({ y: guide - rect.height, horizontal: [guide] })
    }
  ];

  const bestHorizontal = horizontalCandidates
    .map((candidate) => {
      const guide = findNearestGuide(candidate.value, horizontalGuides, snapSettings.threshold);
      return guide === null
        ? null
        : {
            ...candidate.apply(guide),
            distance: Math.abs(guide - candidate.value),
            priority: candidate.kind === "edge" ? 0 : 1
          };
    })
    .filter((candidate): candidate is { x: number; vertical: number[]; distance: number; priority: number } => candidate !== null)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.priority - right.priority;
    })[0];

  const bestVertical = verticalCandidates
    .map((candidate) => {
      const guide = findNearestGuide(candidate.value, verticalGuides, snapSettings.threshold);
      return guide === null
        ? null
        : {
            ...candidate.apply(guide),
            distance: Math.abs(guide - candidate.value),
            priority: candidate.kind === "edge" ? 0 : 1
          };
    })
    .filter((candidate): candidate is { y: number; horizontal: number[]; distance: number; priority: number } => candidate !== null)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.priority - right.priority;
    })[0];

  const snappedX = snapSettings.gridEnabled
    ? snapToGrid(bestHorizontal?.x ?? rect.x, snapSettings.gridSize)
    : Math.round(bestHorizontal?.x ?? rect.x);
  const snappedY = snapSettings.gridEnabled
    ? snapToGrid(bestVertical?.y ?? rect.y, snapSettings.gridSize)
    : Math.round(bestVertical?.y ?? rect.y);

  return {
    x: snappedX,
    y: snappedY,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    guides: {
      vertical: bestHorizontal?.vertical ?? [],
      horizontal: bestVertical?.horizontal ?? []
    }
  };
}

function snapResizeRect(
  rect: Rect,
  resizeDirection: string,
  theme: ThemeDefinition,
  currentId: ComponentId | null,
  snapSettings: SnapSettings
) {
  if (!snapSettings.enabled) {
    return {
      ...roundRect(rect),
      guides: { vertical: [], horizontal: [] }
    };
  }

  const others = collectOthers(theme, currentId);
  const horizontalGuides = collectAxisGuides(theme.canvas.width, SAFE_AREA_SIDE, others, "x", {
    includeCanvas: snapSettings.canvasEdges,
    includeSafeArea: snapSettings.safeArea,
    includeComponents: snapSettings.componentEdges
  });
  const verticalGuides = collectAxisGuides(theme.canvas.height, SAFE_AREA_TOP, others, "y", {
    includeCanvas: snapSettings.canvasEdges,
    includeSafeArea: snapSettings.safeArea,
    includeComponents: snapSettings.componentEdges
  });
  const direction = resizeDirection.toLowerCase();
  let nextRect = roundRect(rect);
  const guides: GuideState = { vertical: [], horizontal: [] };

  if (direction.includes("left")) {
    const leftGuide = findNearestGuide(rect.x, horizontalGuides, snapSettings.threshold);
    if (leftGuide !== null) {
      const rightEdge = rect.x + rect.width;
      nextRect.x = leftGuide;
      nextRect.width = Math.max(1, Math.round(rightEdge - leftGuide));
      guides.vertical.push(leftGuide);
    }
  } else if (direction.includes("right")) {
    const rightGuide = findNearestGuide(rect.x + rect.width, horizontalGuides, snapSettings.threshold);
    if (rightGuide !== null) {
      nextRect.width = Math.max(1, Math.round(rightGuide - rect.x));
      guides.vertical.push(rightGuide);
    }
  }

  if (direction.includes("top")) {
    const topGuide = findNearestGuide(rect.y, verticalGuides, snapSettings.threshold);
    if (topGuide !== null) {
      const bottomEdge = rect.y + rect.height;
      nextRect.y = topGuide;
      nextRect.height = Math.max(1, Math.round(bottomEdge - topGuide));
      guides.horizontal.push(topGuide);
    }
  } else if (direction.includes("bottom")) {
    const bottomGuide = findNearestGuide(rect.y + rect.height, verticalGuides, snapSettings.threshold);
    if (bottomGuide !== null) {
      nextRect.height = Math.max(1, Math.round(bottomGuide - rect.y));
      guides.horizontal.push(bottomGuide);
    }
  }

  nextRect.width = Math.min(nextRect.width, theme.canvas.width - nextRect.x);
  nextRect.height = Math.min(nextRect.height, theme.canvas.height - nextRect.y);

  if (snapSettings.gridEnabled) {
    const rightEdge = nextRect.x + nextRect.width;
    const bottomEdge = nextRect.y + nextRect.height;
    nextRect.x = snapToGrid(nextRect.x, snapSettings.gridSize);
    nextRect.y = snapToGrid(nextRect.y, snapSettings.gridSize);
    nextRect.width = Math.max(1, snapToGrid(rightEdge, snapSettings.gridSize) - nextRect.x);
    nextRect.height = Math.max(1, snapToGrid(bottomEdge, snapSettings.gridSize) - nextRect.y);
    nextRect.width = Math.min(nextRect.width, theme.canvas.width - nextRect.x);
    nextRect.height = Math.min(nextRect.height, theme.canvas.height - nextRect.y);
  }

  return {
    ...nextRect,
    guides
  };
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
  toolbar,
  onSelect,
  onMarqueeSelect,
  onSelectAll,
  onUpdate
}: ThemeCanvasEditorProps) {
  const groupRect = measureGroup(theme);
  const [snapSettings, setSnapSettings] = useState<SnapSettings>({
    enabled: true,
    threshold: SNAP_THRESHOLD,
    canvasEdges: true,
    safeArea: true,
    componentEdges: true,
    gridEnabled: false,
    gridSize: 8,
    showDistanceLabels: true
  });
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
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
  const cameraStorageKey = `pbresults.themeEditor.camera.${themeId}`;
  const snapSummary = snapSettings.enabled
    ? `Snap ${snapSettings.threshold}px`
    : "Snap off";
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
    setCamera({ x: 0, y: 0 });
    if (onZoomChange) {
      onZoomChange(1);
    }
  }

  function focusSelectedComponent() {
    if (!selectedId) {
      fitCanvas();
      return;
    }

    const frameRect = panLayerRef.current?.getBoundingClientRect();
    if (!frameRect) {
      return;
    }

    const component = theme.components[selectedId];
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

    try {
      const raw = window.localStorage.getItem(cameraStorageKey);
      if (!raw) {
        setCamera({ x: 0, y: 0 });
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

    window.localStorage.setItem(
      cameraStorageKey,
      JSON.stringify({
        camera,
        zoom
      })
    );
  }, [cameraStorageKey, camera, zoom]);

  useEffect(() => {
    const scale = stageScaleRef.current || 1;
    setCamera((current) => {
      const clamped = clampCameraToViewport(current, scale);
      if (current.x === clamped.x && current.y === clamped.y) {
        return current;
      }
      return clamped;
    });
  }, [zoom, theme.canvas.width, theme.canvas.height]);

  useEffect(() => {
    function handleResize() {
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
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onZoomChange, selectedId, theme]);

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const isFormControl = target.closest("input, select, textarea, button");
    const isComponentInteractionTarget = target.closest(
      ".editor-hitbox, .react-resizable-handle, .editor-outline, .react-rnd, .react-draggable"
    );
    const canPanWithLeft = event.button === 0 && spacePressed;
    const canPanWithMiddle = event.button === 1;
    const canPanWithPlainLeft = event.button === 0 && !spacePressed && !isFormControl && !isComponentInteractionTarget;
    const canMarqueeSelect = event.button === 0 && event.shiftKey && !spacePressed && !isFormControl && !isComponentInteractionTarget;

    if (canMarqueeSelect) {
      event.preventDefault();
      const frameRect = event.currentTarget.getBoundingClientRect();
      setMarqueeSelection({
        pointerId: event.pointerId,
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
      if (worldRect.width >= 3 || worldRect.height >= 3) {
        const intersectingIds = (
          Object.entries(theme.components) as Array<[ComponentId, ThemeDefinition["components"][ComponentId]]>
        )
          .filter(([, component]) => component.visible)
          .filter(([, component]) => {
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
          .map(([id]) => id);

        onMarqueeSelect?.(intersectingIds, { additive: true });
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

  return (
    <div className="canvas-editor-shell">
      <div className="canvas-editor-toolbar">
        {toolbar}
        <div className="canvas-editor-toolbar-actions">
            <button type="button" className="secondary-button" onClick={fitCanvas}>
              Fit
            </button>
            <button type="button" className="secondary-button" onClick={focusSelectedComponent} disabled={!selectedId}>
              Focus
            </button>
            <button
              type="button"
              className={snapSettings.enabled ? "secondary-button active-utility" : "secondary-button"}
              onClick={() => setSnapSettings((current) => ({ ...current, enabled: !current.enabled }))}
            >
              {snapSummary}
            </button>
            <details className="canvas-snap-controls">
              <summary className="secondary-button">Snap options</summary>
              <div className="canvas-snap-controls-panel">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={snapSettings.canvasEdges}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        canvasEdges: event.target.checked
                      }))
                    }
                  />
                  Canvas edges + center
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={snapSettings.safeArea}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        safeArea: event.target.checked
                      }))
                    }
                  />
                  Safe area guides
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={snapSettings.componentEdges}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        componentEdges: event.target.checked
                      }))
                    }
                  />
                  Other components
                </label>
                <label>
                  Snap tolerance ({snapSettings.threshold}px)
                  <input
                    type="range"
                    min={4}
                    max={32}
                    step={1}
                    value={snapSettings.threshold}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        threshold: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={snapSettings.gridEnabled}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        gridEnabled: event.target.checked
                      }))
                    }
                  />
                  Pixel grid snapping
                </label>
                <label>
                  Grid size ({snapSettings.gridSize}px)
                  <input
                    type="range"
                    min={2}
                    max={32}
                    step={2}
                    value={snapSettings.gridSize}
                    disabled={!snapSettings.gridEnabled}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        gridSize: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={snapSettings.showDistanceLabels}
                    onChange={(event) =>
                      setSnapSettings((current) => ({
                        ...current,
                        showDistanceLabels: event.target.checked
                      }))
                    }
                  />
                  Show line distance labels
                </label>
                <p className="hint">Hold Shift while resizing to keep aspect ratio.</p>
              </div>
            </details>
        </div>
      </div>
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
          mode="width"
          zoom={zoom}
          camera={camera}
        >
          {(stageScale) => {
            stageScaleRef.current = stageScale;
            return (
              <>
            <OverlayRenderer
              theme={theme}
              live={live}
              assets={assets}
              editable
              selectedComponentId={selectAll ? null : selectedId}
              onSelectComponent={onSelect}
            />

            {interaction?.guides.vertical.map((guide) => (
              <span key={`v-${guide}`} className="canvas-guide canvas-guide--vertical" style={{ left: guide }} />
            ))}
            {interaction?.guides.horizontal.map((guide) => (
              <span key={`h-${guide}`} className="canvas-guide canvas-guide--horizontal" style={{ top: guide }} />
            ))}

            {marqueeSelection ? (
              <span
                className="canvas-marquee"
                style={getMarqueeWorldRect(marqueeSelection)}
              />
            ) : null}

            {interaction ? (
              <div
                className="canvas-hud"
                style={{
                  left: Math.max(
                    HUD_MARGIN,
                    Math.min(
                      theme.canvas.width - HUD_ESTIMATED_WIDTH - HUD_MARGIN,
                      interaction.x + interaction.width / 2 - HUD_ESTIMATED_WIDTH / 2
                    )
                  ),
                  top:
                    interaction.y - 44 >= HUD_MARGIN
                      ? interaction.y - 44
                      : Math.min(theme.canvas.height - 54, interaction.y + interaction.height + 8)
                }}
              >
                <strong>{interaction.label}</strong>
                <span>
                  X {interaction.x} · Y {interaction.y} · W {interaction.width} · H {interaction.height}
                </span>
                <span>
                  L {Math.max(0, interaction.x)} · T {Math.max(0, interaction.y)} · R {Math.max(0, theme.canvas.width - (interaction.x + interaction.width))} · B {Math.max(0, theme.canvas.height - (interaction.y + interaction.height))}
                </span>
              </div>
            ) : null}

            {interaction ? (
              <>
                {snapSettings.showDistanceLabels ? (
                  <>
                    <span
                      className="canvas-measure-label"
                      style={{
                        left: Math.max(4, interaction.x / 2 - 16),
                        top: Math.max(4, interaction.y - MEASURE_LABEL_TOP_OFFSET)
                      }}
                    >
                      {Math.max(0, interaction.x)}
                    </span>
                    <span
                      className="canvas-measure-label"
                      style={{
                        left: Math.min(theme.canvas.width - 40, interaction.x + interaction.width + (theme.canvas.width - (interaction.x + interaction.width)) / 2 - 16),
                        top: Math.max(4, interaction.y - MEASURE_LABEL_TOP_OFFSET)
                      }}
                    >
                      {Math.max(0, theme.canvas.width - (interaction.x + interaction.width))}
                    </span>
                    <span
                      className="canvas-measure-label"
                      style={{
                        left: Math.max(4, interaction.x - MEASURE_LABEL_LEFT_OFFSET),
                        top: Math.max(4, interaction.y / 2 - 10)
                      }}
                    >
                      {Math.max(0, interaction.y)}
                    </span>
                    <span
                      className="canvas-measure-label"
                      style={{
                        left: Math.max(4, interaction.x - MEASURE_LABEL_LEFT_OFFSET),
                        top: Math.min(theme.canvas.height - 24, interaction.y + interaction.height + (theme.canvas.height - (interaction.y + interaction.height)) / 2 - 10)
                      }}
                    >
                      {Math.max(0, theme.canvas.height - (interaction.y + interaction.height))}
                    </span>
                  </>
                ) : null}
                <span
                  className="canvas-measure-line canvas-measure-line--horizontal"
                  style={{
                    left: 0,
                    top: interaction.y,
                    width: Math.max(0, interaction.x)
                  }}
                />
                <span
                  className="canvas-measure-line canvas-measure-line--horizontal"
                  style={{
                    left: interaction.x + interaction.width,
                    top: interaction.y,
                    width: Math.max(0, theme.canvas.width - (interaction.x + interaction.width))
                  }}
                />
                <span
                  className="canvas-measure-line canvas-measure-line--vertical"
                  style={{
                    left: interaction.x,
                    top: 0,
                    height: Math.max(0, interaction.y)
                  }}
                />
                <span
                  className="canvas-measure-line canvas-measure-line--vertical"
                  style={{
                    left: interaction.x + interaction.width,
                    top: 0,
                    height: Math.max(0, interaction.y)
                  }}
                />
                <span
                  className="canvas-measure-line canvas-measure-line--vertical"
                  style={{
                    left: interaction.x,
                    top: interaction.y + interaction.height,
                    height: Math.max(0, theme.canvas.height - (interaction.y + interaction.height))
                  }}
                />
                <span
                  className="canvas-measure-line canvas-measure-line--vertical"
                  style={{
                    left: interaction.x + interaction.width,
                    top: interaction.y + interaction.height,
                    height: Math.max(0, theme.canvas.height - (interaction.y + interaction.height))
                  }}
                />
              </>
            ) : null}

            {selectAll ? (
              <Rnd
                bounds="parent"
                size={{ width: groupRect.width, height: groupRect.height }}
                position={{ x: groupRect.x, y: groupRect.y }}
                enableResizing={false}
                onDragStart={() => {
                  onSelectAll?.();
                  setInteraction({
                    ...roundRect(groupRect),
                    label: "All components",
                    guides: { vertical: [], horizontal: [] }
                  });
                }}
                onDrag={(_, data) => {
                  const nextRect = snapMoveRect(
                    { x: data.x, y: data.y, width: groupRect.width, height: groupRect.height },
                    theme,
                    null,
                    snapSettings
                  );
                  setInteraction({
                    ...nextRect,
                    label: "All components"
                  });
                }}
                onDragStop={(_, data) => {
                  const nextRect = snapMoveRect(
                    { x: data.x, y: data.y, width: groupRect.width, height: groupRect.height },
                    theme,
                    null,
                    snapSettings
                  );
                  const deltaX = data.x - groupRect.x;
                  const deltaY = data.y - groupRect.y;
                  const snappedDeltaX = nextRect.x - groupRect.x;
                  const snappedDeltaY = nextRect.y - groupRect.y;
                  const next = structuredClone(theme);
                  for (const component of Object.values(next.components)) {
                    component.x += snapSettings.enabled ? snappedDeltaX : deltaX;
                    component.y += snapSettings.enabled ? snappedDeltaY : deltaY;
                  }
                  setInteraction(null);
                  onUpdate(next);
                }}
                scale={stageScale}
                className="editor-outline group-selected"
              >
                <button type="button" className="editor-hitbox" onClick={() => onSelectAll?.()}>
                  all
                </button>
              </Rnd>
            ) : null}

            {(
              Object.entries(theme.components) as Array<[ComponentId, ThemeDefinition["components"][ComponentId]]>
            ).map(([id, component]) => (
              <Rnd
                key={id}
                bounds="parent"
                size={{ width: component.width, height: component.height }}
                position={{ x: component.x, y: component.y }}
                onDragStart={(event) => {
                  // Keep Shift+click additive selection from being immediately replaced by drag-start selection.
                  if (hasShiftModifier(event)) {
                    return;
                  }
                  onSelect(id, { additive: false });
                  setInteraction({
                    x: component.x,
                    y: component.y,
                    width: component.width,
                    height: component.height,
                    label: id,
                    guides: { vertical: [], horizontal: [] }
                  });
                }}
                onDrag={(_, data) => {
                  const nextRect = snapMoveRect(
                    { x: data.x, y: data.y, width: component.width, height: component.height },
                    theme,
                    id,
                    snapSettings
                  );
                  setInteraction({
                    ...nextRect,
                    label: id
                  });
                }}
                onResizeStart={() => {
                  onSelect(id, { additive: false });
                  setInteraction({
                    x: component.x,
                    y: component.y,
                    width: component.width,
                    height: component.height,
                    label: id,
                    guides: { vertical: [], horizontal: [] }
                  });
                }}
                onDragStop={(_, data) => {
                  const nextRect = snapMoveRect(
                    { x: data.x, y: data.y, width: component.width, height: component.height },
                    theme,
                    id,
                    snapSettings
                  );
                  const next = structuredClone(theme);
                  next.components[id].x = nextRect.x;
                  next.components[id].y = nextRect.y;
                  setInteraction(null);
                  onUpdate(next);
                }}
                onResize={(_, direction, ref, ___, position) => {
                  const nextRect = snapResizeRect(
                    { x: position.x, y: position.y, width: ref.offsetWidth, height: ref.offsetHeight },
                    String(direction),
                    theme,
                    id,
                    snapSettings
                  );
                  setInteraction({
                    ...nextRect,
                    label: id
                  });
                }}
                onResizeStop={(_, direction, ref, ___, position) => {
                  const nextRect = snapResizeRect(
                    { x: position.x, y: position.y, width: ref.offsetWidth, height: ref.offsetHeight },
                    String(direction),
                    theme,
                    id,
                    snapSettings
                  );
                  const next = structuredClone(theme);
                  next.components[id].x = nextRect.x;
                  next.components[id].y = nextRect.y;
                  next.components[id].width = nextRect.width;
                  next.components[id].height = nextRect.height;
                  setInteraction(null);
                  onUpdate(next);
                }}
                lockAspectRatio={shiftPressed}
                scale={stageScale}
                className={!selectAll && selectedIdSet.has(id) ? "editor-outline selected" : "editor-outline"}
              >
                <button
                  type="button"
                  className="editor-hitbox"
                  onClick={(event) => onSelect(id, { additive: event.shiftKey })}
                >
                  {id}
                </button>
              </Rnd>
            ))}
              </>
            );
          }}
        </ScaledCanvasFrame>
      </div>
    </div>
  );
}
