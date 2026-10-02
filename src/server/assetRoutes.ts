import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { assetCleanupRequestSchema } from "../shared/theme.js";
import type { AppChangedEventType } from "../shared/appEvents.js";
import {
  AssetInUseError,
  AssetNotFoundError,
  AssetOperationError,
  attachExistingTeamLogo,
  attachTeamLogo,
  deleteAsset,
  getAssetCleanupReport,
  listAssetLibrary,
  listAssets,
  renameAsset,
  replaceAssetFile,
  reprocessAssetBackground,
  revertAssetToOriginal,
  runAssetCleanup,
  storeAsset
} from "./storage.js";

type AssetRouteOptions = {
  hub: { publish: (type: AppChangedEventType, resourceIds?: string[]) => unknown };
  /** Called after team records change so live team resolution picks up new logos. */
  onTeamsChanged?: () => void;
};

const imageMimeTypes = new Map<string, string>([
  ["image/png", "image/png"],
  ["image/x-png", "image/png"],
  ["image/jpeg", "image/jpeg"],
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
  ["image/webp", "image/webp"],
  ["image/gif", "image/gif"]
]);

const imageExtensions = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

/** Resolves an accepted image mime type, or null when the upload is not a supported image. */
export function resolveUploadMimeType(mimeType: string, fileName: string): string | null {
  const byMime = imageMimeTypes.get(mimeType.toLowerCase());
  if (byMime) {
    return byMime;
  }
  if (mimeType === "" || mimeType === "application/octet-stream") {
    return imageExtensions.get(path.extname(fileName).toLowerCase()) ?? null;
  }
  return null;
}

const fontExtensions = new Map<string, string>([
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"]
]);

/**
 * Resolves a font upload's mime type from its extension (browsers report fonts inconsistently, often as
 * application/octet-stream), or null when it is not a WOFF2, WOFF, TTF or OTF file.
 */
export function resolveFontMimeType(fileName: string): string | null {
  return fontExtensions.get(path.extname(fileName).toLowerCase()) ?? null;
}

type UploadedImage = { buffer: Buffer; fileName: string; mimeType: string };

async function readImageUpload(request: FastifyRequest, reply: FastifyReply): Promise<UploadedImage | null> {
  const file = await request.file();
  if (!file) {
    reply.code(400).send({ message: "Missing file" });
    return null;
  }
  const mimeType = resolveUploadMimeType(file.mimetype, file.filename);
  if (!mimeType) {
    file.file.resume();
    reply.code(415).send({ code: "unsupported_media_type", message: "Upload a PNG, JPG, WebP or GIF image." });
    return null;
  }
  return { buffer: await file.toBuffer(), fileName: file.filename, mimeType };
}

function sendAssetError(reply: FastifyReply, error: unknown) {
  if (error instanceof AssetInUseError) {
    return reply.code(409).send({ code: error.code, message: error.message, usages: error.usages });
  }
  if (error instanceof AssetNotFoundError) {
    return reply.code(404).send({ code: error.code, message: error.message });
  }
  if (error instanceof AssetOperationError) {
    return reply.code(400).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "invalid_request", message: "Invalid request", issues: error.issues });
  }
  if (error instanceof Error && error.message === "Team not found") {
    return reply.code(404).send({ code: "team_not_found", message: error.message });
  }
  throw error;
}

const idParamsSchema = z.object({ id: z.string().min(1) });
const renameBodySchema = z.object({ displayName: z.string().max(120).nullable() });
const slotSchema = z.enum(["primary", "alternate"]);
const linkLogoBodySchema = z.object({ assetId: z.string().min(1).nullable(), slot: slotSchema.default("primary") });

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

export function registerAssetRoutes(app: FastifyInstance, options: AssetRouteOptions): void {
  const { hub } = options;

  app.get("/api/assets", async () => listAssets());

  app.post("/api/assets", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: "Missing file" });
    }
    const imageMimeType = resolveUploadMimeType(file.mimetype, file.filename);
    const fontMimeType = imageMimeType ? null : resolveFontMimeType(file.filename);
    if (!imageMimeType && !fontMimeType) {
      file.file.resume();
      return reply.code(415).send({ code: "unsupported_media_type", message: "Upload a PNG, JPG, WebP or GIF image, or a WOFF2, WOFF, TTF or OTF font." });
    }
    const buffer = await file.toBuffer();
    // Fonts are stored as they are: background removal is for images.
    const result = await storeAsset(buffer, file.filename, (imageMimeType ?? fontMimeType) as string, fontMimeType ? { attemptBackgroundRemoval: false } : {});
    hub.publish("assets.changed", [result.asset.id]);
    return reply.code(201).send(result);
  });

  app.get("/api/assets/library", async () => listAssetLibrary());

  app.get("/api/assets/cleanup", async () => getAssetCleanupReport());

  app.post("/api/assets/cleanup", async (request, reply) => {
    try {
      const body = assetCleanupRequestSchema.parse(request.body ?? {});
      const { deletedIds, ...result } = await runAssetCleanup(body);
      if (result.deleted > 0) {
        hub.publish("assets.changed", deletedIds);
      }
      return result;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.patch("/api/assets/:id", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const { displayName } = renameBodySchema.parse(request.body);
      const asset = renameAsset(id, displayName);
      hub.publish("assets.changed", [asset.id]);
      return asset;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.put("/api/assets/:id/file", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const upload = await readImageUpload(request, reply);
      if (!upload) return reply;
      const removeBackground = parseBooleanQuery((request.query as { removeBackground?: string } | undefined)?.removeBackground);
      const result = await replaceAssetFile(id, upload.buffer, upload.fileName, upload.mimeType, { removeBackground });
      hub.publish("assets.changed", [id]);
      return result;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.post("/api/assets/:id/revert", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const asset = await revertAssetToOriginal(id);
      hub.publish("assets.changed", [id]);
      return asset;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.post("/api/assets/:id/reprocess", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const result = await reprocessAssetBackground(id);
      if (result.processing.status === "processed") {
        hub.publish("assets.changed", [id]);
      }
      return result;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.delete("/api/assets/:id", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const force = parseBooleanQuery((request.query as { force?: string } | undefined)?.force) ?? false;
      const result = await deleteAsset(id, { force });
      hub.publish("assets.changed", result.deletedIds);
      if (result.clearedThemeIds.length) {
        hub.publish("themes.changed", result.clearedThemeIds);
      }
      if (result.clearedTeamIds.length) {
        options.onTeamsChanged?.();
        hub.publish("teams.changed", result.clearedTeamIds);
      }
      return result;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.post("/api/teams/:id/logo", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const slot = (request.query as { slot?: string } | undefined)?.slot === "alternate" ? "alternate" : "primary";
      const upload = await readImageUpload(request, reply);
      if (!upload) return reply;
      const result = await attachTeamLogo(id, upload.buffer, upload.fileName, upload.mimeType, slot);
      options.onTeamsChanged?.();
      hub.publish("teams.changed", [result.team.id]);
      hub.publish("assets.changed", [result.asset.id]);
      return reply.code(201).send(result);
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  app.put("/api/teams/:id/logo/asset", async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const { assetId, slot } = linkLogoBodySchema.parse(request.body);
      const team = attachExistingTeamLogo(id, assetId, slot);
      options.onTeamsChanged?.();
      hub.publish("teams.changed", [team.id]);
      hub.publish("assets.changed", assetId ? [assetId] : undefined);
      return team;
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });
}
