import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAssets, useTeams } from "../hooks";
import { showToast } from "../toast";
import type { TeamRecord } from "../../shared/theme";
import { hasTeamUnsavedChanges } from "./teamAdminUtils";

function aliasesToText(aliases: string[]) {
  return aliases.join("\n");
}

function aliasesFromText(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TeamDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const teamId = params.id;
  const teams = useTeams();
  const assets = useAssets();
  const [draft, setDraft] = useState<TeamRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedTeam = useMemo(
    () => teams.data?.find((team) => team.id === teamId) ?? null,
    [teamId, teams.data]
  );

  const hasUnsavedChanges = useMemo(() => {
    return hasTeamUnsavedChanges(draft, selectedTeam);
  }, [draft, selectedTeam]);

  useEffect(() => {
    setDraft(selectedTeam ? structuredClone(selectedTeam) : null);
  }, [selectedTeam]);

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
      const saved = await api.saveTeam(draft);
      replaceTeamInCache(saved);
      setDraft(structuredClone(saved));
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
      setDraft(structuredClone(result.team));
      assets.setData([result.asset, ...(assets.data ?? []).filter((asset) => asset.id !== result.asset.id)]);
      showToast({ kind: "success", message: slot === "primary" ? "Primary logo updated." : "Alternate logo updated." });
    } catch (error) {
      showToast({ kind: "error", message: error instanceof Error ? error.message : "Failed to upload team logo." });
    }
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
              Canonical name
              <input value={draft.canonicalName} onChange={(event) => setDraft({ ...draft, canonicalName: event.target.value })} />
            </label>
            <label>
              Short name
              <input value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} />
            </label>
            <label>
              Aliases (comma or newline separated)
              <textarea
                rows={7}
                value={aliasesToText(draft.aliases)}
                onChange={(event) => setDraft({ ...draft, aliases: aliasesFromText(event.target.value) })}
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
      </div>
    </section>
  );
}
