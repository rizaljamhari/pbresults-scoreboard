/**
 * The edit format the theme AI assistant answers in: a small subset of JSON Patch (add, replace, remove) where an
 * `@id` path segment picks an array item by its `id`. The AI never deals with array positions, and a change to one
 * layer doesn't mean rewriting the whole `freeComponents` array. Shared so the server checks exactly what the
 * editor will apply.
 */
import { z } from "zod";

export const themeOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string().min(1), value: z.unknown() }),
  z.object({ op: z.literal("replace"), path: z.string().min(1), value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: z.string().min(1) })
]);
export type ThemeOp = z.infer<typeof themeOpSchema>;

/** What the AI answers with. */
export const themeEditAnswerSchema = z.object({
  summary: z.string().trim().max(2000),
  ops: z.array(themeOpSchema).max(200)
});
export type ThemeEditAnswer = z.infer<typeof themeEditAnswerSchema>;

export class ThemeOpError extends Error {
  /** opIndex is null when the problem is with the edits as a whole rather than one of them. */
  constructor(
    readonly opIndex: number | null,
    message: string
  ) {
    super(opIndex === null ? message : `Edit ${opIndex + 1}: ${message}`);
  }
}

/** Top-level fields the AI must leave alone: identity, bookkeeping and history. */
const lockedTopLevel = new Set(["id", "builtin", "updatedAt", "archived", "versions"]);

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function parsePath(path: string): string[] {
  if (!path.startsWith("/")) throw new Error(`path must start with "/": ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** An array position for a segment: `@id`, a number, or `-` (the end, for add). */
function arrayIndex(array: unknown[], segment: string, forAdd: boolean): number {
  if (segment.startsWith("@")) {
    const id = segment.slice(1);
    const index = array.findIndex((item) => isContainer(item) && !Array.isArray(item) && item.id === id);
    if (index === -1) throw new Error(`no item with id "${id}"`);
    return index;
  }
  if (segment === "-" && forAdd) return array.length;
  if (!/^\d+$/.test(segment)) throw new Error(`"${segment}" is not a list position or @id`);
  const index = Number(segment);
  if (index > array.length || (!forAdd && index === array.length)) throw new Error(`position ${index} is out of range`);
  return index;
}

function child(container: Container, segment: string): unknown {
  if (Array.isArray(container)) return container[arrayIndex(container, segment, false)];
  if (!Object.prototype.hasOwnProperty.call(container, segment)) throw new Error(`"${segment}" doesn't exist`);
  return container[segment];
}

/** Every `id` held by an array item anywhere in the value, mapped to how many times it appears. */
function collectItemIds(value: unknown, into = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isContainer(item) && !Array.isArray(item) && typeof item.id === "string") into.set(item.id, (into.get(item.id) ?? 0) + 1);
      collectItemIds(item, into);
    }
  } else if (isContainer(value)) {
    for (const item of Object.values(value)) collectItemIds(item, into);
  }
  return into;
}

/**
 * Applies the ops to a copy of the theme and returns the copy. Throws a ThemeOpError naming the first op that can't
 * be applied. The result still needs `themeSchema` validation: this only checks that the edits make sense as edits.
 */
export function applyThemeOps<T extends object>(theme: T, ops: ThemeOp[]): T {
  const next = structuredClone(theme) as Record<string, unknown>;
  const removedIds = new Set<string>();

  ops.forEach((op, opIndex) => {
    try {
      const segments = parsePath(op.path);
      if (segments.length === 0 || segments[0] === "") throw new Error("the whole theme can't be replaced");
      if (lockedTopLevel.has(segments[0])) throw new Error(`"${segments[0]}" can't be changed`);
      if (segments[segments.length - 1] === "id") throw new Error("ids can't be changed");

      let parent: unknown = next;
      for (const segment of segments.slice(0, -1)) {
        if (!isContainer(parent)) throw new Error(`"${segment}" is inside a value that isn't an object or list`);
        parent = child(parent, segment);
      }
      if (!isContainer(parent)) throw new Error("the target's parent isn't an object or list");
      const last = segments[segments.length - 1];

      if (Array.isArray(parent)) {
        const index = arrayIndex(parent, last, op.op === "add");
        if (op.op === "add") parent.splice(index, 0, structuredClone(op.value));
        else if (op.op === "replace") parent[index] = structuredClone(op.value);
        else for (const id of collectItemIds([parent.splice(index, 1)[0]]).keys()) removedIds.add(id);
        return;
      }

      const exists = Object.prototype.hasOwnProperty.call(parent, last);
      if (op.op === "add") {
        parent[last] = structuredClone(op.value);
      } else if (!exists) {
        throw new Error(`"${last}" doesn't exist`);
      } else if (op.op === "replace") {
        parent[last] = structuredClone(op.value);
      } else {
        for (const id of collectItemIds([parent[last]]).keys()) removedIds.add(id);
        delete parent[last];
      }
    } catch (error) {
      throw new ThemeOpError(opIndex, error instanceof Error ? error.message : String(error));
    }
  });

  // A replace can drop or duplicate items without saying so. Anything that existed must survive unless an op removed
  // it on purpose, and no id may appear twice.
  const before = collectItemIds(theme);
  const after = collectItemIds(next);
  for (const id of before.keys()) {
    if (!after.has(id) && !removedIds.has(id)) throw new ThemeOpError(null, `item "${id}" disappeared without a remove`);
  }
  for (const [id, count] of after) {
    if (count > 1 && (before.get(id) ?? 0) < count) throw new ThemeOpError(null, `id "${id}" is used more than once`);
  }
  return next as T;
}
