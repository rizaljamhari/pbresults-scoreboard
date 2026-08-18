import { z } from "zod";

export const UPDATER_PROTOCOL_VERSION = 1;
export const UPDATE_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const UPDATE_UNPACKED_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const UPDATE_SOURCE_REPOSITORY = "rizaljamhari/pbresults-scoreboard";

function hasSafeVersionParts(value: string): boolean {
  return value.replace(/^v/, "").split(".").every((part) => Number.isSafeInteger(Number(part)));
}

export const stableVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine(hasSafeVersionParts, "Version components must be safe integers");
export const stableReleaseTagSchema = z
  .string()
  .regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine(hasSafeVersionParts, "Version components must be safe integers");
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const relativePathSchema = z.string().refine(isSafeRelativePath, "Expected a normalized relative path");

export const buildInfoSchema = z
  .object({
    schemaVersion: z.literal(1),
    appVersion: stableVersionSchema,
    releaseTag: stableReleaseTagSchema,
    builtAt: z.string().datetime(),
    target: z.literal("windows-x64-portable"),
    bundledNodeVersion: z.string().min(1),
    updaterProtocolVersion: z.number().int().positive(),
    sourceRepository: z.literal(UPDATE_SOURCE_REPOSITORY),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/)
  })
  .refine((value) => value.releaseTag === `v${value.appVersion}`, {
    path: ["releaseTag"],
    message: "Release tag and application version disagree"
  });

export const updateManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: z.object({
      version: stableVersionSchema,
      tag: stableReleaseTagSchema,
      channel: z.literal("stable"),
      builtAt: z.string().datetime()
    }),
    target: z.object({
      platform: z.literal("win32"),
      arch: z.literal("x64"),
      packageKind: z.literal("portable")
    }),
    protocol: z.object({
      minimumUpdaterVersion: z.number().int().positive()
    }),
    asset: z.object({
      name: z.string().min(1),
      size: z.number().int().nonnegative().max(UPDATE_ARCHIVE_MAX_BYTES),
      unpackedSize: z.number().int().nonnegative().max(UPDATE_UNPACKED_MAX_BYTES),
      sha256: sha256Schema
    }),
    payload: z.object({
      rootDirectory: relativePathSchema,
      applicationDirectory: relativePathSchema,
      buildInfoFile: relativePathSchema,
      serverEntry: relativePathSchema
    })
  })
  .superRefine((manifest, context) => {
    if (manifest.release.tag !== `v${manifest.release.version}`) {
      context.addIssue({ code: "custom", path: ["release", "tag"], message: "Release tag and version disagree" });
    }
    const expectedAsset = `pbresults-scoreboard-windows-portable-${manifest.release.tag}.zip`;
    if (manifest.asset.name !== expectedAsset) {
      context.addIssue({ code: "custom", path: ["asset", "name"], message: `Expected ${expectedAsset}` });
    }
    const appPrefix = `${manifest.payload.applicationDirectory}/`;
    if (!manifest.payload.buildInfoFile.startsWith(appPrefix) || !manifest.payload.serverEntry.startsWith(appPrefix)) {
      context.addIssue({ code: "custom", path: ["payload"], message: "Payload files must be inside the application directory" });
    }
  });

export const updatePhaseSchema = z.enum([
  "unsupported",
  "idle",
  "checking",
  "update-available",
  "downloading",
  "verifying",
  "staging",
  "ready-to-install",
  "install-requested",
  "restarting",
  "succeeded",
  "rolled-back",
  "failed"
]);

export const updateErrorCodeSchema = z.enum([
  "UPDATE_UNSUPPORTED_RUNTIME",
  "UPDATE_CHECK_OFFLINE",
  "UPDATE_GITHUB_RATE_LIMITED",
  "UPDATE_RELEASE_INVALID",
  "UPDATE_MANIFEST_MISSING",
  "UPDATE_MANIFEST_INVALID",
  "UPDATE_PROTOCOL_UNSUPPORTED",
  "UPDATE_ALREADY_CURRENT",
  "UPDATE_DOWNLOAD_FAILED",
  "UPDATE_DOWNLOAD_TOO_LARGE",
  "UPDATE_DIGEST_MISMATCH",
  "UPDATE_INSUFFICIENT_DISK_SPACE",
  "UPDATE_ARCHIVE_UNSAFE",
  "UPDATE_PAYLOAD_INVALID",
  "UPDATE_BUSY",
  "UPDATE_LOCAL_REQUEST_REQUIRED",
  "UPDATE_CONFIRMATION_REQUIRED",
  "UPDATE_SHUTDOWN_TIMEOUT",
  "UPDATE_SNAPSHOT_FAILED",
  "UPDATE_ACTIVATION_FAILED",
  "UPDATE_HEALTH_TIMEOUT",
  "UPDATE_VERSION_MISMATCH",
  "UPDATE_ROLLBACK_FAILED"
]);

export const updateStatusSchema = z.object({
  managedUpdatesSupported: z.boolean(),
  unsupportedReason: z.string().nullable(),
  phase: updatePhaseSchema,
  current: z.object({
    version: z.string(),
    releaseTag: z.string().nullable(),
    builtAt: z.string().nullable(),
    sourceCommit: z.string().nullable(),
    updaterProtocolVersion: z.number().int().nullable()
  }),
  available: z
    .object({
      version: stableVersionSchema,
      releaseTag: stableReleaseTagSchema,
      publishedAt: z.string().datetime(),
      releasePageUrl: z.string().url(),
      assetSize: z.number().int().nonnegative()
    })
    .nullable(),
  prepared: z
    .object({
      version: stableVersionSchema,
      releaseTag: stableReleaseTagSchema,
      downloadedBytes: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative(),
      stagedAt: z.string().nullable()
    })
    .nullable(),
  lastCheckedAt: z.string().nullable(),
  nextAutomaticCheckAt: z.string().nullable(),
  skippedVersion: z.string().nullable(),
  lastResult: z
    .object({
      outcome: z.enum(["succeeded", "rolled-back", "failed"]),
      fromVersion: z.string(),
      targetVersion: z.string(),
      completedAt: z.string(),
      message: z.string()
    })
    .nullable(),
  error: z
    .object({
      code: updateErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean()
    })
    .nullable(),
  rollbackAvailable: z.boolean().default(false)
});

export const updateDownloadRequestSchema = z.object({ version: stableVersionSchema });
export const updateInstallRequestSchema = z.object({
  version: stableVersionSchema,
  confirmation: z.literal("INSTALL_AND_RESTART")
});
export const updateSkipRequestSchema = z.object({ version: stableVersionSchema });
export const updateRollbackRequestSchema = z.object({ confirmation: z.literal("ROLL_BACK_AND_RESTART") });

export type BuildInfo = z.infer<typeof buildInfoSchema>;
export type UpdateManifest = z.infer<typeof updateManifestSchema>;
export type UpdatePhase = z.infer<typeof updatePhaseSchema>;
export type UpdateErrorCode = z.infer<typeof updateErrorCodeSchema>;
export type UpdateStatus = z.infer<typeof updateStatusSchema>;

export function compareStableVersions(left: string, right: string): number {
  const leftParts = stableVersionSchema.parse(left).split(".").map(Number);
  const rightParts = stableVersionSchema.parse(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}
