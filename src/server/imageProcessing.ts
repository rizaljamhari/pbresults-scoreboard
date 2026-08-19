import path from "node:path";
import type { VisibleContentAnalysis } from "../shared/theme.js";

const supportedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
export const VISIBLE_CONTENT_ANALYZER_VERSION = 1 as const;
export const VISIBLE_CONTENT_ALPHA_THRESHOLD = 8;
const visibleContentInputPixelLimit = 40_000_000;
const mimeAliases: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg"
};

export type BackgroundRemovalResult =
  | { status: "processed"; buffer: Buffer; mimeType: "image/png"; originalName: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

type SharpModule = typeof import("sharp");
type SharpFactory = SharpModule;

async function loadSharp(): Promise<SharpFactory> {
  const module = await import("sharp");
  return ("default" in module ? module.default : module) as SharpFactory;
}

async function loadRemoveBackground(): Promise<typeof import("@imgly/background-removal-node")["removeBackground"]> {
  const module = await import("@imgly/background-removal-node");
  return module.removeBackground;
}

function outputNameWithPng(originalName: string): string {
  const parsed = path.parse(originalName || "upload");
  return `${parsed.name || "upload"}-nobg.png`;
}

async function normalizeToPng(sharp: SharpFactory, buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).ensureAlpha().png().toBuffer();
}

async function hasTransparentPixels(sharp: SharpFactory, buffer: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  if (channels < 4) {
    return false;
  }

  // RGBA layout: every 4th byte is alpha. Any alpha below 255 means transparency exists.
  for (let index = 3; index < data.length; index += channels) {
    if (data[index] < 255) {
      return true;
    }
  }
  return false;
}

async function sealInteriorTransparency(
  sharp: SharpFactory,
  originalBuffer: Buffer,
  processedBuffer: Buffer
): Promise<Buffer> {
  const original = await sharp(originalBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const processed = await sharp(processedBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (
    original.info.width !== processed.info.width ||
    original.info.height !== processed.info.height ||
    original.info.channels < 4 ||
    processed.info.channels < 4
  ) {
    return processedBuffer;
  }

  const width = processed.info.width;
  const height = processed.info.height;
  const channels = processed.info.channels;
  const alphaThreshold = 8;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue: number[] = [];

  const isTransparent = (pixelIndex: number) => processed.data[pixelIndex * channels + 3] < alphaThreshold;

  const enqueueIfTransparent = (pixelIndex: number) => {
    if (pixelIndex < 0 || pixelIndex >= total || visited[pixelIndex]) {
      return;
    }
    if (!isTransparent(pixelIndex)) {
      return;
    }
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    enqueueIfTransparent(x);
    enqueueIfTransparent((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueueIfTransparent(y * width);
    enqueueIfTransparent(y * width + (width - 1));
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const x = current % width;
    const y = Math.floor(current / width);
    if (x > 0) {
      enqueueIfTransparent(current - 1);
    }
    if (x < width - 1) {
      enqueueIfTransparent(current + 1);
    }
    if (y > 0) {
      enqueueIfTransparent(current - width);
    }
    if (y < height - 1) {
      enqueueIfTransparent(current + width);
    }
  }

  for (let pixel = 0; pixel < total; pixel += 1) {
    if (!isTransparent(pixel) || visited[pixel]) {
      continue;
    }
    const offset = pixel * channels;
    processed.data[offset] = original.data[offset];
    processed.data[offset + 1] = original.data[offset + 1];
    processed.data[offset + 2] = original.data[offset + 2];
    processed.data[offset + 3] = original.data[offset + 3];
  }

  return sharp(processed.data, {
    raw: {
      width,
      height,
      channels
    }
  })
    .png()
    .toBuffer();
}

function normalizeMimeType(mimeType: string): string {
  const base = mimeType.trim().toLowerCase().split(";", 1)[0] ?? "";
  return mimeAliases[base] ?? base;
}

async function detectMimeTypeFromBuffer(sharp: SharpFactory, buffer: Buffer): Promise<string | null> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.format) {
      return null;
    }
    if (metadata.format === "jpg" || metadata.format === "jpeg") {
      return "image/jpeg";
    }
    if (metadata.format === "png") {
      return "image/png";
    }
    if (metadata.format === "webp") {
      return "image/webp";
    }
    return null;
  } catch {
    return null;
  }
}

export async function analyzeVisibleContent(buffer: Buffer, mimeType: string): Promise<VisibleContentAnalysis> {
  let sharp: SharpFactory;
  try {
    sharp = await loadSharp();
  } catch {
    return { analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION, status: "failed" };
  }

  let effectiveMimeType = normalizeMimeType(mimeType);
  if (!supportedImageMimeTypes.has(effectiveMimeType)) {
    effectiveMimeType = (await detectMimeTypeFromBuffer(sharp, buffer)) ?? effectiveMimeType;
  }
  if (!supportedImageMimeTypes.has(effectiveMimeType)) {
    return { analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION, status: "unsupported" };
  }

  try {
    const source = sharp(buffer, { limitInputPixels: visibleContentInputPixelLimit });
    const metadata = await source.metadata();
    if ((metadata.pages ?? 1) > 1) {
      return { analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION, status: "unsupported" };
    }

    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height || info.channels < 4) {
      return { analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION, status: "failed" };
    }

    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    const channels = info.channels;

    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * channels + 3];
        if (alpha < VISIBLE_CONTENT_ALPHA_THRESHOLD) {
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) {
      return {
        analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION,
        status: "empty",
        sourceWidth: info.width,
        sourceHeight: info.height,
        alphaThreshold: VISIBLE_CONTENT_ALPHA_THRESHOLD
      };
    }

    return {
      analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION,
      status: "ready",
      sourceWidth: info.width,
      sourceHeight: info.height,
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      alphaThreshold: VISIBLE_CONTENT_ALPHA_THRESHOLD
    };
  } catch {
    return { analyzerVersion: VISIBLE_CONTENT_ANALYZER_VERSION, status: "failed" };
  }
}

async function toBuffer(value: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return Buffer.from(await value.arrayBuffer());
  }
  throw new Error("Unsupported background remover output type");
}

export async function removeImageBackground(
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<BackgroundRemovalResult> {
  if (process.env.AUTO_BG_REMOVAL === "false") {
    return { status: "skipped", reason: "Disabled by AUTO_BG_REMOVAL=false" };
  }

  let sharp: SharpFactory;
  let removeBackground: typeof import("@imgly/background-removal-node")["removeBackground"];
  try {
    [sharp, removeBackground] = await Promise.all([loadSharp(), loadRemoveBackground()]);
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Image processing runtime could not be loaded"
    };
  }

  const normalizedMimeType = normalizeMimeType(mimeType);
  let effectiveMimeType = normalizedMimeType;
  if (!supportedImageMimeTypes.has(effectiveMimeType)) {
    const detected = await detectMimeTypeFromBuffer(sharp, buffer);
    if (detected) {
      effectiveMimeType = detected;
    }
  }

  if (!supportedImageMimeTypes.has(effectiveMimeType)) {
    return {
      status: "skipped",
      reason: `Unsupported mime type: ${mimeType}`
    };
  }

  try {
    const normalizedInput = await normalizeToPng(sharp, buffer);
    const typedInput = new Blob([new Uint8Array(normalizedInput)], { type: "image/png" });
    const output = await removeBackground(typedInput, {
      output: {
        format: "image/png",
        quality: 1
      }
    } as never);

    const outputBuffer = await toBuffer(output);
    if (!outputBuffer.length) {
      return { status: "failed", reason: "Background remover returned an empty image" };
    }

    const processedBuffer = await normalizeToPng(sharp, outputBuffer);
    const stabilizedBuffer = await sealInteriorTransparency(sharp, normalizedInput, processedBuffer);
    const transparent = await hasTransparentPixels(sharp, stabilizedBuffer);
    if (!transparent) {
      return {
        status: "failed",
        reason: "No removable background detected (output had no transparency)"
      };
    }

    return {
      status: "processed",
      buffer: stabilizedBuffer,
      mimeType: "image/png",
      originalName: outputNameWithPng(originalName)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Unknown background removal error"
    };
  }
}
