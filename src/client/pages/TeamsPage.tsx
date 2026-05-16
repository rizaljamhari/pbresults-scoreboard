import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useLiveState, useSettings, useTeams } from "../hooks";
import { showToast } from "../toast";
import { filterAndSortTeams, formatUpdatedAt, type TeamSort, type TeamStatusFilter } from "./teamAdminUtils";

export function TeamsPage() {
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

  const filteredTeams = useMemo(() => {
    return filterAndSortTeams(teams.data ?? [], search, statusFilter, sortBy);
  }, [search, sortBy, statusFilter, teams.data]);

  if (teams.loading && !teams.data) {
    return <section className="panel">Loading teams…</section>;
  }

  return (
    <section className="admin-page panel-stack">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">Team Registry</p>
          <h2>Overview and CRUD</h2>
          <p className="hint">Review all teams in one table. Open a team to edit profile, aliases, and logos.</p>
        </div>
        <div className="action-row compact">
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
        <div className="table-shell">
          <table className={compactRows ? "data-table data-table--compact" : "data-table"}>
            <thead>
              <tr>
                <th>Team Name</th>
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
                    <td>
                      <strong>{team.canonicalName}</strong>
                    </td>
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
                  <td colSpan={6} className="table-empty">
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
              </div>
              <div>
                <strong>Right slot match</strong>
                <span>{live.data.displayRightTeamMatch.status}</span>
                <span>{live.data.displayRightTeamMatch.team?.canonicalName ?? (live.data.displayRightTeam.name || "Unknown")}</span>
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
