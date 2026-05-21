import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAutoCloseRowActionMenus, useLiveState, useSettings, useTeams } from "../hooks";
import { showToast } from "../toast";
import {
  AdminFilterBar,
  AdminPageFrame,
  AdminPageHeader,
  Badge,
  Button,
  Card,
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
import { filterAndSortTeams, formatUpdatedAt, type TeamSort, type TeamStatusFilter } from "./teamAdminUtils";

export function TeamsPage() {
  useAutoCloseRowActionMenus();
  const navigate = useNavigate();
  const teams = useTeams();
  const settings = useSettings();
  const live = useLiveState(true, settings.data?.pollIntervalMs);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>("all");
  const [sortBy, setSortBy] = useState<TeamSort>("nameAsc");
  const [compactRows, setCompactRows] = useState(false);
  const [testerInput, setTesterInput] = useState("");
  const [testerResult, setTesterResult] = useState<Awaited<ReturnType<typeof api.matchTeam>> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function handleCreate() {
    try {
      const created = await api.createTeam();
      teams.setData([...(teams.data ?? []), created].sort((left, right) => left.canonicalName.localeCompare(right.canonicalName)));
      showToast({ kind: "success", message: "Team created." });
      navigate(`/admin/teams/${created.id}`);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to create team." });
    }
  }

  async function handleDelete(id: string, canonicalName: string) {
    const confirmed = window.confirm(`Delete ${canonicalName}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    try {
      await api.deleteTeam(id);
      teams.setData((teams.data ?? []).filter((team) => team.id !== id));
      showToast({ kind: "success", message: `Deleted ${canonicalName}.` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete team." });
    }
  }

  async function handleMatchTest() {
    try {
      const result = await api.matchTeam(testerInput);
      setTesterResult(result);
      showToast({ kind: "info", message: `Match status: ${result.status}.`, durationMs: 1800 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to run match test." });
    }
  }

  async function handleExportTeams() {
    try {
      const payload = await api.exportTeams();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `pbresults-teams-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      showToast({ kind: "success", message: "Team registry exported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to export teams." });
    }
  }

  async function handleImportTeams(file: File) {
    try {
      const text = await file.text();
      const restored = await api.importTeams(JSON.parse(text));
      teams.setData(restored);
      showToast({ kind: "success", message: "Team registry imported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to import teams." });
    }
  }

  const filteredTeams = useMemo(() => {
    return filterAndSortTeams(teams.data ?? [], search, statusFilter, sortBy);
  }, [search, sortBy, statusFilter, teams.data]);

  useEffect(() => {
    const validIds = new Set((teams.data ?? []).map((team) => team.id));
    setSelectedIds((current) => current.filter((id) => validIds.has(id)));
  }, [teams.data]);

  const selectedCount = selectedIds.length;
  const filteredIds = filteredTeams.map((team) => team.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIds.includes(id));

  function toggleTeamSelection(teamId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(teamId) ? current : [...current, teamId];
      }
      return current.filter((id) => id !== teamId);
    });
  }

  function toggleSelectAllFiltered(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...filteredIds]));
      }
      const filteredSet = new Set(filteredIds);
      return current.filter((id) => !filteredSet.has(id));
    });
  }

  async function handleBulkSetActive(active: boolean) {
    const selectedTeams = (teams.data ?? []).filter((team) => selectedIds.includes(team.id));
    if (!selectedTeams.length) {
      return;
    }
    setBulkBusy(true);
    try {
      const updated = await Promise.all(
        selectedTeams.map((team) =>
          api.saveTeam({
            ...team,
            active,
            updatedAt: team.updatedAt
          })
        )
      );
      const updatedMap = new Map(updated.map((team) => [team.id, team]));
      teams.setData((teams.data ?? []).map((team) => updatedMap.get(team.id) ?? team));
      showToast({
        kind: "success",
        message: `${selectedTeams.length} team${selectedTeams.length === 1 ? "" : "s"} ${active ? "activated" : "deactivated"}.`
      });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to update selected teams." });
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkDelete() {
    const selectedTeams = (teams.data ?? []).filter((team) => selectedIds.includes(team.id));
    if (!selectedTeams.length) {
      return;
    }
    const confirmed = window.confirm(`Delete ${selectedTeams.length} selected team${selectedTeams.length === 1 ? "" : "s"}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    setBulkBusy(true);
    try {
      await Promise.all(selectedTeams.map((team) => api.deleteTeam(team.id)));
      const selectedSet = new Set(selectedIds);
      teams.setData((teams.data ?? []).filter((team) => !selectedSet.has(team.id)));
      setSelectedIds([]);
      showToast({ kind: "success", message: `${selectedTeams.length} team${selectedTeams.length === 1 ? "" : "s"} deleted.` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete selected teams." });
    } finally {
      setBulkBusy(false);
    }
  }

  if (teams.loading && !teams.data) {
    return (
      <Card>
        <FieldHint>Loading teams…</FieldHint>
      </Card>
    );
  }

  return (
    <AdminPageFrame className="panel-stack">
      <AdminPageHeader
        eyebrow="Team Registry"
        title="Overview"
        description="Review all teams in one table. Open a team to edit profile, aliases, and logos."
        actions={(
          <div className="action-row compact">
            <Button variant="secondary" onClick={() => void handleExportTeams()}>
              Export Teams
            </Button>
            <label className={buttonVariants({ variant: "secondary" })}>
              Import Teams
              <input
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleImportTeams(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <Button onClick={() => void handleCreate()}>Create Team</Button>
          </div>
        )}
      />

      <Card>
        <AdminFilterBar className="mb-3.5">
          <label>
            Search teams
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by canonical name, short name, or alias"
            />
          </label>
          <label>
            Status
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TeamStatusFilter)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </label>
          <label>
            Sort
            <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as TeamSort)}>
              <option value="nameAsc">Name (A-Z)</option>
              <option value="nameDesc">Name (Z-A)</option>
              <option value="updatedDesc">Updated (Newest)</option>
              <option value="updatedAsc">Updated (Oldest)</option>
            </Select>
          </label>
          <label className="checkbox justify-self-end whitespace-nowrap pb-1 max-[1200px]:justify-self-start">
            <Checkbox checked={compactRows} onChange={(event) => setCompactRows(event.target.checked)} />
            Compact rows
          </label>
        </AdminFilterBar>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <strong className="text-base text-md3-onBackground">{selectedCount}</strong>
            <span className="text-md3-onSurfaceVariant">{selectedCount === 1 ? "team selected" : "teams selected"}</span>
          </div>
          <div className="action-row compact">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={!selectedCount || bulkBusy}
            >
              Clear selection
            </Button>
            <details className="row-action-menu">
              <summary className={buttonVariants({ variant: "secondary" })}>{bulkBusy ? "Working…" : "Bulk actions"}</summary>
              <div className="row-action-menu-list">
                <Button variant="secondary" type="button" onClick={() => void handleBulkSetActive(true)} disabled={!selectedCount || bulkBusy}>
                  Activate selected
                </Button>
                <Button variant="secondary" type="button" onClick={() => void handleBulkSetActive(false)} disabled={!selectedCount || bulkBusy}>
                  Deactivate selected
                </Button>
                <Button variant="danger" type="button" onClick={() => void handleBulkDelete()} disabled={!selectedCount || bulkBusy}>
                  Delete selected
                </Button>
              </div>
            </details>
          </div>
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
                <TableHead className="w-14 text-center">
                  <label className="checkbox m-0 inline-flex w-full justify-center">
                    <Checkbox
                      type="checkbox"
                      checked={allFilteredSelected}
                      ref={(node) => {
                        if (node) {
                          node.indeterminate = !allFilteredSelected && someFilteredSelected;
                        }
                      }}
                      onChange={(event) => toggleSelectAllFiltered(event.target.checked)}
                    />
                  </label>
                </TableHead>
                <TableHead>Team Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Short Name</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTeams.length ? (
                filteredTeams.map((team) => (
                  <TableRow key={team.id}>
                    <TableCell className="w-14 text-center">
                      <label className="checkbox m-0 inline-flex w-full justify-center">
                        <Checkbox
                          type="checkbox"
                          checked={selectedIds.includes(team.id)}
                          onChange={(event) => toggleTeamSelection(team.id, event.target.checked)}
                        />
                      </label>
                    </TableCell>
                    <TableCell>
                      <strong>{team.canonicalName}</strong>
                    </TableCell>
                    <TableCell>{team.scoreboardDisplayName || "—"}</TableCell>
                    <TableCell>{team.shortName || "—"}</TableCell>
                    <TableCell>{team.aliases.length}</TableCell>
                    <TableCell>
                      <Badge variant={team.active ? "success" : "default"}>{team.active ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>{formatUpdatedAt(team.updatedAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" onClick={() => navigate(`/admin/teams/${team.id}`)}>
                          Edit
                        </Button>
                        <Button variant="danger" onClick={() => void handleDelete(team.id, team.canonicalName)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableEmpty colSpan={8}>
                    {(teams.data ?? []).length
                      ? "No teams match the current filters."
                      : "No teams yet. Create one to start building your team registry."}
                  </TableEmpty>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableShell>
      </Card>

      <div className="grid grid-cols-2 items-start gap-4 max-[1200px]:grid-cols-1">
        <Card>
          <div className="panel-header">
            <div>
              <p className="eyebrow">Match Tester</p>
              <h3>Resolve incoming name</h3>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Input name
              <Input value={testerInput} onChange={(event) => setTesterInput(event.target.value)} placeholder="e.g. SBJ or Seattle Uprising" />
            </label>
            <div className="action-row compact">
              <Button variant="secondary" onClick={() => void handleMatchTest()} disabled={!testerInput.trim()}>
                Test match
              </Button>
            </div>
          </div>
          {testerResult ? (
            <div className="grid gap-3 rounded-md3m border border-md3-outlineVariant bg-md3-surfaceContainer px-4 py-4">
              <strong>
                {testerResult.status} {testerResult.team ? `· ${testerResult.team.canonicalName}` : ""}
              </strong>
              <span className="text-md3-onSurfaceVariant">Normalized: {testerResult.normalizedInput || "n/a"}</span>
              <span className="text-md3-onSurfaceVariant">Matched words: {testerResult.matchedAlias ?? (testerResult.normalizedInput || "n/a")}</span>
              <span className="text-md3-onSurfaceVariant">Confidence: {(testerResult.confidence * 100).toFixed(1)}%</span>
              {testerResult.matchedAlias ? <span className="text-md3-onSurfaceVariant">Matched alias: {testerResult.matchedAlias}</span> : null}
              {testerResult.candidates.length ? (
                <div className="grid gap-2 rounded-md3m border border-md3-outlineVariant bg-md3-surface px-4 py-3">
                  {testerResult.candidates.map((candidate) => (
                    <span key={`${candidate.teamId}:${candidate.matchedAlias ?? "candidate"}`} className="text-md3-onSurfaceVariant">
                      {candidate.teamName} · {(candidate.confidence * 100).toFixed(1)}%{candidate.matchedAlias ? ` · ${candidate.matchedAlias}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>
    </AdminPageFrame>
  );
}
