import { describe, expect, it } from "vitest";
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
    expect(resolveContainedPath("/tmp/root", "/tmp/root/app")).toBe("/tmp/root/app");
    expect(() => resolveContainedPath("/tmp/root", "/tmp/other")).toThrow();
    expect(() => resolveContainedPath("/tmp/root", "/tmp/root")).toThrow();
  });
});
