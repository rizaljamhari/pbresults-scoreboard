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
export const backgroundImageModeValues = ["asset", "homeTeamLogo", "awayTeamLogo"] as const;
export const teamLogoFallbackModeValues = ["none", "eventLogo", "slotFallback", "slotFallbackThenEventLogo"] as const;
export const concedePositionValues = ["above", "overlapping-top"] as const;
export const concedeAnimationValues = ["slide-horizontal", "slide-vertical", "none"] as const;
export const teamOverlayPlacementValues = ["full-panel", "center-stamp", "top-ribbon"] as const;
export const teamOverlayFollowTargetValues = ["none", "logo", "name"] as const;
export const centerSecondaryModeValues = ["timer", "staticText", "hidden"] as const;
export const centerSecondaryTransitionValues = ["none", "fade", "slide-up", "slide-left", "slide-right"] as const;

function migrateLegacyFrame(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const candidate = input as Record<string, unknown>;
  const legacyPadding = typeof candidate.padding === "number" ? candidate.padding : 0;

  return {
    ...candidate,
    paddingX: candidate.paddingX ?? legacyPadding,
    paddingY: candidate.paddingY ?? legacyPadding,
    borderRadius: Array.isArray(candidate.borderRadius)
      ? candidate.borderRadius
      : typeof candidate.borderRadius === "number"
        ? [candidate.borderRadius, candidate.borderRadius, candidate.borderRadius, candidate.borderRadius]
        : [0, 0, 0, 0],
    offsetX: candidate.offsetX ?? 0,
    offsetY: candidate.offsetY ?? 0
  };
}

const commonFrameBaseSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  zIndex: z.number().int(),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  backgroundColor: z.string(),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundImageMode: z.enum(backgroundImageModeValues).default("asset"),
  backgroundImageFit: z.enum(backgroundImageFitValues).default("cover"),
  backgroundImagePosition: z.enum(backgroundImagePositionValues).default("center"),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0),
  borderColor: z.string(),
  borderWidth: z.number().min(0),
  borderRadius: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]),
  paddingX: z.number().min(0),
  paddingY: z.number().min(0),
  offsetX: z.number(),
  offsetY: z.number(),
  shadow: z.string()
});

export const commonFrameSchema = z.preprocess(migrateLegacyFrame, commonFrameBaseSchema);

const textComponentBaseSchema = commonFrameBaseSchema.extend({
  kind: z.literal("text"),
  fontFamily: z.enum(fontFamilies),
  fontSize: z.number().positive(),
  fontWeight: z.number().min(100).max(900),
  color: z.string(),
  textAlign: z.enum(["left", "center", "right"]),
  letterSpacing: z.number(),
  lineHeight: z.number().positive()
});

export const textComponentSchema = z.preprocess(migrateLegacyFrame, textComponentBaseSchema);

const imageComponentBaseSchema = commonFrameBaseSchema.extend({
  kind: z.literal("image"),
  assetId: z.string().nullable(),
  teamLogoFallbackMode: z.enum(teamLogoFallbackModeValues).default("slotFallback")
});

export const imageComponentSchema = z.preprocess(migrateLegacyFrame, imageComponentBaseSchema);

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
  paddingX: 0,
  paddingY: 0,
  offsetX: 0,
  offsetY: 0,
  shadow: "none",
  assetId: null,
  teamLogoFallbackMode: "slotFallback" as const
};

const teamEventOverlayGeneralSchema = z.object({
  enabled: z.boolean().default(true),
  teamSwitchEnabled: z.boolean().default(true),
  placementMode: z.enum(teamOverlayPlacementValues).default("center-stamp"),
  position: z.enum(concedePositionValues).default("above"),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  height: z.number().positive().default(44),
  padding: z.number().min(0).default(12),
  backgroundImageFit: z.enum(backgroundImageFitValues).default("cover"),
  backgroundImagePosition: z.enum(backgroundImagePositionValues).default("center"),
  borderColor: z.string().default("#ffffff"),
  borderWidth: z.number().min(0).default(2),
  borderRadius: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]).default([12, 12, 12, 12]),
  fontFamily: z.enum(fontFamilies).default("Oswald"),
  fontSize: z.number().positive().default(28),
  fontWeight: z.number().min(100).max(900).default(700),
  letterSpacing: z.number().default(1),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  shadow: z.string().default("none"),
  animationPreset: z.enum(concedeAnimationValues).default("slide-vertical"),
  durationMs: z.number().positive().default(2000),
  followTarget: z.enum(teamOverlayFollowTargetValues).default("none")
});

const teamEventOverlayEventSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string(),
  color: z.string(),
  backgroundColor: z.string(),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0)
});

const nestedTeamEventOverlaySchema = z.object({
  general: teamEventOverlayGeneralSchema.default({}),
  concede: teamEventOverlayEventSchema
    .default({
      text: "Conceded",
      color: "#ffffff",
      backgroundColor: "#111111ee"
    }),
  base: teamEventOverlayEventSchema
    .default({
      text: "Base",
      color: "#ffd54f",
      backgroundColor: "#1b3b6fff"
    }),
  winner: teamEventOverlayEventSchema
    .default({
      text: "WINNER",
      color: "#ffffff",
      backgroundColor: "#205838ee"
    })
});

function migrateLegacyTeamEventOverlay(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const candidate = input as Record<string, unknown>;
  if ("general" in candidate || "concede" in candidate || "base" in candidate || "winner" in candidate) {
    const nestedCandidate = candidate as {
      general?: Record<string, unknown>;
    };
    if (nestedCandidate.general) {
      const general = { ...nestedCandidate.general };
      
      if ("followLogoSize" in general) {
        const currentFollowTarget = general.followTarget;
        general.followTarget =
          general.followLogoSize === true &&
          (currentFollowTarget === undefined || currentFollowTarget === "none")
            ? "logo"
            : currentFollowTarget ?? "none";
      }

      if (typeof general.borderRadius === "number") {
        general.borderRadius = [general.borderRadius, general.borderRadius, general.borderRadius, general.borderRadius];
      } else if (!Array.isArray(general.borderRadius)) {
        general.borderRadius = [12, 12, 12, 12];
      }

      return {
        ...candidate,
        general
      };
    }
    return candidate;
  }

  const legacyKeys = [
    "enabled",
    "text",
    "baseText",
    "placementMode",
    "position",
    "offsetX",
    "offsetY",
    "height",
    "padding",
    "backgroundColor",
    "baseBackgroundColor",
    "backgroundImageAssetId",
    "baseBackgroundImageAssetId",
    "backgroundImageFit",
    "backgroundImagePosition",
    "backgroundOverlayColor",
    "backgroundOverlayOpacity",
    "baseBackgroundOverlayColor",
    "baseBackgroundOverlayOpacity",
    "borderColor",
    "borderWidth",
    "borderRadius",
    "color",
    "baseColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "textAlign",
    "shadow",
    "animationPreset",
    "durationMs",
    "followLogoSize",
    "followTarget"
  ];
  if (!legacyKeys.some((key) => key in candidate)) {
    return candidate;
  }

  const general = {
      enabled: candidate.enabled,
      placementMode: candidate.placementMode,
      position: candidate.position,
      offsetX: candidate.offsetX,
      offsetY: candidate.offsetY,
      height: candidate.height,
      padding: candidate.padding,
      backgroundImageFit: candidate.backgroundImageFit,
      backgroundImagePosition: candidate.backgroundImagePosition,
      borderColor: candidate.borderColor,
      borderWidth: candidate.borderWidth,
      borderRadius: Array.isArray(candidate.borderRadius)
        ? candidate.borderRadius
        : typeof candidate.borderRadius === "number"
          ? [candidate.borderRadius, candidate.borderRadius, candidate.borderRadius, candidate.borderRadius]
          : [12, 12, 12, 12],
      fontFamily: candidate.fontFamily,
      fontSize: candidate.fontSize,
      fontWeight: candidate.fontWeight,
      letterSpacing: candidate.letterSpacing,
      textAlign: candidate.textAlign,
      shadow: candidate.shadow,
      animationPreset: candidate.animationPreset,
      durationMs: candidate.durationMs,
      followTarget: candidate.followTarget ?? (candidate.followLogoSize === true ? "logo" : "none")
    };
    const result: Record<string, unknown> = {
      general,
      concede: {
        enabled: candidate.enabled ?? true, // Fallback to general enabled
        text: candidate.text,
        color: candidate.color,
        backgroundColor: candidate.backgroundColor,
        backgroundImageAssetId: candidate.backgroundImageAssetId,
        backgroundOverlayColor: candidate.backgroundOverlayColor,
        backgroundOverlayOpacity: candidate.backgroundOverlayOpacity
      },
      base: {
        enabled: candidate.enabled ?? true,
        text: candidate.baseText,
        color: candidate.baseColor,
        backgroundColor: candidate.baseBackgroundColor,
        backgroundImageAssetId: candidate.baseBackgroundImageAssetId,
        backgroundOverlayColor: candidate.baseBackgroundOverlayColor,
        backgroundOverlayOpacity: candidate.baseBackgroundOverlayOpacity
      }
    };

    if ("winner" in candidate && candidate.winner && typeof candidate.winner === "object") {
      const winnerCandidate = candidate.winner as Record<string, unknown>;
      result.winner = {
        enabled: winnerCandidate.enabled ?? true,
        text: winnerCandidate.text,
        color: winnerCandidate.color,
        backgroundColor: winnerCandidate.backgroundColor,
        backgroundImageAssetId: winnerCandidate.backgroundImageAssetId,
        backgroundOverlayColor: winnerCandidate.backgroundOverlayColor,
        backgroundOverlayOpacity: winnerCandidate.backgroundOverlayOpacity
      };
    }

    return result;
}

export const teamEventOverlaySchema = z.preprocess(migrateLegacyTeamEventOverlay, nestedTeamEventOverlaySchema);

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
    .default({}),
  timeout: z
    .object({
      enabled: z.boolean().default(true),
      text: z.string().default("TIMEOUT"),
      durationMs: z.number().positive().default(1200),
      minIncreaseSeconds: z.number().min(1).default(45),
      backgroundColor: z.string().default("#b3261ecc"),
      color: z.string().default("#ffffff"),
      fontFamily: z.enum(fontFamilies).default("Barlow Condensed"),
      fontSize: z.number().positive().default(28),
      fontWeight: z.number().min(100).max(900).default(700),
      letterSpacing: z.number().default(1)
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
  teamEventOverlay: teamEventOverlaySchema.default({}),
  centerSecondary: centerSecondarySchema.default({})
});

export const settingsSchema = z.object({
  upstreamBaseUrl: z.string().url(),
  publishedThemeId: z.string().nullable(),
  pollEnabled: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(100).max(10000).default(1000),
  autoRemoveBackgroundUploads: z.boolean().default(true)
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
  scoreboardDisplayName: z.string().default(""),
  shortName: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  liveMatchNames: z.array(z.string()).default([]),
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
  resolutionSource: z.enum(["automatic", "manual"]).default("automatic"),
  confidence: z.number().min(0).max(1),
  matchedAlias: z.string().nullable(),
  teamId: z.string().nullable(),
  team: teamRecordSchema.nullable(),
  candidates: z.array(teamMatchCandidateSchema).default([])
});

export const teamResolutionOverrideSchema = z.object({
  normalizedInputName: z.string(),
  rawInputName: z.string(),
  teamId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

function migrateLegacyOperationsState(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const candidate = input as Record<string, unknown>;
  if (Array.isArray(candidate.overrides)) {
    return candidate;
  }

  const legacyOverrides = candidate.overrides as
    | {
        left?: { rawInputName?: string; teamId?: string; createdAt?: string; updatedAt?: string } | null;
        right?: { rawInputName?: string; teamId?: string; createdAt?: string; updatedAt?: string } | null;
      }
    | undefined;

  if (!legacyOverrides || Array.isArray(legacyOverrides) || typeof legacyOverrides !== "object") {
    return candidate;
  }

  const migrated = [legacyOverrides.left, legacyOverrides.right]
    .filter((override): override is NonNullable<typeof override> => Boolean(override?.rawInputName && override.teamId))
    .map((override) => ({
      normalizedInputName: override.rawInputName ?? "",
      rawInputName: override.rawInputName ?? "",
      teamId: override.teamId ?? "",
      createdAt: override.createdAt ?? new Date().toISOString(),
      updatedAt: override.updatedAt ?? override.createdAt ?? new Date().toISOString()
    }));

  return {
    overrides: migrated
  };
}

export const operationsStateSchema = z.preprocess(
  migrateLegacyOperationsState,
  z.object({
    overrides: z.array(teamResolutionOverrideSchema).default([])
  })
);

export const normalizedLiveStateSchema = z.object({
  sourceStatus: z.enum(["idle", "ok", "error", "paused"]),
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
  teamEvent: z.enum(["towel-home", "towel-away", "base-home", "base-away", "none"])
});

export const assetSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  url: z.string(),
  createdAt: z.string(),
  role: z.enum(["original", "processed"]).default("processed"),
  sourceAssetId: z.string().nullable().default(null),
  hiddenFromPicker: z.boolean().default(false),
  contentHash: z.string().nullable().default(null)
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

export const teamRegistryExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  teams: z.array(teamRecordSchema),
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
export type TeamResolutionOverride = z.infer<typeof teamResolutionOverrideSchema>;
export type OperationsState = z.infer<typeof operationsStateSchema>;
export type ThemeExportPackage = z.infer<typeof themeExportSchema>;
export type AppExportPackage = z.infer<typeof appExportSchema>;
export type TeamRegistryExportPackage = z.infer<typeof teamRegistryExportSchema>;

export const defaultSettings: AppSettings = {
  upstreamBaseUrl: "http://127.0.0.1:5000",
  publishedThemeId: "theme-7ad8adb8-e017-4853-93b1-fb608a750253",
  pollEnabled: true,
  pollIntervalMs: 1000,
  autoRemoveBackgroundUploads: true
};

export function createThemeId(prefix = "theme"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
