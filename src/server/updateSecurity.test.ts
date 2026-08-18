import { describe, expect, it } from "vitest";
import path from "node:path";
import { assertTrustedDownloadUrl, isLoopbackAddress, resolveContainedPath } from "./updateSecurity";

describe("update security", () => {
  it("recognizes only direct loopback addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
  });

  it("allows trusted GitHub asset endpoints and rejects arbitrary hosts", () => {
    expect(assertTrustedDownloadUrl("https://github.com/a/b/releases/download/v1/a.zip").hostname).toBe("github.com");
    expect(() => assertTrustedDownloadUrl("http://github.com/a.zip")).toThrow();
    expect(() => assertTrustedDownloadUrl("https://example.com/a.zip")).toThrow();
  });

  it("rejects paths outside a trusted root", () => {
    const root = path.resolve("tmp", "root");
    const child = path.join(root, "app");
    expect(resolveContainedPath(root, child)).toBe(child);
    expect(() => resolveContainedPath(root, path.resolve(root, "..", "other"))).toThrow();
    expect(() => resolveContainedPath(root, root)).toThrow();
  });
});
