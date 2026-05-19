import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAutoCloseRowActionMenus, useSettings, useThemes } from "../hooks";
import { showToast } from "../toast";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  FieldHint,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableShell,
  buttonVariants
} from "../components/ui";
import { filterAndSortThemes, type ThemeKindFilter, type ThemeSort } from "./themeAdminUtils";

export function ThemesPage() {
  useAutoCloseRowActionMenus();
  const preferredBuiltinThemeId = "theme-7ad8adb8-e017-4853-93b1-fb608a750253";
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
      const theme = await api.createTheme(preferredBuiltinThemeId);
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
      <header className="flex items-start justify-between gap-4 py-1 max-[1200px]:flex-col">
        <div>
          <p className="eyebrow">Theme Library</p>
          <h2>Overview and publishing</h2>
          <FieldHint>Manage built-in and custom themes with clear publish and lifecycle actions.</FieldHint>
        </div>
        <div className="action-row">
          <label className={buttonVariants({ variant: "secondary" })}>
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
          <Button onClick={() => void handleCreate()}>Create Theme</Button>
        </div>
      </header>

      <Card>
        <div className="mb-3.5 grid grid-cols-[minmax(240px,2fr)_minmax(140px,1fr)_minmax(140px,1fr)_auto] items-end gap-3.5 max-[1200px]:grid-cols-1 max-[1200px]:items-stretch">
          <label>
            Search themes
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, description, or id"
            />
          </label>
          <label>
            Kind
            <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as ThemeKindFilter)}>
              <option value="all">All</option>
              <option value="builtin">Built-in</option>
              <option value="custom">Custom</option>
            </Select>
          </label>
          <label>
            Sort
            <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as ThemeSort)}>
              <option value="nameAsc">Name (A-Z)</option>
              <option value="nameDesc">Name (Z-A)</option>
            </Select>
          </label>
          <label className="checkbox justify-self-end whitespace-nowrap pb-1 max-[1200px]:justify-self-start">
            <Checkbox checked={compactRows} onChange={(event) => setCompactRows(event.target.checked)} />
            Compact rows
          </label>
        </div>

        <TableShell>
          <Table
            className={
              compactRows
                ? "max-[1200px]:min-w-[780px] [&_td]:px-2.5 [&_td]:py-2 [&_th]:px-2.5 [&_th]:py-2"
                : "max-[1200px]:min-w-[780px]"
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Canvas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleThemes.length ? (
                visibleThemes.map((theme) => (
                  <TableRow key={theme.id}>
                    <TableCell>
                      <strong>{theme.name}</strong>
                    </TableCell>
                    <TableCell>
                      <Badge variant={theme.builtin ? "default" : "success"}>
                        {theme.builtin ? "Built-in" : "Custom"}
                      </Badge>
                    </TableCell>
                    <TableCell>{theme.description || "—"}</TableCell>
                    <TableCell>
                      {theme.canvas.width}x{theme.canvas.height}
                    </TableCell>
                    <TableCell>
                      {settings.data?.publishedThemeId === theme.id ? <Badge variant="success">Published</Badge> : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" onClick={() => navigate(`/admin/themes/${theme.id}`)}>
                          Edit
                        </Button>
                        <Button onClick={() => void handlePublish(theme.id)}>Publish</Button>
                        <details className="row-action-menu">
                          <summary className={buttonVariants({ variant: "secondary" })}>More</summary>
                          <div className="row-action-menu-list">
                            <Button variant="secondary" onClick={() => void handleClone(theme.id)}>
                              Clone
                            </Button>
                            <Button variant="secondary" onClick={() => void handleExport(theme.id)}>
                              Export
                            </Button>
                            {!theme.builtin ? (
                              <Button variant="danger" onClick={() => void handleDelete(theme.id, theme.name)}>
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableEmpty colSpan={6}>
                    {(themes.data ?? []).length ? "No themes match the current filters." : "No themes found."}
                  </TableEmpty>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableShell>
      </Card>
    </section>
  );
}
