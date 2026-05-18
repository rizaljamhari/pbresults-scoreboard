import { describe, expect, it } from "vitest";
import { assetSchema } from "./theme";

describe("assetSchema", () => {
  it("adds defaults for variant metadata on legacy records", () => {
    const parsed = assetSchema.parse({
      id: "asset-1",
      originalName: "logo.png",
      mimeType: "image/png",
      url: "/uploads/asset-1.png",
      createdAt: new Date().toISOString()
    });

    expect(parsed.role).toBe("processed");
    expect(parsed.sourceAssetId).toBeNull();
    expect(parsed.hiddenFromPicker).toBe(false);
    expect(parsed.contentHash).toBeNull();
  });
});
