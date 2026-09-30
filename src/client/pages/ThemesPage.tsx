import { memo, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CopyPlus, Download, Ellipsis, Eye, PenLine, Plus, Radio, Trash2, Upload } from "lucide-react";
import { api } from "../api";
import { useAssets, useLiveState, useSettings, useThemes } from "../hooks";
import { showToast } from "../toast";
import type { NormalizedLiveState, StoredAsset, ThemeDefinition } from "../../shared/theme";
import { OverlayRenderer } from "../components/OverlayRenderer";
import { ScaledCanvasFrame } from "../components/ScaledCanvasFrame";
import { Button, Chip, Dot, Grow, IconButton, Menu, SearchField, Segmented, Toolbar, downloadJson, useSlashFocus } from "../components/admin/kit";
import { filterAndSortThemes, type ThemeKindFilter, type ThemeSort } from "./themeAdminUtils";

const PREFERRED_BUILTIN_THEME_ID = "theme-7ad8adb8-e017-4853-93b1-fb608a750253";

/** A still preview of the theme with the current scores. Rendered once per theme, not on every feed update. */
const ThemeThumb = memo(function ThemeThumb({
  theme,
  live,
  assets
}: {
  theme: ThemeDefinition;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
}) {
  return (
    <div className="ad-theme-thumb ad-checker" aria-hidden>
      <ScaledCanvasFrame width={theme.canvas.width} height={theme.canvas.height} className="ad-theme-thumb-frame" innerClassName="ad-theme-thumb-stage" mode="width">
        <OverlayRenderer theme={theme} live={live} assets={assets} transparentBackground={theme.canvas.transparentPreview} />
      </ScaledCanvasFrame>
    </div>
  );
});

export function ThemesPage() {
  const navigate = useNavigate();
  const themes = useThemes();
  const settings = useSettings();
  const assets = useAssets();
  const live = useLiveState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ThemeKindFilter>("all");
  const [sortBy, setSortBy] = useState<ThemeSort>("nameAsc");
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  // Previews use the scores from when the page opened, so ten renderers do not redraw on every feed tick.
  const snapshotRef = useRef<NormalizedLiveState | null>(null);
  if (!snapshotRef.current && live.data) {
    snapshotRef.current = live.data;
  }

  const onAirId = settings.data?.publishedThemeId ?? null;
  const allThemes = themes.data ?? [];
  const visibleThemes = useMemo(() => {
    const sorted = filterAndSortThemes(allThemes, search, kindFilter, sortBy);
    const onAir = sorted.find((theme) => theme.id === onAirId);
    return onAir ? [onAir, ...sorted.filter((theme) => theme.id !== onAirId)] : sorted;
  }, [allThemes, search, kindFilter, sortBy, onAirId]);
  const customCount = allThemes.filter((theme) => !theme.builtin).length;

  async function refresh() {
    themes.setData(await api.getThemes());
    settings.setData(await api.getSettings());
  }

  async function createFrom(sourceId: string, message: string) {
    try {
      const theme = await api.createTheme(sourceId);
      await refresh();
      showToast({ kind: "success", message });
      navigate(`/admin/themes/${theme.id}`);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to create the theme." });
    }
  }

  async function handlePublish(theme: ThemeDefinition) {
    if (publishingId) {
      return;
    }
    if (!window.confirm(`Put “${theme.name}” on air?\n\nThe live overlay switches to this theme immediately, replacing the one on air now.`)) {
      return;
    }
    setPublishingId(theme.id);
    try {
      await api.publishTheme(theme.id);
      await refresh();
      showToast({ kind: "success", message: `“${theme.name}” is now on air.` });
    } catch (error) {
      showToast({
        kind: "error",
        message: `Could not put it on air: ${error instanceof Error ? error.message : "unknown error"}. The previous theme is still on air.`
      });
    } finally {
      setPublishingId(null);
    }
  }

  async function handleDelete(theme: ThemeDefinition) {
    if (!window.confirm(`Delete “${theme.name}”? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteTheme(theme.id);
      await refresh();
      showToast({ kind: "success", message: "Theme deleted." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete the theme." });
    }
  }

  async function handleExport(theme: ThemeDefinition) {
    try {
      const payload = await api.exportTheme(theme.id);
      downloadJson(payload, `${payload.theme.name.replace(/\s+/g, "-").toLowerCase()}.theme.json`);
      showToast({ kind: "success", message: "Theme exported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to export the theme." });
    }
  }

  async function handleImport(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      await api.importTheme(payload as Parameters<typeof api.importTheme>[0]);
      await refresh();
      showToast({ kind: "success", message: "Theme imported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to import the theme." });
    }
  }

  return (
    <div className="ad-page ad-scope">
      <Toolbar title="Themes" count={themes.data ? allThemes.length : undefined}>
        <SearchField ref={searchRef} label="Search themes" placeholder="Search themes" shortcut="/" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Segmented
          label="Kind"
          value={kindFilter}
          onChange={setKindFilter}
          options={[
            { value: "all", label: "All" },
            { value: "custom", label: "Custom", count: customCount },
            { value: "builtin", label: "Built-in", count: allThemes.length - customCount }
          ]}
        />
        <select className="ad-select" style={{ width: "auto" }} aria-label="Sort" value={sortBy} onChange={(event) => setSortBy(event.target.value as ThemeSort)}>
          <option value="nameAsc">Name A–Z</option>
          <option value="nameDesc">Name Z–A</option>
        </select>
        <Grow />
        <Button variant="ghost" onClick={() => importRef.current?.click()}>
          <Upload aria-hidden />
          Import
        </Button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleImport(file);
            }
            event.currentTarget.value = "";
          }}
        />
        <Button variant="primary" onClick={() => void createFrom(PREFERRED_BUILTIN_THEME_ID, "Theme created.")}>
          <Plus aria-hidden />
          New theme
        </Button>
      </Toolbar>

      <div className="ad-body">
        {!themes.data ? (
          <p className="ad-hint" style={{ padding: 20 }}>
            Loading themes…
          </p>
        ) : visibleThemes.length === 0 ? (
          <div className="ad-empty">
            <b>{allThemes.length ? "No themes match" : "No themes yet"}</b>
            <p className="ad-hint">{allThemes.length ? "Try another search or show all kinds." : "Start from the broadcast layout, then make it yours."}</p>
            {allThemes.length ? (
              <Button
                onClick={() => {
                  setSearch("");
                  setKindFilter("all");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="ad-gallery">
            {visibleThemes.map((theme) => {
              const onAir = theme.id === onAirId;
              return (
                <article key={theme.id} className={onAir ? "ad-surface ad-theme is-air" : "ad-surface ad-theme"}>
                  <Link to={`/admin/themes/${theme.id}`} className="ad-theme-link" aria-label={`Edit ${theme.name}`} tabIndex={-1}>
                    <ThemeThumb theme={theme} live={snapshotRef.current} assets={assets.data ?? []} />
                  </Link>
                  <div className="ad-theme-body">
                    <div className="ad-theme-title">
                      <b title={theme.name}>{theme.name}</b>
                      {onAir ? (
                        <Chip tone="air">
                          <Dot tone="tally" flat />
                          On air
                        </Chip>
                      ) : theme.builtin ? (
                        <Chip>Built-in</Chip>
                      ) : (
                        <Chip>Custom</Chip>
                      )}
                    </div>
                    <p className="ad-theme-desc" title={theme.description}>
                      {theme.description || "No description"}
                      {theme.canvas.width !== 1920 || theme.canvas.height !== 1080 ? ` · ${theme.canvas.width}×${theme.canvas.height}` : ""}
                    </p>
                    <div className="ad-theme-actions">
                      <Link className="ad-btn" to={`/admin/themes/${theme.id}`}>
                        <PenLine aria-hidden />
                        Edit
                      </Link>
                      {onAir ? (
                        <a className="ad-btn ad-btn--ghost" href={`/overlay/preview/${theme.id}`} target="_blank" rel="noreferrer">
                          <Eye aria-hidden />
                          Preview
                        </a>
                      ) : (
                        <Button variant="ghost" onClick={() => void handlePublish(theme)} disabled={publishingId !== null}>
                          <Radio aria-hidden />
                          {publishingId === theme.id ? "Putting on air…" : "Put on air"}
                        </Button>
                      )}
                      <Grow />
                      <Menu
                        trigger={
                          <IconButton label={`More for ${theme.name}`}>
                            <Ellipsis />
                          </IconButton>
                        }
                        items={[
                          ...(!onAir
                            ? [{ label: "Preview", icon: <Eye />, onSelect: () => window.open(`/overlay/preview/${theme.id}`, "_blank", "noreferrer") }]
                            : []),
                          { label: "Duplicate", icon: <CopyPlus />, onSelect: () => void createFrom(theme.id, "Theme duplicated.") },
                          { label: "Export", icon: <Download />, onSelect: () => void handleExport(theme) },
                          ...(!theme.builtin
                            ? [
                                { kind: "separator" as const },
                                {
                                  label: "Delete…",
                                  icon: <Trash2 />,
                                  danger: true,
                                  disabled: onAir,
                                  onSelect: () => void handleDelete(theme)
                                }
                              ]
                            : [])
                        ]}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
            <button type="button" className="ad-surface ad-theme ad-theme-new" onClick={() => void createFrom(PREFERRED_BUILTIN_THEME_ID, "Theme created.")}>
              <Plus aria-hidden />
              New theme
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
