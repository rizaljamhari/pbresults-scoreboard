import { useMemo, useState, type ReactElement } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, CircleSlash, ImagePlus, Search } from "lucide-react";
import type { StoredAsset } from "../../shared/theme";
import { cn } from "../lib/utils";
import { isFontAsset } from "../../shared/fonts";

function displayName(asset: StoredAsset) {
  return asset.displayName?.trim() || asset.originalName;
}

/**
 * Picks an image from the shared asset library, with "None" and an upload tile.
 * The trigger takes the caller's class so it fits the editor or an admin page.
 */
export function AssetLibraryPicker({
  label,
  value,
  assets,
  onChange,
  onUpload,
  triggerClassName,
  trigger,
  align = "start"
}: {
  label: string;
  value: string | null;
  assets: StoredAsset[];
  onChange: (value: string | null) => void;
  onUpload?: (file: File) => void;
  triggerClassName?: string;
  /** Replaces the default thumbnail-and-name trigger, e.g. with a text button. */
  trigger?: ReactElement;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value ? assets.find((asset) => asset.id === value) ?? null : null;
  const shown = useMemo(() => {
    // Font files live in the library too; this picker is for images.
    const images = assets.filter((asset) => !isFontAsset(asset));
    const needle = query.trim().toLowerCase();
    return needle ? images.filter((asset) => displayName(asset).toLowerCase().includes(needle)) : images;
  }, [assets, query]);

  function choose(next: string | null) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        {trigger ?? (
          <button type="button" className={cn("asset-picker-trigger", triggerClassName)} aria-label={`${label}: ${selected ? displayName(selected) : value ? "Missing image" : "None"}`}>
            <span className="asset-picker-trigger-thumb">{selected ? <img src={selected.url} alt="" /> : null}</span>
            <span className="asset-picker-trigger-name">{selected ? displayName(selected) : value ? "Missing image" : "None"}</span>
            <ChevronDown aria-hidden className="asset-picker-trigger-chevron" />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ad-scope ad-pop ad-asset-picker" align={align} sideOffset={6} aria-label={label}>
          <label className="ad-search">
            <Search aria-hidden />
            <input
              className="ad-input"
              type="search"
              autoFocus
              placeholder="Search images"
              aria-label="Search images"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ul className="ad-asset-picker-grid" role="listbox" aria-label={label}>
            {onUpload ? (
              <li>
                <label className="ad-asset-picker-item" title="Upload a new image">
                  <ImagePlus aria-label="Upload a new image" />
                  <input
                    hidden
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) {
                        onUpload(file);
                        setOpen(false);
                      }
                    }}
                  />
                </label>
              </li>
            ) : null}
            <li>
              <button type="button" role="option" aria-selected={value === null} className="ad-asset-picker-item" title="No image" onClick={() => choose(null)}>
                <CircleSlash aria-hidden />
              </button>
            </li>
            {shown.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={asset.id === value}
                  className="ad-asset-picker-item ad-checker"
                  title={displayName(asset)}
                  onClick={() => choose(asset.id)}
                >
                  <img src={asset.url} alt={displayName(asset)} loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
          <div className="ad-asset-picker-foot">
            <span className="ad-hint">{assets.length ? `${shown.length} of ${assets.length}` : "The library is empty"}</span>
            <a href={value ? `/admin/assets/${encodeURIComponent(value)}` : "/admin/assets"} target="_blank" rel="noreferrer">
              Manage assets
            </a>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
