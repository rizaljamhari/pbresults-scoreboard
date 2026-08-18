import fs from "node:fs";
import path from "node:path";
import { runtimeBuild } from "./buildInfo.js";
import { clientDistDir, dataDir } from "./runtimePaths.js";
import { validatePersistentStorage } from "./storage.js";

let dataReadable = false;
let storageValid = false;

export function runStartupHealthProbe() {
  storageValid = validatePersistentStorage();
  const probePath = path.join(dataDir, `.health-probe-${process.pid}`);
  try {
    const descriptor = fs.openSync(probePath, "wx");
    fs.writeFileSync(descriptor, "ok", "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    fs.rmSync(probePath);
    dataReadable = true;
  } catch {
    dataReadable = false;
    try {
      fs.rmSync(probePath, { force: true });
    } catch {
      // The cached probe result is sufficient for health reporting.
    }
  }
}

export function getHealthStatus() {
  const clientBuildPresent = fs.existsSync(path.join(clientDistDir, "index.html"));
  const metadataValid = !runtimeBuild.error;
  return {
    status: dataReadable && storageValid && clientBuildPresent && metadataValid ? "ok" : "error",
    ready: dataReadable && storageValid && clientBuildPresent && metadataValid,
    appVersion: runtimeBuild.info.appVersion,
    releaseTag: runtimeBuild.info.releaseTag,
    target: runtimeBuild.info.target,
    dataReadable: dataReadable && storageValid,
    clientBuildPresent
  };
}
