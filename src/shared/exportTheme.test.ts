import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { createThemeExportPackage } from "./exportTheme";
import { appExportSchema, settingsSchema, teamRegistryExportSchema, themeExportSchema, themeSchema } from "./theme";

describe("createThemeExportPackage", () => {
  it("creates a valid export payload", () => {
    const pkg = createThemeExportPackage(builtinThemes[0], [
      {
        asset: {
          id: "asset-1",
          originalName: "logo.png",
          mimeType: "image/png",
          url: "/uploads/asset-1.png",
          createdAt: new Date().toISOString()
        },
        data: "data:image/png;base64,AAAA"
      }
    ]);

    expect(themeExportSchema.parse(pkg).theme.id).toBe("theme-7ad8adb8-e017-4853-93b1-fb608a750253");
  });

  it("validates a full app export payload shape", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        upstreamBaseUrl: "http://192.168.100.67:5000",
        publishedThemeId: "theme-7ad8adb8-e017-4853-93b1-fb608a750253",
        pollEnabled: true,
        pollIntervalMs: 500
      },
      themes: [builtinThemes[0]],
      teams: [],
      assets: []
    };

    expect(appExportSchema.parse(payload).themes[0].id).toBe("theme-7ad8adb8-e017-4853-93b1-fb608a750253");
  });

  it("fills in empty teams for older app exports", () => {
    const parsed = appExportSchema.parse({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        upstreamBaseUrl: "http://192.168.100.67:5000",
        publishedThemeId: "theme-7ad8adb8-e017-4853-93b1-fb608a750253",
        pollEnabled: true,
        pollIntervalMs: 1000
      },
      themes: [builtinThemes[0]],
      assets: []
    });

    expect(parsed.teams).toEqual([]);
  });

  it("validates a team-only export payload shape", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      teams: [],
      assets: []
    };

    expect(teamRegistryExportSchema.parse(payload).teams).toEqual([]);
  });

  it("fills in a default poll interval for older settings payloads", () => {
    const settings = settingsSchema.parse({
      upstreamBaseUrl: "http://192.168.100.67:5000",
      publishedThemeId: "theme-7ad8adb8-e017-4853-93b1-fb608a750253"
    });

    expect(settings.pollIntervalMs).toBe(1000);
    expect(settings.pollEnabled).toBe(true);
  });

  it("fills in concede and surface defaults for older themes", () => {
    const legacyTheme = structuredClone(builtinThemes[0]) as typeof builtinThemes[0] & { towelBanner?: Record<string, unknown> };
    delete (legacyTheme.components as Partial<typeof legacyTheme.components>).homeTeamLogo;
    delete (legacyTheme.components as Partial<typeof legacyTheme.components>).awayTeamLogo;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).paddingX;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).paddingY;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).offsetX;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).offsetY;
    (legacyTheme.components.homeName as unknown as { padding?: number }).padding = 16;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundImageAssetId;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundImageFit;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundImagePosition;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundOverlayColor;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundOverlayOpacity;
    delete (legacyTheme as Partial<typeof legacyTheme>).teamEventOverlay;
    delete (legacyTheme as Partial<typeof legacyTheme>).centerSecondary;
    legacyTheme.towelBanner = {
      x: 0,
      y: 0,
      width: 100,
      height: 40
    };

    const parsed = themeSchema.parse(legacyTheme);
    expect(parsed.components.homeTeamLogo.assetId).toBeNull();
    expect(parsed.components.awayTeamLogo.visible).toBe(false);
    expect(parsed.components.homeTeamLogo.teamLogoFallbackMode).toBe("slotFallback");
    expect(parsed.components.homeName.backgroundImageAssetId).toBeNull();
    expect(parsed.components.homeName.backgroundImageFit).toBe("cover");
    expect(parsed.components.homeName.paddingX).toBe(16);
    expect(parsed.components.homeName.paddingY).toBe(16);
    expect(parsed.components.homeName.offsetX).toBe(0);
    expect(parsed.components.homeName.offsetY).toBe(0);
    expect(parsed.teamEventOverlay.concede.text).toBe("Conceded");
    expect(parsed.teamEventOverlay.general.placementMode).toBe("center-stamp");
    expect(parsed.centerSecondary.breakMode).toBe("timer");
  });

  it("migrates a flat legacy team overlay into nested general and event sections", () => {
    const legacyTheme = structuredClone(builtinThemes[0]);
    legacyTheme.teamEventOverlay = {
      enabled: true,
      text: "TOWEL",
      baseText: "BASE",
      placementMode: "top-ribbon",
      position: "overlapping-top",
      offsetX: 6,
      offsetY: -12,
      height: 52,
      padding: 10,
      backgroundColor: "#220000",
      baseBackgroundColor: "#001133",
      backgroundImageAssetId: "asset-a",
      baseBackgroundImageAssetId: "asset-b",
      backgroundImageFit: "contain",
      backgroundImagePosition: "left",
      backgroundOverlayColor: "#ff0000",
      backgroundOverlayOpacity: 0.5,
      baseBackgroundOverlayColor: "#0000ff",
      baseBackgroundOverlayOpacity: 0.25,
      borderColor: "#ffffff",
      borderWidth: 4,
      borderRadius: 9,
      color: "#ffeeee",
      baseColor: "#ddff00",
      fontFamily: "Oswald",
      fontSize: 33,
      fontWeight: 700,
      letterSpacing: 1.7,
      textAlign: "right",
      shadow: "none",
      animationPreset: "slide-horizontal",
      durationMs: 2500,
      followLogoSize: true
    } as unknown as typeof legacyTheme.teamEventOverlay;

    const parsed = themeSchema.parse(legacyTheme);
    expect(parsed.teamEventOverlay.general.position).toBe("overlapping-top");
    expect(parsed.teamEventOverlay.general.backgroundImageFit).toBe("contain");
    expect(parsed.teamEventOverlay.general.followTarget).toBe("logo");
    expect(parsed.teamEventOverlay.concede.text).toBe("TOWEL");
    expect(parsed.teamEventOverlay.concede.backgroundImageAssetId).toBe("asset-a");
    expect(parsed.teamEventOverlay.base.text).toBe("BASE");
    expect(parsed.teamEventOverlay.base.backgroundImageAssetId).toBe("asset-b");
    expect(parsed.teamEventOverlay.base.backgroundOverlayOpacity).toBe(0.25);
  });

  it("migrates nested team overlay followLogoSize into followTarget", () => {
    const legacyTheme = structuredClone(builtinThemes[0]);
    legacyTheme.teamEventOverlay = {
      ...legacyTheme.teamEventOverlay,
      general: {
        ...legacyTheme.teamEventOverlay.general,
        followLogoSize: true
      }
    } as unknown as typeof legacyTheme.teamEventOverlay;

    const parsed = themeSchema.parse(legacyTheme);
    expect(parsed.teamEventOverlay.general.followTarget).toBe("logo");
  });
});
