import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import {
  UPDATER_PROTOCOL_VERSION,
  UPDATE_SOURCE_REPOSITORY,
  UPDATE_UNPACKED_MAX_BYTES,
  updateManifestSchema,
  type UpdateErrorCode
} from "../shared/update.js";
import { isPathInside } from "./runtimePaths.js";
import { atomicWriteJson } from "./updateStorage.js";

export class StageFailure extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string
  ) {
    super(message);
  }
}

const REQUIRED_APP_FILES = [
  ["node", "node.exe"],
  ["start-portable.mjs"],
  ["dist", "client", "index.html"],
  ["dist", "server", "server", "index.js"],
  ["package.json"],
  ["BUILD-INFO.json"]
];

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return files;
}

/** Same digest as appInventory() in scripts/pbresults-updater.mjs, which re-checks it before activation. */
export function appInventory(appPath: string): { fileCount: number; digest: string } {
  const lines = listFiles(appPath)
    .map((file) => `${path.relative(appPath, file).split(path.sep).join("/")}|${fs.statSync(file).size}`)
    .sort();
  return {
    fileCount: lines.length,
    digest: createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")
  };
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function openZip(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: false, strictFileNames: false, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("Unable to open the archive."));
      else resolve(zip);
    });
  });
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("Unable to read an archive entry."));
      else resolve(stream);
    });
  });
}

/** Iterate entries one at a time; each is fully handled before the next is read. */
async function forEachEntry(zip: yauzl.ZipFile, handle: (entry: yauzl.Entry) => Promise<void>) {
  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      handle(entry).then(
        () => zip.readEntry(),
        (error) => reject(error)
      );
    });
    zip.readEntry();
  });
}

/**
 * Verify, extract and validate a downloaded release into updates/staging/<id>/prepared-app, then mark the journal
 * `prepared`. Only the application directory is extracted; every entry is checked before it is written.
 */
export async function stageRelease(rootDirectory: string, transactionPath: string, transaction: Record<string, unknown>) {
  const resolveInRoot = (candidate: unknown) => {
    const resolved = path.resolve(rootDirectory, String(candidate));
    if (!isPathInside(rootDirectory, resolved)) {
      throw new StageFailure("UPDATE_ARCHIVE_UNSAFE", "An update path escapes the portable folder.");
    }
    return resolved;
  };
  const archive = resolveInRoot(transaction.archivePath);
  const staging = resolveInRoot(transaction.stagingPath);
  const manifest = updateManifestSchema.parse(transaction.manifest);
  const targetVersion = String(transaction.targetVersion);

  if (manifest.protocol.minimumUpdaterVersion > UPDATER_PROTOCOL_VERSION) {
    throw new StageFailure("UPDATE_PROTOCOL_UNSUPPORTED", "This release needs a newer updater. Download it manually.");
  }
  if ((await fsp.stat(archive)).size !== manifest.asset.size || (await fileSha256(archive)) !== manifest.asset.sha256) {
    throw new StageFailure("UPDATE_DIGEST_MISMATCH", "The downloaded archive failed verification.");
  }

  await fsp.rm(staging, { recursive: true, force: true });
  const extraction = path.join(staging, "payload.partial");
  await fsp.mkdir(extraction, { recursive: true });
  const declaredRoot = `${manifest.payload.rootDirectory.replace(/\/+$/, "")}/`;
  const declaredAppPrefix = `${declaredRoot}${manifest.payload.applicationDirectory.replace(/^\/+|\/+$/g, "")}/`;
  const unsafe = (detail: string) => new StageFailure("UPDATE_ARCHIVE_UNSAFE", `The update archive is unsafe: ${detail}.`);
  let total = 0;

  const zip = await openZip(archive);
  try {
    await forEachEntry(zip, async (entry) => {
      const name = entry.fileName.replace(/\\/g, "/");
      if (!name.startsWith(declaredRoot)) throw unsafe(`unexpected entry ${name}`);
      if (!name.trim() || name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw unsafe(`absolute path ${name}`);
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw unsafe(`symbolic link ${name}`);
      if (!name.startsWith(declaredAppPrefix)) return;
      const appRelative = name.slice(declaredAppPrefix.length);
      if (!appRelative) return;
      const destination = path.resolve(extraction, ...appRelative.split("/").filter(Boolean));
      if (!isPathInside(extraction, destination)) throw unsafe(`path traversal ${name}`);
      total += entry.uncompressedSize;
      if (total > manifest.asset.unpackedSize || total > UPDATE_UNPACKED_MAX_BYTES) throw unsafe("larger than declared");
      if (name.endsWith("/")) {
        await fsp.mkdir(destination, { recursive: true });
        return;
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      if (fs.existsSync(destination)) throw unsafe(`duplicate entry ${name}`);
      await pipeline(await openEntryStream(zip, entry), fs.createWriteStream(destination, { flags: "wx" }));
    });
  } finally {
    zip.close();
  }
  if (total !== manifest.asset.unpackedSize) {
    throw new StageFailure("UPDATE_PAYLOAD_INVALID", "The update archive does not match its declared size.");
  }

  const invalid = (detail: string) => new StageFailure("UPDATE_PAYLOAD_INVALID", `The update package is incomplete: ${detail}.`);
  for (const parts of REQUIRED_APP_FILES) {
    if (!fs.existsSync(path.join(extraction, ...parts))) throw invalid(`missing ${parts.join("/")}`);
  }
  let build: Record<string, unknown>;
  try {
    build = JSON.parse(await fsp.readFile(path.join(extraction, "BUILD-INFO.json"), "utf8")) as Record<string, unknown>;
  } catch {
    throw invalid("unreadable BUILD-INFO.json");
  }
  if (
    build.appVersion !== targetVersion ||
    build.releaseTag !== `v${targetVersion}` ||
    build.builtAt !== manifest.release.builtAt ||
    build.target !== "windows-x64-portable" ||
    build.sourceRepository !== UPDATE_SOURCE_REPOSITORY ||
    typeof build.updaterProtocolVersion !== "number" ||
    build.updaterProtocolVersion < manifest.protocol.minimumUpdaterVersion ||
    build.updaterProtocolVersion > UPDATER_PROTOCOL_VERSION
  ) {
    throw invalid("build metadata does not match the release");
  }

  const prepared = path.join(staging, "prepared-app");
  await fsp.rename(extraction, prepared);
  const inventory = appInventory(prepared);
  const markerPath = path.join(staging, "prepared-marker.json");
  atomicWriteJson(markerPath, {
    schemaVersion: 1,
    transactionId: transaction.id,
    version: targetVersion,
    fileCount: inventory.fileCount,
    inventorySha256: inventory.digest,
    preparedAt: new Date().toISOString()
  });
  const now = new Date().toISOString();
  transaction.preparedAppPath = path.relative(rootDirectory, prepared);
  transaction.preparedMarkerPath = path.relative(rootDirectory, markerPath);
  transaction.stagedAt = now;
  transaction.phase = "prepared";
  transaction.phaseTimestamps = { ...((transaction.phaseTimestamps as Record<string, string> | undefined) ?? {}), prepared: now };
  atomicWriteJson(transactionPath, transaction);
}
