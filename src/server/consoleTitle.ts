import { appDisplayName, type AppSettings } from "../shared/theme.js";

/** Names the Windows console window after the brand. Other platforms keep their process name. */
export function applyConsoleTitle(settings: Pick<AppSettings, "brandName">, platform: NodeJS.Platform = process.platform) {
  if (platform !== "win32") return;
  process.title = appDisplayName(settings);
}
