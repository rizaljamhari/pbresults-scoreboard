import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  UPDATER_PROTOCOL_VERSION,
  UPDATE_SOURCE_REPOSITORY,
  compareStableVersions,
  updateErrorCodeSchema,
  updateManifestSchema,
  type UpdateErrorCode,
  type UpdateManifest,
  type UpdateStatus
} from "../shared/update.js";
import { runtimeBuild } from "./buildInfo.js";
import { bootstrapPortableUpdater } from "./portableBootstrap.js";
import {
  appRootDir,
  currentVersionPath,
  dataDir,
  portableUpdaterPath,
  updateDownloadsDir,
  updateStagingDir,
  updateTransactionsDir
} from "./runtimePaths.js";
import { assertTrustedDownloadUrl } from "./updateSecurity.js";
import {
  atomicWriteJson,
  createTransaction,
  findLatestCompletedTransaction,
  readPersistedUpdateState,
  readTransaction,
  writePersistedUpdateState,
  type PersistedUpdateState
} from "./updateStorage.js";
import { getSettings } from "./storage.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30_000;
const MAX_JITTER_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const COORDINATOR_START_TIMEOUT_MS = 10_000;

type ReleaseMetadata = {
  manifestName: string;
  manifestUrl: string;
  archiveUrl: string;
  archiveApiSize: number;
  manifest: UpdateManifest;
};

type GitHubAsset = { name?: unknown; size?: unknown; browser_download_url?: unknown };
type GitHubRelease = {
  draft?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

class UpdateFailure extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

function emptyPersistedState(): PersistedUpdateState {
  return {
    available: null,
    prepared: null,
    lastCheckedAt: null,
    nextAutomaticCheckAt: null,
    skippedVersion: null,
    lastResult: null,
    etag: null,
    releaseMetadata: null,
    transactionPath: null,
    dismissedResultCompletedAt: null
  };
}

function directorySize(root: string): number {
  if (!fs.existsSync(root)) {
    return 0;
  }
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(target);
    } else if (entry.isFile()) {
      total += fs.statSync(target).size;
    }
  }
  return total;
}

function requiredDiskBytes(manifest: UpdateManifest): number {
  const base = manifest.asset.size + manifest.asset.unpackedSize + directorySize(dataDir) + 250 * 1024 * 1024;
  return Math.ceil(base * 1.1);
}

function assertDiskSpace(manifest: UpdateManifest) {
  let available: number;
  try {
    const stats = fs.statfsSync(appRootDir);
    available = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    throw new UpdateFailure("UPDATE_INSUFFICIENT_DISK_SPACE", "Unable to determine available disk space.", false);
  }
  const required = requiredDiskBytes(manifest);
  if (!Number.isSafeInteger(available) || available < required) {
    throw new UpdateFailure(
      "UPDATE_INSUFFICIENT_DISK_SPACE",
      `The update requires ${required} bytes of free space, but ${available} bytes are available.`,
      false
    );
  }
}

async function fetchTrustedAsset(url: string, allowTestHttp: boolean, signal: AbortSignal): Promise<Response> {
  let current = assertTrustedDownloadUrl(url, allowTestHttp);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      assertTrustedDownloadUrl(response.url || current.toString(), allowTestHttp);
      return response;
    }
    const location = response.headers.get("location");
    if (!location || redirect === 5) {
      throw new UpdateFailure("UPDATE_DOWNLOAD_FAILED", "The release asset exceeded the redirect limit.", false);
    }
    current = assertTrustedDownloadUrl(new URL(location, current).toString(), allowTestHttp);
  }
  throw new UpdateFailure("UPDATE_DOWNLOAD_FAILED", "The release asset redirect could not be resolved.", false);
}

function transactionResult(transaction: Record<string, unknown>): UpdateStatus["lastResult"] {
  const outcome = transaction.outcome;
  if (outcome !== "succeeded" && outcome !== "rolled-back" && outcome !== "failed") {
    return null;
  }
  return {
    outcome,
    fromVersion: String(transaction.sourceVersion ?? "unknown"),
    targetVersion: String(transaction.targetVersion ?? "unknown"),
    completedAt: String(transaction.completedAt ?? new Date().toISOString()),
    message:
      outcome === "succeeded"
        ? "The software update completed successfully."
        : outcome === "rolled-back"
          ? `The update could not start safely and was automatically rolled back. ${String(transaction.errorMessage ?? "")}`.trim()
          : String(transaction.errorMessage ?? "The software update failed.")
  };
}

async function spawnCoordinator(
  mode: "Install" | "Rollback",
  transactionPath: string,
  startedPhase: "install-coordinator-started" | "rollback-coordinator-started"
) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", portableUpdaterPath, "-Mode", mode, "-TransactionPath", transactionPath],
    { cwd: appRootDir, stdio: "ignore", windowsHide: false }
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  const deadline = Date.now() + COORDINATOR_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new UpdateFailure("UPDATE_ACTIVATION_FAILED", `The ${mode.toLowerCase()} coordinator exited before it was ready.`, true);
    }
    try {
      if (readTransaction(transactionPath).phase === startedPhase) {
        child.unref();
        return;
      }
    } catch {
      // The coordinator atomically replaces the journal while acknowledging startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  child.unref();
  throw new UpdateFailure("UPDATE_ACTIVATION_FAILED", `The ${mode.toLowerCase()} coordinator did not become ready.`, true);
}

export class UpdateService {
  private readonly bootstrap = bootstrapPortableUpdater();
  private persisted = readPersistedUpdateState() ?? emptyPersistedState();
  private phase: UpdateStatus["phase"];
  private error: UpdateStatus["error"] = null;
  private busy = false;
  private automaticTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private requestShutdown: (() => Promise<void>) | null = null;
  private serverPort = Number(process.env.PORT ?? 3000);
  private activeTransactionPath: string | null = null;
  private showSkippedRelease = false;
  private rateLimitResetAtMs: number | null = null;

  constructor() {
    this.activeTransactionPath = this.persisted.transactionPath;
    if (this.persisted.available && compareStableVersions(this.persisted.available.version, runtimeBuild.info.appVersion) <= 0) {
      this.persisted.available = null;
      this.persisted.prepared = null;
      this.persisted.releaseMetadata = null;
      this.persisted.transactionPath = null;
    }
    const completed = findLatestCompletedTransaction();
    const result = completed ? transactionResult(completed) : null;
    if (
      result &&
      (!this.persisted.dismissedResultCompletedAt || result.completedAt > this.persisted.dismissedResultCompletedAt) &&
      (!this.persisted.lastResult || result.completedAt > this.persisted.lastResult.completedAt)
    ) {
      this.persisted.lastResult = result;
      this.persisted.prepared = null;
      this.persisted.available = null;
      this.persisted.releaseMetadata = null;
      this.persisted.transactionPath = null;
      this.save();
    }
    this.phase = !this.bootstrap.supported
      ? "unsupported"
      : this.persisted.prepared?.stagedAt
        ? "ready-to-install"
        : this.persisted.available
          ? this.persisted.skippedVersion === this.persisted.available.version ? "idle" : "update-available"
          : this.persisted.lastResult?.outcome === "succeeded"
            ? "succeeded"
            : this.persisted.lastResult?.outcome === "rolled-back"
              ? "rolled-back"
              : this.persisted.lastResult?.outcome === "failed"
                ? "failed"
                : "idle";
  }

  configureLifecycle(options: { port: number; shutdown: () => Promise<void> }) {
    this.serverPort = options.port;
    this.requestShutdown = options.shutdown;
  }

  startAutomaticChecks() {
    if (!this.bootstrap.supported || !getSettings().updateCheckEnabled) {
      return;
    }
    this.scheduleAutomaticCheck(FIRST_CHECK_DELAY_MS);
  }

  reconfigureAutomaticChecks() {
    this.stop();
    this.startAutomaticChecks();
  }

  stop() {
    if (this.automaticTimer) {
      clearTimeout(this.automaticTimer);
      this.automaticTimer = null;
    }
  }

  getStatus(): UpdateStatus {
    this.syncCompletedTransaction();
    let rollbackAvailable = false;
    try {
      const pointer = JSON.parse(fs.readFileSync(currentVersionPath, "utf8")) as { previous?: unknown };
      rollbackAvailable = Boolean(pointer.previous);
    } catch {
      rollbackAvailable = false;
    }
    return {
      managedUpdatesSupported: this.bootstrap.supported,
      unsupportedReason: this.bootstrap.reason,
      phase: this.phase,
      current: {
        version: runtimeBuild.info.appVersion,
        releaseTag: runtimeBuild.info.releaseTag,
        builtAt: runtimeBuild.info.builtAt,
        sourceCommit: runtimeBuild.info.sourceCommit,
        updaterProtocolVersion: runtimeBuild.info.updaterProtocolVersion
      },
      available:
        this.persisted.available &&
        (this.showSkippedRelease || this.persisted.skippedVersion !== this.persisted.available.version)
          ? this.persisted.available
          : null,
      prepared: this.persisted.prepared,
      lastCheckedAt: this.persisted.lastCheckedAt,
      nextAutomaticCheckAt: this.persisted.nextAutomaticCheckAt,
      skippedVersion: this.persisted.skippedVersion,
      lastResult: this.persisted.lastResult,
      error: this.error,
      rollbackAvailable
    };
  }

  async check(manual = true): Promise<UpdateStatus> {
    this.assertSupported();
    if (this.busy) {
      throw new UpdateFailure("UPDATE_BUSY", "Another update operation is already in progress.", true, 409);
    }
    this.busy = true;
    this.phase = "checking";
    this.error = null;
    this.showSkippedRelease = manual;
    try {
      const apiOverride = process.env.PB_UPDATE_API_BASE_URL;
      const endpoint = apiOverride
        ? new URL(`/repos/${UPDATE_SOURCE_REPOSITORY}/releases/latest`, apiOverride).toString()
        : `https://api.github.com/repos/${UPDATE_SOURCE_REPOSITORY}/releases/latest`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "PBResults-Scoreboard-Updater/1"
      };
      if (this.persisted.etag) {
        headers["If-None-Match"] = this.persisted.etag;
      }
      const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20_000) });
      if (response.status === 304) {
        this.persisted.lastCheckedAt = new Date().toISOString();
        this.retryCount = 0;
        this.rateLimitResetAtMs = null;
        this.phase = this.persisted.prepared ? "ready-to-install" : this.persisted.available ? "update-available" : "idle";
        this.save();
        return this.getStatus();
      }
      if (response.status === 403 || response.status === 429) {
        const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
        this.rateLimitResetAtMs = Number.isFinite(resetSeconds) ? resetSeconds * 1000 : null;
        throw new UpdateFailure("UPDATE_GITHUB_RATE_LIMITED", "GitHub temporarily rate-limited update checks.", true, 503);
      }
      if (!response.ok) {
        throw new UpdateFailure("UPDATE_CHECK_OFFLINE", `Update check failed with HTTP ${response.status}.`, true, 503);
      }
      const release = (await response.json()) as GitHubRelease;
      const parsed = await this.parseRelease(release, Boolean(apiOverride));
      this.showSkippedRelease = manual;
      this.persisted.etag = response.headers.get("etag");
      this.persisted.lastCheckedAt = new Date().toISOString();
      this.retryCount = 0;
      this.rateLimitResetAtMs = null;

      if (compareStableVersions(parsed.manifest.release.version, runtimeBuild.info.appVersion) <= 0) {
        this.persisted.available = null;
        this.persisted.releaseMetadata = null;
        this.phase = this.persisted.prepared ? "ready-to-install" : "idle";
      } else {
        this.persisted.available = {
          version: parsed.manifest.release.version,
          releaseTag: parsed.manifest.release.tag,
          publishedAt: String(release.published_at),
          releasePageUrl: String(release.html_url),
          assetSize: parsed.manifest.asset.size
        };
        this.persisted.releaseMetadata = parsed as unknown as Record<string, unknown>;
        this.phase = "update-available";
        if (!manual && this.persisted.skippedVersion === parsed.manifest.release.version) {
          this.phase = "idle";
        }
        if (!manual && getSettings().updateAutoDownload && this.persisted.skippedVersion !== parsed.manifest.release.version) {
          queueMicrotask(() => this.download(parsed.manifest.release.version));
        }
      }
      this.save();
      return this.getStatus();
    } catch (error) {
      const failure = this.asFailure(error, "UPDATE_CHECK_OFFLINE", "Unable to reach the update service.", true, 503);
      this.error = { code: failure.code, message: failure.message, retryable: failure.retryable };
      this.retryCount += 1;
      this.phase = this.persisted.available ? "update-available" : "failed";
      if (manual) {
        throw failure;
      }
      return this.getStatus();
    } finally {
      this.busy = false;
      if (!manual) {
        const normalDelay = this.retryCount === 1 ? 15 * 60 * 1000 : this.retryCount === 2 ? 60 * 60 * 1000 : this.checkIntervalMs();
        const rateLimitDelay = this.rateLimitResetAtMs ? Math.max(0, this.rateLimitResetAtMs - Date.now()) : 0;
        const retryDelay = Math.max(normalDelay, rateLimitDelay);
        this.scheduleAutomaticCheck(retryDelay + Math.floor(Math.random() * MAX_JITTER_MS));
      }
    }
  }

  download(version: string): UpdateStatus {
    this.assertSupported();
    if (this.busy) {
      throw new UpdateFailure("UPDATE_BUSY", "Another update operation is already in progress.", true, 409);
    }
    if (!this.persisted.available || this.persisted.available.version !== version || !this.persisted.releaseMetadata) {
      throw new UpdateFailure("UPDATE_RELEASE_INVALID", "The requested release is no longer the available update.", false, 409);
    }
    this.busy = true;
    this.phase = "downloading";
    this.error = null;
    void this.performDownload(version).finally(() => {
      this.busy = false;
    });
    return this.getStatus();
  }

  async install(version: string): Promise<UpdateStatus> {
    this.assertSupported();
    if (this.busy) {
      throw new UpdateFailure("UPDATE_BUSY", "Another update operation is already in progress.", true, 409);
    }
    if (this.phase !== "ready-to-install" || this.persisted.prepared?.version !== version || !this.activeTransactionPath) {
      throw new UpdateFailure("UPDATE_CONFIRMATION_REQUIRED", "The requested version is not prepared for installation.", false, 409);
    }
    const transaction = readTransaction(this.activeTransactionPath);
    const manifest = updateManifestSchema.parse(transaction.manifest);
    assertDiskSpace(manifest);
    transaction.phase = "shutdown-requested";
    transaction.serverPid = process.pid;
    transaction.port = this.serverPort;
    transaction.phaseTimestamps = {
      ...((transaction.phaseTimestamps as Record<string, string> | undefined) ?? {}),
      "shutdown-requested": new Date().toISOString()
    };
    atomicWriteJson(this.activeTransactionPath, transaction);
    await spawnCoordinator("Install", this.activeTransactionPath, "install-coordinator-started");
    this.phase = "install-requested";
    this.save();
    setTimeout(() => {
      void this.requestShutdown?.();
    }, 250).unref();
    return this.getStatus();
  }

  skip(version: string): UpdateStatus {
    if (!this.persisted.available || this.persisted.available.version !== version) {
      throw new UpdateFailure("UPDATE_RELEASE_INVALID", "Only the currently available version can be skipped.", false, 409);
    }
    this.persisted.skippedVersion = this.persisted.skippedVersion === version ? null : version;
    this.showSkippedRelease = this.persisted.skippedVersion !== version;
    this.phase = this.persisted.skippedVersion === version ? "idle" : "update-available";
    this.save();
    return this.getStatus();
  }

  dismissResult(): UpdateStatus {
    this.persisted.dismissedResultCompletedAt = this.persisted.lastResult?.completedAt ?? this.persisted.dismissedResultCompletedAt;
    this.persisted.lastResult = null;
    if (["succeeded", "rolled-back", "failed"].includes(this.phase)) {
      this.phase =
        this.persisted.available && this.persisted.skippedVersion !== this.persisted.available.version
          ? "update-available"
          : "idle";
    }
    this.save();
    return this.getStatus();
  }

  async rollback(): Promise<UpdateStatus> {
    this.assertSupported();
    if (this.busy) {
      throw new UpdateFailure("UPDATE_BUSY", "Another update operation is already in progress.", true, 409);
    }
    let pointer: {
      active: { version: string; releaseTag: string; relativePath: string };
      previous: { version: string; releaseTag: string; relativePath: string } | null;
    };
    try {
      pointer = JSON.parse(fs.readFileSync(currentVersionPath, "utf8")) as typeof pointer;
    } catch {
      throw new UpdateFailure("UPDATE_ROLLBACK_FAILED", "The active version pointer is invalid.", false, 409);
    }
    if (!pointer.previous) {
      throw new UpdateFailure("UPDATE_ROLLBACK_FAILED", "No previous healthy version is available.", false, 409);
    }
    const id = randomUUID();
    const transaction = {
      schemaVersion: 1,
      id,
      kind: "manual-rollback",
      phase: "shutdown-requested",
      phaseTimestamps: { "shutdown-requested": new Date().toISOString() },
      sourceVersion: pointer.active.version,
      sourceReleaseTag: pointer.active.releaseTag,
      targetVersion: pointer.previous.version,
      targetReleaseTag: pointer.previous.releaseTag,
      serverPid: process.pid,
      port: this.serverPort,
      snapshotPath: null,
      newLauncherPid: null,
      outcome: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      recoveryAttempted: false,
      preparedMarkerPath: null
    };
    this.activeTransactionPath = createTransaction(transaction);
    this.persisted.transactionPath = this.activeTransactionPath;
    await spawnCoordinator("Rollback", this.activeTransactionPath, "rollback-coordinator-started");
    this.phase = "install-requested";
    this.save();
    setTimeout(() => void this.requestShutdown?.(), 250).unref();
    return this.getStatus();
  }

  private async parseRelease(release: GitHubRelease, allowTestHttp: boolean): Promise<ReleaseMetadata> {
    if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") {
      throw new UpdateFailure("UPDATE_RELEASE_INVALID", "GitHub returned a draft, prerelease, or malformed release.", false);
    }
    const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : "";
    try {
      compareStableVersions(version, version);
      assertTrustedDownloadUrl(String(release.html_url), allowTestHttp);
      if (!Number.isFinite(Date.parse(String(release.published_at)))) {
        throw new Error("invalid publication time");
      }
    } catch {
      throw new UpdateFailure("UPDATE_RELEASE_INVALID", "GitHub returned invalid stable release metadata.", false);
    }
    const assets = Array.isArray(release.assets) ? (release.assets as GitHubAsset[]) : [];
    const manifestName = `pbresults-scoreboard-update-manifest-${release.tag_name}.json`;
    const matchingManifests = assets.filter((asset) => asset.name === manifestName);
    if (matchingManifests.length !== 1) {
      throw new UpdateFailure("UPDATE_MANIFEST_MISSING", "The release does not contain exactly one matching update manifest.", false);
    }
    const manifestUrl = String(matchingManifests[0].browser_download_url ?? "");
    assertTrustedDownloadUrl(manifestUrl, allowTestHttp);
    const manifestResponse = await fetchTrustedAsset(manifestUrl, allowTestHttp, AbortSignal.timeout(20_000));
    if (!manifestResponse.ok) {
      throw new UpdateFailure("UPDATE_MANIFEST_INVALID", "The release manifest could not be downloaded.", true);
    }
    const bytes = Buffer.from(await manifestResponse.arrayBuffer());
    if (bytes.length > MANIFEST_MAX_BYTES) {
      throw new UpdateFailure("UPDATE_MANIFEST_INVALID", "The release manifest is too large.", false);
    }
    let manifest: UpdateManifest;
    try {
      manifest = updateManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
    } catch {
      throw new UpdateFailure("UPDATE_MANIFEST_INVALID", "The release manifest failed schema validation.", false);
    }
    if (manifest.release.tag !== release.tag_name) {
      throw new UpdateFailure("UPDATE_MANIFEST_INVALID", "The release tag and manifest disagree.", false);
    }
    if (manifest.protocol.minimumUpdaterVersion > UPDATER_PROTOCOL_VERSION) {
      throw new UpdateFailure("UPDATE_PROTOCOL_UNSUPPORTED", "This release requires a newer updater bootstrap.", false);
    }
    const matchingArchives = assets.filter((asset) => asset.name === manifest.asset.name);
    if (matchingArchives.length !== 1) {
      throw new UpdateFailure("UPDATE_RELEASE_INVALID", "The manifest's portable archive is missing or duplicated.", false);
    }
    const archive = matchingArchives[0];
    if (archive.size !== manifest.asset.size) {
      throw new UpdateFailure("UPDATE_MANIFEST_INVALID", "GitHub and the manifest report different archive sizes.", false);
    }
    const archiveUrl = String(archive.browser_download_url ?? "");
    assertTrustedDownloadUrl(archiveUrl, allowTestHttp);
    return { manifestName, manifestUrl, archiveUrl, archiveApiSize: Number(archive.size), manifest };
  }

  private async performDownload(version: string) {
    const metadata = this.persisted.releaseMetadata as unknown as ReleaseMetadata;
    const manifest = updateManifestSchema.parse(metadata.manifest);
    const allowTestHttp = Boolean(process.env.PB_UPDATE_API_BASE_URL);
    const transactionId = randomUUID();
    const partPath = path.join(updateDownloadsDir, `${manifest.release.tag}-${transactionId}.zip.part`);
    const archivePath = partPath.slice(0, -5);
    const stagingPath = path.join(updateStagingDir, transactionId);
    let descriptor: fs.promises.FileHandle | null = null;
    const downloadController = new AbortController();
    const totalTimeout = setTimeout(() => downloadController.abort(), DOWNLOAD_TIMEOUT_MS);
    totalTimeout.unref();
    let idleTimeout: NodeJS.Timeout | null = null;
    const touchIdleTimeout = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => downloadController.abort(), DOWNLOAD_IDLE_TIMEOUT_MS);
      idleTimeout.unref();
    };
    try {
      assertDiskSpace(manifest);
      assertTrustedDownloadUrl(metadata.archiveUrl, allowTestHttp);
      await fsp.mkdir(updateDownloadsDir, { recursive: true });
      touchIdleTimeout();
      const response = await fetchTrustedAsset(metadata.archiveUrl, allowTestHttp, downloadController.signal);
      if (!response.ok || !response.body) {
        throw new UpdateFailure("UPDATE_DOWNLOAD_FAILED", `Archive download failed with HTTP ${response.status}.`, true);
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) !== manifest.asset.size) {
        throw new UpdateFailure("UPDATE_DOWNLOAD_FAILED", "The archive Content-Length does not match the manifest.", true);
      }
      descriptor = await fsp.open(partPath, "wx");
      const reader = response.body.getReader();
      const hash = createHash("sha256");
      let downloadedBytes = 0;
      this.persisted.prepared = {
        version,
        releaseTag: manifest.release.tag,
        downloadedBytes: 0,
        totalBytes: manifest.asset.size,
        stagedAt: null
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        touchIdleTimeout();
        downloadedBytes += value.byteLength;
        if (downloadedBytes > manifest.asset.size) {
          throw new UpdateFailure("UPDATE_DOWNLOAD_TOO_LARGE", "The archive exceeded its declared size.", false);
        }
        hash.update(value);
        await descriptor.write(value);
        if (this.persisted.prepared) {
          this.persisted.prepared.downloadedBytes = downloadedBytes;
        }
      }
      if (downloadedBytes !== manifest.asset.size || hash.digest("hex") !== manifest.asset.sha256) {
        throw new UpdateFailure("UPDATE_DIGEST_MISMATCH", "The downloaded archive failed SHA-256 verification.", false);
      }
      this.phase = "verifying";
      await descriptor.sync();
      await descriptor.close();
      descriptor = null;
      await fsp.rename(partPath, archivePath);
      const transaction = {
        schemaVersion: 1,
        id: transactionId,
        phase: "staging",
        phaseTimestamps: { staging: new Date().toISOString() },
        sourceVersion: runtimeBuild.info.appVersion,
        sourceReleaseTag: runtimeBuild.info.releaseTag,
        targetVersion: version,
        archivePath: path.relative(appRootDir, archivePath),
        stagingPath: path.relative(appRootDir, stagingPath),
        manifest,
        expectedArchiveHash: manifest.asset.sha256,
        port: this.serverPort,
        preparedAppPath: null,
        stagedAt: null,
        snapshotPath: null,
        targetAppPath: null,
        newLauncherPid: null,
        outcome: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        recoveryAttempted: false,
        preparedMarkerPath: null
      };
      this.activeTransactionPath = createTransaction(transaction);
      this.persisted.transactionPath = this.activeTransactionPath;
      this.phase = "staging";
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        portableUpdaterPath,
        "-Mode",
        "Stage",
        "-TransactionPath",
        this.activeTransactionPath
      ]);
      const staged = readTransaction(this.activeTransactionPath);
      if (staged.phase !== "prepared" || typeof staged.preparedAppPath !== "string") {
        throw new UpdateFailure("UPDATE_PAYLOAD_INVALID", "The staged application failed validation.", false);
      }
      if (this.persisted.prepared) {
        this.persisted.prepared.stagedAt = String(staged.stagedAt ?? new Date().toISOString());
      }
      this.phase = "ready-to-install";
      this.error = null;
      this.save();
    } catch (error) {
      if (descriptor) {
        await descriptor.close().catch(() => undefined);
      }
      await fsp.rm(partPath, { force: true }).catch(() => undefined);
      let transactionFailure: UpdateFailure | null = null;
      if (this.activeTransactionPath) {
        try {
          const failedTransaction = readTransaction(this.activeTransactionPath);
          const parsedCode = updateErrorCodeSchema.safeParse(failedTransaction.errorCode);
          if (parsedCode.success) {
            transactionFailure = new UpdateFailure(
              parsedCode.data,
              String(failedTransaction.errorMessage ?? "The update package failed staging."),
              false
            );
          }
        } catch {
          // Fall back to the download-process error below.
        }
      }
      const failure = transactionFailure ?? this.asFailure(error, "UPDATE_DOWNLOAD_FAILED", "The update could not be downloaded or prepared.", true);
      this.error = { code: failure.code, message: failure.message, retryable: failure.retryable };
      this.phase = "failed";
      this.persisted.prepared = null;
      this.save();
    } finally {
      clearTimeout(totalTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
    }
  }

  private assertSupported() {
    if (!this.bootstrap.supported) {
      throw new UpdateFailure("UPDATE_UNSUPPORTED_RUNTIME", this.bootstrap.reason ?? "Managed updates are unavailable.", false, 409);
    }
  }

  private asFailure(
    error: unknown,
    fallbackCode: UpdateErrorCode,
    fallbackMessage: string,
    retryable: boolean,
    statusCode = 400
  ): UpdateFailure {
    if (error instanceof UpdateFailure) return error;
    return new UpdateFailure(fallbackCode, error instanceof Error ? error.message : fallbackMessage, retryable, statusCode);
  }

  private save() {
    writePersistedUpdateState(this.persisted);
  }

  private syncCompletedTransaction() {
    const completed = findLatestCompletedTransaction();
    const result = completed ? transactionResult(completed) : null;
    if (
      !result ||
      (this.persisted.dismissedResultCompletedAt && result.completedAt <= this.persisted.dismissedResultCompletedAt) ||
      (this.persisted.lastResult && result.completedAt <= this.persisted.lastResult.completedAt)
    ) {
      return;
    }
    this.persisted.lastResult = result;
    this.persisted.prepared = null;
    this.persisted.available = null;
    this.persisted.releaseMetadata = null;
    this.persisted.transactionPath = null;
    this.activeTransactionPath = null;
    this.error = null;
    this.phase = result.outcome === "succeeded" ? "succeeded" : result.outcome === "rolled-back" ? "rolled-back" : "failed";
    this.save();
  }

  private checkIntervalMs() {
    const hours = getSettings().updateCheckIntervalHours;
    return Number.isFinite(hours) ? hours * 60 * 60 * 1000 : DEFAULT_CHECK_INTERVAL_MS;
  }

  private scheduleAutomaticCheck(delayMs: number) {
    if (this.automaticTimer) clearTimeout(this.automaticTimer);
    this.persisted.nextAutomaticCheckAt = new Date(Date.now() + delayMs).toISOString();
    this.save();
    this.automaticTimer = setTimeout(() => {
      this.automaticTimer = null;
      void this.check(false);
    }, delayMs);
    this.automaticTimer.unref();
  }
}

export const updateService = new UpdateService();

export { UpdateFailure };
