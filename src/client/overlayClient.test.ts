import { afterEach, describe, expect, it, vi } from "vitest";
import { eventStreamUrl, overlayClientId, overlayPageFromPath, resetOverlayClientIdForTests } from "./overlayClient";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetOverlayClientIdForTests();
});

describe("overlay client id", () => {
  it("stays the same on a plain-http origin, where crypto.randomUUID does not exist", () => {
    vi.stubGlobal("window", { sessionStorage: fakeStorage() });
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    const first = overlayClientId();
    expect(first).toMatch(/^ov_[0-9a-f]{24}$/);
    expect(overlayClientId()).toBe(first);
  });

  it("stays the same even when storage is blocked", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        }
      }
    });
    const first = overlayClientId();
    expect(overlayClientId()).toBe(first);
  });

  it("reuses the id kept for this tab after a reload", () => {
    const storage = fakeStorage();
    storage.setItem("pbresults.overlay.clientId", "ov_kept_for_this_tab");
    vi.stubGlobal("window", { sessionStorage: storage });
    expect(overlayClientId()).toBe("ov_kept_for_this_tab");
  });
});

describe("overlay pages", () => {
  it("tags only overlay pages' event streams", () => {
    vi.stubGlobal("window", { sessionStorage: fakeStorage() });
    expect(overlayPageFromPath("/overlay/live")).toBe("live");
    expect(overlayPageFromPath("/overlay/preview/theme-a")).toBe("preview");
    expect(overlayPageFromPath("/admin/operations")).toBeNull();
    expect(eventStreamUrl("/admin/operations")).toBe("/api/events");
    expect(eventStreamUrl("/overlay/live")).toMatch(/^\/api\/events\?role=overlay&page=live&client=ov_/);
  });
});
