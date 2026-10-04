/** What an uploaded file's version is read from. */
export type AssetVersionSource = { contentHash?: string | null; updatedAt?: string | null; createdAt?: string | null };

/**
 * An uploaded file's own version: its content hash, or failing that when it last changed. Browsers cache uploads by
 * address, and the address carries this as `?v=`, so it moves exactly when the file's bytes do. The server marks a
 * response cacheable for good only when its `?v=` matches this, so client and server must compute it the same way.
 */
export function assetVersion(file: AssetVersionSource): string {
  if (file.contentHash) return file.contentHash.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  const changed = Date.parse(file.updatedAt ?? file.createdAt ?? "");
  return Number.isFinite(changed) ? String(changed) : "0";
}
