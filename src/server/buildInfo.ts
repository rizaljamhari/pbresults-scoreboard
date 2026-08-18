import fs from "node:fs";
import path from "node:path";
import { buildInfoSchema, type BuildInfo } from "../shared/update.js";
import { activeAppDir, appRootDir, buildInfoPath, clientDistDir } from "./runtimePaths.js";

export type RuntimeBuildInfo = {
  appVersion: string;
  releaseTag: string | null;
  builtAt: string | null;
  target: string;
  bundledNodeVersion: string;
  updaterProtocolVersion: number | null;
  sourceRepository: string | null;
  sourceCommit: string | null;
  packaged: boolean;
};

function developmentVersion(): string {
  try {
    const packagePath = path.resolve(process.cwd(), "package.json");
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "development";
  } catch {
    return "development";
  }
}

export function loadBuildInfo(): { info: RuntimeBuildInfo; error: string | null } {
  if (!process.env.APP_BUILD_INFO_PATH || !process.env.APP_ROOT_DIR) {
    return {
      info: {
        appVersion: developmentVersion(),
        releaseTag: null,
        builtAt: null,
        target: "development",
        bundledNodeVersion: process.versions.node,
        updaterProtocolVersion: null,
        sourceRepository: null,
        sourceCommit: null,
        packaged: false
      },
      error: null
    };
  }

  try {
    const parsed = buildInfoSchema.parse(JSON.parse(fs.readFileSync(buildInfoPath, "utf8"))) as BuildInfo;
    return {
      info: {
        ...parsed,
        packaged: true
      },
      error: null
    };
  } catch (error) {
    return {
      info: {
        appVersion: "unknown",
        releaseTag: null,
        builtAt: null,
        target: "windows-x64-portable",
        bundledNodeVersion: process.versions.node,
        updaterProtocolVersion: null,
        sourceRepository: null,
        sourceCommit: null,
        packaged: true
      },
      error: error instanceof Error ? error.message : "Invalid packaged build metadata"
    };
  }
}

export const runtimeBuild = loadBuildInfo();

export function packagedRuntimeStructurallyPresent(): boolean {
  return fs.existsSync(activeAppDir) && fs.existsSync(clientDistDir) && fs.existsSync(buildInfoPath) && fs.existsSync(appRootDir);
}
