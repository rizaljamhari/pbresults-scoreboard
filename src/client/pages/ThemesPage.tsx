import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSettings, useThemes } from "../hooks";
import { showToast } from "../toast";
import { filterAndSortThemes, type ThemeKindFilter, type ThemeSort } from "./themeAdminUtils";

export function ThemesPage() {
  const navigate = useNavigate();
  const themes = useThemes();
  const settings = useSettings();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ThemeKindFilter>("all");
  const [sortBy, setSortBy] = useState<ThemeSort>("nameAsc");
  const [compactRows, setCompactRows] = useState(false);

  async function refresh() {
    themes.setData(await api.getThemes());
    settings.setData(await api.getSettings());
  }

  const visibleThemes = useMemo(() => {
    return filterAndSortThemes(themes.data ?? [], search, kindFilter, sortBy);
  }, [themes.data, search, kindFilter, sortBy]);

  async function handleCreate() {
    try {
      const theme = await api.createTheme("builtin-classic-chroma");
      await refresh();
      showToast({ kind: "success", message: "Theme created." });
      navigate(`/admin/themes/${theme.id}`);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to create theme." });
    }
  }

  async function handleClone(id: string) {
    try {
      const theme = await api.createTheme(id);
      await refresh();
      showToast({ kind: "success", message: "Theme cloned." });
      navigate(`/admin/themes/${theme.id}`);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to clone theme." });
    }
  }

  async function handlePublish(id: string) {
    try {
      await api.publishTheme(id);
      await refresh();
      showToast({ kind: "success", message: "Theme published." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to publish theme." });
    }
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = window.confirm(`Delete ${name}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    try {
      await api.deleteTheme(id);
      await refresh();
      showToast({ kind: "success", message: "Theme deleted." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete theme." });
    }
  }

  async function handleExport(id: string) {
    try {
      const payload = await api.exportTheme(id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${payload.theme.name.replace(/\s+/g, "-").toLowerCase()}.theme.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      showToast({ kind: "success", message: "Theme exported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to export theme." });
    }
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      await api.importTheme(payload as Parameters<typeof api.importTheme>[0]);
      await refresh();
      showToast({ kind: "success", message: "Theme imported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to import theme." });
    }
  }

  return (
    <section className="admin-page panel-stack">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">Theme Library</p>
          <h2>Overview and publishing</h2>
          <p className="hint">Manage built-in and custom themes with clear publish and lifecycle actions.</p>
        </div>
        <div className="action-row">
          <label className="secondary-button">
            Import theme
            <input
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
          </label>
          <button onClick={() => void handleCreate()}>Create Theme</button>
        </div>
      </header>

      <div className="panel">
        <div className="table-toolbar">
          <label>
            Search themes
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, description, or id"
            />
          </label>
          <label>
            Kind
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as ThemeKindFilter)}>
              <option value="all">All</option>
              <option value="builtin">Built-in</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Sort
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ThemeSort)}>
              <option value="nameAsc">Name (A-Z)</option>
              <option value="nameDesc">Name (Z-A)</option>
            </select>
          </label>
          <label className="checkbox table-compact-toggle">
            <input type="checkbox" checked={compactRows} onChange={(event) => setCompactRows(event.target.checked)} />
            Compact rows
          </label>
        </div>

        <div className="table-shell">
          <table className={compactRows ? "data-table data-table--compact" : "data-table"}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Description</th>
                <th>Canvas</th>
                <th>Status</th>
                <th className="align-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleThemes.length ? (
                visibleThemes.map((theme) => (
                  <tr key={theme.id}>
                    <td>
                      <strong>{theme.name}</strong>
                    </td>
                    <td>
                      <span className={theme.builtin ? "status-pill" : "status-pill status-pill--ok"}>
                        {theme.builtin ? "Built-in" : "Custom"}
                      </span>
                    </td>
                    <td>{theme.description || "—"}</td>
                    <td>
                      {theme.canvas.width}x{theme.canvas.height}
                    </td>
                    <td>
                      {settings.data?.publishedThemeId === theme.id ? <span className="status-badge">Published</span> : "—"}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="secondary-button" onClick={() => navigate(`/admin/themes/${theme.id}`)}>
                          Edit
                        </button>
                        <button onClick={() => void handlePublish(theme.id)}>Publish</button>
                        <details className="row-action-menu">
                          <summary className="secondary-button">More</summary>
                          <div className="row-action-menu-list">
                            <button className="secondary-button" onClick={() => void handleClone(theme.id)}>
                              Clone
                            </button>
                            <button className="secondary-button" onClick={() => void handleExport(theme.id)}>
                              Export
                            </button>
                            {!theme.builtin ? (
                              <button className="danger-button" onClick={() => void handleDelete(theme.id, theme.name)}>
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="table-empty">
                    {(themes.data ?? []).length ? "No themes match the current filters." : "No themes found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

