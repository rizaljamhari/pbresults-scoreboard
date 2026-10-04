import { describe, expect, it, vi } from "vitest";
import { createMemorySecretStore } from "./remoteAccessSecrets";
import { RemoteAccessFailure, RemoteAccessService } from "./remoteAccessService";

const token = "2abcDEFghiJKLmnoPQRstu_3vwxYZ0123456789abcdef";
const local = { managementAllowed: true, remoteRequest: false };
const lan = { managementAllowed: false, remoteRequest: false };

describe("remote access service configuration", () => {
  it("starts unconfigured and becomes inactive once a token is saved", async () => {
    const service = new RemoteAccessService({ store: createMemorySecretStore() });
    expect(service.getStatus(local)).toMatchObject({ configured: false, phase: "unconfigured", configurationSource: null, credentials: null });

    await service.configure(token);
    expect(service.getStatus(local)).toMatchObject({ configured: true, phase: "inactive", configurationSource: "file" });

    await service.removeConfiguration();
    expect(service.getStatus(local)).toMatchObject({ configured: false, phase: "unconfigured" });
  });

  it("omits local-only fields for LAN and remote requests and never exposes the token", async () => {
    const service = new RemoteAccessService({ store: createMemorySecretStore() });
    await service.configure(token);
    const status = service.getStatus(lan);
    expect(status).not.toHaveProperty("configurationSource");
    expect(status).not.toHaveProperty("credentials");
    expect(JSON.stringify(service.getStatus(local))).not.toContain(token);
  });

  it("keeps the previous token when the new one fails its test", async () => {
    const store = createMemorySecretStore({ authtoken: token, source: "file" });
    const verify = vi.fn(async () => {
      throw new RemoteAccessFailure("REMOTE_ACCESS_TOKEN_INVALID", "ngrok rejected the authtoken.");
    });
    const service = new RemoteAccessService({ store, verify, now: () => new Date("2026-10-05T12:00:00.000Z") });

    await expect(service.configure(`${token}X`)).rejects.toMatchObject({ code: "REMOTE_ACCESS_TOKEN_INVALID" });
    expect(store.read()?.authtoken).toBe(token);
    expect(service.getStatus(local).lastError).toEqual({
      code: "REMOTE_ACCESS_TOKEN_INVALID",
      message: "ngrok rejected the authtoken.",
      at: "2026-10-05T12:00:00.000Z"
    });
  });

  it("maps an unexpected verifier error to a sanitized provider error", async () => {
    const service = new RemoteAccessService({
      store: createMemorySecretStore(),
      verify: async (authtoken) => {
        throw new Error(`raw provider failure for ${authtoken}`);
      }
    });
    const failure = await service.configure(token).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "REMOTE_ACCESS_PROVIDER_UNAVAILABLE", statusCode: 502 });
    expect(JSON.stringify(service.getStatus(local))).not.toContain(token);
  });

  it("clears the last error after a successful save", async () => {
    let reject = true;
    const service = new RemoteAccessService({
      store: createMemorySecretStore(),
      verify: async () => {
        if (reject) throw new RemoteAccessFailure("REMOTE_ACCESS_TOKEN_INVALID", "ngrok rejected the authtoken.");
      }
    });
    await service.configure(token).catch(() => undefined);
    reject = false;
    await service.configure(token);
    expect(service.getStatus(local).lastError).toBeNull();
  });

  it("refuses to change or remove a token set by the environment", async () => {
    const verify = vi.fn(async () => {});
    const service = new RemoteAccessService({ store: createMemorySecretStore({ authtoken: token, source: "environment" }), verify });
    expect(service.getStatus(local)).toMatchObject({ configured: true, phase: "inactive", configurationSource: "environment" });
    await expect(service.configure(token)).rejects.toMatchObject({ code: "REMOTE_ACCESS_CONFIGURED_BY_ENVIRONMENT", statusCode: 409 });
    await expect(service.removeConfiguration()).rejects.toMatchObject({ code: "REMOTE_ACCESS_CONFIGURED_BY_ENVIRONMENT" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("reports a store failure without the token", async () => {
    const store = createMemorySecretStore();
    store.save = () => {
      throw new Error("disk full");
    };
    const service = new RemoteAccessService({ store });
    await expect(service.configure(token)).rejects.toMatchObject({ code: "REMOTE_ACCESS_SECRET_STORE_FAILED", statusCode: 500 });
  });

  it("runs configuration changes one at a time", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new RemoteAccessService({
      store: createMemorySecretStore(),
      verify: async (authtoken) => {
        order.push(`verify ${authtoken.slice(-1)}`);
        if (authtoken.endsWith("A")) await gate;
      }
    });

    const first = service.configure(`${token}A`);
    const second = service.removeConfiguration().then(() => order.push("removed"));
    await Promise.resolve();
    expect(order).toEqual(["verify A"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["verify A", "removed"]);
    expect(service.getStatus(local).configured).toBe(false);
  });
});
