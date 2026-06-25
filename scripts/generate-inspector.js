const fs = require('fs');

const content = `import React from "react";
import { ThemeDefinition, ComponentId, fontFamilies, backgroundImageFitValues, backgroundImagePositionValues } from "../../shared/theme";
import { SectionCard, buttonVariants } from "./ui";
import { ColorField, NumberField, TextField } from "../pages/ThemeEditorPage";

export interface ThemeComponentInspectorProps {
  theme: ThemeDefinition;
  patchTheme: (updater: (draft: ThemeDefinition) => void) => void;
  selectedSlot: "left" | "center" | "right" | null;
  selectedSummaryLabel: string;
  selectionModeDetail: string;
  selectAllMode: boolean;
  selectedEditableComponent: (ThemeDefinition["components"][ComponentId] & { id: ComponentId, visible: boolean }) | null;
  selectedSlotConfig: any;
  selectedShortLabel: string;
  patchSelectedComponent: (updater: (draft: any) => void) => void;
  canBringBackward: boolean;
  canBringForward: boolean;
  reorderSelectedComponent: (direction: "sendToBack" | "bringBackward" | "bringForward" | "sendToFront") => void;
  selectedMirroredPair: any;
  mirrorSelectedPieceLayout: () => void;
  bringSelectedIntoView: () => void;
  resetSelectedPieceToSaved: () => void;
  savedSnapshot: any;
  selectedTextComponent: any;
  patchSelectedTextComponent: (updater: (draft: any) => void) => void;
  selectedImageComponent: any;
  patchSelectedImageComponent: (updater: (draft: any) => void) => void;
  selectedLogoContext: any;
  assets: any[];
}

function PropertyAccordion({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="property-accordion" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="property-accordion-content">
        {children}
      </div>
    </details>
  );
}

export function ThemeComponentInspector(props: ThemeComponentInspectorProps) {
  const {
    theme, patchTheme, selectedSlot, selectedSummaryLabel, selectionModeDetail, selectAllMode,
    selectedEditableComponent, selectedSlotConfig, selectedShortLabel, patchSelectedComponent,
    canBringBackward, canBringForward, reorderSelectedComponent, selectedMirroredPair,
    mirrorSelectedPieceLayout, bringSelectedIntoView, resetSelectedPieceToSaved, savedSnapshot,
    selectedTextComponent, patchSelectedTextComponent, selectedImageComponent, patchSelectedImageComponent,
    selectedLogoContext, assets
  } = props;

  return (
    <div className="inspector-stack inspector-stack--compact">
      <div className="editor-selection-summary">
        <div className="editor-selection-copy">
          <strong>{selectedSummaryLabel}</strong>
          <span className="hint">{selectionModeDetail}</span>
        </div>
        {!selectAllMode && selectedEditableComponent ? (
          <div className="editor-selection-meta">
            <span>{selectedEditableComponent.kind === "text" ? "Text" : "Image"}</span>
            <span>{selectedEditableComponent.visible ? "Visible" : "Hidden"}</span>
          </div>
        ) : null}
      </div>

      {!selectAllMode && selectedEditableComponent && (
        <div className="inspector-panel-body" style={{ display: "flex", flexDirection: "column", marginTop: "0.5rem" }}>
          
          <div className="inspector-header-actions" style={{ padding: "0 0.5rem 0.75rem", display: "flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center", justifyContent: "space-between" }}>
            <label className="checkbox" style={{ margin: 0, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={selectedEditableComponent.visible}
                onChange={(event) => patchSelectedComponent((c: any) => (c.visible = event.target.checked))}
              />
              Visible
            </label>
            <div style={{ display: "flex", gap: "0.25rem", marginLeft: "auto" }}>
              <div className="z-order-inline">
                <button type="button" className="z-order-btn" title="Send to back" onClick={() => reorderSelectedComponent("sendToBack")} disabled={!canBringBackward}>⇤</button>
                <button type="button" className="z-order-btn" title="Bring backward" onClick={() => reorderSelectedComponent("bringBackward")} disabled={!canBringBackward}>↓</button>
                <button type="button" className="z-order-btn" title="Bring forward" onClick={() => reorderSelectedComponent("bringForward")} disabled={!canBringForward}>↑</button>
                <button type="button" className="z-order-btn" title="Send to front" onClick={() => reorderSelectedComponent("sendToFront")} disabled={!canBringForward}>⇥</button>
              </div>
              {selectedMirroredPair && (
                <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} style={{ padding: "0 6px" }} onClick={mirrorSelectedPieceLayout} title="Mirror Layout">M</button>
              )}
              <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} style={{ padding: "0 6px" }} onClick={bringSelectedIntoView} title="Bring into view">👁</button>
              <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} style={{ padding: "0 6px" }} onClick={resetSelectedPieceToSaved} disabled={!savedSnapshot} title="Reset to saved">↺</button>
            </div>
          </div>

          <PropertyAccordion title="Layout" defaultOpen>
            <div className="compact-grid">
              <NumberField label="X" value={selectedEditableComponent.x} onChange={(val) => patchSelectedComponent((c: any) => (c.x = val))} />
              <NumberField label="Y" value={selectedEditableComponent.y} onChange={(val) => patchSelectedComponent((c: any) => (c.y = val))} />
              <NumberField label="W" value={selectedEditableComponent.width} onChange={(val) => patchSelectedComponent((c: any) => (c.width = val))} />
              <NumberField label="H" value={selectedEditableComponent.height} onChange={(val) => patchSelectedComponent((c: any) => (c.height = val))} />
              <label>
                <span className="hint">Opacity</span>
                <input
                  type="number" min="0" max="100"
                  value={Math.round(selectedEditableComponent.opacity * 100)}
                  onChange={(e) => patchSelectedComponent((c: any) => (c.opacity = Math.max(0, Math.min(100, Number(e.target.value))) / 100))}
                />
              </label>
              <NumberField label="Z-Index" value={selectedEditableComponent.zIndex} onChange={(val) => patchSelectedComponent((c: any) => (c.zIndex = val))} />
            </div>
          </PropertyAccordion>

          {selectedTextComponent && (
            <PropertyAccordion title="Typography" defaultOpen>
              <div className="compact-grid" style={{ gridTemplateColumns: "1fr" }}>
                <label>
                  <span className="hint">Font Family</span>
                  <select
                    value={selectedTextComponent.fontFamily}
                    onChange={(e) => patchSelectedTextComponent((c: any) => (c.fontFamily = e.target.value))}
                  >
                    {fontFamilies.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>
              <div className="compact-grid" style={{ marginTop: "0.5rem" }}>
                <NumberField label="Size" unit="px" value={selectedTextComponent.fontSize} onChange={(val) => patchSelectedTextComponent((c: any) => (c.fontSize = val))} />
                <NumberField label="Weight" value={selectedTextComponent.fontWeight} onChange={(val) => patchSelectedTextComponent((c: any) => (c.fontWeight = val))} />
                <label>
                  <span className="hint">Align</span>
                  <select
                    value={selectedTextComponent.textAlign}
                    onChange={(e) => patchSelectedTextComponent((c: any) => (c.textAlign = e.target.value))}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <NumberField label="Line Height" step={0.1} value={selectedTextComponent.lineHeight} onChange={(val) => patchSelectedTextComponent((c: any) => (c.lineHeight = val))} />
                <NumberField label="Spacing" unit="px" step={0.1} value={selectedTextComponent.letterSpacing} onChange={(val) => patchSelectedTextComponent((c: any) => (c.letterSpacing = val))} />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <ColorField label="Text Color" value={selectedTextComponent.color} onChange={(val) => patchSelectedTextComponent((c: any) => (c.color = val))} />
              </div>
            </PropertyAccordion>
          )}

          <PropertyAccordion title="Fill (Background)" defaultOpen>
            <ColorField label="Color" value={selectedEditableComponent.backgroundColor} onChange={(val) => patchSelectedComponent((c: any) => (c.backgroundColor = val))} />
            
            <label style={{ marginTop: "0.5rem", display: "block" }}>
              <span className="hint">Image Asset</span>
              <select
                value={selectedEditableComponent.backgroundImageAssetId ?? ""}
                onChange={(e) => patchSelectedComponent((c: any) => (c.backgroundImageAssetId = e.target.value || null))}
              >
                <option value="">None</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.originalName}</option>
                ))}
              </select>
            </label>

            {selectedEditableComponent.backgroundImageAssetId && (
              <div className="compact-grid" style={{ marginTop: "0.5rem" }}>
                <label>
                  <span className="hint">Fit</span>
                  <select
                    value={selectedEditableComponent.backgroundImageFit}
                    onChange={(e) => patchSelectedComponent((c: any) => (c.backgroundImageFit = e.target.value))}
                  >
                    {backgroundImageFitValues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label>
                  <span className="hint">Position</span>
                  <select
                    value={selectedEditableComponent.backgroundImagePosition}
                    onChange={(e) => patchSelectedComponent((c: any) => (c.backgroundImagePosition = e.target.value))}
                  >
                    {backgroundImagePositionValues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
            )}
          </PropertyAccordion>

          <PropertyAccordion title="Stroke (Border)" defaultOpen>
            <ColorField label="Color" value={selectedEditableComponent.borderColor} onChange={(val) => patchSelectedComponent((c: any) => (c.borderColor = val))} />
            <div className="compact-grid" style={{ marginTop: "0.5rem" }}>
              <NumberField label="Width" unit="px" value={selectedEditableComponent.borderWidth} onChange={(val) => patchSelectedComponent((c: any) => (c.borderWidth = val))} />
              <NumberField label="Radius" unit="px" value={selectedEditableComponent.borderRadius} onChange={(val) => patchSelectedComponent((c: any) => (c.borderRadius = val))} />
            </div>
          </PropertyAccordion>

          <PropertyAccordion title="Spacing & Offset" defaultOpen={false}>
            <div className="compact-grid">
              <NumberField label="Pad X" unit="px" value={selectedEditableComponent.paddingX} onChange={(val) => patchSelectedComponent((c: any) => (c.paddingX = val))} />
              <NumberField label="Pad Y" unit="px" value={selectedEditableComponent.paddingY} onChange={(val) => patchSelectedComponent((c: any) => (c.paddingY = val))} />
              <NumberField label="Off X" unit="px" value={selectedEditableComponent.offsetX} onChange={(val) => patchSelectedComponent((c: any) => (c.offsetX = val))} />
              <NumberField label="Off Y" unit="px" value={selectedEditableComponent.offsetY} onChange={(val) => patchSelectedComponent((c: any) => (c.offsetY = val))} />
            </div>
          </PropertyAccordion>

          <PropertyAccordion title="Effects" defaultOpen={false}>
            <ColorField label="Overlay Color" value={selectedEditableComponent.backgroundOverlayColor} onChange={(val) => patchSelectedComponent((c: any) => (c.backgroundOverlayColor = val))} />
            <label style={{ marginTop: "0.5rem", display: "block" }}>
              <span className="hint">Overlay Opacity</span>
              <input
                type="number" min="0" max="100"
                value={Math.round(selectedEditableComponent.backgroundOverlayOpacity * 100)}
                onChange={(e) => patchSelectedComponent((c: any) => (c.backgroundOverlayOpacity = Math.max(0, Math.min(100, Number(e.target.value))) / 100))}
              />
            </label>
            <TextField label="Box Shadow CSS" value={selectedEditableComponent.shadow} onChange={(val) => patchSelectedComponent((c: any) => (c.shadow = val))} />
          </PropertyAccordion>

        </div>
      )}
    </div>
  );
}
\`;

fs.writeFileSync('src/client/components/ThemeComponentInspector.tsx', content);
