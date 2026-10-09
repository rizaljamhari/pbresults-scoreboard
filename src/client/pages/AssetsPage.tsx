import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Brush,
  Copy,
  Download,
  Ellipsis,
  ImageOff,
  ImageUp,
  Images,
  LayoutGrid,
  List,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  X
} from "lucide-react";
import { api, ApiError } from "../api";
import { useAssetLibrary, useSettings } from "../hooks";
import { showToast } from "../toast";
import { isFontAsset } from "../../shared/fonts";
import { useThemeFonts } from "../components/themeFonts";
import type { AssetCleanupReport, AssetLibraryEntry, AssetUsage } from "../../shared/theme";
import { Button, Chip, Field, Grow, IconButton, Menu, SearchField, Segmented, Toolbar, useSlashFocus } from "../components/admin/kit";
import { cn } from "../lib/utils";
import {
  assetDimensions,
  assetName,
  assetTypeLabel,
  filterAndSortAssets,
  formatBytes,
  groupUsages,
  usageHref,
  usageOwnerName,
  usageSummary,
  type AssetFilter,
  type AssetSort
} from "./assetAdminUtils";
import { confirmAction, modalPromptOpen } from "../confirm";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,image/gif";
/** The library also takes font files, for themes' custom fonts. */
const ACCEPTED_UPLOADS = `${ACCEPTED_IMAGES},.woff2,.woff,.ttf,.otf`;

/** A font's tile: "Aa" set in the font itself. */
function FontSample({ asset, className }: { asset: Pick<AssetLibraryEntry, "id" | "url">; className?: string }) {
  const family = `asset-${asset.id}`;
  useThemeFonts([{ family, url: asset.url }]);
  return (
    <span className={cn("pba-font-sample", className)} style={{ fontFamily: `"${family}", sans-serif` }} aria-label="Font">
      Aa
    </span>
  );
}

/** An asset's thumbnail: the image, a font sample, or a missing-file mark. */
function AssetThumb({ asset }: { asset: AssetLibraryEntry }) {
  if (asset.fileMissing) return <ImageOff aria-label="File missing" />;
  return isFontAsset(asset) ? <FontSample asset={asset} /> : <img src={asset.url} alt="" loading="lazy" />;
}
const VIEW_KEY = "pbresults.assets.view";

type AssetView = "grid" | "list";

function readView(): AssetView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function formatAdded(createdAt: string): string {
  const time = Date.parse(createdAt);
  return Number.isNaN(time) ? "—" : new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function processingNote(processing: { status: string; reason: string | null }) {
  if (processing.status === "processed") return " Background removed.";
  if (processing.status === "failed") return ` Background removal failed${processing.reason ? `: ${processing.reason}` : "."}`;
  return "";
}

function stripVersion(url: string) {
  return url.split("?")[0] ?? url;
}

export function AssetsPage() {
  const navigate = useNavigate();
  const { id: openAssetId } = useParams<{ id: string }>();
  const library = useAssetLibrary();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [sort, setSort] = useState<AssetSort>("newest");
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [view, setView] = useState<AssetView>(readView);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const all = library.data ?? [];
  const shown = useMemo(() => filterAndSortAssets(all, search, filter, sort), [all, search, filter, sort]);
  const usedCount = all.filter((asset) => asset.usages.length > 0).length;
  const processedCount = all.filter((asset) => asset.backgroundRemoved).length;
  const openAsset = openAssetId ? all.find((asset) => asset.id === openAssetId) ?? null : null;
  const panelOpen = cleanupOpen || Boolean(openAssetId);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      // The choice still holds for this visit.
    }
  }, [view]);

  function openPanel(id: string | null) {
    setCleanupOpen(false);
    navigate(id ? `/admin/assets/${id}` : "/admin/assets");
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panelOpen || modalPromptOpen()) return;
      if ((event.target as HTMLElement | null)?.closest("[data-radix-popper-content-wrapper], input, textarea")) return;
      openPanel(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  useEffect(() => {
    if (!openAssetId || !library.data) return;
    document.querySelector(`[data-asset-id="${CSS.escape(openAssetId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [openAssetId, Boolean(library.data)]);

  async function uploadFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      showToast({ kind: "error", message: "Drop PNG, JPG, WebP or GIF images." });
      return;
    }
    setUploading((count) => count + images.length);
    let uploaded = 0;
    let lastId: string | null = null;
    let removed = 0;
    for (const file of images) {
      try {
        const result = await api.uploadAsset(file);
        uploaded += 1;
        lastId = result.asset.id;
        if (result.processing.status === "processed") removed += 1;
      } catch (error) {
        showToast({ kind: "error", message: `${file.name}: ${error instanceof Error ? error.message : "Upload failed."}` });
      } finally {
        setUploading((count) => count - 1);
      }
    }
    if (uploaded) {
      library.refresh();
      showToast({
        kind: "success",
        message: `${plural(uploaded, "image")} uploaded.${removed ? ` Background removed from ${removed}.` : ""}`
      });
      if (uploaded === 1 && lastId) openPanel(lastId);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      className={cn("pba-page pba-scope", dragging && "is-dropping")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Toolbar title="Assets" count={library.data ? all.length : undefined}>
        <SearchField
          ref={searchRef}
          label="Search assets"
          placeholder="Search names, themes and teams"
          shortcut="/"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "used", label: "In use", count: usedCount },
            { value: "unused", label: "Unused", count: all.length - usedCount },
            { value: "processed", label: "Cut out", count: processedCount, title: "Background removed" }
          ]}
        />
        <Segmented
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "Newest" },
            { value: "name", label: "Name" },
            { value: "size", label: "Size" }
          ]}
        />
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
        <Button variant="ghost" onClick={() => setCleanupOpen(true)}>
          <Brush aria-hidden />
          Clean up…
        </Button>
        <Button variant="primary" disabled={uploading > 0} onClick={() => uploadRef.current?.click()}>
          <Upload aria-hidden />
          {uploading > 0 ? `Uploading ${uploading}…` : "Upload"}
        </Button>
        <input
          ref={uploadRef}
          hidden
          multiple
          type="file"
          accept={ACCEPTED_UPLOADS}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = "";
            if (files.length) void uploadFiles(files);
          }}
        />
      </Toolbar>

      <div className={panelOpen ? "pba-split has-panel" : "pba-split"}>
        <div className="pba-table-wrap">
          {!library.data ? (
            <p className="pba-hint" style={{ padding: 20 }}>
              Loading assets…
            </p>
          ) : shown.length === 0 ? (
            <div className="pba-empty">
              <b>{all.length ? "No assets match" : "No assets yet"}</b>
              <p className="pba-hint">
                {all.length
                  ? "Try another name, or show everything."
                  : "Upload logos, backgrounds and other images here, or drop them anywhere on this page."}
              </p>
              {all.length ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => uploadRef.current?.click()}>
                  <Upload aria-hidden />
                  Upload images
                </Button>
              )}
            </div>
          ) : view === "list" ? (
            <table className="pba-table pba-asset-table" aria-label="Assets">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Used in</th>
                  <th className="pba-col-2nd">Type</th>
                  <th className="pba-col-2nd">Dimensions</th>
                  <th className="pba-num">Size</th>
                  <th className="pba-col-2nd">Added</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((asset) => {
                  const open = asset.id === openAssetId;
                  return (
                    <tr key={asset.id} data-asset-id={asset.id} aria-selected={open} onClick={() => openPanel(asset.id)}>
                      <td className="pba-cell-name">
                        <button
                          type="button"
                          className="pba-row-open"
                          aria-pressed={open}
                          onClick={(event) => {
                            event.stopPropagation();
                            openPanel(asset.id);
                          }}
                        >
                          <span className="pba-asset-row-thumb pba-checker">
                            <AssetThumb asset={asset} />
                          </span>
                          <span className="pba-asset-row-name" title={assetName(asset)}>
                            {assetName(asset)}
                          </span>
                        </button>
                      </td>
                      <td>
                        {asset.fileMissing ? (
                          <Chip tone="critical">File missing</Chip>
                        ) : asset.usages.length ? (
                          <span className="pba-asset-row-usage" title={groupUsages(asset.usages).map(({ usage }) => usageOwnerName(usage)).join(", ")}>
                            {usageSummary(asset.usages).replace(/^Used in /, "")}
                          </span>
                        ) : (
                          <Chip tone="quiet">Unused</Chip>
                        )}
                      </td>
                      <td className="pba-col-2nd">
                        {assetTypeLabel(asset.mimeType)}
                        {asset.backgroundRemoved ? <span className="pba-faint"> · cut out</span> : null}
                      </td>
                      <td className="pba-col-2nd">{assetDimensions(asset) ?? <span className="pba-faint">—</span>}</td>
                      <td className="pba-num">{formatBytes(asset.byteSize)}</td>
                      <td className="pba-col-2nd">{formatAdded(asset.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <ul className="pba-asset-grid" aria-label="Assets">
              {shown.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    data-asset-id={asset.id}
                    className="pba-asset-card"
                    aria-pressed={asset.id === openAssetId}
                    onClick={() => openPanel(asset.id)}
                  >
                    <span className="pba-asset-thumb pba-checker">
                      <AssetThumb asset={asset} />
                    </span>
                    <span className="pba-asset-name" title={assetName(asset)}>
                      {assetName(asset)}
                    </span>
                    <span className="pba-asset-meta">
                      {asset.fileMissing ? (
                        <Chip tone="critical">File missing</Chip>
                      ) : (
                        <Chip tone={asset.usages.length ? "ok" : "quiet"}>
                          {asset.usages.length ? plural(groupUsages(asset.usages).length, "use") : "Unused"}
                        </Chip>
                      )}
                      <span className="pba-faint">{formatBytes(asset.byteSize)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cleanupOpen ? (
          <CleanupPanel onClose={() => setCleanupOpen(false)} onDone={() => library.refresh()} />
        ) : openAssetId ? (
          <AssetInspector
            key={openAssetId}
            asset={openAsset}
            loaded={Boolean(library.data)}
            onChanged={() => library.refresh()}
            onClose={() => openPanel(null)}
          />
        ) : null}
      </div>

      {dragging ? (
        <div className="pba-drop-hint" aria-hidden>
          <ImageUp />
          Drop images to upload
        </div>
      ) : null}
    </div>
  );
}

function UsageList({ usages }: { usages: AssetUsage[] }) {
  if (!usages.length) {
    return <p className="pba-hint">Not used by any theme, team or branding.</p>;
  }
  return (
    <ul className="pba-usage-list">
      {groupUsages(usages).map(({ key, usage, places }) => (
        <li key={key}>
          <Link to={usageHref(usage)} className="pba-usage-owner">
            {usageOwnerName(usage)}
          </Link>
          <span className="pba-usage-kind">{usage.kind === "theme" ? "Theme" : usage.kind === "team" ? "Team" : "Settings"}</span>
          {usage.kind === "theme" && usage.published ? <Chip tone="air">On air</Chip> : null}
          {usage.kind === "theme" && usage.builtin ? <Chip tone="quiet">Built-in</Chip> : null}
          <span className="pba-usage-places">{places.join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

function AssetInspector({
  asset,
  loaded,
  onChanged,
  onClose
}: {
  asset: AssetLibraryEntry | null;
  loaded: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const [name, setName] = useState(asset ? assetName(asset) : "");
  const [preview, setPreview] = useState<"current" | "original">("current");
  const [removeBackground, setRemoveBackground] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<AssetUsage[] | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (asset) setName(assetName(asset));
  }, [asset?.displayName, asset?.originalName]);

  useEffect(() => {
    if (!asset?.original) setPreview("current");
  }, [asset?.original?.id]);

  if (!asset) {
    return (
      <aside className="pba-inspector" aria-label="Asset">
        {loaded ? (
          <div className="pba-empty">
            <b>Asset not found</b>
            <p className="pba-hint">It may have been deleted somewhere else.</p>
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : null}
      </aside>
    );
  }

  const current = asset;
  const removeBg = removeBackground ?? settings.data?.autoRemoveBackgroundUploads ?? true;
  const dimensions = assetDimensions(current);
  const previewUrl = preview === "original" && current.original ? current.original.url : current.url;

  async function run<T>(label: string, action: () => Promise<T>, success: (result: T) => string) {
    setBusy(label);
    try {
      const result = await action();
      showToast({ kind: "success", message: success(result) });
      onChanged();
      return result;
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : `${label} failed.` });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function commitName() {
    const next = name.trim();
    if (next === assetName(current) || (!next && !current.displayName)) {
      setName(assetName(current));
      return;
    }
    await run("Rename", () => api.renameAsset(current.id, next || null), () => "Asset renamed.");
  }

  async function replace(file: File) {
    await run(
      "Replace",
      () => api.replaceAssetFile(current.id, file, removeBg),
      (result) => `File replaced everywhere it is used.${processingNote(result.processing)}`
    );
  }

  async function handleDelete(force: boolean) {
    if (!force && current.usages.length) {
      setBlockedBy(current.usages);
      return;
    }
    if (
      !force &&
      !(await confirmAction({
        title: `Delete “${assetName(current)}”?`,
        message: "This cannot be undone.",
        confirmLabel: "Delete image",
        tone: "danger"
      }))
    )
      return;
    setBusy("Delete");
    try {
      const result = await api.deleteAsset(current.id, force);
      const cleared = result.clearedThemeIds.length + result.clearedTeamIds.length;
      showToast({
        kind: "success",
        message: cleared ? `Asset deleted and removed from ${plural(cleared, "place")}.` : "Asset deleted."
      });
      onChanged();
      navigate("/admin/assets");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.payload?.usages) {
        setBlockedBy(error.payload.usages);
      } else {
        showToast({ kind: "error", message: error instanceof Error ? error.message : "Delete failed." });
      }
    } finally {
      setBusy(null);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(new URL(stripVersion(current.url), window.location.origin).toString());
      showToast({ kind: "success", message: "Image address copied.", durationMs: 1600 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to copy." });
    }
  }

  function download() {
    const link = document.createElement("a");
    link.href = stripVersion(current.url);
    link.download = assetName(current);
    link.click();
  }

  return (
    <aside className="pba-inspector" aria-label={assetName(current)}>
      <div className="pba-insp-head">
        <span className="pba-insp-logo pba-checker">{current.fileMissing ? null : isFontAsset(current) ? <FontSample asset={current} /> : <img src={current.url} alt="" />}</span>
        <div className="pba-insp-title">
          <b>{assetName(current)}</b>
          <span>{usageSummary(current.usages)}</span>
        </div>
        <Menu
          trigger={
            <IconButton label="More asset actions">
              <Ellipsis />
            </IconButton>
          }
          items={[
            { label: "Copy image address", icon: <Copy />, onSelect: () => void copyUrl() },
            { label: "Download", icon: <Download />, onSelect: download, disabled: current.fileMissing },
            { kind: "separator" },
            { label: "Delete…", icon: <Trash2 />, danger: true, onSelect: () => void handleDelete(false) }
          ]}
        />
        <IconButton label="Close" title="Close (Esc)" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="pba-insp-body">
        {blockedBy ? (
          <div className="pba-callout pba-callout--critical pba-callout--stack">
            <div className="pba-callout-line">
              <TriangleAlert aria-hidden />
              <b>This asset is still in use</b>
            </div>
            <p>Deleting it removes the image from these places. Themes and teams keep everything else.</p>
            <UsageList usages={blockedBy} />
            <div className="pba-callout-actions">
              <Button size="sm" onClick={() => setBlockedBy(null)}>
                Keep it
              </Button>
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void handleDelete(true)}>
                Delete and clear {plural(blockedBy.length, "reference")}
              </Button>
            </div>
          </div>
        ) : null}

        <section className="pba-insp-group">
          <div className="pba-asset-preview pba-checker">
            {current.fileMissing ? (
              <span className="pba-hint">
                <ImageOff aria-hidden /> The file for this asset is missing. Replace it to repair every place that uses it.
              </span>
            ) : isFontAsset(current) ? (
              <FontSample asset={current} className="pba-font-sample--large" />
            ) : (
              <img src={previewUrl} alt={preview === "original" ? "Original upload" : "Current image"} />
            )}
          </div>
          {current.original ? (
            <Segmented
              className="pba-asset-preview-toggle"
              label="Preview"
              value={preview}
              onChange={setPreview}
              options={[
                { value: "current", label: current.backgroundRemoved ? "Cut out" : "Current" },
                { value: "original", label: "Original upload" }
              ]}
            />
          ) : null}
        </section>

        <section className="pba-insp-group">
          <Field label="Name" hint={current.displayName ? `Uploaded as ${current.originalName}` : undefined}>
            {(id) => (
              <input
                id={id}
                className="pba-input"
                value={name}
                placeholder={current.originalName}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setName(assetName(current));
                    event.currentTarget.blur();
                  }
                }}
              />
            )}
          </Field>
          <dl className="pba-asset-facts">
            <dt>Type</dt>
            <dd>{assetTypeLabel(current.mimeType)}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(current.byteSize)}</dd>
            {dimensions ? (
              <>
                <dt>Pixels</dt>
                <dd>{dimensions}</dd>
              </>
            ) : null}
            <dt>Added</dt>
            <dd>{new Date(current.createdAt).toLocaleString()}</dd>
            {current.updatedAt ? (
              <>
                <dt>Changed</dt>
                <dd>{new Date(current.updatedAt).toLocaleString()}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="pba-insp-group">
          <h2>
            Used by<span className="pba-hint">{current.usages.length ? plural(current.usages.length, "place") : null}</span>
          </h2>
          <UsageList usages={current.usages} />
        </section>

        <section className="pba-insp-group">
          <h2>File</h2>
          {isFontAsset(current) ? (
            <p className="pba-hint">A font file. Add it to a theme from the Fonts section of the theme panel.</p>
          ) : (
          <div className="pba-asset-actions">
            <Button disabled={busy !== null} onClick={() => replaceRef.current?.click()}>
              <ImageUp aria-hidden />
              {busy === "Replace" ? "Replacing…" : "Replace file…"}
            </Button>
            <label className="pba-check-row">
              <input className="pba-check" type="checkbox" checked={removeBg} onChange={(event) => setRemoveBackground(event.target.checked)} />
              Remove background from the new file
            </label>
            <p className="pba-hint">Every theme and team using this asset switches to the new file. It keeps its name and links.</p>
            {current.backgroundRemoved ? (
              <Button
                disabled={busy !== null}
                onClick={() => void run("Revert", () => api.revertAsset(current.id), () => "Switched back to the original upload.")}
              >
                <RotateCcw aria-hidden />
                {busy === "Revert" ? "Reverting…" : "Use original upload"}
              </Button>
            ) : null}
            {!current.fileMissing ? (
              <Button
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "Remove background",
                    () => api.reprocessAsset(current.id),
                    (result) =>
                      result.processing.status === "processed"
                        ? "Background removed."
                        : `Background not removed${result.processing.reason ? `: ${result.processing.reason}` : "."}`
                  )
                }
              >
                <Sparkles aria-hidden />
                {busy === "Remove background" ? "Removing background…" : current.backgroundRemoved ? "Remove background again" : "Remove background"}
              </Button>
            ) : null}
          </div>
          )}
          <input
            ref={replaceRef}
            hidden
            type="file"
            accept={ACCEPTED_IMAGES}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void replace(file);
            }}
          />
        </section>
      </div>
    </aside>
  );
}

type CleanupSelection = {
  assetIds: Set<string>;
  originalIds: Set<string>;
  strayFiles: Set<string>;
  brokenRecordIds: Set<string>;
};

function initialSelection(report: AssetCleanupReport): CleanupSelection {
  return {
    assetIds: new Set(report.unusedAssets.filter((item) => !item.recent).map((item) => item.id)),
    originalIds: new Set(report.orphanOriginals.map((item) => item.id)),
    strayFiles: new Set(report.strayFiles.map((item) => item.fileName)),
    brokenRecordIds: new Set(report.brokenRecords.map((item) => item.id))
  };
}

function CleanupPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [report, setReport] = useState<AssetCleanupReport | null>(null);
  const [selection, setSelection] = useState<CleanupSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const next = await api.getAssetCleanupReport();
      setReport(next);
      setSelection(initialSelection(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to scan assets.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggle(group: keyof CleanupSelection, id: string, checked: boolean) {
    setSelection((current) => {
      if (!current) return current;
      const next = new Set(current[group]);
      if (checked) next.add(id);
      else next.delete(id);
      return { ...current, [group]: next };
    });
  }

  const selectedBytes = useMemo(() => {
    if (!report || !selection) return 0;
    return (
      report.unusedAssets.filter((item) => selection.assetIds.has(item.id)).reduce((sum, item) => sum + (item.byteSize ?? 0), 0) +
      report.orphanOriginals.filter((item) => selection.originalIds.has(item.id)).reduce((sum, item) => sum + (item.byteSize ?? 0), 0) +
      report.strayFiles.filter((item) => selection.strayFiles.has(item.fileName)).reduce((sum, item) => sum + item.byteSize, 0)
    );
  }, [report, selection]);

  const selectedCount = selection
    ? selection.assetIds.size + selection.originalIds.size + selection.strayFiles.size + selection.brokenRecordIds.size
    : 0;
  const total = report
    ? report.unusedAssets.length + report.orphanOriginals.length + report.strayFiles.length + report.brokenRecords.length
    : 0;

  async function runCleanup() {
    if (!selection || !selectedCount) return;
    const confirmed = await confirmAction({
      title: `Permanently delete ${plural(selectedCount, "item")}?`,
      message: `This frees ${formatBytes(selectedBytes)} and cannot be undone.`,
      confirmLabel: `Delete ${plural(selectedCount, "item")}`,
      tone: "danger"
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await api.runAssetCleanup({
        assetIds: [...selection.assetIds],
        originalIds: [...selection.originalIds],
        strayFiles: [...selection.strayFiles],
        brokenRecordIds: [...selection.brokenRecordIds]
      });
      showToast({
        kind: "success",
        message: `Removed ${plural(result.deleted, "item")} and freed ${formatBytes(result.freedBytes)}.${
          result.skipped.length ? ` Skipped ${result.skipped.length} that changed since the scan.` : ""
        }`
      });
      onDone();
      await load();
    } catch (runError) {
      showToast({ kind: "error", message: runError instanceof Error ? runError.message : "Cleanup failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="pba-inspector" aria-label="Clean up assets">
      <div className="pba-insp-head">
        <span className="pba-insp-logo">
          <Images aria-hidden />
        </span>
        <div className="pba-insp-title">
          <b>Clean up</b>
          <span>{report ? (total ? `${plural(total, "item")} · ${formatBytes(report.reclaimableBytes)} can be freed` : "Nothing to clean up") : "Scanning…"}</span>
        </div>
        <IconButton label="Close" title="Close (Esc)" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="pba-insp-body">
        {error ? (
          <div className="pba-callout pba-callout--critical">
            <TriangleAlert aria-hidden />
            <span style={{ flex: 1 }}>{error}</span>
            <Button size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
        {report && selection ? (
          total === 0 ? (
            <div className="pba-empty">
              <b>All tidy</b>
              <p className="pba-hint">Every asset is used by a theme or team, and the uploads folder has no leftovers.</p>
            </div>
          ) : (
            <>
              <CleanupGroup
                title="Unused assets"
                hint="Not used by any theme or team. Ones added in the last day are left unticked, in case a theme you are editing is about to use them."
                items={report.unusedAssets.map((item) => ({
                  id: item.id,
                  name: item.name,
                  url: item.url,
                  detail: `${formatBytes(item.byteSize)}${item.recent ? " · added today" : ""}`
                }))}
                selected={selection.assetIds}
                onToggle={(id, checked) => toggle("assetIds", id, checked)}
              />
              <CleanupGroup
                title="Leftover originals"
                hint="Kept from background removal for assets that no longer exist."
                items={report.orphanOriginals.map((item) => ({ id: item.id, name: item.name, url: item.url, detail: formatBytes(item.byteSize) }))}
                selected={selection.originalIds}
                onToggle={(id, checked) => toggle("originalIds", id, checked)}
              />
              <CleanupGroup
                title="Stray files"
                hint="Files in the uploads folder that no asset points to."
                items={report.strayFiles.map((item) => ({ id: item.fileName, name: item.fileName, url: null, detail: formatBytes(item.byteSize) }))}
                selected={selection.strayFiles}
                onToggle={(id, checked) => toggle("strayFiles", id, checked)}
              />
              <CleanupGroup
                title="Broken records"
                hint="Unused assets whose file is gone. Removing them frees no space."
                items={report.brokenRecords.map((item) => ({ id: item.id, name: item.name, url: null, detail: "File missing" }))}
                selected={selection.brokenRecordIds}
                onToggle={(id, checked) => toggle("brokenRecordIds", id, checked)}
              />
            </>
          )
        ) : null}
      </div>

      {report && total > 0 ? (
        <div className="pba-insp-foot">
          <span className="pba-hint">
            {selectedCount ? `${plural(selectedCount, "item")} · ${formatBytes(selectedBytes)}` : "Nothing selected"}
          </span>
          <Button variant="danger" disabled={busy || !selectedCount} onClick={() => void runCleanup()}>
            <Trash2 aria-hidden />
            {busy ? "Deleting…" : "Delete selected"}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function CleanupGroup({
  title,
  hint,
  items,
  selected,
  onToggle
}: {
  title: string;
  hint: string;
  items: Array<{ id: string; name: string; url: string | null; detail: string }>;
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (!items.length) return null;
  const allSelected = items.every((item) => selected.has(item.id));
  return (
    <section className="pba-insp-group">
      <h2>
        <input
          className="pba-check"
          type="checkbox"
          aria-label={`Select all ${title.toLowerCase()}`}
          checked={allSelected}
          ref={(node) => {
            if (node) node.indeterminate = !allSelected && items.some((item) => selected.has(item.id));
          }}
          onChange={(event) => items.forEach((item) => onToggle(item.id, event.target.checked))}
        />
        {title}
        <span className="pba-hint">{items.length}</span>
      </h2>
      <p className="pba-hint" style={{ margin: "-4px 0 10px" }}>
        {hint}
      </p>
      <ul className="pba-cleanup-list">
        {items.map((item) => (
          <li key={item.id}>
            <label>
              <input className="pba-check" type="checkbox" checked={selected.has(item.id)} onChange={(event) => onToggle(item.id, event.target.checked)} />
              <span className="pba-cleanup-thumb pba-checker">{item.url ? <img src={item.url} alt="" loading="lazy" /> : <ImageOff aria-hidden />}</span>
              <span className="pba-cleanup-name" title={item.name}>
                {item.name}
              </span>
              <span className="pba-faint">{item.detail}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
