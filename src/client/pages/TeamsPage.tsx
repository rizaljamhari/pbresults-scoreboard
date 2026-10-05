import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, CheckCheck, CircleSlash, Download, Ellipsis, FlaskConical, Plus, Trash2, Upload, X } from "lucide-react";
import { api } from "../api";
import { useAssets, useLiveState, useTeams } from "../hooks";
import { showToast } from "../toast";
import type { TeamRecord } from "../../shared/theme";
import { Button, Chip, Grow, IconButton, Menu, SearchField, Segmented, Toolbar, downloadJson, useSlashFocus } from "../components/admin/kit";
import { TeamPanel, type TeamPanelActions } from "./TeamPanel";
import { useLeaveGuard } from "../components/UnsavedChangesGuard";
import { filterAndSortTeams, formatUpdatedAt, formatUpdatedAtFull, type TeamSort, type TeamStatusFilter } from "./teamAdminUtils";
import { confirmAction } from "../confirm";

type MatchResult = Awaited<ReturnType<typeof api.matchTeam>>;

function MatchTester() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!input.trim()) return;
    setBusy(true);
    try {
      setResult(await api.matchTeam(input));
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to test the name." });
    } finally {
      setBusy(false);
    }
  }

  const tone = result?.status === "matched" ? "ok" : result?.status === "uncertain" ? "warning" : "critical";
  const statusLabel = result?.status === "matched" ? "Matched" : result?.status === "uncertain" ? "Not sure" : "No match";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost">
          <FlaskConical aria-hidden />
          Test a name
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ad-scope ad-pop ad-tester" align="end" sideOffset={6}>
          <form
            className="ad-tester-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <input
              className="ad-input"
              autoFocus
              placeholder="A name the feed might send, e.g. SBJ"
              aria-label="Name to test"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <Button type="submit" disabled={!input.trim() || busy}>
              Test
            </Button>
          </form>
          {result ? (
            <div className="ad-tester-result">
              <div className="ad-tester-line">
                <Chip tone={tone}>{statusLabel}</Chip>
                <b>{result.team?.canonicalName ?? "No team"}</b>
                <span className="ad-hint" style={{ marginLeft: "auto" }}>
                  {(result.confidence * 100).toFixed(0)}% sure
                </span>
              </div>
              <p className="ad-hint">
                Read as “{result.normalizedInput || "—"}”{result.matchedAlias ? ` · matched “${result.matchedAlias}”` : ""}
              </p>
              {result.candidates.length ? (
                <ul className="ad-tester-candidates">
                  {result.candidates.map((candidate) => (
                    <li key={`${candidate.teamId}:${candidate.matchedAlias ?? "candidate"}`}>
                      <span>{candidate.teamName}</span>
                      <span className="ad-hint">
                        {(candidate.confidence * 100).toFixed(0)}%{candidate.matchedAlias ? ` · ${candidate.matchedAlias}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="ad-hint" style={{ marginTop: 8 }}>
              Shows which team the feed name would pick, and how sure the matcher is.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SortHeader({
  label,
  asc,
  desc,
  sortBy,
  onSort,
  className
}: {
  label: string;
  asc: TeamSort;
  desc: TeamSort;
  sortBy: TeamSort;
  onSort: (sort: TeamSort) => void;
  className?: string;
}) {
  const active = sortBy === asc || sortBy === desc;
  return (
    <th className={className} aria-sort={sortBy === asc ? "ascending" : sortBy === desc ? "descending" : "none"}>
      <button type="button" className="ad-th-sort" onClick={() => onSort(sortBy === asc ? desc : asc)}>
        {label}
        {active ? sortBy === asc ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden /> : null}
      </button>
    </th>
  );
}

export function TeamsPage() {
  const navigate = useNavigate();
  const { id: openTeamId } = useParams<{ id: string }>();
  const teams = useTeams();
  const assets = useAssets();
  const live = useLiveState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>("all");
  const [sortBy, setSortBy] = useState<TeamSort>("nameAsc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const allTeams = teams.data ?? [];
  const filteredTeams = useMemo(() => filterAndSortTeams(allTeams, search, statusFilter, sortBy), [allTeams, search, statusFilter, sortBy]);
  const activeCount = allTeams.filter((team) => team.active).length;
  const assetUrl = useMemo(() => new Map((assets.data ?? []).map((asset) => [asset.id, asset.url])), [assets.data]);

  const leftTeamId = live.data?.displayLeftTeamMatch.teamId ?? null;
  const rightTeamId = live.data?.displayRightTeamMatch.teamId ?? null;
  const onAirSide = openTeamId === leftTeamId ? "left" : openTeamId === rightTeamId ? "right" : null;

  useEffect(() => {
    const validIds = new Set(allTeams.map((team) => team.id));
    setSelectedIds((current) => current.filter((id) => validIds.has(id)));
  }, [teams.data]);

  // A deep link or a new team opens the panel; bring its row into view so the list still shows where you are.
  useEffect(() => {
    if (!openTeamId || !teams.data) return;
    document.querySelector(`tr[data-team-id="${CSS.escape(openTeamId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [openTeamId, Boolean(teams.data)]);

  const panelActionsRef = useRef<TeamPanelActions | null>(null);
  const leaveGuard = useLeaveGuard({
    dirty: panelDirty,
    saving: false,
    onSave: () => panelActionsRef.current?.save() ?? Promise.resolve(false),
    onDiscard: () => panelActionsRef.current?.discard()
  });

  function openTeam(id: string | null) {
    if (id === (openTeamId ?? null)) return;
    leaveGuard.confirmLeave(() => navigate(id ? `/admin/teams/${id}` : "/admin/teams"));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !openTeamId) return;
      if ((event.target as HTMLElement | null)?.closest("[data-radix-popper-content-wrapper], input, textarea, dialog")) return;
      openTeam(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openTeamId, panelDirty]);

  function handleCreate() {
    leaveGuard.confirmLeave(() => void createTeam());
  }

  async function createTeam() {
    try {
      const created = await api.createTeam();
      teams.setData([...allTeams, created].sort((left, right) => left.canonicalName.localeCompare(right.canonicalName)));
      showToast({ kind: "success", message: "Team created." });
      setPanelDirty(false);
      navigate(`/admin/teams/${created.id}`);
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to create the team." });
    }
  }

  async function handleExport() {
    try {
      downloadJson(await api.exportTeams(), `pbresults-teams-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
      showToast({ kind: "success", message: "Teams exported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to export teams." });
    }
  }

  async function handleImport(file: File) {
    const confirmed = await confirmAction({
      title: `Import teams from “${file.name}”?`,
      message: "New teams are added. Teams with the same reference are replaced by the ones in the file.",
      confirmLabel: "Import teams"
    });
    if (!confirmed) return;
    try {
      teams.setData(await api.importTeams(JSON.parse(await file.text())));
      showToast({ kind: "success", message: "Teams imported." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to import teams." });
    }
  }

  const filteredIds = filteredTeams.map((team) => team.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIds.includes(id));

  function toggleOne(teamId: string, checked: boolean) {
    setSelectedIds((current) => (checked ? (current.includes(teamId) ? current : [...current, teamId]) : current.filter((id) => id !== teamId)));
  }

  function toggleAllFiltered(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, ...filteredIds]));
      const filteredSet = new Set(filteredIds);
      return current.filter((id) => !filteredSet.has(id));
    });
  }

  async function bulkSetActive(active: boolean) {
    const selected = allTeams.filter((team) => selectedIds.includes(team.id));
    if (!selected.length) return;
    setBulkBusy(true);
    try {
      const updated = await Promise.all(selected.map((team) => api.saveTeam({ ...team, active, updatedAt: team.updatedAt })));
      const updatedMap = new Map(updated.map((team) => [team.id, team]));
      teams.setData(allTeams.map((team) => updatedMap.get(team.id) ?? team));
      showToast({ kind: "success", message: `${selected.length} team${selected.length === 1 ? "" : "s"} ${active ? "turned on" : "turned off"} for live matching.` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to update the selected teams." });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    const selected = allTeams.filter((team) => selectedIds.includes(team.id));
    if (!selected.length) return;
    const confirmed = await confirmAction({
      title: `Delete ${selected.length} selected team${selected.length === 1 ? "" : "s"}?`,
      message: "This cannot be undone.",
      confirmLabel: selected.length === 1 ? "Delete team" : `Delete ${selected.length} teams`,
      tone: "danger"
    });
    if (!confirmed) return;
    setBulkBusy(true);
    try {
      await Promise.all(selected.map((team) => api.deleteTeam(team.id)));
      const selectedSet = new Set(selectedIds);
      teams.setData(allTeams.filter((team) => !selectedSet.has(team.id)));
      if (openTeamId && selectedSet.has(openTeamId)) {
        setPanelDirty(false);
        navigate("/admin/teams");
      }
      setSelectedIds([]);
      showToast({ kind: "success", message: `${selected.length} team${selected.length === 1 ? "" : "s"} deleted.` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete the selected teams." });
    } finally {
      setBulkBusy(false);
    }
  }

  function logoFor(team: TeamRecord) {
    return team.logoAssetId ? assetUrl.get(team.logoAssetId) : undefined;
  }

  return (
    <div className="ad-page ad-scope">
      <Toolbar title="Teams" count={teams.data ? allTeams.length : undefined}>
        <SearchField
          ref={searchRef}
          label="Search teams"
          placeholder="Search teams and match names"
          shortcut="/"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Segmented
          label="Live matching"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active", count: activeCount, title: "Used in live matching" },
            { value: "inactive", label: "Inactive", count: allTeams.length - activeCount, title: "Skipped by live matching" }
          ]}
        />
        {selectedIds.length ? (
          <>
            <span className="ad-tb-sep" />
            <Chip tone="blue">{selectedIds.length} selected</Chip>
            <Menu
              align="start"
              trigger={
                <Button size="sm" disabled={bulkBusy}>
                  {bulkBusy ? "Working…" : "Actions"}
                </Button>
              }
              items={[
                { label: "Use in live matching", icon: <CheckCheck />, onSelect: () => void bulkSetActive(true) },
                { label: "Skip in live matching", icon: <CircleSlash />, onSelect: () => void bulkSetActive(false) },
                { kind: "separator" },
                { label: "Delete…", icon: <Trash2 />, danger: true, onSelect: () => void bulkDelete() }
              ]}
            />
            <IconButton label="Clear selection" onClick={() => setSelectedIds([])}>
              <X />
            </IconButton>
          </>
        ) : null}
        <Grow />
        <MatchTester />
        <Menu
          trigger={
            <IconButton label="Import or export teams">
              <Ellipsis />
            </IconButton>
          }
          items={[
            { label: "Export teams", icon: <Download />, onSelect: () => void handleExport() },
            { label: "Import teams…", icon: <Upload />, onSelect: () => importRef.current?.click() }
          ]}
        />
        <input
          ref={importRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
            event.currentTarget.value = "";
          }}
        />
        <Button variant="primary" onClick={handleCreate}>
          <Plus aria-hidden />
          New team
        </Button>
      </Toolbar>

      <div className={openTeamId ? "ad-split has-panel" : "ad-split"}>
        <div className="ad-table-wrap">
          {!teams.data ? (
            <p className="ad-hint" style={{ padding: 20 }}>
              Loading teams…
            </p>
          ) : filteredTeams.length === 0 ? (
            <div className="ad-empty">
              <b>{allTeams.length ? "No teams match" : "No teams yet"}</b>
              <p className="ad-hint">
                {allTeams.length ? "Try another name, or show all teams." : "Add every team the feed may send, with its logo and the names it goes by."}
              </p>
              {allTeams.length ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={handleCreate}>
                  <Plus aria-hidden />
                  New team
                </Button>
              )}
            </div>
          ) : (
            <table className="ad-table">
              <thead>
                <tr>
                  <th className="ad-col-check">
                    <input
                      className="ad-check"
                      type="checkbox"
                      aria-label="Select all shown teams"
                      checked={allFilteredSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = !allFilteredSelected && someFilteredSelected;
                      }}
                      onChange={(event) => toggleAllFiltered(event.target.checked)}
                    />
                  </th>
                  <SortHeader label="Team" asc="nameAsc" desc="nameDesc" sortBy={sortBy} onSort={setSortBy} />
                  <th className="ad-col-2nd">Scoreboard name</th>
                  <th>Short</th>
                  <th className="ad-num" title="Names you added plus names learned from live">
                    Match names
                  </th>
                  <th>Status</th>
                  <SortHeader label="Updated" asc="updatedAsc" desc="updatedDesc" sortBy={sortBy} onSort={setSortBy} className="ad-col-2nd" />
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((team) => {
                  const logo = logoFor(team);
                  const open = team.id === openTeamId;
                  return (
                    <tr key={team.id} data-team-id={team.id} aria-selected={open} onClick={() => openTeam(team.id)}>
                      <td className="ad-col-check" onClick={(event) => event.stopPropagation()}>
                        <input
                          className="ad-check"
                          type="checkbox"
                          aria-label={`Select ${team.canonicalName}`}
                          checked={selectedIds.includes(team.id)}
                          onChange={(event) => toggleOne(team.id, event.target.checked)}
                        />
                      </td>
                      <td className="ad-cell-name">
                        <button
                          type="button"
                          className="ad-row-open"
                          onClick={(event) => {
                            event.stopPropagation();
                            openTeam(team.id);
                          }}
                        >
                          <span className="ad-row-logo">{logo ? <img src={logo} alt="" loading="lazy" /> : null}</span>
                          {team.canonicalName || "Untitled team"}
                        </button>
                      </td>
                      <td className="ad-col-2nd">{team.scoreboardDisplayName || <span className="ad-faint">—</span>}</td>
                      <td>{team.shortName || <span className="ad-faint">—</span>}</td>
                      <td className="ad-num">{team.aliases.length + team.liveMatchNames.length}</td>
                      <td>
                        <span className={team.active ? "ad-status is-on" : "ad-status"}>
                          <span className="ad-dot" aria-hidden />
                          {team.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="ad-col-2nd ad-faint" title={formatUpdatedAtFull(team.updatedAt)}>
                        {formatUpdatedAt(team.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {openTeamId ? (
          <TeamPanel
            key={openTeamId}
            teamId={openTeamId}
            teams={teams}
            assets={assets}
            onAirSide={onAirSide}
            onClose={() => openTeam(null)}
            onDirtyChange={setPanelDirty}
            actionsRef={panelActionsRef}
          />
        ) : null}
      </div>
      {leaveGuard.prompt}
    </div>
  );
}
