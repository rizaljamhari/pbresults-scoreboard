import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Ellipsis, Trash2, TriangleAlert, X } from "lucide-react";
import { api } from "../api";
import type { useAssets, useTeams } from "../hooks";
import { showToast } from "../toast";
import type { TeamRecord } from "../../shared/theme";
import { generateTeamAliases, listExplicitTeamMatchNames } from "../../shared/teamMatching";
import { Button, Field, IconButton, Menu, SAVE_SHORTCUT, Switch } from "../components/admin/kit";
import { AssetLibraryPicker } from "../components/AssetLibraryPicker";
import { formatUpdatedAtFull, hasTeamUnsavedChanges } from "./teamAdminUtils";

export function splitNames(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Names the matcher derives by itself (initials, shorthand), minus the ones already entered on the team. */
function generatedNames(team: TeamRecord) {
  const explicit = new Set(listExplicitTeamMatchNames(team).map((name) => name.trim()));
  return generateTeamAliases(team).filter((name) => !explicit.has(name.trim()));
}

function NameTokens({
  names,
  onRemove,
  removeLabel,
  auto = false
}: {
  names: string[];
  onRemove?: (name: string) => void;
  removeLabel?: string;
  auto?: boolean;
}) {
  return (
    <>
      {names.map((name) => (
        <span key={name} className={auto ? "ad-token ad-token--auto" : "ad-token"}>
          {name}
          {onRemove ? (
            <button type="button" aria-label={`${removeLabel ?? "Remove"} ${name}`} onClick={() => onRemove(name)}>
              <X aria-hidden />
            </button>
          ) : null}
        </span>
      ))}
    </>
  );
}

/**
 * Edits one team beside the list. The draft is local until Save; changes made elsewhere while you edit are held
 * back and offered, never merged silently.
 */
export type TeamPanelActions = { save: () => Promise<boolean>; discard: () => void };

export function TeamPanel({
  teamId,
  teams,
  assets,
  onAirSide,
  onClose,
  onDirtyChange,
  actionsRef
}: {
  teamId: string;
  teams: ReturnType<typeof useTeams>;
  assets: ReturnType<typeof useAssets>;
  onAirSide: "left" | "right" | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Lets the page save or discard this draft from its leave prompt. */
  actionsRef?: MutableRefObject<TeamPanelActions | null>;
}) {
  const selectedTeam = useMemo(() => teams.data?.find((team) => team.id === teamId) ?? null, [teamId, teams.data]);
  const [draft, setDraft] = useState<TeamRecord | null>(null);
  const [savedTeam, setSavedTeam] = useState<TeamRecord | null>(null);
  const [externallyChanged, setExternallyChanged] = useState(false);
  const [pendingAlias, setPendingAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const uploadRefs = { primary: useRef<HTMLInputElement>(null), alternate: useRef<HTMLInputElement>(null) };

  const hasUnsavedChanges = useMemo(() => hasTeamUnsavedChanges(draft, savedTeam) || pendingAlias.trim() !== "", [draft, savedTeam, pendingAlias]);
  const changeCount = useMemo(() => {
    if (!draft || !savedTeam) return 0;
    const keys = ["canonicalName", "scoreboardDisplayName", "shortName", "aliases", "liveMatchNames", "notes", "active"] as const;
    return keys.filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(savedTeam[key])).length + (pendingAlias.trim() ? 1 : 0);
  }, [draft, savedTeam, pendingAlias]);

  useEffect(() => {
    onDirtyChange(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  useEffect(() => () => onDirtyChange(false), []);

  useEffect(() => {
    if (!selectedTeam) {
      setDraft(null);
      setSavedTeam(null);
      setExternallyChanged(false);
      return;
    }
    if (!draft || !savedTeam || savedTeam.id !== selectedTeam.id) {
      setDraft(structuredClone(selectedTeam));
      setSavedTeam(structuredClone(selectedTeam));
      setPendingAlias("");
      setExternallyChanged(false);
      return;
    }
    if (!hasTeamUnsavedChanges(selectedTeam, savedTeam)) {
      return;
    }
    if (hasTeamUnsavedChanges(draft, savedTeam)) {
      setExternallyChanged(true);
      return;
    }
    setDraft(structuredClone(selectedTeam));
    setSavedTeam(structuredClone(selectedTeam));
    setExternallyChanged(false);
  }, [selectedTeam]);

  function withPendingAlias(team: TeamRecord): TeamRecord {
    const extra = splitNames(pendingAlias).filter((name) => !team.aliases.includes(name));
    return extra.length ? { ...team, aliases: [...team.aliases, ...extra] } : team;
  }

  async function handleSave(): Promise<boolean> {
    if (!draft) {
      return false;
    }
    setSaving(true);
    try {
      const saved = await api.saveTeam(withPendingAlias(draft));
      teams.setData((teams.data ?? []).map((team) => (team.id === saved.id ? saved : team)));
      setDraft(structuredClone(saved));
      setSavedTeam(structuredClone(saved));
      setPendingAlias("");
      setExternallyChanged(false);
      showToast({ kind: "success", message: `${saved.canonicalName} saved.` });
      return true;
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to save the team." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      if (!hasUnsavedChanges || saving) {
        return;
      }
      event.preventDefault();
      void handleSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasUnsavedChanges, saving, draft, pendingAlias]);

  function discard() {
    if (!savedTeam) return;
    setDraft(structuredClone(savedTeam));
    setPendingAlias("");
  }

  // Set on every render rather than cleared on unmount: the next team's panel mounts before this one unmounts.
  if (actionsRef) actionsRef.current = { save: handleSave, discard };

  async function handleDelete() {
    if (!selectedTeam || !window.confirm(`Delete ${selectedTeam.canonicalName}? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteTeam(selectedTeam.id);
      teams.setData((teams.data ?? []).filter((team) => team.id !== selectedTeam.id));
      showToast({ kind: "success", message: `Deleted ${selectedTeam.canonicalName}.` });
      onDirtyChange(false);
      onClose();
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete the team." });
    }
  }

  async function handleUploadLogo(slot: "primary" | "alternate", file: File) {
    if (!selectedTeam) {
      return;
    }
    try {
      const result = await api.uploadTeamLogo(selectedTeam.id, file, slot);
      applyLogoIds(result.team);
      assets.setData([result.asset, ...(assets.data ?? []).filter((asset) => asset.id !== result.asset.id)]);
      const note =
        result.processing.status === "processed"
          ? ""
          : ` Background removal ${result.processing.status}${result.processing.reason ? `: ${result.processing.reason}` : "."}`;
      showToast({ kind: "success", message: `${slot === "primary" ? "Logo" : "Alternate logo"} updated.${note}` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to upload the logo." });
    }
  }

  function applyLogoIds(saved: TeamRecord) {
    teams.setData((teams.data ?? []).map((team) => (team.id === saved.id ? saved : team)));
    const logoFields = { logoAssetId: saved.logoAssetId, alternateLogoAssetId: saved.alternateLogoAssetId, updatedAt: saved.updatedAt };
    setSavedTeam((current) => (current ? { ...current, ...logoFields } : current));
    setDraft((current) => (current ? { ...current, ...logoFields } : structuredClone(saved)));
  }

  async function handleLinkLogo(slot: "primary" | "alternate", assetId: string | null) {
    if (!selectedTeam) return;
    try {
      applyLogoIds(await api.linkTeamLogo(selectedTeam.id, assetId, slot));
      const label = slot === "primary" ? "Logo" : "Alternate logo";
      showToast({ kind: "success", message: assetId ? `${label} updated.` : `${label} removed.` });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to change the logo." });
    }
  }

  async function copyReference() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.id);
      showToast({ kind: "success", message: "Team reference copied.", durationMs: 1600 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to copy." });
    }
  }

  function commitPendingAlias() {
    if (!draft || !pendingAlias.trim()) return;
    setDraft(withPendingAlias(draft));
    setPendingAlias("");
  }

  if (teams.data && !selectedTeam) {
    return (
      <aside className="ad-inspector" aria-label="Team">
        <div className="ad-empty">
          <b>Team not found</b>
          <p className="ad-hint">It may have been deleted somewhere else.</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </aside>
    );
  }

  if (!draft || !selectedTeam) {
    return <aside className="ad-inspector" aria-label="Team" />;
  }

  const logos = [
    { slot: "primary" as const, label: "Logo", assetId: draft.logoAssetId },
    { slot: "alternate" as const, label: "Alternate", assetId: draft.alternateLogoAssetId }
  ];
  const primaryLogo = draft.logoAssetId ? assets.data?.find((asset) => asset.id === draft.logoAssetId) : null;
  const automatic = generatedNames(draft);

  return (
    <aside className="ad-inspector" aria-label={draft.canonicalName}>
      <div className="ad-insp-head">
        <span className="ad-insp-logo ad-checker">{primaryLogo ? <img src={primaryLogo.url} alt="" /> : null}</span>
        <div className="ad-insp-title">
          <b>{draft.canonicalName || "Untitled team"}</b>
          <span>{onAirSide ? `On air now · ${onAirSide} team` : draft.active ? "Used in live matching" : "Not used in live matching"}</span>
        </div>
        <Menu
          trigger={
            <IconButton label="More team actions">
              <Ellipsis />
            </IconButton>
          }
          items={[
            { label: "Copy team reference", onSelect: () => void copyReference() },
            { kind: "separator" },
            { label: "Delete team…", icon: <Trash2 />, danger: true, onSelect: () => void handleDelete() }
          ]}
        />
        <IconButton label="Close" title="Close (Esc)" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="ad-insp-body">
        {externallyChanged ? (
          <div className="ad-callout ad-callout--warning">
            <TriangleAlert aria-hidden />
            <span style={{ flex: 1 }}>This team was changed somewhere else while you were editing.</span>
            <Button
              size="sm"
              onClick={() => {
                if (hasUnsavedChanges && !window.confirm("Discard your changes and load the other version?")) return;
                setDraft(structuredClone(selectedTeam));
                setSavedTeam(structuredClone(selectedTeam));
                setPendingAlias("");
                setExternallyChanged(false);
              }}
            >
              Load theirs
            </Button>
          </div>
        ) : null}

        <section className="ad-insp-group">
          <h2>Names</h2>
          <Field label="Team name">
            {(id) => <input id={id} className="ad-input" value={draft.canonicalName} onChange={(event) => setDraft({ ...draft, canonicalName: event.target.value })} />}
          </Field>
          <div className="ad-row2">
            <Field label="On the scoreboard">
              {(id) => (
                <input
                  id={id}
                  className="ad-input"
                  value={draft.scoreboardDisplayName}
                  placeholder={draft.canonicalName}
                  onChange={(event) => setDraft({ ...draft, scoreboardDisplayName: event.target.value })}
                />
              )}
            </Field>
            <Field label="Short name">
              {(id) => <input id={id} className="ad-input" value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} />}
            </Field>
          </div>
        </section>

        <section className="ad-insp-group">
          <h2>
            Match names<span className="ad-hint">Feed names that pick this team</span>
          </h2>
          <div className="ad-sub">You added</div>
          <div className="ad-tokens">
            <NameTokens names={draft.aliases} removeLabel="Remove" onRemove={(name) => setDraft({ ...draft, aliases: draft.aliases.filter((entry) => entry !== name) })} />
            <input
              className="ad-input ad-token-add"
              placeholder="Add a name"
              aria-label="Add a match name"
              value={pendingAlias}
              onChange={(event) => {
                const value = event.target.value;
                if (/[,\n]/.test(value)) {
                  const extra = splitNames(value).filter((name) => !draft.aliases.includes(name));
                  setDraft({ ...draft, aliases: [...draft.aliases, ...extra] });
                  setPendingAlias("");
                } else {
                  setPendingAlias(value);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPendingAlias();
                } else if (event.key === "Backspace" && !pendingAlias && draft.aliases.length) {
                  setDraft({ ...draft, aliases: draft.aliases.slice(0, -1) });
                }
              }}
              onBlur={commitPendingAlias}
            />
          </div>
          <div className="ad-sub">
            Learned from live<span className="ad-hint">from Use and remember in Operations</span>
          </div>
          <div className="ad-tokens">
            {draft.liveMatchNames.length ? (
              <NameTokens
                names={draft.liveMatchNames}
                removeLabel="Forget"
                onRemove={(name) => setDraft({ ...draft, liveMatchNames: draft.liveMatchNames.filter((entry) => entry !== name) })}
              />
            ) : (
              <span className="ad-hint">None yet.</span>
            )}
          </div>
          {automatic.length ? (
            <>
              <div className="ad-sub">
                Automatic<span className="ad-hint">made from the names above</span>
              </div>
              <div className="ad-tokens">
                <NameTokens names={automatic} auto />
              </div>
            </>
          ) : null}
        </section>

        <section className="ad-insp-group">
          <h2>Logos</h2>
          <div className="ad-logos">
            {logos.map(({ slot, label, assetId }) => {
              const asset = assetId ? assets.data?.find((item) => item.id === assetId) ?? null : null;
              return (
                <div key={slot} className="ad-logo-slot">
                  <button
                    type="button"
                    className={asset ? "ad-logo-well ad-checker" : "ad-logo-well is-empty"}
                    onClick={() => uploadRefs[slot].current?.click()}
                    aria-label={asset ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
                  >
                    {asset ? <img src={asset.url} alt="" /> : `No ${label.toLowerCase()}`}
                  </button>
                  <div className="ad-logo-meta">
                    <span title={asset ? asset.displayName ?? asset.originalName : undefined}>
                      {asset ? `${label} · ${asset.displayName ?? asset.originalName}` : "PNG, JPG, WebP or GIF"}
                    </span>
                    <Button variant="text" onClick={() => uploadRefs[slot].current?.click()}>
                      {asset ? "Replace" : "Upload"}
                    </Button>
                    <AssetLibraryPicker
                      label={`${label} from library`}
                      value={assetId}
                      assets={assets.data ?? []}
                      onChange={(next) => void handleLinkLogo(slot, next)}
                      align="end"
                      trigger={<Button variant="text">Library</Button>}
                    />
                  </div>
                  <input
                    ref={uploadRefs[slot]}
                    hidden
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleUploadLogo(slot, file);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="ad-insp-group">
          <div className="ad-switch-row">
            <div>
              <b>Use in live matching</b>
              <p className="ad-hint">Inactive teams are skipped by automatic matching.</p>
            </div>
            <Switch label="Use in live matching" checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
          </div>
        </section>

        <section className="ad-insp-group">
          <Field label="Notes">
            {(id) => (
              <textarea
                id={id}
                className="ad-textarea"
                placeholder="Anything the next operator should know"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            )}
          </Field>
          <p className="ad-hint" title={formatUpdatedAtFull(draft.updatedAt)}>
            Last saved {formatUpdatedAtFull(draft.updatedAt)}
          </p>
        </section>
      </div>

      <div className="ad-insp-foot">
        <p className="ad-hint">
          {hasUnsavedChanges ? (
            <>
              {changeCount === 1 ? "1 unsaved change" : `${changeCount} unsaved changes`} · <kbd>{SAVE_SHORTCUT}</kbd>
            </>
          ) : (
            "All changes saved"
          )}
        </p>
        <Button variant="ghost" onClick={discard} disabled={!hasUnsavedChanges || saving}>
          Discard
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={!hasUnsavedChanges || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </aside>
  );
}
