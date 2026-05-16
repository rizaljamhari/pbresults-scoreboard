import { describe, expect, it } from "vitest";
import { builtinThemes } from "./builtinThemes";
import { createThemeExportPackage } from "./exportTheme";
import { appExportSchema, settingsSchema, themeExportSchema, themeSchema } from "./theme";

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

    expect(themeExportSchema.parse(pkg).theme.id).toBe("builtin-classic-chroma");
  });

  it("validates a full app export payload shape", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        upstreamBaseUrl: "http://192.168.100.67:5000",
        publishedThemeId: "builtin-classic-chroma",
        pollIntervalMs: 500
      },
      themes: [builtinThemes[0]],
      teams: [],
      assets: []
    };

    expect(appExportSchema.parse(payload).themes[0].id).toBe("builtin-classic-chroma");
  });

  it("fills in empty teams for older app exports", () => {
    const parsed = appExportSchema.parse({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        upstreamBaseUrl: "http://192.168.100.67:5000",
        publishedThemeId: "builtin-classic-chroma",
        pollIntervalMs: 1000
      },
      themes: [builtinThemes[0]],
      assets: []
    });

    expect(parsed.teams).toEqual([]);
  });

  it("fills in a default poll interval for older settings payloads", () => {
    const settings = settingsSchema.parse({
      upstreamBaseUrl: "http://192.168.100.67:5000",
      publishedThemeId: "builtin-classic-chroma"
    });

    expect(settings.pollIntervalMs).toBe(1000);
  });

  it("fills in concede and surface defaults for older themes", () => {
    const legacyTheme = structuredClone(builtinThemes[0]) as typeof builtinThemes[0] & { towelBanner?: Record<string, unknown> };
    delete (legacyTheme.components as Partial<typeof legacyTheme.components>).homeTeamLogo;
    delete (legacyTheme.components as Partial<typeof legacyTheme.components>).awayTeamLogo;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundImageAssetId;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundImageFit;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundImagePosition;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundOverlayColor;
    delete (legacyTheme.components.homeName as Partial<(typeof legacyTheme.components.homeName)>).backgroundOverlayOpacity;
    delete (legacyTheme as Partial<typeof legacyTheme>).concedeState;
    delete (legacyTheme as Partial<typeof legacyTheme>).centerSecondary;
    legacyTheme.towelBanner = {
      enabled: true,
      x: 0,
      y: 0,
      width: 100,
      height: 40
    };

    const parsed = themeSchema.parse(legacyTheme);
    expect(parsed.components.homeTeamLogo.assetId).toBeNull();
    expect(parsed.components.awayTeamLogo.visible).toBe(false);
    expect(parsed.components.homeName.backgroundImageAssetId).toBeNull();
    expect(parsed.components.homeName.backgroundImageFit).toBe("cover");
    expect(parsed.concedeState.text).toBe("Conceded");
    expect(parsed.concedeState.placementMode).toBe("center-stamp");
    expect(parsed.centerSecondary.breakMode).toBe("timer");
  });
});
