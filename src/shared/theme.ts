import { z } from "zod";

export const componentIds = [
  "homeName",
  "homeTeamLogo",
  "homeScore",
  "awayName",
  "awayTeamLogo",
  "awayScore",
  "gameTime",
  "breakTime",
  "eventLogo"
] as const;

export type ComponentId = (typeof componentIds)[number];

export const fontFamilies = [
  "Bebas Neue",
  "Oswald",
  "Barlow Condensed",
  "Arial Narrow",
  "Helvetica Neue"
] as const;

export const backgroundImageFitValues = ["cover", "contain", "stretch"] as const;
export const backgroundImagePositionValues = ["center", "top", "bottom", "left", "right"] as const;
export const concedePositionValues = ["above", "overlapping-top"] as const;
export const concedeAnimationValues = ["slide-horizontal", "slide-vertical", "none"] as const;
export const teamOverlayPlacementValues = ["full-panel", "center-stamp", "top-ribbon"] as const;
export const centerSecondaryModeValues = ["timer", "staticText", "hidden"] as const;
export const centerSecondaryTransitionValues = ["none", "fade", "slide-up"] as const;

export const commonFrameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  zIndex: z.number().int(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  backgroundColor: z.string(),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundImageFit: z.enum(backgroundImageFitValues).default("cover"),
  backgroundImagePosition: z.enum(backgroundImagePositionValues).default("center"),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0),
  borderColor: z.string(),
  borderWidth: z.number().min(0),
  borderRadius: z.number().min(0),
  padding: z.number().min(0),
  shadow: z.string()
});

export const textComponentSchema = commonFrameSchema.extend({
  kind: z.literal("text"),
  fontFamily: z.enum(fontFamilies),
  fontSize: z.number().positive(),
  fontWeight: z.number().min(100).max(900),
  color: z.string(),
  textAlign: z.enum(["left", "center", "right"]),
  letterSpacing: z.number(),
  lineHeight: z.number().positive()
});

export const imageComponentSchema = commonFrameSchema.extend({
  kind: z.literal("image"),
  assetId: z.string().nullable()
});

const defaultImageComponentValue = {
  kind: "image" as const,
  x: 0,
  y: 0,
  width: 120,
  height: 120,
  zIndex: 1,
  visible: false,
  opacity: 1,
  backgroundColor: "#00000000",
  backgroundImageAssetId: null,
  backgroundImageFit: "contain" as const,
  backgroundImagePosition: "center" as const,
  backgroundOverlayColor: "#000000",
  backgroundOverlayOpacity: 0,
  borderColor: "#00000000",
  borderWidth: 0,
  borderRadius: 0,
  padding: 0,
  shadow: "none",
  assetId: null
};

export const concedeStateSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().default("Conceded"),
  placementMode: z.enum(teamOverlayPlacementValues).default("center-stamp"),
  position: z.enum(concedePositionValues).default("above"),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  height: z.number().positive().default(44),
  padding: z.number().min(0).default(12),
  backgroundColor: z.string().default("#111111ee"),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundImageFit: z.enum(backgroundImageFitValues).default("cover"),
  backgroundImagePosition: z.enum(backgroundImagePositionValues).default("center"),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0),
  borderColor: z.string().default("#ffffff"),
  borderWidth: z.number().min(0).default(2),
  borderRadius: z.number().min(0).default(12),
  color: z.string().default("#ffffff"),
  fontFamily: z.enum(fontFamilies).default("Oswald"),
  fontSize: z.number().positive().default(28),
  fontWeight: z.number().min(100).max(900).default(700),
  letterSpacing: z.number().default(1),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  shadow: z.string().default("none"),
  animationPreset: z.enum(concedeAnimationValues).default("slide-vertical"),
  durationMs: z.number().positive().default(2000)
});

export const centerSecondarySchema = z.object({
  gameMode: z.enum(centerSecondaryModeValues).default("staticText"),
  gameText: z.string().default(""),
  breakMode: z.enum(centerSecondaryModeValues).default("timer"),
  breakText: z.string().default(""),
  timerStyle: z
    .object({
      fontFamily: z.enum(fontFamilies).default("Barlow Condensed"),
      fontSize: z.number().positive().default(28),
      fontWeight: z.number().min(100).max(900).default(700),
      color: z.string().default("#f6f1e8")
    })
    .default({}),
  staticStyle: z
    .object({
      fontFamily: z.enum(fontFamilies).default("Barlow Condensed"),
      fontSize: z.number().positive().default(28),
      fontWeight: z.number().min(100).max(900).default(700),
      color: z.string().default("#f6f1e8")
    })
    .default({}),
  transition: z
    .object({
      animation: z.enum(centerSecondaryTransitionValues).default("fade"),
      durationMs: z.number().positive().default(250)
    })
    .default({})
});

export const themeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  builtin: z.boolean(),
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    backgroundColor: z.string(),
    transparentPreview: z.boolean(),
    safeArea: z.boolean()
  }),
  components: z.object({
    homeName: textComponentSchema,
    homeTeamLogo: imageComponentSchema.default(defaultImageComponentValue),
    homeScore: textComponentSchema,
    awayName: textComponentSchema,
    awayTeamLogo: imageComponentSchema.default(defaultImageComponentValue),
    awayScore: textComponentSchema,
    gameTime: textComponentSchema,
    breakTime: textComponentSchema,
    eventLogo: imageComponentSchema
  }),
  concedeState: concedeStateSchema.default({}),
  centerSecondary: centerSecondarySchema.default({})
});

export const settingsSchema = z.object({
  upstreamBaseUrl: z.string().url(),
  publishedThemeId: z.string().nullable(),
  pollIntervalMs: z.number().int().min(100).max(10000).default(1000)
});

export const timerSchema = z.object({
  value: z.number(),
  state: z.number()
});

export const teamSchema = z.object({
  name: z.string(),
  score: z.number(),
  playersAlive: z.number().optional(),
  timer: z
    .object({
      value: z.number(),
      state: z.number()
    })
    .nullable()
    .optional(),
  midName: z.string().optional(),
  image: z.string().optional()
});

export const teamRecordSchema = z.object({
  id: z.string(),
  canonicalName: z.string().min(1),
  shortName: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  logoAssetId: z.string().nullable().default(null),
  alternateLogoAssetId: z.string().nullable().default(null),
  notes: z.string().default(""),
  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const teamMatchCandidateSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  confidence: z.number().min(0).max(1),
  matchedAlias: z.string().nullable()
});

export const teamMatchResultSchema = z.object({
  inputName: z.string(),
  normalizedInput: z.string(),
  status: z.enum(["matched", "uncertain", "unmatched"]),
  confidence: z.number().min(0).max(1),
  matchedAlias: z.string().nullable(),
  teamId: z.string().nullable(),
  team: teamRecordSchema.nullable(),
  candidates: z.array(teamMatchCandidateSchema).default([])
});

export const normalizedLiveStateSchema = z.object({
  sourceStatus: z.enum(["idle", "ok", "error"]),
  fetchedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  state: z.string(),
  period: z.string(),
  round: z.number(),
  sidesSwitched: z.number(),
  secondGame: z.union([z.boolean(), z.array(teamSchema)]),
  homeTeam: teamSchema,
  awayTeam: teamSchema,
  displayLeftTeam: teamSchema,
  displayRightTeam: teamSchema,
  homeTeamMatch: teamMatchResultSchema,
  awayTeamMatch: teamMatchResultSchema,
  displayLeftTeamMatch: teamMatchResultSchema,
  displayRightTeamMatch: teamMatchResultSchema,
  unresolvedTeamNames: z.array(z.string()).default([]),
  breakTimer: timerSchema,
  gameTimer: timerSchema,
  towelEvent: z.enum(["home", "away", "none"])
});

export const assetSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  url: z.string(),
  createdAt: z.string()
});

export const themeExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  theme: themeSchema,
  assets: z.array(
    z.object({
      asset: assetSchema,
      data: z.string()
    })
  )
});

export const appExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  settings: settingsSchema,
  themes: z.array(themeSchema),
  teams: z.array(teamRecordSchema).default([]),
  assets: z.array(
    z.object({
      asset: assetSchema,
      data: z.string()
    })
  )
});

export type TextThemeComponent = z.infer<typeof textComponentSchema>;
export type ImageThemeComponent = z.infer<typeof imageComponentSchema>;
export type ThemeDefinition = z.infer<typeof themeSchema>;
export type AppSettings = z.infer<typeof settingsSchema>;
export type NormalizedLiveState = z.infer<typeof normalizedLiveStateSchema>;
export type StoredAsset = z.infer<typeof assetSchema>;
export type TeamRecord = z.infer<typeof teamRecordSchema>;
export type TeamMatchResult = z.infer<typeof teamMatchResultSchema>;
export type ThemeExportPackage = z.infer<typeof themeExportSchema>;
export type AppExportPackage = z.infer<typeof appExportSchema>;

export const defaultSettings: AppSettings = {
  upstreamBaseUrl: "http://192.168.100.67:5000",
  publishedThemeId: "builtin-classic-chroma",
  pollIntervalMs: 1000
};

export function createThemeId(prefix = "theme"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
