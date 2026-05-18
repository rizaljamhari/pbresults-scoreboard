import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useTeams } from "../hooks";
import { showToast } from "../toast";
import type { TeamRecord } from "../../shared/theme";
import { hasTeamUnsavedChanges } from "./teamAdminUtils";
import { generateTeamAliases, listExplicitTeamMatchNames } from "../../shared/teamMatching";

function aliasesToText(aliases: string[]) {
  return aliases.join("\n");
}

function aliasesFromText(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getExplicitMatchNames(team: TeamRecord) {
  return listExplicitTeamMatchNames(team);
}

function getGeneratedMatchNames(team: TeamRecord) {
  const explicit = new Set(getExplicitMatchNames(team).map((name) => name.trim()));
  return generateTeamAliases(team).filter((name) => !explicit.has(name.trim()));
}

export function TeamDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const teamId = params.id;
  const teams = useTeams();
  const assets = useAssets();
  const [draft, setDraft] = useState<TeamRecord | null>(null);
  const [aliasesText, setAliasesText] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedTeam = useMemo(
    () => teams.data?.find((team) => team.id === teamId) ?? null,
    [teamId, teams.data]
  );
  const explicitMatchNames = useMemo(() => (draft ? getExplicitMatchNames(draft) : []), [draft]);
  const generatedMatchNames = useMemo(() => (draft ? getGeneratedMatchNames(draft) : []), [draft]);

  const hasUnsavedChanges = useMemo(() => {
    return hasTeamUnsavedChanges(draft, selectedTeam);
  }, [draft, selectedTeam]);

  useEffect(() => {
    if (!selectedTeam) {
      setDraft(null);
      setAliasesText("");
      return;
    }

    setDraft(structuredClone(selectedTeam));
    setAliasesText(aliasesToText(selectedTeam.aliases));
  }, [selectedTeam?.id]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

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
  }, [hasUnsavedChanges, saving, draft]);

  function canLeaveEditor() {
    if (!hasUnsavedChanges) {
      return true;
    }
    return window.confirm("You have unsaved changes. Leave this page and discard them?");
  }

  function selectedAsset(assetId: string | null | undefined) {
    return assetId ? assets.data?.find((asset) => asset.id === assetId) ?? null : null;
  }

  function replaceTeamInCache(next: TeamRecord) {
    teams.setData((teams.data ?? []).map((team) => (team.id === next.id ? next : team)));
  }

  async function handleSave() {
    if (!draft) {
      return;
    }

    setSaving(true);
    try {
      const nextDraft = {
        ...draft,
        aliases: aliasesFromText(aliasesText)
      };
      const saved = await api.saveTeam(nextDraft);
      replaceTeamInCache(saved);
      setDraft(structuredClone(saved));
      setAliasesText(aliasesToText(saved.aliases));
      showToast({ kind: "success", message: "Team updated." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to update team." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedTeam) {
      return;
    }

    const confirmed = window.confirm(`Delete ${selectedTeam.canonicalName}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    try {
      await api.deleteTeam(selectedTeam.id);
      teams.setData((teams.data ?? []).filter((team) => team.id !== selectedTeam.id));
      showToast({ kind: "success", message: `Deleted ${selectedTeam.canonicalName}.` });
      navigate("/admin/teams");
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete team." });
    }
  }

  async function handleUploadLogo(slot: "primary" | "alternate", file: File) {
    if (!selectedTeam) {
      return;
    }

    try {
      const result = await api.uploadTeamLogo(selectedTeam.id, file, slot);
      replaceTeamInCache(result.team);
      setDraft((current) => {
        if (!current) {
          return structuredClone(result.team);
        }
        return {
          ...current,
          logoAssetId: result.team.logoAssetId,
          alternateLogoAssetId: result.team.alternateLogoAssetId,
          updatedAt: result.team.updatedAt
        };
      });
      assets.setData([result.asset, ...(assets.data ?? []).filter((asset) => asset.id !== result.asset.id)]);
      const fallbackMessage =
        result.processing.status === "processed"
          ? ""
          : ` Background removal ${result.processing.status}${result.processing.reason ? `: ${result.processing.reason}` : "."}`;
      showToast({
        kind: "success",
        message: `${slot === "primary" ? "Primary logo updated." : "Alternate logo updated."}${fallbackMessage}`
      });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to upload team logo." });
    }
  }

  async function handleCopyTeamId() {
    try {
      await navigator.clipboard.writeText(draft.id);
      showToast({ kind: "success", message: "Team ID copied.", durationMs: 1600 });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to copy Team ID." });
    }
  }

  function removeLiveMatchName(name: string) {
    setDraft({
      ...draft,
      liveMatchNames: draft.liveMatchNames.filter((entry) => entry !== name)
    });
  }

  if (teams.loading && !teams.data) {
    return <section className="panel">Loading team…</section>;
  }

  if (!selectedTeam || !draft) {
    return (
      <section className="admin-page panel-stack">
        <header className="admin-page-header">
          <div>
            <p className="eyebrow">Team Registry</p>
            <h2>Team not found</h2>
            <p className="hint">The selected team no longer exists.</p>
          </div>
          <Link
            className="secondary-button"
            to="/admin/teams"
            onClick={(event) => {
              if (!canLeaveEditor()) {
                event.preventDefault();
              }
            }}
          >
            Back to overview
          </Link>
        </header>
      </section>
    );
  }

  return (
    <section className="admin-page panel-stack">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">Team Registry</p>
          <h2>Edit team</h2>
          <p className="hint">Update team profile, alias matching, and logo assets.</p>
        </div>
        <div className="action-row compact">
          <Link
            className="secondary-button"
            to="/admin/teams"
            onClick={(event) => {
              if (!canLeaveEditor()) {
                event.preventDefault();
              }
            }}
          >
            Back to overview
          </Link>
          <button className="secondary-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button className="danger-button" onClick={() => void handleDelete()}>
            Delete team
          </button>
        </div>
      </header>

      <div className="admin-grid-2">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Profile</p>
              <h3>{draft.canonicalName}</h3>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Team reference
              <div className="field-with-action">
                <input value={draft.id} readOnly />
                <button className="secondary-button" type="button" onClick={() => void handleCopyTeamId()}>
                  Copy
                </button>
              </div>
              <span className="hint">Used internally for team import/export and safe identification.</span>
            </label>
            <label>
              Canonical name
              <input value={draft.canonicalName} onChange={(event) => setDraft({ ...draft, canonicalName: event.target.value })} />
            </label>
            <label>
              Scoreboard display name
              <input
                value={draft.scoreboardDisplayName}
                onChange={(event) => setDraft({ ...draft, scoreboardDisplayName: event.target.value })}
                placeholder="Optional override used on scoreboard"
              />
            </label>
            <label>
              Short name
              <input value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} />
            </label>
            <label>
              Aliases (comma or newline separated)
              <textarea
                rows={7}
                value={aliasesText}
                onChange={(event) => setAliasesText(event.target.value)}
                onBlur={() => {
                  const parsed = aliasesFromText(aliasesText);
                  setDraft({ ...draft, aliases: parsed });
                  setAliasesText(aliasesToText(parsed));
                }}
              />
            </label>
            <label>
              Notes
              <textarea rows={5} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
              Active in live matching
            </label>
            {hasUnsavedChanges ? <p className="hint">You have unsaved changes.</p> : null}
            <p className="hint">Tip: press Ctrl/Cmd+S to save quickly.</p>
          </div>
        </div>

        <div className="panel-stack">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Logos</p>
                <h3>Primary and alternate assets</h3>
              </div>
            </div>

            <div className="team-logo-grid">
              {([
                ["Primary logo", draft.logoAssetId, "primary"],
                ["Alternate logo", draft.alternateLogoAssetId, "alternate"]
              ] as const).map(([label, assetId, slot]) => {
                const asset = selectedAsset(assetId);
                return (
                  <div key={slot} className="team-logo-card">
                    <strong>{label}</strong>
                    <div className="team-logo-preview">
                      {asset ? <img src={asset.url} alt={asset.originalName} className="team-logo-image" /> : <span>No asset</span>}
                    </div>
                    <span className="hint">{asset?.originalName ?? "Upload a PNG, JPG, or GIF."}</span>
                    <label className="secondary-button">
                      Upload
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void handleUploadLogo(slot, file);
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Matching</p>
                <h3>Entered match names</h3>
                <p className="hint">
                  These are the names you entered directly on this team and the matcher will use them exactly.
                </p>
              </div>
            </div>

            <div className="chip-row">
              {explicitMatchNames.length ? (
                explicitMatchNames.map((name) => (
                  <span key={name} className="pill">
                    {name}
                  </span>
                ))
              ) : (
                <span className="hint">No names available yet.</span>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Live Match Names</p>
                <h3>Remembered from live resolution</h3>
                <p className="hint">
                  These short names were learned from Operations. Remove any that should no longer auto-match this team.
                </p>
              </div>
            </div>

            {draft.liveMatchNames.length ? (
              <div className="chip-row">
                {draft.liveMatchNames.map((name) => (
                  <button key={name} className="pill-button" type="button" onClick={() => removeLiveMatchName(name)}>
                    <span>{name}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">No learned live names yet. Use “Use and remember” from Operations to add them.</p>
            )}
            <p className="hint">Changes take effect after you save this team.</p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Generated Shortcuts</p>
                <h3>Automatic helper names</h3>
                <p className="hint">
                  These are derived from the team name automatically, such as initials or shorthand. They help matching but are not manually editable here.
                </p>
              </div>
            </div>

            <div className="chip-row">
              {generatedMatchNames.length ? (
                generatedMatchNames.map((name) => (
                  <span key={name} className="pill">
                    {name}
                  </span>
                ))
              ) : (
                <span className="hint">No generated shortcuts for this team.</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
