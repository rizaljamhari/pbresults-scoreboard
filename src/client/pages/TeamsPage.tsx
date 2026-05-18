import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAutoCloseRowActionMenus, useLiveState, useSettings, useTeams } from "../hooks";
import { showToast } from "../toast";
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
    return <section className="panel">Loading teams…</section>;
  }

  return (
    <section className="admin-page panel-stack">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">Team Registry</p>
          <h2>Overview</h2>
          <p className="hint">Review all teams in one table. Open a team to edit profile, aliases, and logos.</p>
        </div>
        <div className="action-row compact">
          <button className="secondary-button" onClick={() => void handleExportTeams()}>
            Export Teams
          </button>
          <label className="secondary-button">
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
          <button onClick={() => void handleCreate()}>Create Team</button>
        </div>
      </header>

      <div className="panel">
        <div className="table-toolbar">
          <label>
            Search teams
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by canonical name, short name, or alias"
            />
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TeamStatusFilter)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            Sort
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as TeamSort)}>
              <option value="nameAsc">Name (A-Z)</option>
              <option value="nameDesc">Name (Z-A)</option>
              <option value="updatedDesc">Updated (Newest)</option>
              <option value="updatedAsc">Updated (Oldest)</option>
            </select>
          </label>
          <label className="checkbox table-compact-toggle">
            <input type="checkbox" checked={compactRows} onChange={(event) => setCompactRows(event.target.checked)} />
            Compact rows
          </label>
        </div>
        <div className="table-bulk-bar">
          <div className="table-bulk-summary">
            <strong>{selectedCount}</strong>
            <span>{selectedCount === 1 ? "team selected" : "teams selected"}</span>
          </div>
          <div className="action-row compact">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={!selectedCount || bulkBusy}
            >
              Clear selection
            </button>
            <details className="row-action-menu">
              <summary className="secondary-button">{bulkBusy ? "Working…" : "Bulk actions"}</summary>
              <div className="row-action-menu-list">
                <button className="secondary-button" type="button" onClick={() => void handleBulkSetActive(true)} disabled={!selectedCount || bulkBusy}>
                  Activate selected
                </button>
                <button className="secondary-button" type="button" onClick={() => void handleBulkSetActive(false)} disabled={!selectedCount || bulkBusy}>
                  Deactivate selected
                </button>
                <button className="danger-button" type="button" onClick={() => void handleBulkDelete()} disabled={!selectedCount || bulkBusy}>
                  Delete selected
                </button>
              </div>
            </details>
          </div>
        </div>
        <div className="table-shell">
          <table className={compactRows ? "data-table data-table--compact" : "data-table"}>
            <thead>
              <tr>
                <th className="table-select-cell">
                  <label className="checkbox table-select-all">
                    <input
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
                </th>
                <th>Team Name</th>
                <th>Display Name</th>
                <th>Short Name</th>
                <th>Aliases</th>
                <th>Status</th>
                <th>Updated</th>
                <th className="align-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.length ? (
                filteredTeams.map((team) => (
                  <tr key={team.id}>
                    <td className="table-select-cell">
                      <label className="checkbox table-row-select">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(team.id)}
                          onChange={(event) => toggleTeamSelection(team.id, event.target.checked)}
                        />
                      </label>
                    </td>
                    <td>
                      <strong>{team.canonicalName}</strong>
                    </td>
                    <td>{team.scoreboardDisplayName || "—"}</td>
                    <td>{team.shortName || "—"}</td>
                    <td>{team.aliases.length}</td>
                    <td>
                      <span className={team.active ? "status-pill status-pill--ok" : "status-pill"}>{team.active ? "Active" : "Inactive"}</span>
                    </td>
                    <td>{formatUpdatedAt(team.updatedAt)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="secondary-button" onClick={() => navigate(`/admin/teams/${team.id}`)}>
                          Edit
                        </button>
                        <button className="danger-button" onClick={() => void handleDelete(team.id, team.canonicalName)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="table-empty">
                    {(teams.data ?? []).length
                      ? "No teams match the current filters."
                      : "No teams yet. Create one to start building your team registry."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-grid-2">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Match Tester</p>
              <h3>Resolve incoming name</h3>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Input name
              <input value={testerInput} onChange={(event) => setTesterInput(event.target.value)} placeholder="e.g. SBJ or Seattle Uprising" />
            </label>
            <div className="action-row compact">
              <button className="secondary-button" onClick={() => void handleMatchTest()} disabled={!testerInput.trim()}>
                Test match
              </button>
            </div>
          </div>
          {testerResult ? (
            <div className="match-result-card">
              <strong>
                {testerResult.status} {testerResult.team ? `· ${testerResult.team.canonicalName}` : ""}
              </strong>
              <span>Normalized: {testerResult.normalizedInput || "n/a"}</span>
              <span>Matched words: {testerResult.matchedAlias ?? (testerResult.normalizedInput || "n/a")}</span>
              <span>Confidence: {(testerResult.confidence * 100).toFixed(1)}%</span>
              {testerResult.matchedAlias ? <span>Matched alias: {testerResult.matchedAlias}</span> : null}
              {testerResult.candidates.length ? (
                <div className="team-candidate-list">
                  {testerResult.candidates.map((candidate) => (
                    <span key={`${candidate.teamId}:${candidate.matchedAlias ?? "candidate"}`}>
                      {candidate.teamName} · {(candidate.confidence * 100).toFixed(1)}%{candidate.matchedAlias ? ` · ${candidate.matchedAlias}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live Feed</p>
              <h3>Current team resolution status</h3>
            </div>
          </div>
          {live.data ? (
            <div className="stats-grid">
              <div>
                <strong>Left slot match</strong>
                <span>{live.data.displayLeftTeamMatch.status}</span>
                <span>{live.data.displayLeftTeamMatch.team?.canonicalName ?? (live.data.displayLeftTeam.name || "Unknown")}</span>
                <span>Matched words: {live.data.displayLeftTeamMatch.matchedAlias ?? "—"}</span>
              </div>
              <div>
                <strong>Right slot match</strong>
                <span>{live.data.displayRightTeamMatch.status}</span>
                <span>{live.data.displayRightTeamMatch.team?.canonicalName ?? (live.data.displayRightTeam.name || "Unknown")}</span>
                <span>Matched words: {live.data.displayRightTeamMatch.matchedAlias ?? "—"}</span>
              </div>
              <div>
                <strong>Unresolved</strong>
                <span>{live.data.unresolvedTeamNames.length ? live.data.unresolvedTeamNames.join(", ") : "None"}</span>
              </div>
              <div>
                <strong>Displayed teams</strong>
                <span>
                  {live.data.displayLeftTeam.name} vs {live.data.displayRightTeam.name}
                </span>
              </div>
            </div>
          ) : (
            <p className="hint">{live.error ?? "Waiting for live data…"}</p>
          )}
        </div>
      </div>
    </section>
  );
}
