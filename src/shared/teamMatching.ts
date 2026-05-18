import { teamMatchResultSchema, type TeamMatchResult, type TeamRecord } from "./theme.js";

type Candidate = {
  team: TeamRecord;
  alias: string;
  normalizedAlias: string;
  compactAlias: string;
  confidence: number;
};

function compactName(value: string): string {
  return value.replace(/\s+/g, "");
}

function makeBigrams(value: string): string[] {
  const source = compactName(value);
  if (source.length < 2) {
    return source ? [source] : [];
  }
  const bigrams: string[] = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    bigrams.push(source.slice(index, index + 2));
  }
  return bigrams;
}

function diceCoefficient(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }

  const leftPairs = makeBigrams(left);
  const rightPairs = makeBigrams(right);
  if (leftPairs.length === 0 || rightPairs.length === 0) {
    return 0;
  }

  const rightPool = [...rightPairs];
  let matches = 0;
  for (const pair of leftPairs) {
    const matchIndex = rightPool.indexOf(pair);
    if (matchIndex > -1) {
      matches += 1;
      rightPool.splice(matchIndex, 1);
    }
  }
  return (2 * matches) / (leftPairs.length + rightPairs.length);
}

export function normalizeTeamName(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateTeamAliases(team: TeamRecord): string[] {
  const aliases = new Set<string>();
  const push = (value: string) => {
    const clean = value.trim();
    if (clean) {
      aliases.add(clean);
    }
  };

  push(team.canonicalName);
  push(team.scoreboardDisplayName);
  push(team.shortName);
  for (const alias of team.aliases) {
    push(alias);
  }
  for (const liveMatchName of team.liveMatchNames) {
    push(liveMatchName);
  }

  const normalizedCanonical = normalizeTeamName(team.canonicalName);
  const words = normalizedCanonical.split(" ").filter(Boolean);
  if (words.length > 1) {
    push(words.map((word) => word[0]).join(""));
    push(words[words.length - 1]);
  }

  return [...aliases];
}

export function listExplicitTeamMatchNames(team: TeamRecord): string[] {
  const names = new Set<string>();
  const push = (value: string) => {
    const clean = value.trim();
    if (clean) {
      names.add(clean);
    }
  };

  push(team.canonicalName);
  push(team.scoreboardDisplayName);
  push(team.shortName);
  for (const alias of team.aliases) {
    push(alias);
  }
  for (const liveMatchName of team.liveMatchNames) {
    push(liveMatchName);
  }

  return [...names];
}

function buildCandidates(inputName: string, teams: TeamRecord[]): Candidate[] {
  const normalizedInput = normalizeTeamName(inputName);
  const compactInput = compactName(normalizedInput);

  return teams
    .filter((team) => team.active)
    .flatMap((team) =>
      generateTeamAliases(team).map((alias) => {
        const normalizedAlias = normalizeTeamName(alias);
        const compactAlias = compactName(normalizedAlias);
        let confidence = 0;

        if (normalizedInput && normalizedInput === normalizedAlias) {
          confidence = 1;
        } else if (compactInput && compactInput === compactAlias) {
          confidence = 0.98;
        } else if (compactInput && compactAlias) {
          confidence = Math.max(
            diceCoefficient(normalizedInput, normalizedAlias) * 0.92,
            diceCoefficient(compactInput, compactAlias) * 0.95
          );
        }

        return {
          team,
          alias,
          normalizedAlias,
          compactAlias,
          confidence
        };
      })
    );
}

export function matchTeamName(inputName: string, teams: TeamRecord[]): TeamMatchResult {
  const normalizedInput = normalizeTeamName(inputName);
  if (!normalizedInput) {
    return teamMatchResultSchema.parse({
      inputName,
      normalizedInput,
      status: "unmatched",
      confidence: 0,
      matchedAlias: null,
      teamId: null,
      team: null,
      candidates: []
    });
  }

  const rankedByTeam = new Map<string, Candidate>();
  for (const candidate of buildCandidates(inputName, teams)) {
    const existing = rankedByTeam.get(candidate.team.id);
    if (!existing || candidate.confidence > existing.confidence) {
      rankedByTeam.set(candidate.team.id, candidate);
    }
  }

  const ranked = [...rankedByTeam.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.team.canonicalName.localeCompare(right.team.canonicalName);
  });

  const exactMatches = ranked.filter((candidate) => candidate.confidence >= 0.98);
  if (exactMatches.length === 1) {
    const hit = exactMatches[0];
    return teamMatchResultSchema.parse({
      inputName,
      normalizedInput,
      status: "matched",
      confidence: hit.confidence,
      matchedAlias: hit.alias,
      teamId: hit.team.id,
      team: hit.team,
      candidates: ranked.slice(0, 3).map((candidate) => ({
        teamId: candidate.team.id,
        teamName: candidate.team.canonicalName,
        confidence: Number(candidate.confidence.toFixed(4)),
        matchedAlias: candidate.alias
      }))
    });
  }

  if (exactMatches.length > 1) {
    return teamMatchResultSchema.parse({
      inputName,
      normalizedInput,
      status: "uncertain",
      confidence: exactMatches[0]?.confidence ?? 0,
      matchedAlias: null,
      teamId: null,
      team: null,
      candidates: exactMatches.slice(0, 5).map((candidate) => ({
        teamId: candidate.team.id,
        teamName: candidate.team.canonicalName,
        confidence: Number(candidate.confidence.toFixed(4)),
        matchedAlias: candidate.alias
      }))
    });
  }

  const suggestions = ranked.filter((candidate) => candidate.confidence >= 0.55).slice(0, 5);
  if (suggestions.length > 0) {
    const top = suggestions[0];
    return teamMatchResultSchema.parse({
      inputName,
      normalizedInput,
      status: "uncertain",
      confidence: Number(top.confidence.toFixed(4)),
      matchedAlias: null,
      teamId: null,
      team: null,
      candidates: suggestions.map((candidate) => ({
        teamId: candidate.team.id,
        teamName: candidate.team.canonicalName,
        confidence: Number(candidate.confidence.toFixed(4)),
        matchedAlias: candidate.alias
      }))
    });
  }

  return teamMatchResultSchema.parse({
    inputName,
    normalizedInput,
    status: "unmatched",
    confidence: 0,
    matchedAlias: null,
    teamId: null,
    team: null,
    candidates: []
  });
}
