import { describe, expect, it } from "vitest";
import { buildInfoSchema, compareStableVersions, isSafeRelativePath, updateManifestSchema } from "./update";

const buildInfo = {
  schemaVersion: 1,
  appVersion: "1.8.0",
  releaseTag: "v1.8.0",
  builtAt: "2026-08-18T00:00:00.000Z",
  target: "windows-x64-portable",
  bundledNodeVersion: "22.18.0",
  updaterProtocolVersion: 1,
  sourceRepository: "rizaljamhari/pbresults-scoreboard",
  sourceCommit: "a".repeat(40)
} as const;

const manifest = {
  schemaVersion: 1,
  release: { version: "1.8.0", tag: "v1.8.0", channel: "stable", builtAt: buildInfo.builtAt },
  target: { platform: "win32", arch: "x64", packageKind: "portable" },
  protocol: { minimumUpdaterVersion: 1 },
  asset: {
    name: "pbresults-scoreboard-windows-portable-v1.8.0.zip",
    size: 123,
    unpackedSize: 456,
    sha256: "b".repeat(64)
  },
  payload: {
    rootDirectory: "PBResults-Scoreboard",
    applicationDirectory: "app",
    buildInfoFile: "app/BUILD-INFO.json",
    serverEntry: "app/dist/server/server/index.js"
  }
} as const;

describe("update release contracts", () => {
  it("accepts matching build information and manifest metadata", () => {
    expect(buildInfoSchema.parse(buildInfo).releaseTag).toBe("v1.8.0");
    expect(updateManifestSchema.parse(manifest).asset.size).toBe(123);
  });

  it("rejects mismatched tags, filenames, targets, and unsafe paths", () => {
    expect(() => updateManifestSchema.parse({ ...manifest, release: { ...manifest.release, tag: "v1.9.0" } })).toThrow();
    expect(() => updateManifestSchema.parse({ ...manifest, asset: { ...manifest.asset, name: "wrong.zip" } })).toThrow();
    expect(() => updateManifestSchema.parse({ ...manifest, target: { ...manifest.target, arch: "arm64" } })).toThrow();
    expect(
      () => updateManifestSchema.parse({ ...manifest, payload: { ...manifest.payload, buildInfoFile: "../BUILD-INFO.json" } })
    ).toThrow();
  });

  it.each(["../app", "app/../data", "/app", "C:/app", "app\\file", "app//file", "./app"])(
    "rejects unsafe relative path %s",
    (value) => expect(isSafeRelativePath(value)).toBe(false)
  );

  it("compares stable versions numerically", () => {
    expect(compareStableVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareStableVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareStableVersions("1.0.9", "1.1.0")).toBe(-1);
    expect(() => compareStableVersions("9007199254740992.0.0", "1.0.0")).toThrow();
  });
});
