import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Archive, ArchiveRestore, CopyPlus, Download, Ellipsis, Eye, LayoutGrid, List, PenLine, Plus, Radio, Trash2, Upload } from "lucide-react";
import { api } from "../api";
import { useAssets, useLiveState, useSettings, useThemes } from "../hooks";
import { showToast } from "../toast";
import type { NormalizedLiveState, StoredAsset, ThemeDefinition } from "../../shared/theme";
import { OverlayRenderer } from "../components/OverlayRenderer";
import { Button, Chip, Dot, Grow, IconButton, Menu, SearchField, Segmented, Toolbar, downloadJson, useSlashFocus, type MenuItem } from "../components/admin/kit";
import { fitContent, formatEdited, groupByAcronym, organizeThemes, themeContentBounds, type ThemeSort } from "./themeAdminUtils";
import { confirmAction } from "../confirm";

type ThemeView = "grid" | "list";

const VIEW_KEY = "pbresults.themes.view";
const SORT_KEY = "pbresults.themes.sort";

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice still holds for this visit.
  }
}

const THUMB_PADDING = 14;

/**
 * A still preview of the theme with the current scores, cropped to what the theme draws so the scoreboard
 * is legible, and centred in a fixed-height box so every card lines up. Rendered once per theme, not on
 * every feed update, and only after the box is measured so nothing jumps.
 */
const ThemeThumb = memo(function ThemeThumb({
  theme,
  live,
  assets
}: {
  theme: ThemeDefinition;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const bounds = useMemo(() => themeContentBounds(theme), [theme]);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) {
      return;
    }
    const update = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setBox((current) => (current && current.width === width && current.height === height ? current : width && height ? { width, height } : null));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = box ? fitContent(bounds, box.width, box.height, THUMB_PADDING) : null;

  return (
    <div ref={boxRef} className="ad-theme-thumb ad-checker" aria-hidden>
      {fit ? (
        <div
          className="ad-theme-thumb-stage"
          style={{ width: theme.canvas.width, height: theme.canvas.height, transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}
        >
          <OverlayRenderer theme={theme} live={live} assets={assets} transparentBackground />
        </div>
      ) : null}
    </div>
  );
});

type CardActions = {
  publishingId: string | null;
  onPublish: (theme: ThemeDefinition) => void;
  onDuplicate: (theme: ThemeDefinition) => void;
  onExport: (theme: ThemeDefinition) => void;
  onArchive: (theme: ThemeDefinition, archived: boolean) => void;
  onDelete: (theme: ThemeDefinition) => void;
};

function themeMenu(theme: ThemeDefinition, onAir: boolean, actions: CardActions): MenuItem[] {
  const items: MenuItem[] = [];
  if (!onAir) {
    items.push({
      label: actions.publishingId === theme.id ? "Putting on air…" : "Put on air…",
      icon: <Radio />,
      disabled: actions.publishingId !== null,
      onSelect: () => actions.onPublish(theme)
    });
  }
  items.push(
    { label: "Preview", icon: <Eye />, onSelect: () => window.open(`/overlay/preview/${theme.id}`, "_blank", "noreferrer") },
    { label: "Duplicate", icon: <CopyPlus />, onSelect: () => actions.onDuplicate(theme) },
    { label: "Export", icon: <Download />, onSelect: () => actions.onExport(theme) }
  );
  if (!theme.builtin && !onAir) {
    items.push(
      { kind: "separator" },
      theme.archived
        ? { label: "Restore", icon: <ArchiveRestore />, onSelect: () => actions.onArchive(theme, false) }
        : { label: "Archive", icon: <Archive />, onSelect: () => actions.onArchive(theme, true) },
      { label: "Delete…", icon: <Trash2 />, danger: true, onSelect: () => actions.onDelete(theme) }
    );
  }
  return items;
}

/** The theme's name, led by its acronym in bold so a long list can be skimmed. */
function ThemeName({ theme }: { theme: ThemeDefinition }) {
  return (
    <b className="ad-theme-name" title={theme.acronym ? `${theme.acronym} · ${theme.name}` : theme.name}>
      {theme.acronym ? <abbr className="ad-theme-acronym" title={theme.name}>{theme.acronym}</abbr> : null}
      <span>{theme.name}</span>
    </b>
  );
}

/** One theme, as a card in the grid or a row in the list. Edit is the one visible action; the rest sit in ⋯. */
function ThemeItem({
  theme,
  view,
  onAir,
  live,
  assets,
  actions
}: {
  theme: ThemeDefinition;
  view: ThemeView;
  onAir: boolean;
  live: NormalizedLiveState | null;
  assets: StoredAsset[];
  actions: CardActions;
}) {
  const edited = formatEdited(theme.updatedAt);
  const size = theme.canvas.width !== 1920 || theme.canvas.height !== 1080 ? `${theme.canvas.width}×${theme.canvas.height}` : null;
  const meta = [edited, size].filter(Boolean).join(" · ");
  const chip = onAir ? (
    <Chip tone="air">
      <Dot tone="tally" flat />
      On air
    </Chip>
  ) : null;
  const builtinChip = theme.builtin ? <Chip>Built-in</Chip> : null;
  const menu = (
    <Menu
      trigger={
        <IconButton label={`More for ${theme.name}`}>
          <Ellipsis />
        </IconButton>
      }
      items={themeMenu(theme, onAir, actions)}
    />
  );
  const edit = (
    <Link className="ad-btn" to={`/admin/themes/${theme.id}`}>
      <PenLine aria-hidden />
      Edit
    </Link>
  );
  const classes = ["ad-surface", view === "grid" ? "ad-theme" : "ad-theme-row", onAir ? "is-air" : "", theme.archived ? "is-archived" : ""].join(" ");

  return (
    <article className={classes}>
      <Link to={`/admin/themes/${theme.id}`} className="ad-theme-link" aria-label={`Edit ${theme.name}`} tabIndex={-1}>
        <ThemeThumb theme={theme} live={live} assets={assets} />
      </Link>
      {view === "grid" ? (
        <div className="ad-theme-body">
          <div className="ad-theme-title">
            <ThemeName theme={theme} />
            {chip ?? builtinChip}
          </div>
          {theme.description ? (
            <p className="ad-theme-desc" title={theme.description}>
              {theme.description}
            </p>
          ) : null}
          {meta ? <p className="ad-theme-meta">{meta}</p> : null}
          <div className="ad-theme-actions">
            {edit}
            <Grow />
            {menu}
          </div>
        </div>
      ) : (
        <>
          <div className="ad-theme-row-text">
            <ThemeName theme={theme} />
            {theme.description ? <span title={theme.description}>{theme.description}</span> : null}
          </div>
          <span className="ad-theme-meta">{meta}</span>
          <span className="ad-theme-row-chip">{chip ?? builtinChip}</span>
          <div className="ad-theme-actions">
            {edit}
            {menu}
          </div>
        </>
      )}
    </article>
  );
}

export function ThemesPage() {
  const navigate = useNavigate();
  const themes = useThemes();
  const settings = useSettings();
  const assets = useAssets();
  const live = useLiveState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<ThemeSort>(() => readStored(SORT_KEY, ["recent", "nameAsc", "nameDesc"] as const, "recent"));
  const [view, setView] = useState<ThemeView>(() => readStored(VIEW_KEY, ["grid", "list"] as const, "grid"));
  const [showArchived, setShowArchived] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  useEffect(() => writeStored(SORT_KEY, sortBy), [sortBy]);
  useEffect(() => writeStored(VIEW_KEY, view), [view]);

  // Previews use the scores from when the page opened, so ten renderers do not redraw on every feed tick.
  const snapshotRef = useRef<NormalizedLiveState | null>(null);
  if (!snapshotRef.current && live.data) {
    snapshotRef.current = live.data;
  }

  const onAirId = settings.data?.publishedThemeId ?? null;
  const allThemes = themes.data ?? [];
  const sections = useMemo(() => organizeThemes(allThemes, search, sortBy, onAirId), [allThemes, search, sortBy, onAirId]);
  const searching = search.trim() !== "";
  const archivedOpen = showArchived || (searching && sections.archived.length > 0);
  const eventThemeCount = allThemes.filter((theme) => !theme.builtin && !theme.archived).length;
  const nothingMatches = searching && !sections.onAir && !sections.active.length && !sections.archived.length;

  async function refresh() {
    themes.setData(await api.getThemes());
    settings.setData(await api.getSettings());
  }

  async function createFrom(source: ThemeDefinition, message: string) {
    try {
      const theme = await api.createTheme(source.id, source.name);
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
    const confirmed = await confirmAction({
      title: `Put “${theme.name}” on air?`,
      message: "The live overlay switches to this theme immediately, replacing the one on air now.",
      confirmLabel: "Put on air",
      tone: "danger"
    });
    if (!confirmed) return;
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

  async function handleArchive(theme: ThemeDefinition, archived: boolean) {
    try {
      await api.archiveTheme(theme.id, archived);
      await refresh();
      showToast({ kind: "success", message: archived ? `“${theme.name}” archived. It is under Archived at the bottom.` : `“${theme.name}” restored.` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to update the theme." });
    }
  }

  async function handleDelete(theme: ThemeDefinition) {
    const confirmed = await confirmAction({
      title: `Delete “${theme.name}”?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete theme",
      tone: "danger"
    });
    if (!confirmed) return;
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

  const actions: CardActions = {
    publishingId,
    onPublish: (theme) => void handlePublish(theme),
    onDuplicate: (theme) => void createFrom(theme, "Theme duplicated."),
    onExport: (theme) => void handleExport(theme),
    onArchive: (theme, archived) => void handleArchive(theme, archived),
    onDelete: (theme) => void handleDelete(theme)
  };

  const newThemeItems: MenuItem[] = [
    ...sections.templates.map((template) => ({
      label: `Start from ${template.name}`,
      icon: <Plus />,
      onSelect: () => void createFrom(template, "Theme created.")
    })),
    { kind: "separator" as const },
    { label: "Import a theme file…", icon: <Upload />, onSelect: () => importRef.current?.click() }
  ];

  const renderList = (list: ThemeDefinition[]) => (
    <div className={view === "grid" ? "ad-gallery" : "ad-theme-list"}>
      {list.map((theme) => (
        <ThemeItem
          key={theme.id}
          theme={theme}
          view={view}
          onAir={theme.id === onAirId}
          live={snapshotRef.current}
          assets={assets.data ?? []}
          actions={actions}
        />
      ))}
    </div>
  );

  // Themes sharing an acronym sit together under it, the on-air theme's set first; a list with no acronyms stays flat.
  const onAirAcronym = allThemes.find((theme) => theme.id === onAirId)?.acronym ?? "";
  const renderItems = (list: ThemeDefinition[]) => {
    const groups = groupByAcronym(list, sortBy, onAirAcronym);
    if (groups.length <= 1 && !groups[0]?.acronym) {
      return renderList(list);
    }
    return groups.map((group) => (
      <div key={group.acronym || "none"} className="ad-theme-group">
        <h3 className="ad-theme-group-title">
          {group.acronym ? <span className="ad-theme-acronym">{group.acronym}</span> : "No acronym"}
          <span className="ad-theme-section-count">{group.themes.length}</span>
        </h3>
        {renderList(group.themes)}
      </div>
    ));
  };

  return (
    <div className="ad-page ad-scope">
      <Toolbar title="Themes" count={themes.data ? eventThemeCount : undefined}>
        <SearchField ref={searchRef} label="Search themes" placeholder="Search themes" shortcut="/" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="ad-select" style={{ width: "auto" }} aria-label="Sort" value={sortBy} onChange={(event) => setSortBy(event.target.value as ThemeSort)}>
          <option value="recent">Recently edited</option>
          <option value="nameAsc">Name A–Z</option>
          <option value="nameDesc">Name Z–A</option>
        </select>
        <Segmented
          label="Layout"
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: <LayoutGrid aria-label="Grid" />, title: "Grid" },
            { value: "list", label: <List aria-label="List" />, title: "List" }
          ]}
        />
        <Grow />
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
        <Menu
          trigger={
            <Button variant="primary">
              <Plus aria-hidden />
              New theme
            </Button>
          }
          items={newThemeItems}
        />
      </Toolbar>

      <div className="ad-body">
        {!themes.data ? (
          <p className="ad-hint" style={{ padding: 20 }}>
            Loading themes…
          </p>
        ) : nothingMatches ? (
          <div className="ad-empty">
            <b>No themes match</b>
            <p className="ad-hint">Try another name, or clear the search.</p>
            <Button onClick={() => setSearch("")}>Clear search</Button>
          </div>
        ) : (
          <>
            {sections.onAir ? (
              <section className="ad-theme-section" aria-labelledby="themes-on-air">
                <h2 id="themes-on-air" className="ad-theme-section-title">
                  On air
                </h2>
                {renderList([sections.onAir])}
              </section>
            ) : null}

            <section className="ad-theme-section" aria-labelledby="themes-yours">
              <h2 id="themes-yours" className="ad-theme-section-title">
                Your themes
                {sections.active.length ? <span className="ad-theme-section-count">{sections.active.length}</span> : null}
              </h2>
              {sections.active.length ? (
                renderItems(sections.active)
              ) : searching ? (
                <p className="ad-hint ad-theme-section-empty">No other themes match.</p>
              ) : (
                <div className="ad-empty ad-theme-section-empty">
                  <b>No themes of your own yet</b>
                  <p className="ad-hint">Start from a built-in layout, then make it yours.</p>
                  <div className="ad-theme-starters">
                    {sections.templates.map((template) => (
                      <Button key={template.id} onClick={() => void createFrom(template, "Theme created.")}>
                        <Plus aria-hidden />
                        Start from {template.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {sections.archived.length ? (
              <section className="ad-theme-section ad-theme-archive" aria-label="Archived themes">
                <button type="button" className="ad-btn ad-btn--text" aria-expanded={archivedOpen} onClick={() => setShowArchived((open) => !open)}>
                  <Archive aria-hidden />
                  {archivedOpen ? "Hide archived" : `Show archived (${sections.archived.length})`}
                </button>
                {archivedOpen ? renderItems(sections.archived) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
