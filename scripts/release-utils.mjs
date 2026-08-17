const stableVersionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function normalizeStableVersion(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  const match = stableVersionPattern.exec(raw);
  if (!match) {
    throw new Error(`Invalid release version "${raw || "(empty)"}". Expected MAJOR.MINOR.PATCH, for example 1.7.0.`);
  }

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Invalid release version "${raw}". Version numbers must be safe integers.`);
  }

  const version = parts.join(".");
  return {
    version,
    tag: `v${version}`,
    parts
  };
}

export function compareStableVersions(left, right) {
  const leftVersion = typeof left === "string" ? normalizeStableVersion(left) : left;
  const rightVersion = typeof right === "string" ? normalizeStableVersion(right) : right;

  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.parts[index] - rightVersion.parts[index];
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return 0;
}

export function findLatestStableVersion(tags) {
  const stableVersions = [];
  for (const tag of tags) {
    try {
      stableVersions.push(normalizeStableVersion(tag));
    } catch {
      // Ignore non-release and prerelease tags when finding the latest stable version.
    }
  }
  return stableVersions.sort(compareStableVersions).at(-1) ?? null;
}

export function githubRepositoryFromRemote(remoteUrl) {
  const value = remoteUrl.trim().replace(/\.git$/, "");
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i,
    /^git@github\.com:([^/]+\/[^/]+)$/i,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/i
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function resolvePortableReleaseMetadata(releaseTag, packageVersion) {
  if (!releaseTag?.trim()) {
    return {
      appVersion: packageVersion,
      releaseTag: null,
      zipFileName: "PBResults-Scoreboard-win-x64.zip"
    };
  }
  const release = normalizeStableVersion(releaseTag);
  return {
    appVersion: release.version,
    releaseTag: release.tag,
    zipFileName: `pbresults-scoreboard-windows-portable-${release.tag}.zip`
  };
}
