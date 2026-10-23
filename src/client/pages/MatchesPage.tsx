import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, CircleAlert, Ellipsis, FileUp, Link2, Pencil, Plus, Radio, Repeat, Trash2, Type, UserPlus, X } from "lucide-react";
import { api } from "../api";
import { useAssets, useMatchLists, useTeams } from "../hooks";
import { showToast } from "../toast";
import { confirmAction } from "../confirm";
import { Button, Chip, Grow, IconButton, Menu, Segmented, Toolbar, type MenuItem } from "../components/admin/kit";
import { TeamPicker, type TeamChoice, type TeamLogoFor } from "../components/TeamPicker";
import {
  gameHasPlaceholder,
  isPlaceholderLabel,
  matchBestOfValues,
  OWN_TURN,
  gameTitle,
  groupPlayOrder,
  isBackToBack,
  type PlayOrderStep,
  listDivisions,
  turnGroupMap,
  turnGroups,
  sideStatus,
  unlinkedLabels,
  type MatchList,
  type MatchListsState,
  type ScheduledGame,
  type ScheduledSide
} from "../../shared/matchList";
import { matchTeamName } from "../../shared/teamMatching";
import type { TeamRecord } from "../../shared/theme";

const SELECTED_KEY = "pbresults.admin.matchListSelected";
/** How sure a name match must be before the Teams tab offers it as a one-click link. */
const SUGGEST_CONFIDENCE = 0.8;

function readSelected() {
  try {
    return window.localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function saveSelected(id: string | null) {
  try {
    if (id) window.localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // Remembering it is a convenience only.
  }
}

/** crypto.randomUUID only exists on https or localhost; the admin may be opened over the venue LAN by plain http. */
function newGameId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * "SMPL - GRAND FINALE - MELAKA · Sat 24 Oct" from the PDF's event name and day: a league's acronym in brackets stands
 * in for its long name, and anything still too long is cut at a word.
 */
export function defaultListName(title: string, date: string, fileName: string) {
  const day = /^(\w{3})\w*,\s+(\d{1,2})\s+(\w{3})/.exec(date);
  const shortDay = day ? `${day[1]} ${day[2]} ${day[3]}` : "";
  const acronym = /^(.*?)\(([A-Z0-9]{2,10})\)(.*)$/.exec(title);
  let base = (acronym ? `${acronym[2]} ${acronym[3]}` : title || fileName.replace(/\.pdf$/i, "")).replace(/\s+/g, " ").trim();
  if (base.length > 56) base = base.slice(0, 56).replace(/\s+\S*$/, "");
  base = base.replace(/[\s-]+$/, "");
  return [base, shortDay].filter(Boolean).join(" · ") || "Match list";
}

/** Teams by id, their logos, and which ids still exist (a link to a deleted team needs linking again). */
type TeamLookup = { byId: Map<string, TeamRecord>; known: ReadonlySet<string>; logoFor: TeamLogoFor };

/** One side of a game in the table: its team (logo and name), or what the schedule printed and why it is not set. */
function SideLabel({ side, lookup }: { side: ScheduledSide; lookup: TeamLookup }) {
  const status = sideStatus(side, lookup.known);
  const team = side.teamId ? lookup.byId.get(side.teamId) : undefined;
  const logo = lookup.logoFor(team);
  if (status === "linked") {
    return (
      <span className="pba-ml-side">
        <span className="pba-row-logo">{logo ? <img src={logo} alt="" loading="lazy" /> : null}</span>
        <span className="pba-ml-side-name">{team?.canonicalName}</span>
      </span>
    );
  }
  if (status === "text") {
    return (
      <span className="pba-ml-side" title="Shown as typed, no logo">
        <span className="pba-row-logo">
          <Type aria-hidden />
        </span>
        <span className="pba-ml-side-name">{side.name}</span>
      </span>
    );
  }
  if (status === "placeholder") {
    return (
      <span className="pba-ml-side is-placeholder" title="Decided during the day. Click to set the team.">
        <span className="pba-ml-side-name">{side.label}</span>
      </span>
    );
  }
  if (status === "unlinked") {
    return (
      <span className="pba-ml-side is-unlinked" title="Not linked to the team list: shows by this name, without a logo">
        <CircleAlert className="pba-ml-warn" aria-hidden />
        <span className="pba-ml-side-name">{side.label}</span>
      </span>
    );
  }
  return <span className="pba-faint">—</span>;
}

/** A game's side, clickable to set this one game's team (a knockout's real team, or a last-minute change). */
function SideCell({
  game,
  which,
  teams,
  lookup,
  onChange
}: {
  game: ScheduledGame;
  which: "home" | "away";
  teams: TeamRecord[];
  lookup: TeamLookup;
  onChange: (side: ScheduledSide) => void;
}) {
  const [open, setOpen] = useState(false);
  const side = game[which];
  const choose = (choice: TeamChoice) => {
    setOpen(false);
    onChange("teamId" in choice ? { ...side, teamId: choice.teamId, name: "" } : { ...side, teamId: null, name: choice.name.slice(0, 40) });
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="pba-ml-side-btn" aria-label={`${which === "home" ? "Home" : "Away"} team for game ${game.gameId ?? ""}`}>
          <SideLabel side={side} lookup={lookup} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pba-scope pba-pop pba-picker-pop" align="start" sideOffset={6}>
          <TeamPicker
            id={`${game.id}-${which}`}
            label={`${which === "home" ? "Home" : "Away"} team for game ${game.gameId ?? ""}`}
            teams={teams}
            logoFor={lookup.logoFor}
            initialQuery={sideStatus(side, lookup.known) === "unlinked" ? side.label : ""}
            footer={() =>
              side.label ? (
                <div className="pba-ml-picker-foot">
                  <span className="pba-hint">Schedule says “{side.label}”</span>
                  {side.teamId || side.name ? (
                    <Button
                      size="sm"
                      variant="text"
                      onClick={() => {
                        setOpen(false);
                        onChange({ ...side, teamId: null, name: "" });
                      }}
                    >
                      Back to schedule
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
            onChoose={choose}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function GamesTable({
  list,
  teams,
  lookup,
  onSave
}: {
  list: MatchList;
  teams: TeamRecord[];
  lookup: TeamLookup;
  onSave: (games: ScheduledGame[]) => void;
}) {
  const update = (id: string, patch: Partial<ScheduledGame>) => onSave(list.games.map((game) => (game.id === id ? { ...game, ...patch } : game)));
  const divided = listDivisions(list).length > 1;
  const groupOf = turnGroupMap(list);
  const groupNames = turnGroups(list).map((group) => group.name);
  const setTurns = (game: ScheduledGame, value: string) =>
    update(game.id, { turnGroup: value === NEW_GROUP ? newGroupName(groupNames) : value === OWN_TURN_VALUE ? OWN_TURN : value });
  /** A single game joins a group from its row menu, so the Turns column only shows where it matters. */
  const joinItems = (game: ScheduledGame): MenuItem[] =>
    game.kind !== "game" || game.bestOf > 1 || groupOf.get(game.id)
      ? []
      : [
          ...groupNames.map((name) => ({ label: `Take turns with ${name}`, icon: <Repeat />, onSelect: () => setTurns(game, name) })),
          { label: "Start a new turn group", icon: <Plus />, onSelect: () => setTurns(game, NEW_GROUP) },
          { kind: "separator" as const }
        ];
  const move = (index: number, by: number) => {
    const games = [...list.games];
    const [game] = games.splice(index, 1);
    games.splice(index + by, 0, game);
    onSave(games);
  };
  const addGame = () => {
    const last = Math.max(0, ...list.games.map((game) => game.gameId ?? 0));
    onSave([
      ...list.games,
      {
        id: newGameId(),
        gameId: last + 1,
        time: "",
        minutes: null,
        division: "",
        stage: "",
        kind: "game",
        home: { label: "", teamId: null, name: "" },
        away: { label: "", teamId: null, name: "" },
        bestOf: 1,
        notes: "",
        turnGroup: null
      }
    ]);
  };

  return (
    <>
      <table className="pba-table pba-ml-table">
        <thead>
          <tr>
            <th className="pba-num">Game</th>
            <th>Time</th>
            <th className="pba-col-2nd">Stage</th>
            <th>Home</th>
            <th>Away</th>
            <th title="Sets in the series. The score carries from set to set; only the clock resets.">Best of</th>
            <th title="Which turn group a best-of series is in. Single games join a group from their row menu.">Turns</th>
            <th aria-label="Row actions" />
          </tr>
        </thead>
        <tbody>
          {list.games.map((game, index) =>
            game.kind === "break" ? (
              <tr key={game.id} className="pba-ml-break">
                <td className="pba-num pba-faint">—</td>
                <td>{game.time}</td>
                <td colSpan={5} className="pba-faint">
                  {game.notes || game.stage || "Break"}
                  {game.minutes ? ` · ${game.minutes} min` : ""}
                </td>
                <td className="pba-ml-actions">
                  <RowMenu index={index} count={list.games.length} onMove={move} onDelete={() => onSave(list.games.filter((item) => item.id !== game.id))} />
                </td>
              </tr>
            ) : (
              <tr key={game.id} className={gameHasPlaceholder(game) ? "is-placeholder" : undefined}>
                <td className="pba-num" title={`${gameTitle(game, divided)}${game.stage ? ` · ${game.stage}` : ""}`}>
                  {divided && game.division ? <span className="pba-ml-division">{game.division.trim().slice(0, 1).toUpperCase()}</span> : null}
                  {game.gameId}
                </td>
                <td>{game.time}</td>
                <td className="pba-col-2nd pba-ml-stage" title={game.notes || undefined}>
                  {divided && game.division ? `${game.division} · ${game.stage}` : game.stage}
                </td>
                <td>
                  <SideCell game={game} which="home" teams={teams} lookup={lookup} onChange={(home) => update(game.id, { home })} />
                </td>
                <td>
                  <SideCell game={game} which="away" teams={teams} lookup={lookup} onChange={(away) => update(game.id, { away })} />
                </td>
                <td>
                  <select
                    className="pba-select pba-ml-bestof"
                    aria-label={`Best of, ${gameTitle(game, divided)}`}
                    value={game.bestOf}
                    onChange={(event) => update(game.id, { bestOf: Number(event.target.value) as ScheduledGame["bestOf"] })}
                  >
                    {matchBestOfValues.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {game.bestOf > 1 || groupOf.get(game.id) ? (
                    <select
                      className="pba-select pba-ml-turns"
                      aria-label={`Turns, ${gameTitle(game, divided)}`}
                      value={groupOf.get(game.id) ?? OWN_TURN_VALUE}
                      onChange={(event) => setTurns(game, event.target.value)}
                    >
                      <option value={OWN_TURN_VALUE}>{game.bestOf > 1 ? "On its own (back to back)" : "On its own"}</option>
                      {groupNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      <option value={NEW_GROUP}>New turn group</option>
                    </select>
                  ) : (
                    <span className="pba-faint" title="A single game plays once. To have it take turns with a group, use its row menu.">
                      —
                    </span>
                  )}
                </td>
                <td className="pba-ml-actions">
                  <RowMenu
                    index={index}
                    count={list.games.length}
                    extra={joinItems(game)}
                    onMove={move}
                    onDelete={() => onSave(list.games.filter((item) => item.id !== game.id))}
                  />
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      <div className="pba-ml-foot">
        <Button size="sm" onClick={addGame}>
          <Plus aria-hidden />
          Add game
        </Button>
      </div>
    </>
  );
}

/** Select values that cannot be group names (those are trimmed text). */
const OWN_TURN_VALUE = " own";
const NEW_GROUP = " new";

function newGroupName(taken: string[]) {
  let n = 1;
  while (taken.includes(`Group ${n}`)) n += 1;
  return `Group ${n}`;
}

/** A game's short code for lists of games: "51", or "M51" where game numbers repeat per division. */
function gameCode(game: ScheduledGame, divided: boolean) {
  return divided && game.division.trim() ? `${game.division.trim().slice(0, 1).toUpperCase()}${game.gameId}` : `${game.gameId}`;
}

/**
 * A group's play order as one line: "Sets 1–3 in turn: M45 → M46 → M47 → M48 · a decided series sits out · then
 * overtime, then one-on-ones", or back to back "M51 to its end → R29 → M52 to its end".
 */
function playOrderText(order: PlayOrderStep[], backToBack: boolean, divided: boolean) {
  const codes = (games: ScheduledGame[]) => games.map((game) => gameCode(game, divided)).join(" → ");
  if (backToBack) {
    return `${order.map((step) => `${codes(step.games)}${step.games[0]?.bestOf > 1 ? " to its end" : ""}`).join(" → ")} · a series still level plays its overtime, then one-on-ones, straight away`;
  }
  const sets = order.filter((step) => step.games.length > 0);
  // Rounds with the same games read as one: "Sets 2–3".
  const runs: Array<{ from: number; to: number; games: ScheduledGame[] }> = [];
  sets.forEach((step, index) => {
    const last = runs.at(-1);
    if (last && codes(last.games) === codes(step.games)) last.to = index + 1;
    else runs.push({ from: index + 1, to: index + 1, games: step.games });
  });
  const parts = runs.map((run) => `${run.from === run.to ? `Set ${run.from}` : `Sets ${run.from}–${run.to}`}${run.from === 1 && run.to > 1 ? " in turn" : ""}: ${codes(run.games)}`);
  if (sets.length > 1) parts.push("a decided series sits out");
  if (order.length > sets.length) parts.push("then overtime, then one-on-ones, for any still level");
  return parts.join(" · ");
}

type TurnGroupChange = { games?: ScheduledGame[]; backToBackGroups?: string[] };

/** Adds a game to a group: a short searchable list of the list's games not in it yet. */
function AddGamePicker({ list, group, divided, onAdd }: { list: MatchList; group: string; divided: boolean; onAdd: (game: ScheduledGame) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groupOf = turnGroupMap(list);
  const wanted = query.trim().toLowerCase();
  const candidates = list.games
    .filter((game) => game.kind === "game" && groupOf.get(game.id) !== group)
    .filter((game) => {
      if (!wanted) return true;
      const text = `${gameCode(game, divided)} ${game.division} ${game.stage} ${game.home.label} ${game.away.label}`.toLowerCase();
      return text.includes(wanted);
    });
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost">
          <Plus aria-hidden />
          Add game
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pba-scope pba-pop pba-ml-add-game" align="start" sideOffset={6}>
          <input
            className="pba-input"
            autoFocus
            aria-label={`Find a game to add to ${group}`}
            placeholder="Game number, stage or team"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="pba-ml-add-list" aria-label="Games">
            {candidates.length === 0 ? (
              <li className="pba-hint">No game matches.</li>
            ) : (
              candidates.map((game) => (
                <li key={game.id}>
                  <button
                    type="button"
                    className="pba-game-pick-row"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      onAdd(game);
                    }}
                  >
                    <span className="pba-num">{gameCode(game, divided)}</span>
                    <span className="pba-faint">{game.time}</span>
                    <span>
                      {game.stage}
                      {game.bestOf > 1 ? ` · best of ${game.bestOf}` : ""}
                    </span>
                    <span className="pba-faint">{groupOf.get(game.id) ?? ""}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One turn group: its name (renamed on request), how it plays (taking turns or back to back), its games, and the order
 * that produces, so the operator can check it before Next match runs it on air.
 */
function TurnGroupRow({
  list,
  name,
  games,
  divided,
  groupNames,
  onChange
}: {
  list: MatchList;
  name: string;
  games: ScheduledGame[];
  divided: boolean;
  groupNames: string[];
  onChange: (change: TurnGroupChange) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const groupOf = turnGroupMap(list);
  const backToBack = isBackToBack(list, name);
  const order = groupPlayOrder(list, name);

  async function rename(to: string) {
    setRenaming(false);
    const next = to.trim().slice(0, 60);
    if (!next || next === name) return;
    const merging = groupNames.includes(next);
    if (
      merging &&
      !(await confirmAction({
        title: `Merge “${name}” into “${next}”?`,
        message: `Both groups' games will take turns as one group, “${next}”.`,
        confirmLabel: "Merge groups"
      }))
    ) {
      return;
    }
    const games = list.games.map((game) => (groupOf.get(game.id) === name ? { ...game, turnGroup: next } : game));
    const kept = list.backToBackGroups.filter((group) => group !== name);
    // A merge keeps the target's order; a plain rename keeps this group's.
    const backToBackGroups = !merging && backToBack ? [...kept, next] : kept;
    onChange({ games, backToBackGroups });
  }

  const setOrder = (order: "turns" | "backToBack") =>
    onChange({
      backToBackGroups: order === "backToBack" ? [...list.backToBackGroups.filter((group) => group !== name), name] : list.backToBackGroups.filter((group) => group !== name)
    });
  const setGroup = (game: ScheduledGame, group: string) =>
    onChange({ games: list.games.map((item) => (item.id === game.id ? { ...item, turnGroup: group } : item)) });

  return (
    <div className="pba-ml-group">
      <div className="pba-ml-group-head">
        {renaming ? (
          <input
            className="pba-input pba-ml-group-name"
            aria-label={`New name for ${name}`}
            autoFocus
            value={draft}
            maxLength={60}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void rename(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Without this the same keypress would land on the merge question's first button and dismiss it.
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setDraft(name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <>
            <b className="pba-ml-group-title">{name}</b>
            <IconButton
              label={`Rename ${name}`}
              onClick={() => {
                setDraft(name);
                setRenaming(true);
              }}
            >
              <Pencil />
            </IconButton>
          </>
        )}
        {games.length > 1 ? (
          <Segmented
            label={`How ${name} plays`}
            value={backToBack ? "backToBack" : "turns"}
            onChange={setOrder}
            options={[
              { value: "turns", label: "Take turns", title: "Set 1 of every game, then set 2 of those still open, and so on" },
              { value: "backToBack", label: "Back to back", title: "Each game to its end, in schedule order" }
            ]}
          />
        ) : (
          <span className="pba-hint">One game: it plays to its end</span>
        )}
        <span className="pba-ml-group-games">
          {games.map((game) => (
            <span key={game.id} className="pba-chip pba-ml-member" title={`${gameTitle(game, divided)} · ${game.stage}`}>
              {gameCode(game, divided)}
              <button type="button" aria-label={`Take ${gameTitle(game, divided)} out of ${name}`} onClick={() => setGroup(game, OWN_TURN)}>
                <X aria-hidden />
              </button>
            </span>
          ))}
        </span>
        <AddGamePicker list={list} group={name} divided={divided} onAdd={(game) => setGroup(game, name)} />
      </div>
      <p className="pba-ml-playorder" aria-label={`Play order for ${name}`}>
        {playOrderText(order, backToBack, divided)}
      </p>
    </div>
  );
}

/**
 * The turn groups. Automatic groups put best-of series of one division and stage together; the operator can rename,
 * merge, add or take out games, and switch a group between taking turns and back to back.
 */
function TurnGroupsBar({ list, onChange }: { list: MatchList; onChange: (change: TurnGroupChange) => void }) {
  const groups = turnGroups(list);
  const divided = listDivisions(list).length > 1;
  const customised = list.games.some((game) => game.turnGroup !== null) || list.backToBackGroups.length > 0;
  if (groups.length === 0 && !customised) return null;

  async function reset() {
    const ok = await confirmAction({
      title: "Go back to automatic turn groups?",
      message: "Your groups and back-to-back choices are cleared. Best-of series of each division and stage take turns again; single games play on their own.",
      confirmLabel: "Use automatic groups"
    });
    if (!ok) return;
    onChange({ games: list.games.map((game) => ({ ...game, turnGroup: null })), backToBackGroups: [] });
    showToast({ kind: "success", message: "Turn groups are automatic again." });
  }

  return (
    <section className="pba-ml-groups" aria-label="Turn groups">
      <div className="pba-ml-groups-head">
        <span className="pba-label pba-ml-order-title">Turn groups</span>
        <span className="pba-hint">Games in a group take turns. Set a group to Back to back, or a series on its own, to play each one to its end.</span>
        {customised ? (
          <Button size="sm" variant="text" className="pba-push" onClick={() => void reset()}>
            Back to automatic groups
          </Button>
        ) : null}
      </div>
      {groups.length ? (
        <div className="pba-ml-group-list">
          {groups.map(({ name, games }) => (
            <TurnGroupRow key={name} list={list} name={name} games={games} divided={divided} groupNames={groups.map((group) => group.name)} onChange={onChange} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RowMenu({
  index,
  count,
  extra = [],
  onMove,
  onDelete
}: {
  index: number;
  count: number;
  /** Row-specific items shown first, such as joining a turn group. */
  extra?: MenuItem[];
  onMove: (index: number, by: number) => void;
  onDelete: () => void;
}) {
  return (
    <Menu
      trigger={
        <IconButton label="Row actions">
          <Ellipsis />
        </IconButton>
      }
      items={[
        ...extra,
        { label: "Move up", icon: <ArrowUp />, disabled: index === 0, onSelect: () => onMove(index, -1) },
        { label: "Move down", icon: <ArrowDown />, disabled: index === count - 1, onSelect: () => onMove(index, 1) },
        { kind: "separator" },
        { label: "Remove row", icon: <Trash2 />, danger: true, onSelect: onDelete }
      ]}
    />
  );
}

type PrintedTeam = { label: string; games: number; side: ScheduledSide };

/** Every printed team name in the list, once, with how it is mapped. Placeholders are left out: they are not teams. */
function printedTeams(list: MatchList, known: ReadonlySet<string>): PrintedTeam[] {
  const byLabel = new Map<string, PrintedTeam>();
  for (const game of list.games) {
    if (game.kind !== "game") continue;
    for (const side of [game.home, game.away]) {
      const label = side.label.trim();
      if (!label || isPlaceholderLabel(label)) continue;
      const key = label.toLowerCase();
      const entry = byLabel.get(key);
      if (entry) entry.games += 1;
      else byLabel.set(key, { label, games: 1, side });
    }
  }
  const order = { unlinked: 0, text: 1, linked: 2, placeholder: 3, empty: 4 };
  return [...byLabel.values()].sort((a, b) => order[sideStatus(a.side, known)] - order[sideStatus(b.side, known)]);
}

function TeamMappingTable({
  list,
  teams,
  lookup,
  onMapped
}: {
  list: MatchList;
  teams: TeamRecord[];
  lookup: TeamLookup;
  onMapped: (list: MatchList) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const rows = useMemo(() => printedTeams(list, lookup.known), [list, lookup.known]);
  const unlinked = rows.filter((row) => sideStatus(row.side, lookup.known) === "unlinked");

  async function map(request: Parameters<typeof api.mapMatchListTeam>[1]) {
    setBusy(request.label);
    try {
      onMapped(await api.mapMatchListTeam(list.id, request));
      return true;
    } catch (error) {
      showToast({ kind: "error", message: errorMessage(error, "Couldn't save that team.") });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createAllMissing() {
    const ok = await confirmAction({
      title: `Add ${unlinked.length} team${unlinked.length === 1 ? "" : "s"} to Teams?`,
      message: "Each name not linked yet becomes a new team, named as the schedule prints it. Add their logos on the Teams page.",
      confirmLabel: `Add ${unlinked.length} team${unlinked.length === 1 ? "" : "s"}`
    });
    if (!ok) return;
    for (const row of unlinked) {
      if (!(await map({ action: "create", label: row.label }))) return;
    }
    showToast({ kind: "success", message: `${unlinked.length} team${unlinked.length === 1 ? "" : "s"} added to Teams.` });
  }

  if (rows.length === 0) {
    return (
      <div className="pba-empty">
        <b>No team names yet</b>
        <p className="pba-hint">Team names from the schedule show here so you can link them to your team list.</p>
      </div>
    );
  }

  return (
    <>
      <div className="pba-ml-subbar">
        <span className="pba-hint">
          {unlinked.length
            ? `${unlinked.length} of ${rows.length} team names are not linked. A link applies to every game in this list, and is remembered for the next schedule.`
            : `All ${rows.length} team names are linked or kept as text.`}
        </span>
        {unlinked.length ? (
          <Button size="sm" disabled={Boolean(busy)} onClick={() => void createAllMissing()}>
            <UserPlus aria-hidden />
            Add all missing to Teams
          </Button>
        ) : null}
      </div>
      <table className="pba-table pba-ml-table">
        <thead>
          <tr>
            <th>On the schedule</th>
            <th className="pba-num">Games</th>
            <th>Team</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = sideStatus(row.side, lookup.known);
            // Only a close match is offered: "Loco Legion" scores 0.68 against "Anarki Legion" and must not be suggested.
            const best = status === "unlinked" ? matchTeamName(row.label, teams, { includeInactive: true }).candidates[0] : undefined;
            const suggested = best && best.confidence >= SUGGEST_CONFIDENCE ? lookup.byId.get(best.teamId) : undefined;
            const working = busy === row.label;
            return (
              <tr key={row.label} className={status === "unlinked" ? "is-unlinked" : undefined}>
                <td className="pba-cell-name">{row.label}</td>
                <td className="pba-num">{row.games}</td>
                <td>
                  {status === "unlinked" ? (
                    <span className="pba-ml-status">
                      <Chip tone="warning">Not linked</Chip>
                      {suggested ? (
                        <Button
                          size="sm"
                          variant="text"
                          disabled={working}
                          title={suggested.active ? undefined : `${suggested.canonicalName} is inactive in Teams; linking switches it back on.`}
                          onClick={() => void map({ action: "link", label: row.label, teamId: suggested.id })}
                        >
                          Link to {suggested.canonicalName}?
                        </Button>
                      ) : null}
                    </span>
                  ) : (
                    <SideLabel side={row.side} lookup={lookup} />
                  )}
                </td>
                <td className="pba-ml-actions">
                  <Popover.Root open={pickerFor === row.label} onOpenChange={(open) => setPickerFor(open ? row.label : null)}>
                    <Popover.Trigger asChild>
                      <Button size="sm" disabled={working}>
                        <Link2 aria-hidden />
                        {status === "linked" ? "Change" : "Link"}
                      </Button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="pba-scope pba-pop pba-picker-pop" align="end" sideOffset={6}>
                        <TeamPicker
                          id={`map-${row.label}`}
                          label={`Team for “${row.label}”`}
                          teams={teams}
                          logoFor={lookup.logoFor}
                          initialQuery={row.label}
                          typedTag="keep as text"
                          onChoose={(choice) => {
                            setPickerFor(null);
                            void map("teamId" in choice ? { action: "link", label: row.label, teamId: choice.teamId } : { action: "text", label: row.label });
                          }}
                        />
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  <Menu
                    trigger={
                      <IconButton label={`More for ${row.label}`} disabled={working}>
                        <Ellipsis />
                      </IconButton>
                    }
                    items={[
                      { label: "Add to Teams as a new team", icon: <UserPlus />, disabled: status === "linked", onSelect: () => void map({ action: "create", label: row.label }) },
                      { label: "Keep as text (no logo)", icon: <Type />, disabled: status === "text", onSelect: () => void map({ action: "text", label: row.label }) },
                      { kind: "separator" },
                      { label: "Unlink", icon: <X />, disabled: status === "unlinked", onSelect: () => void map({ action: "clear", label: row.label }) }
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function ListDetail({
  list,
  active,
  teams,
  lookup,
  onChange,
  onReload,
  onSetActive,
  onDelete
}: {
  list: MatchList;
  active: boolean;
  teams: TeamRecord[];
  lookup: TeamLookup;
  onChange: (list: MatchList) => void;
  /** Fetches the lists again, after a save failed. */
  onReload: () => void;
  onSetActive: (active: boolean) => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<"games" | "teams">("games");
  const [name, setName] = useState(list.name);
  useEffect(() => setName(list.name), [list.name]);
  const unlinked = unlinkedLabels(list, lookup.known);
  const games = list.games.filter((game) => game.kind === "game");
  const placeholders = games.filter(gameHasPlaceholder).length;

  // Edits show at once and save one after another, in the order made. Only the answer to the latest edit is shown,
  // so a slow reply never puts back an older version over a quicker second edit.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveCount = useRef(0);
  function save(change: Partial<Pick<MatchList, "name" | "games" | "backToBackGroups">>) {
    const next = { name: list.name, games: list.games, backToBackGroups: list.backToBackGroups, ...change };
    const mine = ++saveCount.current;
    onChange({ ...list, ...next });
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const saved = await api.updateMatchList({ id: list.id, ...next });
        if (mine === saveCount.current) onChange(saved);
      } catch (error) {
        showToast({ kind: "error", message: errorMessage(error, "Couldn't save the match list.") });
        if (mine === saveCount.current) onReload();
      }
    });
  }

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed) setName(list.name);
    else if (trimmed !== list.name) save({ name: trimmed });
  }

  return (
    <div className="pba-ml-detail">
      <div className="pba-ml-head">
        <input
          className="pba-input pba-ml-name"
          aria-label="List name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(list.name);
          }}
        />
        <span className="pba-hint">
          {games.length} games{placeholders ? ` · ${placeholders} with teams to fill in` : ""}
          {list.sourceFileName ? ` · from ${list.sourceFileName}` : ""}
        </span>
        <Grow />
        {active ? (
          <>
            <Chip tone="ok">
              <Radio aria-hidden />
              Used for manual scoring
            </Chip>
            <Button size="sm" variant="ghost" onClick={() => onSetActive(false)}>
              Stop using
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => onSetActive(true)}>
            Use for manual scoring
          </Button>
        )}
        <Menu
          trigger={
            <IconButton label="List actions">
              <Ellipsis />
            </IconButton>
          }
          items={[{ label: "Delete list…", icon: <Trash2 />, danger: true, onSelect: onDelete }]}
        />
      </div>
      {unlinked.length ? (
        <div className="pba-callout pba-callout--warning pba-ml-callout">
          <CircleAlert aria-hidden />
          <span>
            {unlinked.length} team{unlinked.length === 1 ? " isn't" : "s aren't"} linked to the team list, so {unlinked.length === 1 ? "it shows" : "they show"} by
            the printed name without a logo.
          </span>
          {tab !== "teams" ? (
            <Button size="sm" className="pba-push" onClick={() => setTab("teams")}>
              Link teams
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="pba-ml-tabs">
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "games", label: "Games", count: games.length },
            { value: "teams", label: "Teams", count: unlinked.length || undefined, title: "Link the schedule's team names to your team list" }
          ]}
        />
      </div>
      <div className="pba-table-wrap">
        {tab === "games" ? (
          <>
            <TurnGroupsBar list={list} onChange={(change) => save(change)} />
            <GamesTable list={list} teams={teams} lookup={lookup} onSave={(games) => save({ games })} />
          </>
        ) : (
          <TeamMappingTable list={list} teams={teams} lookup={lookup} onMapped={onChange} />
        )}
      </div>
    </div>
  );
}

/**
 * Match lists: an event's schedule, read from its PDF, so manual scoring's Next match loads the right teams. Team
 * names on the schedule are linked to the team list here.
 */
export function MatchesPage() {
  const matchLists = useMatchLists();
  const teams = useTeams();
  const assets = useAssets();
  const [selectedId, setSelectedId] = useState<string | null>(readSelected);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const state: MatchListsState = matchLists.data ?? { activeListId: null, lists: [] };
  const selected = state.lists.find((list) => list.id === selectedId) ?? state.lists[0] ?? null;
  const allTeams = teams.data ?? [];
  const assetUrl = useMemo(() => new Map((assets.data ?? []).map((asset) => [asset.id, asset.url])), [assets.data]);
  const lookup: TeamLookup = useMemo(
    () => ({
      byId: new Map(allTeams.map((team) => [team.id, team])),
      known: new Set(allTeams.map((team) => team.id)),
      logoFor: (team) => {
        const id = team?.logoAssetId ?? team?.alternateLogoAssetId;
        return id ? assetUrl.get(id) : undefined;
      }
    }),
    [allTeams, assetUrl]
  );

  function select(id: string | null) {
    setSelectedId(id);
    saveSelected(id);
  }

  function replaceList(list: MatchList) {
    matchLists.setData({ ...state, lists: state.lists.map((item) => (item.id === list.id ? list : item)) });
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const schedule = await api.importSchedulePdf(file);
      const list = await api.createMatchList({
        name: defaultListName(schedule.title, schedule.date, schedule.sourceFileName),
        sourceFileName: schedule.sourceFileName,
        games: schedule.games
      });
      matchLists.setData({ ...state, lists: [...state.lists, list] });
      select(list.id);
      const count = list.games.filter((game) => game.kind === "game").length;
      const missing = unlinkedLabels(list, lookup.known).length;
      showToast({
        kind: "success",
        message: `Read ${count} games.${missing ? ` ${missing} team names need linking.` : " Every team is linked."}`
      });
      for (const warning of schedule.warnings) showToast({ kind: "info", message: warning });
    } catch (error) {
      showToast({ kind: "error", message: errorMessage(error, "Couldn't read that PDF.") });
    } finally {
      setUploading(false);
    }
  }

  async function createEmpty() {
    try {
      const list = await api.createMatchList({ name: `Match list ${state.lists.length + 1}`, games: [] });
      matchLists.setData({ ...state, lists: [...state.lists, list] });
      select(list.id);
    } catch (error) {
      showToast({ kind: "error", message: errorMessage(error, "Couldn't create the list.") });
    }
  }

  async function setActive(list: MatchList, active: boolean) {
    try {
      matchLists.setData(await api.setActiveMatchList(active ? list.id : null));
      showToast({ kind: "success", message: active ? `Next match now follows “${list.name}”.` : "Next match no longer follows a list." });
    } catch (error) {
      showToast({ kind: "error", message: errorMessage(error, "Couldn't change the list in use.") });
    }
  }

  async function remove(list: MatchList) {
    const ok = await confirmAction({
      title: `Delete “${list.name}”?`,
      message: state.activeListId === list.id ? "Manual scoring stops following it. Teams already on the scoreboard stay." : "This cannot be undone.",
      confirmLabel: "Delete list",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await api.deleteMatchList(list.id);
      matchLists.setData({
        activeListId: state.activeListId === list.id ? null : state.activeListId,
        lists: state.lists.filter((item) => item.id !== list.id)
      });
      select(null);
    } catch (error) {
      showToast({ kind: "error", message: errorMessage(error, "Couldn't delete the list.") });
    }
  }

  return (
    <div className="pba-page pba-scope">
      <Toolbar title="Matches" count={matchLists.data ? state.lists.length : undefined}>
        <Grow />
        <Button onClick={() => void createEmpty()}>
          <Plus aria-hidden />
          New list
        </Button>
        <Button variant="primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <FileUp aria-hidden />
          {uploading ? "Reading PDF…" : "Upload schedule PDF"}
        </Button>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = "";
          }}
        />
      </Toolbar>

      {!matchLists.data ? (
        <p className="pba-hint" style={{ padding: 20 }}>
          Loading match lists…
        </p>
      ) : state.lists.length === 0 ? (
        <div className="pba-empty">
          <b>No match lists yet</b>
          <p className="pba-hint">Upload the event's schedule PDF. Manual scoring's Next match then loads each game's teams for you.</p>
          <Button variant="primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <FileUp aria-hidden />
            Upload schedule PDF
          </Button>
        </div>
      ) : (
        <div className="pba-ml-split">
          <nav className="pba-ml-lists" aria-label="Match lists">
            {state.lists.map((list) => {
              const missing = unlinkedLabels(list, lookup.known).length;
              return (
                <button key={list.id} type="button" className="pba-ml-list" aria-current={list.id === selected?.id ? "true" : undefined} onClick={() => select(list.id)}>
                  <span className="pba-ml-list-name">{list.name}</span>
                  <span className="pba-ml-list-meta">
                    {state.activeListId === list.id ? <Chip tone="ok">In use</Chip> : null}
                    {missing ? <Chip tone="warning">{missing} to link</Chip> : null}
                    <span className="pba-hint">{list.games.filter((game) => game.kind === "game").length} games</span>
                  </span>
                </button>
              );
            })}
          </nav>
          {selected ? (
            <ListDetail
              key={selected.id}
              list={selected}
              active={state.activeListId === selected.id}
              teams={allTeams}
              lookup={lookup}
              onChange={replaceList}
              onReload={() => void api.getMatchLists().then(matchLists.setData, () => undefined)}
              onSetActive={(active) => void setActive(selected, active)}
              onDelete={() => void remove(selected)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
