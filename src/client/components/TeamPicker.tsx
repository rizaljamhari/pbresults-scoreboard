import { useMemo, useState, type ReactNode } from "react";
import type { TeamRecord } from "../../shared/theme";
import { searchTeams } from "../pages/teamSearch";

export type TeamLogoFor = (team: Pick<TeamRecord, "logoAssetId" | "alternateLogoAssetId"> | null | undefined) => string | undefined;
export type TeamChoice = { teamId: string } | { name: string };

/** Finds a registry team, or takes the typed name as it is. Used by manual scoring and the Matches page. */
export function TeamPicker({
  id,
  label,
  teams,
  logoFor,
  initialQuery = "",
  placeholder = "Search teams or type a name",
  typedTag = "no logo",
  footer,
  onChoose
}: {
  /** Unique per page, for the listbox's ids. */
  id: string;
  /** The search field's accessible name. */
  label: string;
  teams: TeamRecord[];
  logoFor: TeamLogoFor;
  initialQuery?: string;
  placeholder?: string;
  typedTag?: string;
  /** Shown under the list, e.g. a hint about the typed name. Gets the typed text and whether a team matched it. */
  footer?: (typed: string, hasResults: boolean) => ReactNode;
  onChoose: (choice: TeamChoice) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(0);
  const typed = query.trim();
  const results = useMemo(() => searchTeams(teams, query, 6), [teams, query]);
  const options = [
    ...results.map((result) => ({ key: result.team.id, label: result.team.canonicalName, tag: result.via ? `as ${result.via}` : null, team: result.team as TeamRecord | null })),
    ...(typed ? [{ key: "__typed", label: `Use “${typed}” as typed`, tag: typedTag, team: null }] : [])
  ];
  const listId = `team-picker-${id}`;

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChoose(option.team ? { teamId: option.team.id } : { name: typed });
  }

  return (
    <div className="pba-picker">
      <input
        className="pba-input"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        aria-activedescendant={options[highlight] ? `${listId}-${options[highlight].key}` : undefined}
        autoComplete="off"
        autoFocus
        placeholder={placeholder}
        value={query}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setHighlight((current) => (current + 1) % options.length);
          } else if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            setHighlight((current) => (current - 1 + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(highlight);
          }
        }}
      />
      <ul id={listId} role="listbox" className="pba-picker-list" aria-label="Teams">
        {options.length === 0 ? (
          <li className="pba-picker-empty">Type to search the team registry, or to use a name that is not in it.</li>
        ) : (
          options.map((option, index) => {
            const logo = option.team ? logoFor(option.team) : undefined;
            return (
              <li
                key={option.key}
                id={`${listId}-${option.key}`}
                role="option"
                aria-selected={index === highlight}
                className="pba-picker-option"
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
              >
                <span className="pba-picker-logo">{logo ? <img src={logo} alt="" /> : null}</span>
                <span className="pba-picker-name">{option.label}</span>
                {option.tag ? <span className="pba-picker-tag">{option.tag}</span> : null}
              </li>
            );
          })
        )}
      </ul>
      {footer?.(typed, results.length > 0)}
    </div>
  );
}
