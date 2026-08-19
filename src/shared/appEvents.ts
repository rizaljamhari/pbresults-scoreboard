import { z } from "zod";
import { normalizedLiveStateSchema, operatorTextStateSchema } from "./theme.js";

export const appResourceDomains = ["settings", "themes", "assets", "teams"] as const;
export type AppResourceDomain = (typeof appResourceDomains)[number];

export const appChangedEventTypes = [
  "settings.changed",
  "themes.changed",
  "theme.published",
  "assets.changed",
  "teams.changed"
] as const;
export type AppChangedEventType = (typeof appChangedEventTypes)[number];

export const appRealtimeEventTypes = ["live.state", "operator-text.state"] as const;
export type AppRealtimeEventType = (typeof appRealtimeEventTypes)[number];

export const appEventTypeToDomain: Record<AppChangedEventType, AppResourceDomain> = {
  "settings.changed": "settings",
  "themes.changed": "themes",
  "theme.published": "settings",
  "assets.changed": "assets",
  "teams.changed": "teams"
};

export const appResourceRevisionsSchema = z.object({
  settings: z.number().int().nonnegative(),
  themes: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
  teams: z.number().int().nonnegative()
});

const appEventCommonSchema = z.object({
  protocol: z.literal(1),
  instanceId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime()
});

export const appEventSnapshotSchema = appEventCommonSchema.extend({
  type: z.literal("system.snapshot"),
  revisions: appResourceRevisionsSchema,
  runtime: z.object({
    appVersion: z.string().min(1),
    releaseTag: z.string().nullable()
  }),
  liveState: normalizedLiveStateSchema.optional(),
  operatorTextState: operatorTextStateSchema.optional()
});

const changedEventFields = {
  revision: z.number().int().positive(),
  resourceIds: z.array(z.string().min(1)).max(100).optional()
};

export const appChangedEventSchema = z.discriminatedUnion("type", [
  appEventCommonSchema.extend({ type: z.literal("settings.changed"), ...changedEventFields }),
  appEventCommonSchema.extend({ type: z.literal("themes.changed"), ...changedEventFields }),
  appEventCommonSchema.extend({ type: z.literal("theme.published"), ...changedEventFields }),
  appEventCommonSchema.extend({ type: z.literal("assets.changed"), ...changedEventFields }),
  appEventCommonSchema.extend({ type: z.literal("teams.changed"), ...changedEventFields })
]);

export const appRealtimeEventSchema = z.discriminatedUnion("type", [
  appEventCommonSchema.extend({
    type: z.literal("live.state"),
    state: normalizedLiveStateSchema
  }),
  appEventCommonSchema.extend({
    type: z.literal("operator-text.state"),
    state: operatorTextStateSchema
  })
]);

export const appEventSchema = z.discriminatedUnion("type", [
  appEventSnapshotSchema,
  ...appChangedEventSchema.options,
  ...appRealtimeEventSchema.options
]);

export type AppResourceRevisions = z.infer<typeof appResourceRevisionsSchema>;
export type AppEventSnapshot = z.infer<typeof appEventSnapshotSchema>;
export type AppChangedEvent = z.infer<typeof appChangedEventSchema>;
export type AppRealtimeEvent = z.infer<typeof appRealtimeEventSchema>;
export type AppEvent = z.infer<typeof appEventSchema>;
export type RuntimeIdentity = AppEventSnapshot["runtime"];

export const initialAppResourceRevisions: AppResourceRevisions = {
  settings: 0,
  themes: 0,
  assets: 0,
  teams: 0
};

export function parseAppEventMessage(eventType: string, data: string): AppEvent | null {
  try {
    const parsed = appEventSchema.parse(JSON.parse(data));
    return parsed.type === eventType ? parsed : null;
  } catch {
    return null;
  }
}
