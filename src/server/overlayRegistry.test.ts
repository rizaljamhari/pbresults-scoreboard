import { afterEach, describe, expect, it } from "vitest";
import {
  OVERLAY_LOST_AFTER_MS,
  OVERLAY_STALE_AFTER_MS,
  OVERLAY_STARTUP_GRACE_MS,
  OVERLAY_THEME_GRACE_MS,
  OVERLAY_VERSION_GRACE_MS,
  browserLabel,
  summarizeOverlays,
  type OverlayReport,
  type OverlayServerView,
  type OverlayState
} from "../shared/overlayHealth";
import { OverlayRegistry } from "./overlayRegistry";

const START = Date.parse("2026-10-02T10:00:00.000Z");
const VMIX = { remoteAddress: "192.168.1.20", userAgent: "Mozilla/5.0 Chrome/120.0 vMix/27" };

let clock = START;
let serverFetchedAt = new Date(START).toISOString();
let view: OverlayServerView = {
  publishedThemeId: "theme-a",
  publishedThemeUpdatedAt: "2026-10-01T09:00:00.000Z",
  appVersion: "1.4.0",
  behindThresholdMs: 5_000
};
const registries: OverlayRegistry[] = [];

function registry() {
  clock = START;
  serverFetchedAt = new Date(START).toISOString();
  view = { publishedThemeId: "theme-a", publishedThemeUpdatedAt: "2026-10-01T09:00:00.000Z", appVersion: "1.4.0", behindThresholdMs: 5_000 };
  const created = new OverlayRegistry({
    now: () => clock,
    getServerView: () => view,
    getServerLiveFetchedAt: () => serverFetchedAt,
    getThemeName: (id) => ({ "theme-a": "MBPJ Impact v3", "theme-b": "APM Invitational" })[id] ?? null
  });
  registries.push(created);
  return created;
}

afterEach(() => {
  for (const created of registries.splice(0)) created.stop();
});

function report(overrides: Partial<OverlayReport> = {}): OverlayReport {
  return {
    clientId: "client-vmix-1",
    page: "live",
    themeId: "theme-a",
    themeUpdatedAt: "2026-10-01T09:00:00.000Z",
    liveFetchedAt: serverFetchedAt,
    liveSourceStatus: "ok",
    transport: "stream",
    appVersion: "1.4.0",
    visibility: "visible",
    viewport: { width: 1920, height: 1080 },
    ...overrides
  };
}

function only(state: OverlayState) {
  expect(state.clients).toHaveLength(1);
  return state.clients[0];
}

describe("overlay connection", () => {
  it("stays connected while the stream is open, however quiet", () => {
    const overlays = registry();
    overlays.attachStream("client-vmix-1", "live", VMIX);
    clock += OVERLAY_LOST_AFTER_MS * 2;
    expect(only(overlays.getState()).connection).toBe("connected");
  });

  it("goes stale and then lost once the stream closes and reports stop", () => {
    const overlays = registry();
    const detach = overlays.attachStream("client-vmix-1", "live", VMIX);
    overlays.report(report(), VMIX);
    detach();
    clock += OVERLAY_STALE_AFTER_MS - 1;
    expect(only(overlays.getState()).connection).toBe("connected");
    clock += 2;
    expect(only(overlays.getState()).connection).toBe("stale");
    clock += OVERLAY_LOST_AFTER_MS;
    expect(only(overlays.getState()).connection).toBe("lost");
  });

  it("counts reports as alive when the page fell back to polling", () => {
    const overlays = registry();
    overlays.report(report({ transport: "fallback" }), VMIX);
    clock += OVERLAY_STALE_AFTER_MS - 1_000;
    expect(only(overlays.getState()).connection).toBe("connected");
  });

  it("marks a page closed when it says goodbye, and forgets it a minute later", () => {
    const overlays = registry();
    overlays.report(report(), VMIX);
    overlays.report(report({ leaving: true }), VMIX);
    expect(only(overlays.getState()).connection).toBe("closed");
    clock += 61_000;
    expect(overlays.getState().clients).toHaveLength(0);
  });

  it("forgets a lost page after ten minutes", () => {
    const overlays = registry();
    overlays.report(report(), VMIX);
    clock += 10 * 60_000 + 1;
    expect(overlays.getState().clients).toHaveLength(0);
  });
});

describe("overlay issues", () => {
  it("reports a lagging page straight away, from the lag when it reported", () => {
    const overlays = registry();
    overlays.report(report({ liveFetchedAt: new Date(START - 9_000).toISOString() }), VMIX);
    const client = only(overlays.getState());
    expect(client.lagMs).toBe(9_000);
    expect(client.issues.map((issue) => issue.code)).toEqual(["behind"]);
  });

  it("does not judge lag while the page's own feed is not ok", () => {
    const overlays = registry();
    overlays.report(report({ liveFetchedAt: new Date(START - 60_000).toISOString(), liveSourceStatus: "error" }), VMIX);
    expect(only(overlays.getState()).issues).toEqual([]);
  });

  it("waits out the grace period before calling a theme wrong", () => {
    const overlays = registry();
    overlays.report(report({ themeId: "theme-b" }), VMIX);
    expect(only(overlays.getState()).issues).toEqual([]);
    clock += OVERLAY_THEME_GRACE_MS;
    overlays.report(report({ themeId: "theme-b" }), VMIX);
    const client = only(overlays.getState());
    expect(client.issues.map((issue) => issue.code)).toEqual(["wrong-theme"]);
    expect(client.themeName).toBe("APM Invitational");
  });

  it("clears an issue as soon as it is fixed", () => {
    const overlays = registry();
    overlays.report(report({ themeId: "theme-b" }), VMIX);
    clock += OVERLAY_THEME_GRACE_MS;
    expect(only(overlays.getState()).issues).toHaveLength(1);
    overlays.report(report(), VMIX);
    expect(only(overlays.getState()).issues).toEqual([]);
  });

  it("spots an older save of the right theme", () => {
    const overlays = registry();
    overlays.report(report({ themeUpdatedAt: "2026-09-30T09:00:00.000Z" }), VMIX);
    clock += OVERLAY_THEME_GRACE_MS;
    expect(only(overlays.getState()).issues.map((issue) => issue.code)).toEqual(["outdated-theme"]);
  });

  it("gives an old app version time to reload itself", () => {
    const overlays = registry();
    overlays.attachStream("client-vmix-1", "live", VMIX);
    overlays.report(report({ appVersion: "1.3.9" }), VMIX);
    clock += OVERLAY_THEME_GRACE_MS;
    expect(only(overlays.getState()).issues).toEqual([]);
    clock += OVERLAY_VERSION_GRACE_MS;
    expect(only(overlays.getState()).issues.map((issue) => issue.code)).toEqual(["old-version"]);
  });

  it("never judges preview pages by the theme on air", () => {
    const overlays = registry();
    overlays.report(report({ page: "preview", themeId: "theme-b" }), VMIX);
    clock += OVERLAY_THEME_GRACE_MS;
    expect(only(overlays.getState()).issues).toEqual([]);
  });
});

describe("overlay summary", () => {
  function stateAfter(setup: (overlays: OverlayRegistry) => void) {
    const overlays = registry();
    setup(overlays);
    return overlays.getState();
  }

  it("is fine when one live page is healthy, even with an old lost entry", () => {
    const state = stateAfter((overlays) => {
      overlays.report(report({ clientId: "client-old-page" }), VMIX);
      clock += OVERLAY_LOST_AFTER_MS + 1;
      overlays.report(report(), VMIX);
    });
    expect(summarizeOverlays(state, clock, "MBPJ Impact v3")).toMatchObject({ level: "ok", code: "connected", label: "Connected" });
  });

  it("raises the alarm when the only live page is lost", () => {
    const state = stateAfter((overlays) => {
      overlays.report(report(), VMIX);
      clock += OVERLAY_LOST_AFTER_MS + 12_000;
    });
    const summary = summarizeOverlays(state, clock, null);
    expect(summary).toMatchObject({ level: "critical", code: "lost" });
    expect(summary.check?.detail).toContain("192.168.1.20");
  });

  it("says behind, with the lag", () => {
    const state = stateAfter((overlays) => overlays.report(report({ liveFetchedAt: new Date(START - 9_000).toISOString() }), VMIX));
    expect(summarizeOverlays(state, clock, null)).toMatchObject({ level: "warning", code: "behind", label: "Behind · 9 s" });
  });

  it("waits for overlays to reconnect after a restart before saying none", () => {
    const state = stateAfter(() => undefined);
    expect(summarizeOverlays(state, clock, null).code).toBe("checking");
    expect(summarizeOverlays(state, clock + OVERLAY_STARTUP_GRACE_MS, null)).toMatchObject({ level: "warning", code: "none" });
  });

  it("calls out a preview address loaded instead of the live one", () => {
    const state = stateAfter((overlays) => {
      clock += OVERLAY_STARTUP_GRACE_MS;
      overlays.report(report({ page: "preview" }), VMIX);
    });
    const summary = summarizeOverlays(state, clock, null);
    expect(summary).toMatchObject({ level: "warning", code: "preview-only" });
    expect(summary.check?.showUrl).toBe(true);
  });

  it("says this computer for a page on the same machine", () => {
    const state = stateAfter((overlays) => {
      overlays.report(report(), { remoteAddress: "127.0.0.1", userAgent: "" });
      clock += OVERLAY_LOST_AFTER_MS + 1;
    });
    expect(summarizeOverlays(state, clock, null).check?.detail).toContain("this computer");
  });
});

describe("browser label", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 vMix/27", "vMix · Chrome 120"],
    ["Mozilla/5.0 Chrome/127.0 Safari/537.36 OBS/30.1", "OBS · Chrome 127"],
    ["Mozilla/5.0 Chrome/141.0 Safari/537.36 Edg/141.0", "Edge 141"],
    ["Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36", "Chrome 141"],
    ["", "Browser"]
  ])("names %s as %s", (userAgent, expected) => {
    expect(browserLabel(userAgent)).toBe(expected);
  });
});
