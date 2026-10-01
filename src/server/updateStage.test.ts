import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import { appInventory, stageRelease, StageFailure } from "./updateStage.js";
// @ts-expect-error The root coordinator is plain JavaScript without type declarations.
import { appInventory as coordinatorInventory } from "../../scripts/pbresults-updater.mjs";

const roots: string[] = [];
const version = "2.0.0";
const builtAt = "2026-10-01T00:00:00.000Z";

type Entry = { name: string; data?: string; mode?: number };

function appEntries(overrides: Record<string, string | null> = {}): Entry[] {
  const files: Record<string, string | null> = {
    "node/node.exe": "binary",
    "start-portable.mjs": "// start",
    "dist/client/index.html": "<!doctype html>",
    "dist/server/server/index.js": "// server",
    "package.json": "{}",
    "BUILD-INFO.json": JSON.stringify({
      schemaVersion: 1,
      appVersion: version,
      releaseTag: `v${version}`,
      builtAt,
      target: "windows-x64-portable",
      bundledNodeVersion: "22.0.0",
      updaterProtocolVersion: 2,
      sourceRepository: "rizaljamhari/pbresults-scoreboard",
      sourceCommit: "0".repeat(40)
    }),
    ...overrides
  };
  return Object.entries(files)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([name, data]) => ({ name: `PBResults-Scoreboard/app/${name}`, data }));
}

async function buildZip(target: string, entries: Entry[]) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    zip.addBuffer(Buffer.from(entry.data ?? ""), entry.name, entry.mode ? { mode: entry.mode } : {});
  }
  zip.end();
  const output = fs.createWriteStream(target);
  zip.outputStream.pipe(output);
  await once(output, "close");
}

/** A portable root with a downloaded archive and a staging journal, as performDownload leaves them. */
async function fixture(entries: Entry[], options: { patch?: [string, string]; manifest?: Record<string, unknown> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-stage-"));
  roots.push(root);
  const archive = path.join(root, "updates", "downloads", "release.zip");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  await buildZip(archive, entries);
  if (options.patch) {
    const bytes = fs.readFileSync(archive);
    const from = Buffer.from(options.patch[0]);
    const to = Buffer.from(options.patch[1]);
    for (let index = bytes.indexOf(from); index !== -1; index = bytes.indexOf(from, index + 1)) to.copy(bytes, index);
    fs.writeFileSync(archive, bytes);
  }
  const bytes = fs.readFileSync(archive);
  const unpackedSize = entries
    .filter((entry) => entry.name.startsWith("PBResults-Scoreboard/app/"))
    .reduce((total, entry) => total + Buffer.byteLength(entry.data ?? ""), 0);
  const transaction: Record<string, unknown> = {
    id: "tx-stage",
    phase: "staging",
    phaseTimestamps: {},
    targetVersion: version,
    archivePath: path.relative(root, archive),
    stagingPath: path.join("updates", "staging", "tx-stage"),
    manifest: {
      schemaVersion: 1,
      release: { version, tag: `v${version}`, channel: "stable", builtAt },
      target: { platform: "win32", arch: "x64", packageKind: "portable" },
      protocol: { minimumUpdaterVersion: 2 },
      asset: {
        name: `pbresults-scoreboard-windows-portable-v${version}.zip`,
        size: bytes.length,
        unpackedSize,
        sha256: createHash("sha256").update(bytes).digest("hex")
      },
      payload: {
        rootDirectory: "PBResults-Scoreboard",
        applicationDirectory: "app",
        buildInfoFile: "app/BUILD-INFO.json",
        serverEntry: "app/dist/server/server/index.js"
      },
      ...options.manifest
    }
  };
  const journal = path.join(root, "updates", "transactions", "tx-stage.json");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.writeFileSync(journal, JSON.stringify(transaction));
  return { root, journal, transaction };
}

async function expectStageFailure(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((caught) => caught);
  expect(error).toBeInstanceOf(StageFailure);
  expect((error as StageFailure).code).toBe(code);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stageRelease", () => {
  it("extracts only the application folder and records the prepared app", async () => {
    const { root, journal, transaction } = await fixture([
      ...appEntries(),
      { name: "PBResults-Scoreboard/README-OPERATOR.txt", data: "not part of the app" }
    ]);
    await stageRelease(root, journal, transaction);

    const staged = JSON.parse(fs.readFileSync(journal, "utf8"));
    expect(staged.phase).toBe("prepared");
    const prepared = path.join(root, staged.preparedAppPath);
    expect(fs.readFileSync(path.join(prepared, "start-portable.mjs"), "utf8")).toBe("// start");
    expect(fs.existsSync(path.join(prepared, "README-OPERATOR.txt"))).toBe(false);
    const marker = JSON.parse(fs.readFileSync(path.join(root, staged.preparedMarkerPath), "utf8"));
    expect(marker).toMatchObject({ version, fileCount: 6, inventorySha256: appInventory(prepared).digest });
  });

  it("computes the same inventory digest as the root coordinator", async () => {
    const { root, journal, transaction } = await fixture(appEntries());
    await stageRelease(root, journal, transaction);
    const prepared = path.join(root, String(transaction.preparedAppPath));
    expect(coordinatorInventory(prepared)).toEqual(appInventory(prepared));
  });

  it("rejects an archive whose digest does not match the manifest", async () => {
    const { root, journal, transaction } = await fixture(appEntries());
    (transaction.manifest as { asset: { sha256: string } }).asset.sha256 = "0".repeat(64);
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_DIGEST_MISMATCH");
  });

  it("rejects a release that needs a newer updater", async () => {
    const { root, journal, transaction } = await fixture(appEntries(), { manifest: { protocol: { minimumUpdaterVersion: 99 } } });
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_PROTOCOL_UNSUPPORTED");
  });

  it("rejects entries outside the declared root folder", async () => {
    const { root, journal, transaction } = await fixture([...appEntries(), { name: "Elsewhere/evil.txt", data: "x" }]);
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_ARCHIVE_UNSAFE");
  });

  it("rejects symbolic links", async () => {
    const { root, journal, transaction } = await fixture([
      ...appEntries(),
      { name: "PBResults-Scoreboard/app/link", data: "/etc/passwd", mode: 0o120777 }
    ]);
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_ARCHIVE_UNSAFE");
  });

  it("rejects path traversal without writing outside the staging folder", async () => {
    const { root, journal, transaction } = await fixture(
      [...appEntries(), { name: "PBResults-Scoreboard/app/zz/zz/evil.txt", data: "x" }],
      { patch: ["app/zz/zz/evil.txt", "app/../../evil.txt"] }
    );
    await expect(stageRelease(root, journal, transaction)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, "updates", "evil.txt"))).toBe(false);
    expect(fs.existsSync(path.join(root, "updates", "staging", "evil.txt"))).toBe(false);
  });

  it("rejects a payload larger than declared", async () => {
    const { root, journal, transaction } = await fixture(appEntries());
    (transaction.manifest as { asset: { unpackedSize: number } }).asset.unpackedSize = 10;
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_ARCHIVE_UNSAFE");
  });

  it("rejects a payload with a missing required file", async () => {
    const { root, journal, transaction } = await fixture(appEntries({ "dist/client/index.html": null }));
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_PAYLOAD_INVALID");
  });

  it("rejects build metadata that does not match the release", async () => {
    const { root, journal, transaction } = await fixture(
      appEntries({
        "BUILD-INFO.json": JSON.stringify({ appVersion: "9.9.9", releaseTag: "v9.9.9", builtAt, updaterProtocolVersion: 2 })
      })
    );
    await expectStageFailure(stageRelease(root, journal, transaction), "UPDATE_PAYLOAD_INVALID");
  });
});
