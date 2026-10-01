import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinThemes } from "../shared/builtinThemes";

let tempRoot = "";
let storage: typeof import("./storage");
let routes: typeof import("./assetRoutes");
let app: FastifyInstance;
let baseUrl = "";
const published: Array<{ type: string; ids?: string[] }> = [];
const onTeamsChanged = vi.fn();

async function pngFile(colour: number, name = "logo.png", type = "image/png") {
  const buffer = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: colour, g: 10, b: 10, alpha: 1 } } })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type }), name);
  return form;
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-asset-routes-"));
  process.env.APP_ROOT_DIR = tempRoot;
  process.env.APP_DATA_DIR = path.join(tempRoot, "data");
  process.env.APP_UPLOADS_DIR = path.join(tempRoot, "data", "uploads");
  process.env.AUTO_BG_REMOVAL = "false";
  vi.resetModules();
  storage = await import("./storage");
  routes = await import("./assetRoutes");

  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1 } });
  routes.registerAssetRoutes(app, {
    hub: { publish: (type, ids) => published.push({ type, ids }) },
    onTeamsChanged
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  published.length = 0;
  onTeamsChanged.mockClear();
});

afterAll(async () => {
  await app.close();
  delete process.env.APP_ROOT_DIR;
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_UPLOADS_DIR;
  delete process.env.AUTO_BG_REMOVAL;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function upload(colour: number) {
  const response = await fetch(`${baseUrl}/api/assets`, { method: "POST", body: await pngFile(colour) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { asset: { id: string; url: string } }).asset;
}

describe("asset routes", () => {
  it("accepts images and rejects other file types with 415", async () => {
    const asset = await upload(11);
    expect(published).toContainEqual({ type: "assets.changed", ids: [asset.id] });

    const form = new FormData();
    form.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "logo.svg");
    const rejected = await fetch(`${baseUrl}/api/assets`, { method: "POST", body: form });
    expect(rejected.status).toBe(415);
    expect(await rejected.json()).toMatchObject({ code: "unsupported_media_type" });
  });

  it("accepts octet-stream uploads by their image extension", () => {
    expect(routes.resolveUploadMimeType("application/octet-stream", "logo.JPG")).toBe("image/jpeg");
    expect(routes.resolveUploadMimeType("application/octet-stream", "notes.txt")).toBeNull();
    expect(routes.resolveUploadMimeType("image/x-png", "logo")).toBe("image/png");
  });

  it("renames, validates the body and 404s unknown ids", async () => {
    const asset = await upload(12);
    const renamed = await fetch(`${baseUrl}/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Main sponsor" })
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: asset.id, displayName: "Main sponsor" });

    const invalid = await fetch(`${baseUrl}/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: 42 })
    });
    expect(invalid.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/assets/asset-nope`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x" })
    });
    expect(missing.status).toBe(404);
  });

  it("returns 409 with usages for in-use deletes, then force-deletes and announces cleared references", async () => {
    const asset = await upload(13);
    storage.saveTheme({ ...structuredClone(builtinThemes[0]), id: "theme-route", name: "Route theme", builtin: false, components: {
      ...structuredClone(builtinThemes[0].components),
      eventLogo: { ...structuredClone(builtinThemes[0].components.eventLogo), assetId: asset.id }
    } });
    const team = storage.createTeamRecord({ canonicalName: "Route FC" });
    const linked = await fetch(`${baseUrl}/api/teams/${team.id}/logo/asset`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: asset.id, slot: "primary" })
    });
    expect(linked.status).toBe(200);
    expect(onTeamsChanged).toHaveBeenCalledTimes(1);

    const blocked = await fetch(`${baseUrl}/api/assets/${asset.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    const payload = (await blocked.json()) as { code: string; usages: Array<{ kind: string }> };
    expect(payload.code).toBe("asset_in_use");
    expect(payload.usages.map((usage) => usage.kind).sort()).toEqual(["team", "theme"]);

    published.length = 0;
    const forced = await fetch(`${baseUrl}/api/assets/${asset.id}?force=true`, { method: "DELETE" });
    expect(forced.status).toBe(200);
    expect(published).toEqual([
      { type: "assets.changed", ids: [asset.id] },
      { type: "themes.changed", ids: ["theme-route"] },
      { type: "teams.changed", ids: [team.id] }
    ]);
    expect(storage.getTeamRecord(team.id)?.logoAssetId).toBeNull();
  });

  it("replaces a file in place and lists the library", async () => {
    const asset = await upload(14);
    const response = await fetch(`${baseUrl}/api/assets/${asset.id}/file?removeBackground=false`, { method: "PUT", body: await pngFile(15) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ asset: { id: asset.id }, processing: { status: "skipped" } });

    const library = (await (await fetch(`${baseUrl}/api/assets/library`)).json()) as Array<{ id: string; usages: unknown[] }>;
    expect(library.find((entry) => entry.id === asset.id)?.usages).toEqual([]);
  });

  it("returns 404 when uploading a logo for a missing team", async () => {
    const response = await fetch(`${baseUrl}/api/teams/team-missing/logo`, { method: "POST", body: await pngFile(16) });
    expect(response.status).toBe(404);
  });

  it("runs cleanup only for what was selected", async () => {
    const asset = await upload(17);
    const report = await (await fetch(`${baseUrl}/api/assets/cleanup`)).json();
    expect(report.unusedAssets.map((item: { id: string }) => item.id)).toContain(asset.id);

    const response = await fetch(`${baseUrl}/api/assets/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetIds: [asset.id] })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: 1, skipped: [] });
    expect(published).toContainEqual({ type: "assets.changed", ids: [asset.id] });
  });
});
