import React from "react";
import {
  ThemeDefinition,
  fontFamilies,
  backgroundImageFitValues,
  backgroundImagePositionValues,
  imageContentModeValues,
  type StoredAsset
} from "../../shared/theme";
import type { ThemeComponent } from "../../shared/themeComponents";
import { buttonVariants } from "./ui";
import { ColorField, NumberField, TextField } from "../pages/ThemeEditorPage";
import { VisibleContentImage } from "./VisibleContentImage";

export interface ThemeComponentInspectorProps {
  theme: ThemeDefinition;
  patchTheme: (updater: (draft: ThemeDefinition) => void) => void;
  selectedSlot: "left" | "center" | "right" | null;
  selectedSummaryLabel: string;
  selectionModeDetail: string;
  selectAllMode: boolean;
  selectedEditableComponent: ThemeComponent | null;
  selectedComponentSource: "fixed" | "free";
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
  selectedLogoContext: any;
  assets: StoredAsset[];
  onUploadAsset?: (file: File, target: "surface" | "logo") => void;
  onDuplicateFreeComponent?: () => void;
  onDeleteFreeComponent?: () => void;
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
    selectedEditableComponent, selectedComponentSource, selectedSlotConfig, selectedShortLabel, patchSelectedComponent,
    canBringBackward, canBringForward, reorderSelectedComponent, selectedMirroredPair,
    mirrorSelectedPieceLayout, bringSelectedIntoView, resetSelectedPieceToSaved, savedSnapshot,
    selectedTextComponent, patchSelectedTextComponent, selectedImageComponent,
    selectedLogoContext, assets, onUploadAsset, onDuplicateFreeComponent, onDeleteFreeComponent
  } = props;
  const selectedImageAsset: StoredAsset | null = selectedImageComponent
    ? selectedLogoContext?.effectiveAsset ?? assets.find((asset) => asset.id === selectedImageComponent.assetId) ?? null
    : null;
  const visibleContentStatus = (() => {
    const analysis = selectedImageAsset?.visibleContent;
    if (!analysis) return "Waiting for visible-pixel analysis";
    if (analysis.status === "empty") return "Image is fully transparent";
    if (analysis.status !== "ready") {
      return analysis.status === "unsupported"
        ? "This image format cannot be analyzed"
        : "Visible-pixel analysis failed; full canvas will be used";
    }
    const fullFrame =
      analysis.x === 0 &&
      analysis.y === 0 &&
      analysis.width === analysis.sourceWidth &&
      analysis.height === analysis.sourceHeight;
    return fullFrame ? "Image already fills its canvas" : "Visible bounds ready";
  })();

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
        <div className="inspector-panel-body">
          
          <div className="inspector-header-actions">
            <label className="checkbox" style={{ margin: 0, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={selectedEditableComponent.visible}
                onChange={(event) => patchSelectedComponent((c: any) => (c.visible = event.target.checked))}
              />
              Visible
            </label>
            <div className="inspector-header-action-group">
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
              {selectedComponentSource === "free" ? (
                <>
                  <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} onClick={onDuplicateFreeComponent}>Duplicate</button>
                  <button type="button" className={buttonVariants({ variant: "danger", size: "sm" })} onClick={onDeleteFreeComponent}>Delete</button>
                </>
              ) : null}
            </div>
          </div>

          {selectedComponentSource === "free" ? (
            <PropertyAccordion title="Component" defaultOpen>
              <label>
                <span className="hint">Label</span>
                <input
                  value={(selectedEditableComponent as { label?: string }).label ?? ""}
                  maxLength={80}
                  onChange={(event) => patchSelectedComponent((component: any) => { component.label = event.target.value })}
                />
              </label>
              {selectedTextComponent && "contentMode" in selectedTextComponent ? (
                <div className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <label>
                    <span className="hint">Content mode</span>
                    <select
                      value={selectedTextComponent.contentMode}
                      onChange={(event) => patchSelectedTextComponent((component: any) => { component.contentMode = event.target.value })}
                    >
                      <option value="static">Static</option>
                      <option value="operator">Operator controlled</option>
                    </select>
                  </label>
                  <label>
                    <span className="hint">Default text</span>
                    {selectedTextComponent.multiline ? (
                      <textarea
                        rows={3}
                        value={selectedTextComponent.defaultText}
                        maxLength={selectedTextComponent.maxLength}
                        onChange={(event) => patchSelectedTextComponent((component: any) => { component.defaultText = event.target.value })}
                      />
                    ) : (
                      <input
                        value={selectedTextComponent.defaultText}
                        maxLength={selectedTextComponent.maxLength}
                        onChange={(event) => patchSelectedTextComponent((component: any) => { component.defaultText = event.target.value.replace(/[\r\n]+/g, " ") })}
                      />
                    )}
                  </label>
                  <NumberField
                    label="Maximum characters"
                    min={1}
                    max={500}
                    value={selectedTextComponent.maxLength}
                    onChange={(value) => patchSelectedTextComponent((component: any) => {
                      component.maxLength = Math.max(1, Math.min(500, Math.round(value)));
                      component.defaultText = component.defaultText.slice(0, component.maxLength);
                    })}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={selectedTextComponent.multiline}
                      onChange={(event) => patchSelectedTextComponent((component: any) => {
                        component.multiline = event.target.checked;
                        if (!event.target.checked) {
                          component.defaultText = component.defaultText.replace(/[\r\n]+/g, " ");
                        }
                      })}
                    />
                    Allow multiple lines
                  </label>
                </div>
              ) : null}
            </PropertyAccordion>
          ) : null}

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

          {selectedImageComponent && (
            <PropertyAccordion title="Image" defaultOpen>
              {selectedLogoContext ? (
                <div className="compact-grid" style={{ gridTemplateColumns: "1fr", marginBottom: "0.5rem" }}>
                  <div style={{ padding: "0.5rem", background: "var(--md-surface-2)", borderRadius: "var(--md-radius-m)" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem" }}>Live Resolution</div>
                    <div className="hint" style={{ marginBottom: "0.5rem" }}>
                      {selectedLogoContext.match?.team?.canonicalName
                        ? `${selectedLogoContext.match.team.canonicalName} · ${selectedLogoContext.match.status}`
                        : `No matched team yet · ${selectedLogoContext.match?.status ?? "unmatched"}`}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", background: "var(--md-surface-3)", padding: "0.5rem", borderRadius: "var(--md-radius-s)", height: "40px" }}>
                      {selectedLogoContext.effectiveAsset ? (
                        <VisibleContentImage
                          asset={selectedLogoContext.effectiveAsset}
                          alt=""
                          mode={selectedImageComponent.imageContentMode}
                          paddingPct={selectedImageComponent.visibleContentPaddingPct}
                          fit="contain"
                          position="center"
                        />
                      ) : (
                        <span className="hint">No resolved logo</span>
                      )}
                    </div>
                  </div>
                  
                  <label style={{ marginTop: "0.5rem", display: "block" }}>
                    <span className="hint">Fallback mode</span>
                    <select
                      value={selectedImageComponent.teamLogoFallbackMode}
                      onChange={(e) => patchSelectedComponent((c: any) => { if(c.kind==="image") c.teamLogoFallbackMode = e.target.value })}
                    >
                      <option value="none">Registry only</option>
                      <option value="eventLogo">Use event logo</option>
                      <option value="slotFallback">Use slot fallback asset</option>
                      <option value="slotFallbackThenEventLogo">Slot fallback, then event</option>
                    </select>
                  </label>
                </div>
              ) : null}

              <label style={{ display: "block" }}>
                <span className="hint">{selectedLogoContext ? "Fallback Asset" : "Image Asset"}</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <select
                    style={{ flex: 1 }}
                    value={selectedImageComponent.assetId ?? ""}
                    onChange={(e) => patchSelectedComponent((c: any) => { if(c.kind==="image") c.assetId = e.target.value || null })}
                  >
                    <option value="">None</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>{asset.originalName}</option>
                    ))}
                  </select>
                  {onUploadAsset && (
                    <label className={buttonVariants({ variant: "secondary", size: "sm" })} style={{ cursor: "pointer", margin: 0, alignSelf: "center", whiteSpace: "nowrap" }}>
                      Upload
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) onUploadAsset(file, "logo");
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </label>

              <div className="compact-grid" style={{ marginTop: "0.5rem" }}>
                <label>
                  <span className="hint">Fit</span>
                  <select
                    value={selectedImageComponent.backgroundImageFit}
                    onChange={(e) => patchSelectedComponent((c: any) => { if(c.kind==="image") c.backgroundImageFit = e.target.value })}
                  >
                    {backgroundImageFitValues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label>
                  <span className="hint">Position</span>
                  <select
                    value={selectedImageComponent.backgroundImagePosition}
                    onChange={(e) => patchSelectedComponent((c: any) => { if(c.kind==="image") c.backgroundImagePosition = e.target.value })}
                  >
                    {backgroundImagePositionValues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
              <div className="compact-grid" style={{ marginTop: "0.5rem" }}>
                <label>
                  <span className="hint">Fit using</span>
                  <select
                    value={selectedImageComponent.imageContentMode}
                    onChange={(event) =>
                      patchSelectedComponent((component: any) => {
                        if (component.kind === "image") component.imageContentMode = event.target.value;
                      })
                    }
                  >
                    {imageContentModeValues.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === "full-canvas" ? "Full image canvas" : "Visible pixels"}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedImageComponent.imageContentMode === "visible-pixels" ? (
                  <label>
                    <span className="hint">Visible padding (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={25}
                      step={1}
                      value={selectedImageComponent.visibleContentPaddingPct}
                      onChange={(event) =>
                        patchSelectedComponent((component: any) => {
                          if (component.kind === "image") {
                            component.visibleContentPaddingPct = Math.min(25, Math.max(0, Number(event.target.value) || 0));
                          }
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>
              {selectedImageComponent.imageContentMode === "visible-pixels" && selectedImageAsset ? (
                <div className="hint" style={{ marginTop: "0.4rem" }}>{visibleContentStatus}</div>
              ) : null}
            </PropertyAccordion>
          )}

          <PropertyAccordion title="Fill (Background)" defaultOpen>
            <ColorField label="Color" value={selectedEditableComponent.backgroundColor} onChange={(val) => patchSelectedComponent((c: any) => (c.backgroundColor = val))} />
            
            <label style={{ marginTop: "0.5rem", display: "block" }}>
              <span className="hint">Image Source</span>
              <select
                value={selectedEditableComponent.backgroundImageMode}
                onChange={(e) => patchSelectedComponent((c: any) => (c.backgroundImageMode = e.target.value))}
              >
                <option value="asset">Static Asset</option>
                <option value="homeTeamLogo">Match Home Team Logo</option>
                <option value="awayTeamLogo">Match Away Team Logo</option>
              </select>
            </label>

            {selectedEditableComponent.backgroundImageMode === "asset" && (
              <label style={{ marginTop: "0.5rem", display: "block" }}>
                <span className="hint">Image Asset</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <select
                    style={{ flex: 1 }}
                    value={selectedEditableComponent.backgroundImageAssetId ?? ""}
                    onChange={(e) => patchSelectedComponent((c: any) => (c.backgroundImageAssetId = e.target.value || null))}
                  >
                    <option value="">None</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>{asset.originalName}</option>
                    ))}
                  </select>
                  {onUploadAsset && (
                    <label className={buttonVariants({ variant: "secondary", size: "sm" })} style={{ cursor: "pointer", margin: 0, alignSelf: "center", whiteSpace: "nowrap" }}>
                      Upload
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) onUploadAsset(file, "surface");
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </label>
            )}

            {(selectedEditableComponent.backgroundImageMode !== "asset" || selectedEditableComponent.backgroundImageAssetId) && (
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
            <div style={{ marginTop: "0.5rem" }}>
              <NumberField label="Border Width" unit="px" value={selectedEditableComponent.borderWidth} onChange={(val) => patchSelectedComponent((c: any) => (c.borderWidth = val))} />
            </div>
            <label style={{ display: "block", marginTop: "0.5rem", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "var(--md-text-secondary)" }}>Corner Radius (px)</label>
            <div className="compact-grid" style={{ marginTop: "0.25rem" }}>
              <NumberField label="Top L" value={selectedEditableComponent.borderRadius[0]} onChange={(val) => patchSelectedComponent((c: any) => (c.borderRadius[0] = val))} />
              <NumberField label="Top R" value={selectedEditableComponent.borderRadius[1]} onChange={(val) => patchSelectedComponent((c: any) => (c.borderRadius[1] = val))} />
              <NumberField label="Btm L" value={selectedEditableComponent.borderRadius[3]} onChange={(val) => patchSelectedComponent((c: any) => (c.borderRadius[3] = val))} />
              <NumberField label="Btm R" value={selectedEditableComponent.borderRadius[2]} onChange={(val) => patchSelectedComponent((c: any) => (c.borderRadius[2] = val))} />
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
