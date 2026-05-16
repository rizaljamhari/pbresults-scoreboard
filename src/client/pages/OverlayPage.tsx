import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useLiveState, useSettings } from "../hooks";
import { OverlayRenderer } from "../components/OverlayRenderer";
import { ScaledCanvasFrame } from "../components/ScaledCanvasFrame";
import type { ThemeDefinition } from "../../shared/theme";

export function OverlayPage({ mode }: { mode: "live" | "preview" }) {
  const { id } = useParams();
  const [theme, setTheme] = useState<ThemeDefinition | null>(null);
  const settings = useSettings();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const assets = useAssets();

  useEffect(() => {
    let active = true;
    async function load() {
      if (mode === "preview" && id) {
        const next = await api.getTheme(id);
        if (active) {
          setTheme(next);
        }
        return;
      }

      const settings = await api.getSettings();
      if (!settings.publishedThemeId) {
        return;
      }
      const next = await api.getTheme(settings.publishedThemeId);
      if (active) {
        setTheme(next);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id, mode]);

  if (!theme) {
    return <div className="overlay-page loading">Loading overlay…</div>;
  }

  return (
    <div
      className={`overlay-page ${mode === "live" ? "overlay-page--live" : "overlay-page--preview"}`}
      style={mode === "live" ? { background: theme.canvas.backgroundColor } : undefined}
    >
      <ScaledCanvasFrame
        width={theme.canvas.width}
        height={theme.canvas.height}
        className={`overlay-stage-frame ${mode === "live" ? "overlay-stage-frame--live" : "overlay-stage-frame--preview"}`}
        innerClassName="overlay-stage"
        mode="contain"
      >
        <OverlayRenderer theme={theme} live={live.data} assets={assets.data ?? []} />
      </ScaledCanvasFrame>
    </div>
  );
}
