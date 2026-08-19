import { useParams } from "react-router-dom";
import { useAssets, useLiveState, useOperatorTextState, useRuntimeVersionWatcher, useSettings, useTheme } from "../hooks";
import { OverlayRenderer } from "../components/OverlayRenderer";
import { ScaledCanvasFrame } from "../components/ScaledCanvasFrame";

export function OverlayPage({ mode }: { mode: "live" | "preview" }) {
  useRuntimeVersionWatcher();
  const { id } = useParams();
  const settings = useSettings();
  const selectedThemeId = mode === "preview" ? id : settings.data?.publishedThemeId ?? undefined;
  const themeResource = useTheme(selectedThemeId, true);
  const theme = themeResource.data;
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const operatorText = useOperatorTextState();
  const assets = useAssets();

  if (mode === "live" && settings.data && !settings.data.publishedThemeId) {
    return <div className="overlay-page loading">No published theme.</div>;
  }

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
        <OverlayRenderer
          theme={theme}
          live={live.data}
          assets={assets.data ?? []}
          operatorTextValues={
            operatorText.data?.themeId === theme.id
              ? Object.fromEntries(operatorText.data.fields.map((field) => [field.componentId, field.value]))
              : {}
          }
        />
      </ScaledCanvasFrame>
    </div>
  );
}
