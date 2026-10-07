/**
 * A compact, TypeScript-like description of the theme format for the theme AI assistant, generated from the zod
 * schema so it can't drift from what `themeSchema` accepts. A raw JSON Schema dump is several times larger.
 */
import { z } from "zod";
import { fontFamilies, themeSchema } from "./theme.js";

const INDENT = "  ";

function describeLiteral(value: unknown): string {
  return JSON.stringify(value);
}

/** Unwraps defaults, optionals, effects and lazies, noting what was optional. */
function unwrap(schema: z.ZodTypeAny): { schema: z.ZodTypeAny; optional: boolean } {
  let current = schema;
  let optional = false;
  for (;;) {
    if (current instanceof z.ZodDefault) {
      optional = true;
      current = current._def.innerType;
    } else if (current instanceof z.ZodOptional) {
      optional = true;
      current = current._def.innerType;
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema;
    } else if (current instanceof z.ZodLazy) {
      current = current._def.getter();
    } else if (current instanceof z.ZodCatch) {
      current = current._def.innerType;
    } else if (current instanceof z.ZodBranded) {
      current = current._def.type;
    } else if (current instanceof z.ZodPipeline) {
      current = current._def.out;
    } else {
      return { schema: current, optional };
    }
  }
}

function numberBounds(schema: z.ZodNumber): string {
  const parts: string[] = [];
  for (const check of schema._def.checks) {
    if (check.kind === "int") parts.push("int");
    if (check.kind === "min") parts.push(`${check.inclusive ? ">=" : ">"}${check.value}`);
    if (check.kind === "max") parts.push(`${check.inclusive ? "<=" : "<"}${check.value}`);
  }
  return parts.length ? `number(${parts.join(" ")})` : "number";
}

/** Renders a schema as text. Nested objects are rendered unindented and indented by the caller, so identical shapes
 * produce identical text and can be named once. */
class Renderer {
  /** Object text → how often it appears; filled by a counting pass. */
  readonly counts = new Map<string, number>();
  /** Object text → its name, for shapes worth defining once. */
  readonly names = new Map<string, string>();
  readonly definitions: string[] = [];
  private readonly usedNames = new Set<string>(["Theme"]);
  naming = false;

  render(schema: z.ZodTypeAny, key = "Item"): string {
    const { schema: inner } = unwrap(schema);
    if (inner instanceof z.ZodString) return "string";
    if (inner instanceof z.ZodNumber) return numberBounds(inner);
    if (inner instanceof z.ZodBoolean) return "boolean";
    if (inner instanceof z.ZodNull) return "null";
    if (inner instanceof z.ZodUnknown || inner instanceof z.ZodAny) return "unknown";
    if (inner instanceof z.ZodLiteral) return describeLiteral(inner._def.value);
    if (inner instanceof z.ZodEnum) return (inner._def.values as string[]).map(describeLiteral).join(" | ");
    if (inner instanceof z.ZodNativeEnum) return Object.values(inner._def.values).map(describeLiteral).join(" | ");
    if (inner instanceof z.ZodNullable) return `${this.render(inner._def.innerType, key)} | null`;
    if (inner instanceof z.ZodArray) {
      const element = this.render(inner._def.type, singular(key));
      return element.includes("\n") || element.includes("|") ? `Array<${element}>` : `${element}[]`;
    }
    if (inner instanceof z.ZodTuple) return `[${(inner._def.items as z.ZodTypeAny[]).map((item) => this.render(item, key)).join(", ")}]`;
    if (inner instanceof z.ZodRecord) return `Record<string, ${this.render(inner._def.valueType, singular(key))}>`;
    if (inner instanceof z.ZodUnion || inner instanceof z.ZodDiscriminatedUnion) {
      return [...(inner._def.options as Iterable<z.ZodTypeAny>)].map((option) => this.render(option, key)).join(" | ");
    }
    if (inner instanceof z.ZodIntersection) return `${this.render(inner._def.left, key)} & ${this.render(inner._def.right, key)}`;
    if (inner instanceof z.ZodObject) return this.object(inner, key);
    return "unknown";
  }

  private object(schema: z.AnyZodObject, key: string): string {
    const fields = Object.entries(schema.shape as Record<string, z.ZodTypeAny>).map(([field, value]) => {
      const { optional } = unwrap(value);
      return `${field}${optional ? "?" : ""}: ${this.render(value, field)}`;
    });
    const text = `{\n${fields.map((field) => indent(field)).join("\n")}\n}`;
    if (!this.naming) {
      this.counts.set(text, (this.counts.get(text) ?? 0) + 1);
      return text;
    }
    // Name shapes that repeat and are big enough for a name to save space.
    if ((this.counts.get(text) ?? 0) < 2 || text.length < 120) return text;
    let name = this.names.get(text);
    if (!name) {
      name = this.uniqueName(key);
      this.names.set(text, name);
      this.definitions.push(`type ${name} = ${text}`);
    }
    return name;
  }

  private uniqueName(key: string): string {
    const base = key.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, letter: string) => letter.toUpperCase()).replace(/^[a-z]/, (letter) => letter.toUpperCase()) || "Shape";
    let name = base;
    for (let n = 2; this.usedNames.has(name); n += 1) name = `${base}${n}`;
    this.usedNames.add(name);
    return name;
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => INDENT + line)
    .join("\n");
}

function singular(key: string): string {
  return key.endsWith("s") && key.length > 3 ? key.slice(0, -1) : key;
}

/** Notes for fields whose meaning isn't obvious from their names. Keep them short: they're sent on every request. */
const fieldNotes = `
Notes:
- Canvas coordinates are pixels on the theme's canvas (see canvas.width/height); x/y are the top-left corner.
- components holds the fixed scoreboard pieces, keyed by piece id (homeName, awayName, homeScore, ...). They can be moved, restyled or hidden, never removed or renamed.
- freeComponents are the designer's own layers: kind "text", "image" or "shape". Each has a unique id. New ones need a new unique id.
- Team names arrive truncated to 8 characters by the PBResults tablet; size name slots so 8 wide characters fit.
- Colours are CSS colour strings (#RRGGBB, #RRGGBBAA or rgba()).
- tokens.colors are named colours and styles.text / styles.surface are reusable looks. Pieces opt in through their design binding (tokenBindings, textStyleId, surfaceStyleId). Prefer changing a token or style over changing many pieces one by one.
- Font families must be built in (${fontFamilies.join(", ")}) or registered in the theme's fonts list.
- imageContentMode "visible-pixels" fits an image by its non-transparent pixels instead of its full canvas.
- momentOverlays are the event cards (eliminations, towel, timeout...); teamEventOverlay is the card shown over a team panel.
`.trim();

let cached: string | null = null;

/** The reference sent to the AI. Built once per process. */
export function themeReference(): string {
  if (cached) return cached;
  const renderer = new Renderer();
  renderer.render(themeSchema, "Theme");
  renderer.naming = true;
  const theme = renderer.render(themeSchema, "Theme");
  cached = [...renderer.definitions, `type Theme = ${theme}`, fieldNotes].join("\n\n");
  return cached;
}
