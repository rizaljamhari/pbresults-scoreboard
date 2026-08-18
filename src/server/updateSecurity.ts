import path from "node:path";
import type { FastifyRequest } from "fastify";

const allowedAssetHosts = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com"
]);

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const normalized = address.split("%")[0].toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

export function isLoopbackRequest(request: FastifyRequest): boolean {
  return isLoopbackAddress(request.ip);
}

export function assertTrustedDownloadUrl(rawUrl: string, allowTestHttp = false): URL {
  const url = new URL(rawUrl);
  if (allowTestHttp && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return url;
  }
  if (url.protocol !== "https:" || !allowedAssetHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Release asset URL is not hosted by an approved GitHub endpoint.");
  }
  return url;
}

export function resolveContainedPath(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes its trusted root.");
  }
  return resolved;
}
