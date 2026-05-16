import type { StoredAsset, ThemeDefinition, ThemeExportPackage } from "./theme.js";

export function createThemeExportPackage(
  theme: ThemeDefinition,
  assets: Array<{ asset: StoredAsset; data: string }>
): ThemeExportPackage {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    theme,
    assets
  };
}
