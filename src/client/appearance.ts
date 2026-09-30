import { createContext, useContext, useEffect, useState } from "react";

export type AppearancePreference = "system" | "light" | "dark";

const STORAGE_KEY = "pbresults.admin.appearance";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Light/dark for the admin only. The resolved theme is written to <html data-admin-theme> while an admin page is
 * mounted and removed again on unmount, so the overlay routes (and the broadcast) never pick it up.
 */
export function useAdminAppearance() {
  const [preference, setPreferenceState] = useState<AppearancePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Keep open admin tabs in step when the preference changes in another tab.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setPreferenceState(readPreference());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resolved: "light" | "dark" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.adminTheme = resolved;
    return () => {
      delete root.dataset.adminTheme;
    };
  }, [resolved]);

  function setPreference(next: AppearancePreference) {
    setPreferenceState(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
  }

  return { preference, resolved, setPreference };
}

type AppearanceContextValue = ReturnType<typeof useAdminAppearance>;

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** The admin's appearance controls, provided by the admin shell. */
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside the admin shell");
  }
  return value;
}
