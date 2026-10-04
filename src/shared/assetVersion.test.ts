import { describe, expect, it } from "vitest";
import { assetVersion } from "./assetVersion";

describe("asset versions", () => {
  it("follows the file's own content, so unrelated changes never move its address", () => {
    const logo = { contentHash: "sha256:3b0290aa4fd1c2e9b7", updatedAt: null, createdAt: "2026-08-18T11:44:19.000Z" };
    expect(assetVersion(logo)).toBe("sha2563b0290aa4f");
    expect(assetVersion({ ...logo })).toBe(assetVersion(logo));
    // Replacing the bytes changes the hash, and with it the address browsers cache by.
    expect(assetVersion({ ...logo, contentHash: "sha256:9c11ee" })).not.toBe(assetVersion(logo));
  });

  it("falls back to when the file last changed, as a plain number", () => {
    expect(assetVersion({ contentHash: null, updatedAt: "2026-10-05T01:00:00.000Z", createdAt: "2026-08-18T11:44:19.000Z" })).toBe(
      String(Date.parse("2026-10-05T01:00:00.000Z"))
    );
    expect(assetVersion({ contentHash: null, updatedAt: null, createdAt: "2026-08-18T11:44:19.000Z" })).toBe(String(Date.parse("2026-08-18T11:44:19.000Z")));
    expect(assetVersion({})).toBe("0");
  });
});
