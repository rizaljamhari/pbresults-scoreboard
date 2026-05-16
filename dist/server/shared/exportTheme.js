export function createThemeExportPackage(theme, assets) {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        theme,
        assets
    };
}
