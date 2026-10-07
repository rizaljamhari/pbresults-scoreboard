import { Fragment } from "react";
import { Eye, EyeOff, Flag, Hash, Hourglass, Image as ImageIcon, Lock, LockOpen, PanelRightClose, Square, Timer, Type } from "lucide-react";
import type { ThemeDefinition } from "../../../shared/theme";
import { getThemeComponentEntry, type ThemeComponentEntry } from "../../../shared/themeComponents";
import { IconButton } from "./EditorChrome";
import { SwitchRow } from "./fields";
import { pieceName, pieceShortName } from "./pieceNames";

export type LayerGroup = { id: string; title: string; ids: string[] };

/** A moment card (timeout, game finished): not a piece, so it is listed on its own and opens its preview. */
export type MomentLayer = {
  kind: "timeout" | "gameFinished";
  name: string;
  enabled: boolean;
  placement: "centreLine" | "free";
  selected: boolean;
};

function MomentRows({
  moments,
  onSelect,
  onToggle
}: {
  moments: MomentLayer[];
  onSelect: (kind: MomentLayer["kind"]) => void;
  onToggle: (kind: MomentLayer["kind"]) => void;
}) {
  return (
    <section className="te-layer-group" aria-label="Moments">
      <h3>Moments</h3>
      <ul>
        {moments.map((moment) => (
          <li
            key={moment.kind}
            className={["te-layer", moment.selected ? "te-layer--selected" : "", moment.enabled ? "" : "te-layer--hidden"].join(" ")}
          >
            <button
              type="button"
              className="te-layer-main"
              aria-pressed={moment.selected}
              aria-label={`${moment.name}${moment.enabled ? "" : ", off"}`}
              onClick={() => onSelect(moment.kind)}
            >
              {moment.kind === "timeout" ? <Hourglass aria-hidden /> : <Flag aria-hidden />}
              <span className="te-layer-name">{moment.name}</span>
              <span className="te-layer-tag">{moment.placement === "centreLine" ? "centre" : "free"}</span>
            </button>
            <IconButton
              label={moment.enabled ? `Turn off ${moment.name}` : `Turn on ${moment.name}`}
              pressed={!moment.enabled}
              onClick={() => onToggle(moment.kind)}
              className="te-layer-toggle"
            >
              {moment.enabled ? <Eye /> : <EyeOff />}
            </IconButton>
            <span className="te-layer-spacer" aria-hidden />
          </li>
        ))}
      </ul>
    </section>
  );
}


function iconFor(entry: ThemeComponentEntry) {
  if (entry.id === "homeScore" || entry.id === "awayScore") {
    return <Hash aria-hidden />;
  }
  if (entry.id === "gameTime" || entry.id === "breakTime") {
    return <Timer aria-hidden />;
  }
  return entry.component.kind === "image" ? <ImageIcon aria-hidden /> : entry.component.kind === "shape" ? <Square aria-hidden /> : <Type aria-hidden />;
}

function tagFor(entry: ThemeComponentEntry) {
  if (entry.source === "fixed") {
    return entry.id === "eventLogo" ? null : "live";
  }
  const component = entry.component as { kind: string; contentMode?: string };
  return component.kind === "text" && component.contentMode === "operator" ? "operator" : null;
}

export function LayersPanel({
  theme,
  warnings,
  groups,
  selectedIds,
  lockedIds,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onToggleTeamLogos,
  moments,
  onSelectMoment,
  onToggleMoment,
  onCollapse
}: {
  theme: ThemeDefinition;
  groups: LayerGroup[];
  selectedIds: ReadonlySet<string>;
  lockedIds: ReadonlySet<string>;
  onSelect: (id: string, additive: boolean) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onToggleTeamLogos: (visible: boolean) => void;
  moments: MomentLayer[];
  onSelectMoment: (kind: MomentLayer["kind"]) => void;
  onToggleMoment: (kind: MomentLayer["kind"]) => void;
  onCollapse: () => void;
  /** Pieces with a problem to fix before going on air, and what it is. */
  warnings?: ReadonlyMap<string, string>;
}) {
  const allGroups: LayerGroup[] = [...groups, { id: "custom", title: "Custom", ids: theme.freeComponents.map((component) => component.id) }];
  const logosVisible = theme.components.homeTeamLogo.visible && theme.components.awayTeamLogo.visible;

  return (
    <>
      <header className="te-panel-header">
        <h2>Layers</h2>
        <IconButton label="Hide layers" onClick={onCollapse}>
          <PanelRightClose />
        </IconButton>
      </header>
      {allGroups.map((group) => (
        <Fragment key={group.id}>
        <section className="te-layer-group" aria-label={group.title}>
          <h3>{group.title}</h3>
          {group.ids.length === 0 ? (
            <p className="te-layer-empty">Add text (T) or an image (I) to create a custom layer.</p>
          ) : (
            <ul>
              {group.ids.map((id) => {
                const entry = getThemeComponentEntry(theme, id);
                if (!entry) {
                  return null;
                }
                const selected = selectedIds.has(id);
                const locked = lockedIds.has(id);
                const visible = entry.component.visible;
                const tag = tagFor(entry);
                const warning = warnings?.get(id);
                const name = pieceShortName(entry);
                const fullName = pieceName(entry);
                return (
                  <li key={id} className={["te-layer", selected ? "te-layer--selected" : "", visible ? "" : "te-layer--hidden"].join(" ")}>
                    <button
                      type="button"
                      className="te-layer-main"
                      aria-pressed={selected}
                      aria-label={`${fullName}${visible ? "" : ", hidden"}${locked ? ", locked" : ""}${warning ? `. ${warning}` : ""}`}
                      title={warning}
                      onClick={(event) => onSelect(id, event.shiftKey || event.metaKey || event.ctrlKey)}
                    >
                      {iconFor(entry)}
                      <span className="te-layer-name">{name}</span>
                      {warning ? <span className="te-layer-tag te-layer-tag--warn">cuts off</span> : tag ? <span className="te-layer-tag">{tag}</span> : null}
                    </button>
                    <IconButton label={visible ? `Hide ${fullName}` : `Show ${fullName}`} pressed={!visible} onClick={() => onToggleVisible(id)} className="te-layer-toggle">
                      {visible ? <Eye /> : <EyeOff />}
                    </IconButton>
                    <IconButton label={locked ? `Unlock ${fullName}` : `Lock ${fullName}`} pressed={locked} onClick={() => onToggleLock(id)} className="te-layer-toggle">
                      {locked ? <Lock /> : <LockOpen />}
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {group.id === "center" ? <MomentRows moments={moments} onSelect={onSelectMoment} onToggle={onToggleMoment} /> : null}
        </Fragment>
      ))}
      <div className="te-layer-options">
        <SwitchRow
          label="Team logos"
          hint="Shows or hides both team logo slots."
          checked={logosVisible}
          onChange={onToggleTeamLogos}
        />
      </div>
    </>
  );
}
