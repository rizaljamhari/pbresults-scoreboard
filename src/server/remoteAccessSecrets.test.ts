import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileSecretStore, createMemorySecretStore, SecretStoreFailure } from "./remoteAccessSecrets";

const token = "2abcDEFghiJKLmnoPQRstu_3vwxYZ0123456789abcdef";
let tempRoot = "";
let filePath = "";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-remote-secrets-"));
  filePath = path.join(tempRoot, "secrets", "remote-access.json");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("file secret store", () => {
  it("reports nothing configured when the file is missing", () => {
    expect(createFileSecretStore({ filePath, env: {} }).read()).toBeNull();
  });

  it("saves, reads back across instances, replaces, and removes the token", () => {
    const store = createFileSecretStore({ filePath, env: {}, now: () => new Date("2026-10-05T12:00:00.000Z") });
    store.save(token);
    expect(createFileSecretStore({ filePath, env: {} }).read()).toEqual({ authtoken: token, source: "file" });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      version: 1,
      provider: "ngrok",
      protection: "none",
      authtoken: token,
      updatedAt: "2026-10-05T12:00:00.000Z"
    });

    store.save(`${token}X`);
    expect(store.read()?.authtoken).toBe(`${token}X`);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(["remote-access.json"]);

    store.remove();
    expect(fs.existsSync(filePath)).toBe(false);
    expect(store.read()).toBeNull();
    expect(() => store.remove()).not.toThrow();
  });

  it("treats a malformed or unexpected file as not configured", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not json");
    expect(createFileSecretStore({ filePath, env: {} }).read()).toBeNull();
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, provider: "ngrok", protection: "windows-dpapi-current-user", ciphertext: "abc" }));
    expect(createFileSecretStore({ filePath, env: {} }).read()).toBeNull();
  });

  it("prefers NGROK_AUTHTOKEN and refuses to change or remove it", () => {
    const store = createFileSecretStore({ filePath, env: { NGROK_AUTHTOKEN: ` ${token} ` } });
    expect(store.read()).toEqual({ authtoken: token, source: "environment" });
    expect(() => store.save(token)).toThrow(SecretStoreFailure);
    expect(() => store.remove()).toThrow(SecretStoreFailure);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("ignores a blank NGROK_AUTHTOKEN", () => {
    const store = createFileSecretStore({ filePath, env: { NGROK_AUTHTOKEN: "  " } });
    store.save(token);
    expect(store.read()).toEqual({ authtoken: token, source: "file" });
  });

  it("reports a write failure without leaving a temporary file", () => {
    fs.mkdirSync(filePath, { recursive: true });
    const store = createFileSecretStore({ filePath, env: {} });
    expect(() => store.save(token)).toThrow(SecretStoreFailure);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(["remote-access.json"]);
  });
});

describe("secret location", () => {
  it("keeps the token file outside data, so exports and backups never include it", async () => {
    const paths = await import("./runtimePaths");
    expect(paths.remoteAccessSecretPath).toBe(path.join(paths.secretsDir, "remote-access.json"));
    expect(paths.isPathInside(paths.dataDir, paths.remoteAccessSecretPath)).toBe(false);
    expect(paths.isPathInside(paths.appRootDir, paths.remoteAccessSecretPath)).toBe(true);
  });
});

describe("memory secret store", () => {
  it("saves and removes, and protects an environment token", () => {
    const store = createMemorySecretStore();
    store.save(token);
    expect(store.read()).toEqual({ authtoken: token, source: "file" });
    store.remove();
    expect(store.read()).toBeNull();

    const environment = createMemorySecretStore({ authtoken: token, source: "environment" });
    expect(() => environment.save(token)).toThrow(SecretStoreFailure);
    expect(() => environment.remove()).toThrow(SecretStoreFailure);
  });
});
