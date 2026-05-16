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
  onSelect: (id: ComponentId) => void;
  onSelectAll?: () => void;
  onUpdate: (theme: ThemeDefinition) => void;
};

function snap(value: number, size: number, limit: number) {
  const candidates = [0, (limit - size) / 2, limit - size];
  const threshold = 16;
  for (const candidate of candidates) {
    if (Math.abs(value - candidate) <= threshold) {
      return Math.round(candidate);
    }
  }
  return Math.round(value);
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

export function ThemeCanvasEditor({
  theme,
  live,
  assets,
  selectedId,
  selectAll = false,
  zoom = 1,
  onSelect,
  onSelectAll,
  onUpdate
}: ThemeCanvasEditorProps) {
  const groupRect = measureGroup(theme);

  return (
    <div className="canvas-editor-shell">
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

            {selectAll ? (
              <Rnd
                bounds="parent"
                size={{ width: groupRect.width, height: groupRect.height }}
                position={{ x: groupRect.x, y: groupRect.y }}
                enableResizing={false}
                onDragStart={() => onSelectAll?.()}
                onDragStop={(_, data) => {
                  const deltaX = data.x - groupRect.x;
                  const deltaY = data.y - groupRect.y;
                  const next = structuredClone(theme);
                  for (const component of Object.values(next.components)) {
                    component.x += deltaX;
                    component.y += deltaY;
                  }
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
                onDragStart={() => onSelect(id)}
                onResizeStart={() => onSelect(id)}
                onDragStop={(_, data) => {
                  const next = structuredClone(theme);
                  next.components[id].x = snap(data.x, component.width, theme.canvas.width);
                  next.components[id].y = snap(data.y, component.height, theme.canvas.height);
                  onUpdate(next);
                }}
                onResizeStop={(_, __, ref, ___, position) => {
                  const next = structuredClone(theme);
                  next.components[id].x = snap(position.x, ref.offsetWidth, theme.canvas.width);
                  next.components[id].y = snap(position.y, ref.offsetHeight, theme.canvas.height);
                  next.components[id].width = Math.round(ref.offsetWidth);
                  next.components[id].height = Math.round(ref.offsetHeight);
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
