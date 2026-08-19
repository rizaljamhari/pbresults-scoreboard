import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeVisibleContent, VISIBLE_CONTENT_ALPHA_THRESHOLD } from "./imageProcessing";

async function rgbaPng(width: number, height: number, pixels: Array<{ x: number; y: number; alpha: number }>) {
  const data = Buffer.alloc(width * height * 4);
  for (const pixel of pixels) {
    const offset = (pixel.y * width + pixel.x) * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = pixel.alpha;
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("analyzeVisibleContent", () => {
  it("returns the smallest rectangle containing visible alpha pixels", async () => {
    const buffer = await rgbaPng(8, 6, [
      { x: 2, y: 1, alpha: 255 },
      { x: 5, y: 4, alpha: 255 },
      { x: 7, y: 5, alpha: VISIBLE_CONTENT_ALPHA_THRESHOLD - 1 }
    ]);

    await expect(analyzeVisibleContent(buffer, "image/png")).resolves.toEqual({
      analyzerVersion: 1,
      status: "ready",
      sourceWidth: 8,
      sourceHeight: 6,
      x: 2,
      y: 1,
      width: 4,
      height: 4,
      alphaThreshold: VISIBLE_CONTENT_ALPHA_THRESHOLD
    });
  });

  it("includes pixels exactly at the alpha threshold", async () => {
    const buffer = await rgbaPng(3, 3, [{ x: 1, y: 2, alpha: VISIBLE_CONTENT_ALPHA_THRESHOLD }]);
    const result = await analyzeVisibleContent(buffer, "image/png");

    expect(result).toMatchObject({ status: "ready", x: 1, y: 2, width: 1, height: 1 });
  });

  it("reports a fully transparent image as empty", async () => {
    const buffer = await rgbaPng(4, 5, []);

    await expect(analyzeVisibleContent(buffer, "image/png")).resolves.toEqual({
      analyzerVersion: 1,
      status: "empty",
      sourceWidth: 4,
      sourceHeight: 5,
      alphaThreshold: VISIBLE_CONTENT_ALPHA_THRESHOLD
    });
  });

  it("reports opaque JPEG images as full-frame", async () => {
    const buffer = await sharp({
      create: { width: 7, height: 3, channels: 3, background: { r: 20, g: 40, b: 60 } }
    }).jpeg().toBuffer();

    expect(await analyzeVisibleContent(buffer, "image/jpeg")).toMatchObject({
      status: "ready",
      sourceWidth: 7,
      sourceHeight: 3,
      x: 0,
      y: 0,
      width: 7,
      height: 3
    });
  });

  it("fails safely for an invalid supported image", async () => {
    await expect(analyzeVisibleContent(Buffer.from("not-a-png"), "image/png")).resolves.toEqual({
      analyzerVersion: 1,
      status: "failed"
    });
  });
});
