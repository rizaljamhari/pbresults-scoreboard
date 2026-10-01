import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "./randomId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomUuid", () => {
  it("uses crypto.randomUUID where the browser offers it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(randomUuid()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("still makes unique v4 ids on a plain-http page without randomUUID", () => {
    let seed = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = (seed * 31 + index * 17) % 256;
        seed += 1;
        return bytes;
      }
    });
    const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("falls back to Math.random when there is no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(randomUuid()).toMatch(UUID_V4);
  });
});
