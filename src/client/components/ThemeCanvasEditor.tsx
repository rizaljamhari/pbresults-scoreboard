import { useState, type ReactNode } from "react";
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
  selectAll?: boolean;
  zoom?: number;
  toolbar?: ReactNode;
  onSelect: (id: ComponentId) => void;
  onSelectAll?: () => void;
  onUpdate: (theme: ThemeDefinition) => void;
};

const SAFE_AREA_TOP = 54;
const SAFE_AREA_SIDE = 96;
const SNAP_THRESHOLD = 14;

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
  axis: "x" | "y"
) {
  const otherGuides = others.flatMap((component) => {
    const start = axis === "x" ? component.x : component.y;
    const length = axis === "x" ? component.width : component.height;
    const end = start + length;
    const center = start + length / 2;
    return [start, center, end];
  });

  return [0, limit / 2, limit, safeInset, limit - safeInset, ...otherGuides];
}

function findNearestGuide(value: number, guides: number[]) {
  const nearest = guides
    .map((guide) => ({ guide, distance: Math.abs(guide - value) }))
    .filter((candidate) => candidate.distance <= SNAP_THRESHOLD)
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearest) {
    return null;
  }

  return Math.round(nearest.guide);
}

function snapMoveRect(
  rect: Rect,
  theme: ThemeDefinition,
  currentId: ComponentId | null,
  snapEnabled: boolean
) {
  if (!snapEnabled) {
    return {
      ...roundRect(rect),
      guides: { vertical: [], horizontal: [] }
    };
  }

  const others = collectOthers(theme, currentId);
  const horizontalGuides = collectAxisGuides(theme.canvas.width, SAFE_AREA_SIDE, others, "x");
  const verticalGuides = collectAxisGuides(theme.canvas.height, SAFE_AREA_TOP, others, "y");

  const horizontalCandidates = [
    {
      value: rect.x,
      apply: (guide: number) => ({ x: guide, vertical: [guide] })
    },
    {
      value: rect.x + rect.width / 2,
      apply: (guide: number) => ({ x: guide - rect.width / 2, vertical: [guide] })
    },
    {
      value: rect.x + rect.width,
      apply: (guide: number) => ({ x: guide - rect.width, vertical: [guide] })
    }
  ];

  const verticalCandidates = [
    {
      value: rect.y,
      apply: (guide: number) => ({ y: guide, horizontal: [guide] })
    },
    {
      value: rect.y + rect.height / 2,
      apply: (guide: number) => ({ y: guide - rect.height / 2, horizontal: [guide] })
    },
    {
      value: rect.y + rect.height,
      apply: (guide: number) => ({ y: guide - rect.height, horizontal: [guide] })
    }
  ];

  const bestHorizontal = horizontalCandidates
    .map((candidate) => {
      const guide = findNearestGuide(candidate.value, horizontalGuides);
      return guide === null ? null : { ...candidate.apply(guide), distance: Math.abs(guide - candidate.value) };
    })
    .filter((candidate): candidate is { x: number; vertical: number[]; distance: number } => candidate !== null)
    .sort((left, right) => left.distance - right.distance)[0];

  const bestVertical = verticalCandidates
    .map((candidate) => {
      const guide = findNearestGuide(candidate.value, verticalGuides);
      return guide === null ? null : { ...candidate.apply(guide), distance: Math.abs(guide - candidate.value) };
    })
    .filter((candidate): candidate is { y: number; horizontal: number[]; distance: number } => candidate !== null)
    .sort((left, right) => left.distance - right.distance)[0];

  return {
    x: Math.round(bestHorizontal?.x ?? rect.x),
    y: Math.round(bestVertical?.y ?? rect.y),
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
  snapEnabled: boolean
) {
  if (!snapEnabled) {
    return {
      ...roundRect(rect),
      guides: { vertical: [], horizontal: [] }
    };
  }

  const others = collectOthers(theme, currentId);
  const horizontalGuides = collectAxisGuides(theme.canvas.width, SAFE_AREA_SIDE, others, "x");
  const verticalGuides = collectAxisGuides(theme.canvas.height, SAFE_AREA_TOP, others, "y");
  const direction = resizeDirection.toLowerCase();
  let nextRect = roundRect(rect);
  const guides: GuideState = { vertical: [], horizontal: [] };

  if (direction.includes("left")) {
    const leftGuide = findNearestGuide(rect.x, horizontalGuides);
    if (leftGuide !== null) {
      const rightEdge = rect.x + rect.width;
      nextRect.x = leftGuide;
      nextRect.width = Math.max(1, Math.round(rightEdge - leftGuide));
      guides.vertical.push(leftGuide);
    }
  } else if (direction.includes("right")) {
    const rightGuide = findNearestGuide(rect.x + rect.width, horizontalGuides);
    if (rightGuide !== null) {
      nextRect.width = Math.max(1, Math.round(rightGuide - rect.x));
      guides.vertical.push(rightGuide);
    }
  }

  if (direction.includes("top")) {
    const topGuide = findNearestGuide(rect.y, verticalGuides);
    if (topGuide !== null) {
      const bottomEdge = rect.y + rect.height;
      nextRect.y = topGuide;
      nextRect.height = Math.max(1, Math.round(bottomEdge - topGuide));
      guides.horizontal.push(topGuide);
    }
  } else if (direction.includes("bottom")) {
    const bottomGuide = findNearestGuide(rect.y + rect.height, verticalGuides);
    if (bottomGuide !== null) {
      nextRect.height = Math.max(1, Math.round(bottomGuide - rect.y));
      guides.horizontal.push(bottomGuide);
    }
  }

  nextRect.width = Math.min(nextRect.width, theme.canvas.width - nextRect.x);
  nextRect.height = Math.min(nextRect.height, theme.canvas.height - nextRect.y);

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
  selectAll = false,
  zoom = 1,
  toolbar,
  onSelect,
  onSelectAll,
  onUpdate
}: ThemeCanvasEditorProps) {
  const groupRect = measureGroup(theme);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);

  return (
    <div className="canvas-editor-shell">
      {toolbar || snapEnabled ? (
        <div className="canvas-editor-toolbar">
          {toolbar}
          <div className="canvas-editor-toolbar-actions">
            <button
              type="button"
              className={snapEnabled ? "secondary-button active-utility" : "secondary-button"}
              onClick={() => setSnapEnabled((current) => !current)}
            >
              Snap {snapEnabled ? "on" : "off"}
            </button>
          </div>
        </div>
      ) : null}
      <ScaledCanvasFrame
        width={theme.canvas.width}
        height={theme.canvas.height}
        className="canvas-stage-frame"
        innerClassName="canvas-stage"
        mode="width"
        zoom={zoom}
      >
        {(stageScale) => (
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

            {interaction ? (
              <div
                className="canvas-hud"
                style={{
                  left: interaction.x,
                  top: Math.max(0, interaction.y - 32)
                }}
              >
                <strong>{interaction.label}</strong>
                <span>
                  X {interaction.x} · Y {interaction.y} · W {interaction.width} · H {interaction.height}
                </span>
              </div>
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
                    snapEnabled
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
                    snapEnabled
                  );
                  const deltaX = data.x - groupRect.x;
                  const deltaY = data.y - groupRect.y;
                  const snappedDeltaX = nextRect.x - groupRect.x;
                  const snappedDeltaY = nextRect.y - groupRect.y;
                  const next = structuredClone(theme);
                  for (const component of Object.values(next.components)) {
                    component.x += snapEnabled ? snappedDeltaX : deltaX;
                    component.y += snapEnabled ? snappedDeltaY : deltaY;
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
                onDragStart={() => {
                  onSelect(id);
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
                    snapEnabled
                  );
                  setInteraction({
                    ...nextRect,
                    label: id
                  });
                }}
                onResizeStart={() => {
                  onSelect(id);
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
                    snapEnabled
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
                    snapEnabled
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
                    snapEnabled
                  );
                  const next = structuredClone(theme);
                  next.components[id].x = nextRect.x;
                  next.components[id].y = nextRect.y;
                  next.components[id].width = nextRect.width;
                  next.components[id].height = nextRect.height;
                  setInteraction(null);
                  onUpdate(next);
                }}
                scale={stageScale}
                className={!selectAll && selectedId === id ? "editor-outline selected" : "editor-outline"}
              >
                <button type="button" className="editor-hitbox" onClick={() => onSelect(id)}>
                  {id}
                </button>
              </Rnd>
            ))}
          </>
        )}
      </ScaledCanvasFrame>
    </div>
  );
}
