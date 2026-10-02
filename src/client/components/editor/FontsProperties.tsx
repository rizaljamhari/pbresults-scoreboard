import { Upload, X } from "lucide-react";
import { fontUsageCount, isFontAsset, replaceFontFamily } from "../../../shared/fonts";
import { fontFamilies, type StoredAsset, type ThemeDefinition } from "../../../shared/theme";
import { IconButton } from "./EditorChrome";
import { PanelSection, SelectInput } from "./fields";

/** Where text using a removed font goes. */
const FALLBACK_FONT = "Oswald";

function validFamily(name: string, others: string[]) {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 60 &&
    !/["\\]/.test(trimmed) &&
    ![...fontFamilies, ...others].some((taken) => taken.toLowerCase() === trimmed.toLowerCase())
  );
}

/**
 * The theme's custom fonts: upload a WOFF2, WOFF, TTF or OTF file (stored locally, so it works offline), or add one
 * already in the asset library. Renaming a font renames it wherever it is used.
 */
export function FontsProperties({
  theme,
  assets,
  patchTheme,
  onUpload,
  onAddFromLibrary
}: {
  theme: ThemeDefinition;
  assets: StoredAsset[];
  patchTheme: (update: (draft: ThemeDefinition) => void) => void;
  onUpload: (file: File) => void;
  onAddFromLibrary: (asset: StoredAsset) => void;
}) {
  const libraryFonts = assets.filter((asset) => isFontAsset(asset) && !theme.fonts.some((font) => font.assetId === asset.id));

  return (
    <PanelSection title="Fonts" defaultOpen={theme.fonts.length > 0}>
      <p className="te-field-hint">Your own fonts, stored on this machine so they work offline. They appear in every font menu after the built-in ones.</p>
      {theme.fonts.map((font) => {
        const asset = assets.find((candidate) => candidate.id === font.assetId);
        const uses = fontUsageCount(theme, font.family);
        const others = theme.fonts.filter((other) => other !== font).map((other) => other.family);
        return (
          <div key={font.assetId} className="te-font">
            <span className="te-font-sample" style={{ fontFamily: `"${font.family}", sans-serif` }} aria-hidden>
              Aa 123
            </span>
            <div className="te-token-body">
              <input
                className="te-input"
                aria-label="Font name"
                defaultValue={font.family}
                maxLength={60}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next === font.family) return;
                  if (!validFamily(next, others)) {
                    event.target.value = font.family;
                    return;
                  }
                  patchTheme((draft) => {
                    replaceFontFamily(draft, font.family, next);
                    const target = draft.fonts.find((candidate) => candidate.assetId === font.assetId);
                    if (target) target.family = next;
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <span className="te-usage">
                {asset ? (uses ? `Used by ${uses} text ${uses === 1 ? "setting" : "settings"}` : "Not used yet") : "Font file missing: text falls back to a system font"}
              </span>
            </div>
            <IconButton
              label={`Remove ${font.family}`}
              onClick={() => {
                if (uses > 0 && !window.confirm(`Remove “${font.family}”? The ${uses} text ${uses === 1 ? "setting" : "settings"} using it switch to ${FALLBACK_FONT}.`)) {
                  return;
                }
                patchTheme((draft) => {
                  replaceFontFamily(draft, font.family, FALLBACK_FONT);
                  draft.fonts = draft.fonts.filter((candidate) => candidate.assetId !== font.assetId);
                });
              }}
            >
              <X />
            </IconButton>
          </div>
        );
      })}
      <div className="te-button-pair">
        <label className="te-mini-btn">
          <Upload aria-hidden />
          Upload font
          <input
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = "";
            }}
          />
        </label>
        {libraryFonts.length ? (
          <SelectInput
            label="Add a font from the library"
            hideLabel
            value=""
            options={[{ value: "", label: "From library…" }, ...libraryFonts.map((asset) => ({ value: asset.id, label: asset.displayName ?? asset.originalName }))]}
            onChange={(id) => {
              const asset = libraryFonts.find((candidate) => candidate.id === id);
              if (asset) onAddFromLibrary(asset);
            }}
          />
        ) : null}
      </div>
    </PanelSection>
  );
}
