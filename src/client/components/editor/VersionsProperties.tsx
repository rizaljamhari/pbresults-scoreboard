import { useState } from "react";
import { X } from "lucide-react";
import { themeSchema, type ThemeDefinition } from "../../../shared/theme";
import { diffThemes } from "../../../shared/themeDiff";
import { listThemeComponentEntries } from "../../../shared/themeComponents";
import { ChangeList } from "./ChangeReview";
import { IconButton } from "./EditorChrome";
import { PanelSection } from "./fields";
import { pieceName } from "./pieceNames";

type Version = ThemeDefinition["versions"][number];

const MAX_VERSIONS = 10;

function savedAtLabel(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A version's settings as a full theme, migrated like any stored theme; null if it no longer parses. */
export function versionTheme(theme: ThemeDefinition, version: Version): ThemeDefinition | null {
  const parsed = themeSchema.safeParse({ ...version.theme, id: theme.id, versions: [] });
  return parsed.success ? parsed.data : null;
}

/**
 * Named versions of the theme: keep the editor's current state under a name, compare it with the draft later, open
 * it as the draft, or turn it into a new theme. Keeping a version never changes the theme or what's on air.
 */
export function VersionsProperties({
  theme,
  busy,
  onKeep,
  onOpen,
  onDuplicate,
  onDelete
}: {
  theme: ThemeDefinition;
  busy: boolean;
  onKeep: (name: string) => void;
  onOpen: (version: Version) => void;
  onDuplicate: (version: Version) => void;
  onDelete: (version: Version) => void;
}) {
  const [name, setName] = useState("");
  const [comparing, setComparing] = useState<string | null>(null);
  const entries = listThemeComponentEntries(theme);
  const label = (id: string, fallback: string) => {
    const entry = entries.find((candidate) => candidate.id === id);
    return entry ? pieceName(entry) : fallback;
  };

  if (theme.builtin) {
    return (
      <PanelSection title="Versions" defaultOpen={false}>
        <p className="te-field-hint">Built-in themes can't keep versions. Use Save as a copy first, then keep versions of the copy.</p>
      </PanelSection>
    );
  }

  return (
    <PanelSection title="Versions" defaultOpen={false} aside={theme.versions.length || undefined}>
      <p className="te-field-hint">
        Keep the theme as it is in the editor now, unsaved changes included, to come back to later. Keeping a version doesn't change what's on air. Up to {MAX_VERSIONS};
        the oldest goes first.
      </p>
      <form
        className="te-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onKeep(name.trim());
          setName("");
        }}
      >
        <input className="te-input" aria-label="Version name" placeholder="e.g. Before sponsor change" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="te-mini-btn" disabled={busy || !name.trim()}>
          Keep version
        </button>
      </form>

      {theme.versions.map((version) => {
        const snapshot = versionTheme(theme, version);
        const open = comparing === version.id;
        const changes = open && snapshot ? diffThemes(snapshot, theme, label) : [];
        return (
          <div key={version.id} className="te-version">
            <div className="te-version-head">
              <div className="te-token-body">
                <b>{version.name}</b>
                <span className="te-usage">{savedAtLabel(version.savedAt)}</span>
              </div>
              <IconButton label={`Delete version ${version.name}`} onClick={() => onDelete(version)}>
                <X />
              </IconButton>
            </div>
            <div className="te-version-actions">
              <button type="button" className="te-text-btn" aria-expanded={open} disabled={!snapshot} onClick={() => setComparing(open ? null : version.id)}>
                {open ? "Hide changes" : "Compare"}
              </button>
              <button type="button" className="te-text-btn" disabled={!snapshot} onClick={() => onOpen(version)}>
                Open as draft
              </button>
              <button type="button" className="te-text-btn" disabled={!snapshot || busy} onClick={() => onDuplicate(version)}>
                Duplicate as new theme
              </button>
            </div>
            {!snapshot ? <span className="te-usage">This version can't be read by this app version.</span> : null}
            {open ? (
              changes.length ? (
                <>
                  <span className="te-usage">Since this version, in your draft:</span>
                  <ChangeList changes={changes} />
                </>
              ) : (
                <span className="te-usage">Your draft is the same as this version.</span>
              )
            ) : null}
          </div>
        );
      })}
    </PanelSection>
  );
}
