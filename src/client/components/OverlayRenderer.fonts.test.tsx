import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import type { StoredAsset } from "../../shared/theme";
import { OverlayRenderer } from "./OverlayRenderer";

const fontAsset = { id: "font-1", url: "/uploads/font-1.woff2", mimeType: "font/woff2" } as StoredAsset;

function render(editable: boolean, withFont = true) {
  const theme = structuredClone(builtinThemes[0]);
  if (withFont) {
    theme.fonts = [{ assetId: fontAsset.id, family: "Brand" }];
    theme.components.homeName.fontFamily = "Brand";
  }
  return renderToStaticMarkup(<OverlayRenderer theme={theme} live={null} assets={[fontAsset]} editable={editable} />);
}

describe("custom fonts in the overlay", () => {
  it("keeps the on-air graphic hidden until its fonts have loaded", () => {
    expect(render(false)).toContain("visibility:hidden");
  });

  it("never hides the editor canvas, or a theme without custom fonts", () => {
    expect(render(true)).not.toContain("visibility:hidden");
    expect(render(false, false)).not.toContain("visibility:hidden");
  });

  it("sets text in the custom family", () => {
    expect(render(true)).toContain('font-family:&quot;Brand&quot;, sans-serif');
  });
});
