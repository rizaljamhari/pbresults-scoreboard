import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const overlayFiles = [
  "src/client/pages/OverlayPage.tsx",
  "src/client/components/OverlayRenderer.tsx"
];

const variantPrefixPattern = /^(?:sm:|md:|lg:|xl:|2xl:|hover:|focus:|focus-visible:|active:|disabled:)+/;

const utilityTokenPatterns = [
  /^(flex|grid|inline-flex|inline-grid|block|inline-block|hidden)$/,
  /^(items|justify|content|self|place|gap|space-x|space-y|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|min-w|max-w|h|min-h|max-h|border|rounded|shadow|ring|transition|duration|ease)-/,
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|transparent|current|black|white|[a-z]+-[0-9]{2,3})$/,
  /^bg-(?:transparent|black|white|[a-z]+-[0-9]{2,3}|\[[^\]]+\])$/,
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^leading-/,
  /^tracking-/,
  /^opacity-/,
  /^z-/,
  /^(absolute|relative|fixed|sticky)$/,
  /^(top|right|bottom|left|inset)-/,
  /^(translate|scale|rotate|skew)-/
];

function isTailwindLikeToken(token) {
  if (!token) {
    return false;
  }

  // Arbitrary values and variant syntax are strong Tailwind indicators.
  if (token.includes("[") || variantPrefixPattern.test(token)) {
    return true;
  }

  return utilityTokenPatterns.some((pattern) => pattern.test(token));
}

let hasViolation = false;

for (const file of overlayFiles) {
  const filePath = resolve(root, file);
  const source = readFileSync(filePath, "utf8");

  const classNameMatches = source.match(/className\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\})/g) ?? [];
  for (const match of classNameMatches) {
    const classValue =
      match.match(/className\s*=\s*"([^"]*)"/)?.[1] ??
      match.match(/className\s*=\s*'([^']*)'/)?.[1] ??
      match.match(/className\s*=\s*\{`([^`]*)`\}/)?.[1] ??
      "";

    const tokens = classValue.split(/\s+/).filter(Boolean);
    const tailwindToken = tokens.find((token) => isTailwindLikeToken(token));

    if (tailwindToken) {
      hasViolation = true;
      console.error(`[overlay-scope] Tailwind-like utility token detected in ${file}`);
      console.error(`  offending token: ${tailwindToken}`);
      console.error(`  offending snippet: ${match}`);
    }
  }
}

if (hasViolation) {
  process.exit(1);
}

console.log("[overlay-scope] OK: no Tailwind-like utility tokens found in overlay files.");
