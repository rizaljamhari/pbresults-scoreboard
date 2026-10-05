import { z } from "zod";
import { changeMotionPresetValues, enterOrderValues, motionEasingValues, motionPresetValues, type ChangeMotionSettings, type MotionSettings } from "./motion.js";
import { defaultFill, fillTypeValues, type FillSettings } from "./fill.js";
import { randomUuid } from "./randomId.js";
import { scoreboardStateSchema } from "./scoreboard.js";

/** A surface's solid colour or gradient (see `./fill.ts`); solid by default, so `backgroundColor` keeps working. */
function fillField(defaults: FillSettings = defaultFill) {
  return z
    .object({
      type: z.enum(fillTypeValues).default(defaults.type),
      angle: z.number().min(0).max(360).default(defaults.angle),
      stops: z
        .array(z.object({ color: z.string(), position: z.number().min(0).max(1) }))
        .min(2)
        .max(8)
        .default(defaults.stops)
    })
    .default({});
}

/** Fill for the box and for the tint over its background image. */
export const surfaceFillFields = {
  fill: fillField(),
  tintFill: fillField()
};

export const defaultSurfaceFill = { fill: { ...defaultFill, stops: [...defaultFill.stops] }, tintFill: { ...defaultFill, stops: [...defaultFill.stops] } };

export const blendModeValues = ["normal", "multiply", "screen", "overlay", "soft-light"] as const;
export const imageEffectWhenValues = ["always", "lost"] as const;

/**
 * How a piece mixes with what is under it. The video is added by vMix after the overlay, so both only affect other
 * overlay pieces beneath this one.
 */
export const frameLookFields = {
  blendMode: z.enum(blendModeValues).default("normal"),
  /** Blurs overlay pieces showing through this one's see-through fill, in px; 0 for none. */
  backdropBlur: z.number().min(0).max(40).default(0)
};
export const defaultFrameLook = { blendMode: "normal" as const, backdropBlur: 0 };

/** Effects on an image's visible pixels: a shadow that follows its shape, and greying out (always or on a loss). */
export const imageEffectsField = z
  .object({
    /** Text-style CSS shadow (x y blur colour), drawn as drop-shadow filters; "none" for none. */
    shadow: z.string().default("none"),
    grayscale: z.number().min(0).max(1).default(0),
    dim: z.number().min(0).max(1).default(0),
    /** Team logos only: grey out always, or only once the team has lost the match. */
    when: z.enum(imageEffectWhenValues).default("always")
  })
  .default({});
export const defaultImageEffects = { shadow: "none", grayscale: 0, dim: 0, when: "always" as const };

/**
 * Which theme colours and styles an object uses ("bind and bake", see docs/theme-design-system-proposal.md §3.1).
 * The object keeps concrete values; these records say where they come from, so the editor can rewrite them when a
 * colour or style changes. Fields listed in `overrides` were changed on the object and are left alone.
 */
export const designField = z
  .object({
    /** Colour field name → theme colour id. */
    tokenBindings: z.record(z.string(), z.string()).default({}),
    textStyleId: z.string().nullable().default(null),
    surfaceStyleId: z.string().nullable().default(null),
    overrides: z.array(z.string()).default([])
  })
  .default({});
export type DesignBinding = z.infer<typeof designField>;
export const defaultDesign = (): DesignBinding => ({ tokenBindings: {}, textStyleId: null, surfaceStyleId: null, overrides: [] });

/** Pieces don't animate in or out unless the theme says so. */
export const defaultPieceMotion: MotionSettings = { preset: "none", durationMs: 400, easing: "snappy", delayMs: 0 };

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

/**
 * A font family name: a built-in one or a custom font the theme registers. Quotes and backslashes are refused so
 * the name is always safe inside CSS.
 */
export const fontFamilySchema = z.string().trim().min(1).max(60).regex(/^[^"\\]+$/);

export const backgroundImageFitValues = ["cover", "contain", "stretch"] as const;
export const backgroundImagePositionValues = ["center", "top", "bottom", "left", "right"] as const;
export const backgroundImageModeValues = ["asset", "homeTeamLogo", "awayTeamLogo"] as const;
export const teamLogoFallbackModeValues = ["none", "eventLogo", "slotFallback", "slotFallbackThenEventLogo"] as const;
export const imageContentModeValues = ["full-canvas", "visible-pixels"] as const;
export const concedePositionValues = ["above", "overlapping-top"] as const;
export const teamOverlayPlacementValues = ["full-panel", "center-stamp", "top-ribbon"] as const;
export const teamOverlayFollowTargetValues = ["none", "logo", "name"] as const;
export const centerSecondaryModeValues = ["timer", "staticText", "hidden"] as const;
export const centerSecondaryTransitionValues = ["none", "fade", "slide-up", "slide-left", "slide-right"] as const;
export const textTransformValues = ["none", "uppercase", "capitalize"] as const;
export const textFitValues = ["clip", "ellipsis", "shrink"] as const;

/**
 * How text behaves when it is longer than its box. Shared by every text-bearing object (pieces, event cards,
 * moment cards); the defaults keep older themes rendering exactly as before.
 */
export const textFitFields = {
  textTransform: z.enum(textTransformValues).default("none"),
  textFit: z.enum(textFitValues).default("clip"),
  /** Smallest size shrink may reach, as a share of the font size; past it the text ends in an ellipsis. */
  textFitMinScale: z.number().min(0.3).max(1).default(0.6)
};

const textFitSchema = z.object(textFitFields);
export type TextFitSettings = z.infer<typeof textFitSchema>;
export const defaultTextFit: TextFitSettings = { textTransform: "none", textFit: "clip", textFitMinScale: 0.6 };

/** Shadow and outline drawn on the letters themselves, shared like `textFitFields`. */
export const textEffectFields = {
  /** CSS text-shadow; "none" for no shadow. */
  textShadow: z.string().default("none"),
  /** Outline drawn outside the letters, in px; 0 for none. */
  textStrokeWidth: z.number().min(0).max(20).default(0),
  textStrokeColor: z.string().default("#000000")
};

/** A motion setting (see `./motion.ts`); every field falls back to the given default. */
function motionField(defaults: MotionSettings) {
  return z
    .object({
      preset: z.enum(motionPresetValues).default(defaults.preset),
      durationMs: z.number().min(0).max(10000).default(defaults.durationMs),
      easing: z.enum(motionEasingValues).default(defaults.easing),
      delayMs: z.number().min(0).max(5000).default(defaults.delayMs)
    })
    .default({});
}

export const defaultEventCardMotion: MotionSettings = { preset: "drop-in", durationMs: 2000, easing: "ease-in-out", delayMs: 0 };
export const defaultCentreLineMotion: MotionSettings = { preset: "fade", durationMs: 250, easing: "ease", delayMs: 0 };
export const defaultTeamSwitchMotion: MotionSettings = { preset: "scale", durationMs: 600, easing: "snappy", delayMs: 0 };

export const transitionDirectionValues = ["right-to-left", "left-to-right"] as const;
export const sweepWidthValues = ["full", "scoreboard"] as const;
export const defaultTransitionContentMotion: MotionSettings = { preset: "fade", durationMs: 220, easing: "ease-out", delayMs: 0 };
export const defaultTransitionLogoMotion: MotionSettings = { preset: "pop-in", durationMs: 420, easing: "ease-out", delayMs: 120 };

/**
 * The operator's Show and Hide: a band sweeps across and uncovers the scoreboard's plates behind it, then the
 * contents build in. Hide plays it backwards. Loading the overlay and Play entrance keep each piece's own entrance.
 */
export const transitionSchema = z.object({
  enabled: z.boolean().default(true),
  /** The way the band travels on Show. */
  direction: z.enum(transitionDirectionValues).default("left-to-right"),
  /**
   * How far the band travels: across the whole screen, or only across the scoreboard (plus some room each side), so
   * a source cropped to the scoreboard in vMix or OBS still shows the whole sweep.
   */
  sweepWidth: z.enum(sweepWidthValues).default("full"),
  /** With the sweep on the scoreboard only, extra room each side, as a share of the scoreboard's width. 0 for a tight crop. */
  sweepRoom: z.number().min(0).max(0.3).default(0.175),
  /** How long the band takes to cross the screen. */
  sweepMs: z.number().min(200).max(3000).default(800),
  /** An image from the library fills the band instead of the colour, logo and text. */
  bandImageAssetId: z.string().nullable().default(null),
  /** The colour strip: it fades in from a darker tail and travels at its own pace, overtaking the text. */
  bandColor: z.string().default("#b3121f"),
  /** The narrow block at the band's tail that uncovers the scoreboard. */
  bandEdgeColor: z.string().default("#111111"),
  bandTextColor: z.string().default("#ffffff"),
  /** Empty uses the centre line's game text, then the theme name. */
  bandText: z.string().max(80).default(""),
  bandFontFamily: fontFamilySchema.default("Oswald"),
  /** Puts the event logo at the band's leading edge. */
  bandShowLogo: z.boolean().default(true),
  /** Scales the band's height around the scoreboard's middle; 1 just covers the scoreboard with a little room. */
  bandScale: z.number().min(0.2).max(2).default(1),
  /** A light sideways blur on the band while it moves. */
  motionBlur: z.boolean().default(true),
  /** How text and the other contents arrive once the band has passed. */
  contentMotion: motionField(defaultTransitionContentMotion),
  /** How logos arrive once the band has passed. */
  logoMotion: motionField(defaultTransitionLogoMotion),
  /** Gap between contents as they build in, in the theme's build-in order. */
  contentGapMs: z.number().min(0).max(1000).default(60),
  /**
   * How far through the sweep the contents start building in, as a percentage of the sweep time. The band lands
   * softly, so waiting for it to stop (100) feels late; contents only show where the band has already passed.
   */
  contentsStart: z.number().int().min(30).max(100).default(75),
  /** The centre line shows the band's text for this long after Show, then its usual content; 0 skips it. */
  centreLineIntroMs: z.number().min(0).max(10000).default(1500)
});

export type TransitionSettings = z.infer<typeof transitionSchema>;

/**
 * Where the design lands on air. Designers can build the scoreboard big in the middle of the canvas; on air it is
 * moved and scaled as one piece: design point p shows at p × scale + offset. Off, it shows exactly as designed.
 */
export const placementSchema = z.object({
  enabled: z.boolean().default(false),
  scale: z.number().min(0.05).max(1).default(1),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0)
});

export type PlacementSettings = z.infer<typeof placementSchema>;

/**
 * How a live text piece reacts to its value changing: an animation when it changes (scores, operator text) and a
 * warning in a clock's last seconds. Both off by default.
 */
export const liveTextFields = {
  changeMotion: z
    .object({
      preset: z.enum(changeMotionPresetValues).default("none"),
      durationMs: z.number().min(0).max(10000).default(450),
      easing: z.enum(motionEasingValues).default("snappy"),
      delayMs: z.number().min(0).max(5000).default(0)
    })
    .default({}),
  clockWarning: z
    .object({
      /** The warning starts at this many seconds left; 0 turns it off. */
      belowSeconds: z.number().int().min(0).max(600).default(0),
      pulse: z.boolean().default(true),
      /** Text colour during the warning; empty keeps the piece's own colour. */
      color: z.string().default("")
    })
    .default({})
};

const liveTextSchema = z.object(liveTextFields);
export type LiveTextSettings = z.infer<typeof liveTextSchema>;
export const defaultChangeMotion: ChangeMotionSettings = { preset: "none", durationMs: 450, easing: "snappy", delayMs: 0 };
export const defaultLiveText: LiveTextSettings = { changeMotion: { ...defaultChangeMotion }, clockWarning: { belowSeconds: 0, pulse: true, color: "" } };

const textEffectSchema = z.object(textEffectFields);
export type TextEffectSettings = z.infer<typeof textEffectSchema>;
export const defaultTextEffects: TextEffectSettings = { textShadow: "none", textStrokeWidth: 0, textStrokeColor: "#000000" };

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
  /** Fades the background (fill, image and tint together) without fading the content, border or shadow. */
  backgroundOpacity: z.number().min(0).max(1).default(1),
  borderColor: z.string(),
  borderWidth: z.number().min(0),
  borderRadius: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]),
  paddingX: z.number().min(0),
  paddingY: z.number().min(0),
  offsetX: z.number(),
  offsetY: z.number(),
  shadow: z.string(),
  /** With an on-air placement, this piece stays where it was designed instead of moving and scaling with the rest. */
  stayInPlace: z.boolean().default(false),
  /** Plays as the piece arrives: when the overlay loads, when it is shown, and on the operator's Play entrance. */
  enterMotion: motionField(defaultPieceMotion),
  /** Plays as the piece is hidden. */
  exitMotion: motionField(defaultPieceMotion),
  ...surfaceFillFields,
  ...frameLookFields,
  design: designField
});

export const commonFrameSchema = z.preprocess(migrateLegacyFrame, commonFrameBaseSchema);

const textComponentBaseSchema = commonFrameBaseSchema.extend({
  kind: z.literal("text"),
  fontFamily: fontFamilySchema,
  fontSize: z.number().positive(),
  fontWeight: z.number().min(100).max(900),
  color: z.string(),
  textAlign: z.enum(["left", "center", "right"]),
  letterSpacing: z.number(),
  lineHeight: z.number().positive(),
  ...textFitFields,
  ...textEffectFields,
  ...liveTextFields
});

export const textComponentSchema = z.preprocess(migrateLegacyFrame, textComponentBaseSchema);

const imageComponentBaseSchema = commonFrameBaseSchema.extend({
  kind: z.literal("image"),
  assetId: z.string().nullable(),
  teamLogoFallbackMode: z.enum(teamLogoFallbackModeValues).default("slotFallback"),
  imageContentMode: z.enum(imageContentModeValues).default("full-canvas"),
  visibleContentPaddingPct: z.number().min(0).max(25).default(0),
  imageEffects: imageEffectsField
});

export const imageComponentSchema = z.preprocess(migrateLegacyFrame, imageComponentBaseSchema);

const freeTextComponentBaseSchema = textComponentBaseSchema.extend({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  contentMode: z.enum(["static", "operator"]).default("static"),
  defaultText: z.string().default(""),
  maxLength: z.number().int().min(1).max(500).default(120),
  multiline: z.boolean().default(false)
});

const freeImageComponentBaseSchema = imageComponentBaseSchema.extend({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80)
});

export const freeTextComponentSchema = z.preprocess(migrateLegacyFrame, freeTextComponentBaseSchema);
export const freeImageComponentSchema = z.preprocess(migrateLegacyFrame, freeImageComponentBaseSchema);
export const shapeValues = ["rectangle", "pill", "ellipse"] as const;

/** A plain box: a bar, plate, badge or divider, styled with the usual fill, border and shadow. */
const freeShapeComponentBaseSchema = commonFrameBaseSchema.extend({
  kind: z.literal("shape"),
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  shape: z.enum(shapeValues).default("rectangle"),
  /** Slants the box sideways, in degrees, for the angled plates common in sports graphics. */
  skewX: z.number().min(-30).max(30).default(0)
});

export const freeShapeComponentSchema = z.preprocess(migrateLegacyFrame, freeShapeComponentBaseSchema);
export const freeComponentSchema = z.union([freeTextComponentSchema, freeImageComponentSchema, freeShapeComponentSchema]);

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
  backgroundOpacity: 1,
  borderColor: "#00000000",
  borderWidth: 0,
  borderRadius: 0,
  paddingX: 0,
  paddingY: 0,
  offsetX: 0,
  offsetY: 0,
  shadow: "none",
  stayInPlace: false,
  assetId: null,
  teamLogoFallbackMode: "slotFallback" as const,
  imageContentMode: "full-canvas" as const,
  visibleContentPaddingPct: 0
};

const teamEventOverlayGeneralObjectSchema = z.object({
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
  fontFamily: fontFamilySchema.default("Oswald"),
  fontSize: z.number().positive().default(28),
  fontWeight: z.number().min(100).max(900).default(700),
  letterSpacing: z.number().default(1),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  shadow: z.string().default("none"),
  ...textFitFields,
  ...textEffectFields,
  /** Loops while the card is on screen: enters, holds, leaves, over `durationMs`. */
  motion: motionField(defaultEventCardMotion),
  followTarget: z.enum(teamOverlayFollowTargetValues).default("none"),
  design: designField
});

/** The event card's animation used to be its own preset and duration; it now uses the shared motion setting. */
function migrateEventCardMotion(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const { animationPreset, durationMs, ...rest } = input as Record<string, unknown>;
  if ("motion" in rest || (animationPreset === undefined && durationMs === undefined)) {
    return rest;
  }
  return {
    ...rest,
    motion: {
      preset: animationPreset === "none" ? "none" : animationPreset === "slide-horizontal" ? "glide-in" : "drop-in",
      durationMs: typeof durationMs === "number" ? durationMs : defaultEventCardMotion.durationMs,
      easing: defaultEventCardMotion.easing,
      delayMs: 0
    }
  };
}

const teamEventOverlayGeneralSchema = z.preprocess(migrateEventCardMotion, teamEventOverlayGeneralObjectSchema);

const teamEventOverlayEventSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string(),
  color: z.string(),
  backgroundColor: z.string(),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0),
  backgroundOpacity: z.number().min(0).max(1).default(1),
  ...surfaceFillFields,
  design: designField
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

const centerSecondaryObjectSchema = z.object({
  gameMode: z.enum(centerSecondaryModeValues).default("staticText"),
  gameText: z.string().default(""),
  breakMode: z.enum(centerSecondaryModeValues).default("timer"),
  breakText: z.string().default(""),
  timerStyle: z
    .object({
      fontFamily: fontFamilySchema.default("Barlow Condensed"),
      fontSize: z.number().positive().default(28),
      fontWeight: z.number().min(100).max(900).default(700),
      color: z.string().default("#f6f1e8")
    })
    .default({}),
  staticStyle: z
    .object({
      fontFamily: fontFamilySchema.default("Barlow Condensed"),
      fontSize: z.number().positive().default(28),
      fontWeight: z.number().min(100).max(900).default(700),
      color: z.string().default("#f6f1e8")
    })
    .default({}),
  /** Plays when the line's content changes; reversed as it goes blank. */
  motion: motionField(defaultCentreLineMotion)
});

/** The centre line's `transition` (animation and duration) became the shared motion setting. */
function migrateCentreLineMotion(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const { transition, ...rest } = input as Record<string, unknown>;
  if ("motion" in rest || !transition || typeof transition !== "object") {
    return rest;
  }
  const legacy = transition as { animation?: unknown; durationMs?: unknown };
  const preset = (centerSecondaryTransitionValues as readonly unknown[]).includes(legacy.animation) ? legacy.animation : defaultCentreLineMotion.preset;
  return {
    ...rest,
    motion: {
      preset,
      durationMs: typeof legacy.durationMs === "number" ? legacy.durationMs : defaultCentreLineMotion.durationMs,
      easing: defaultCentreLineMotion.easing,
      delayMs: 0
    }
  };
}

export const centerSecondarySchema = z.preprocess(migrateCentreLineMotion, centerSecondaryObjectSchema);

export const momentPlacementValues = ["centreLine", "free"] as const;

/**
 * A card shown for a match moment (timeout, game finished). It either takes the centre line's box or sits
 * freely; its type and surface are always its own.
 */
const momentCardSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().default(""),
  placement: z.enum(momentPlacementValues).default("centreLine"),
  hideCentreLineContent: z.boolean().default(false),
  // Free placement; ignored while following the centre line.
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().default(240),
  height: z.number().positive().default(44),
  fontFamily: fontFamilySchema.default("Barlow Condensed"),
  fontSize: z.number().positive().default(28),
  fontWeight: z.number().min(100).max(900).default(700),
  letterSpacing: z.number().default(1),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  color: z.string().default("#ffffff"),
  backgroundColor: z.string().default("#00000000"),
  backgroundImageAssetId: z.string().nullable().default(null),
  backgroundImageFit: z.enum(backgroundImageFitValues).default("cover"),
  backgroundImagePosition: z.enum(backgroundImagePositionValues).default("center"),
  backgroundOverlayColor: z.string().default("#000000"),
  backgroundOverlayOpacity: z.number().min(0).max(1).default(0),
  backgroundOpacity: z.number().min(0).max(1).default(1),
  borderColor: z.string().default("#00000000"),
  borderWidth: z.number().min(0).default(0),
  borderRadius: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]).default([0, 0, 0, 0]),
  paddingX: z.number().min(0).default(0),
  paddingY: z.number().min(0).default(0),
  shadow: z.string().default("none"),
  ...textFitFields,
  ...textEffectFields,
  ...surfaceFillFields,
  design: designField
});

export const momentOverlaysSchema = z.object({
  timeout: momentCardSchema
    .extend({
      durationMs: z.number().positive().default(1200),
      minIncreaseSeconds: z.number().min(1).default(45)
    })
    .default({ text: "TIMEOUT", backgroundColor: "#b3261ecc" }),
  gameFinished: momentCardSchema.default({ text: "GAME FINISHED", hideCentreLineContent: true })
});

// Timeout and game finished used to live inside centerSecondary and draw into the centre line itself.
const legacyCentreLineMomentsSchema = z.object({
  breakMode: z.enum(centerSecondaryModeValues).default("timer"),
  gameFinished: z.object({ enabled: z.boolean().default(true) }).default({}),
  timerStyle: centerSecondaryObjectSchema.shape.timerStyle,
  staticStyle: centerSecondaryObjectSchema.shape.staticStyle,
  timeout: z
    .object({
      enabled: z.boolean().default(true),
      text: z.string().default("TIMEOUT"),
      durationMs: z.number().positive().default(1200),
      minIncreaseSeconds: z.number().min(1).default(45),
      backgroundColor: z.string().default("#b3261ecc"),
      color: z.string().default("#ffffff"),
      fontFamily: fontFamilySchema.default("Barlow Condensed"),
      fontSize: z.number().positive().default(28),
      fontWeight: z.number().min(100).max(900).default(700),
      letterSpacing: z.number().default(1)
    })
    .default({})
});

/**
 * Moves the legacy centre-line timeout and game-finished settings into their own cards, following the centre
 * line, so an older theme renders exactly as it did.
 */
export function migrateMomentOverlays(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const candidate = input as Record<string, unknown>;
  if ("momentOverlays" in candidate) {
    return candidate;
  }

  const legacy = legacyCentreLineMomentsSchema.safeParse(candidate.centerSecondary ?? {});
  if (!legacy.success) {
    return candidate;
  }
  const line = legacy.data;
  const components = candidate.components as Record<string, unknown> | undefined;
  const breakTime = textComponentSchema.safeParse(components?.breakTime);
  const piece = breakTime.success ? breakTime.data : null;
  const rect = piece ? { x: piece.x, y: piece.y, width: piece.width, height: piece.height } : {};
  // Game finished used the centre line's current break style, or the piece's own type when breaks are hidden.
  const finishedStyle =
    line.breakMode === "timer" ? line.timerStyle : line.breakMode === "staticText" ? line.staticStyle : piece ?? line.timerStyle;

  return {
    ...candidate,
    momentOverlays: {
      timeout: {
        enabled: line.timeout.enabled,
        text: line.timeout.text,
        placement: "centreLine",
        hideCentreLineContent: false,
        ...rect,
        fontFamily: line.timeout.fontFamily,
        fontSize: line.timeout.fontSize,
        fontWeight: line.timeout.fontWeight,
        letterSpacing: line.timeout.letterSpacing,
        textAlign: piece?.textAlign ?? "center",
        color: line.timeout.color,
        backgroundColor: line.timeout.backgroundColor,
        durationMs: line.timeout.durationMs,
        minIncreaseSeconds: line.timeout.minIncreaseSeconds
      },
      gameFinished: {
        enabled: line.gameFinished.enabled,
        text: "GAME FINISHED",
        placement: "centreLine",
        hideCentreLineContent: true,
        ...rect,
        fontFamily: finishedStyle.fontFamily,
        fontSize: finishedStyle.fontSize,
        fontWeight: finishedStyle.fontWeight,
        letterSpacing: piece?.letterSpacing ?? 0,
        textAlign: piece?.textAlign ?? "center",
        color: finishedStyle.color,
        backgroundColor: "#00000000"
      }
    }
  };
}

/** A named bundle of type settings that text pieces, event cards and moment cards can use. */
const textStyleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  fontFamily: fontFamilySchema.default("Oswald"),
  fontSize: z.number().positive().default(32),
  fontWeight: z.number().min(100).max(900).default(700),
  letterSpacing: z.number().default(0),
  lineHeight: z.number().positive().default(1),
  color: z.string().default("#ffffff"),
  ...textFitFields,
  ...textEffectFields,
  tokenBindings: z.record(z.string(), z.string()).default({})
});

/** A named bundle of box settings that pieces and moment cards can use. */
const surfaceStyleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  backgroundColor: z.string().default("#111111"),
  fill: fillField(),
  borderColor: z.string().default("#00000000"),
  borderWidth: z.number().min(0).default(0),
  borderRadius: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]).default([0, 0, 0, 0]),
  shadow: z.string().default("none"),
  backdropBlur: z.number().min(0).max(40).default(0),
  tokenBindings: z.record(z.string(), z.string()).default({})
});

export type TextStyle = z.infer<typeof textStyleSchema>;
export type SurfaceStyle = z.infer<typeof surfaceStyleSchema>;
export type ColorToken = { id: string; name: string; value: string };
export const textStyleDefaults = (id: string, name: string): TextStyle => textStyleSchema.parse({ id, name });
export const surfaceStyleDefaults = (id: string, name: string): SurfaceStyle => surfaceStyleSchema.parse({ id, name });

const themeObjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Short tag shown in front of the name in the theme list, e.g. "SL"; optional. */
  acronym: z.string().max(6).default(""),
  description: z.string(),
  builtin: z.boolean(),
  /** Last time the theme was saved or created; null for themes saved before this was tracked. */
  updatedAt: z.string().nullable().default(null),
  /** Hidden from the main theme list; nothing else changes. */
  archived: z.boolean().default(false),
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
  freeComponents: z.array(freeComponentSchema).default([]),
  teamEventOverlay: teamEventOverlaySchema.default({}),
  centerSecondary: centerSecondarySchema.default({}),
  momentOverlays: momentOverlaysSchema.default({}),
  /**
   * Named snapshots of the theme, newest first. Each holds the theme's settings as they were (without its own
   * versions), parsed with the theme schema when used, so old snapshots migrate like any stored theme.
   */
  versions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(60),
        savedAt: z.string(),
        theme: z.record(z.string(), z.unknown())
      })
    )
    .default([]),
  /** Custom fonts the theme uses: an uploaded font file and the family name pieces refer to it by. */
  fonts: z.array(z.object({ assetId: z.string().min(1), family: fontFamilySchema })).default([]),
  /** Named colours the theme's pieces and styles can use. */
  tokens: z
    .object({
      colors: z.array(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(40), value: z.string() })).default([])
    })
    .default({}),
  /** Reusable looks: text styles (type) and surface styles (the box). */
  styles: z
    .object({
      text: z.array(textStyleSchema).default([]),
      surface: z.array(surfaceStyleSchema).default([])
    })
    .default({}),
  /** Motion that belongs to the whole scoreboard rather than one piece. */
  motion: z
    .object({
      /** Old names and logos leave as the new ones arrive when the teams change. */
      teamSwitch: motionField(defaultTeamSwitchMotion),
      /** Gap between pieces as the whole scoreboard enters; 0 brings them in together. */
      enterStaggerMs: z.number().min(0).max(2000).default(0),
      enterOrder: z.enum(enterOrderValues).default("left-to-right")
    })
    .default({}),
  transition: transitionSchema.default({}),
  placement: placementSchema.default({})
});

export const themeSchema = z.preprocess(migrateMomentOverlays, themeObjectSchema);

export const settingsSchema = z.object({
  upstreamBaseUrl: z.string().url(),
  publishedThemeId: z.string().nullable(),
  pollEnabled: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(100).max(10000).default(1000),
  autoRemoveBackgroundUploads: z.boolean().default(true),
  /** Operator switch: the overlay cuts instead of animating until it is turned off. */
  reduceMotion: z.boolean().default(false),
  updateCheckEnabled: z.boolean().default(true),
  updateCheckIntervalHours: z.number().int().min(1).max(168).default(6),
  updateAutoDownload: z.boolean().default(false),
  /** White-label name for the admin and the Windows console. Empty means the default app name. */
  brandName: z.string().trim().max(40).default(""),
  brandLogoAssetId: z.string().nullable().default(null),
  /** Shows "Powered by PBResults Scoreboard" under a custom name. */
  brandPoweredBy: z.boolean().default(true)
});

export const DEFAULT_APP_NAME = "PBResults Scoreboard";

export function appDisplayName(settings: Pick<AppSettings, "brandName"> | null | undefined): string {
  return settings?.brandName.trim() || DEFAULT_APP_NAME;
}

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

export const operatorTextOverrideSchema = z.object({
  themeId: z.string(),
  componentId: z.string(),
  value: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const operatorTextFieldSchema = z.object({
  componentId: z.string(),
  label: z.string(),
  defaultValue: z.string(),
  value: z.string(),
  hasOverride: z.boolean(),
  maxLength: z.number().int().positive(),
  multiline: z.boolean(),
  updatedAt: z.string().nullable()
});

export const operatorTextStateSchema = z.object({
  themeId: z.string().nullable(),
  fields: z.array(operatorTextFieldSchema)
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
    overrides: z.array(teamResolutionOverrideSchema).default([]),
    operatorTextOverrides: z.array(operatorTextOverrideSchema).default([]),
    scoreboard: scoreboardStateSchema.default({})
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

const visibleContentReadySchema = z.object({
  analyzerVersion: z.literal(1),
  status: z.literal("ready"),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alphaThreshold: z.number().int().min(0).max(255)
});

const visibleContentEmptySchema = z.object({
  analyzerVersion: z.literal(1),
  status: z.literal("empty"),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  alphaThreshold: z.number().int().min(0).max(255)
});

const visibleContentUnavailableSchema = z.object({
  analyzerVersion: z.literal(1),
  status: z.enum(["unsupported", "failed"])
});

export const visibleContentAnalysisSchema = z.discriminatedUnion("status", [
  visibleContentReadySchema,
  visibleContentEmptySchema,
  visibleContentUnavailableSchema
]);

export const assetSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  url: z.string(),
  createdAt: z.string(),
  role: z.enum(["original", "processed"]).default("processed"),
  sourceAssetId: z.string().nullable().default(null),
  hiddenFromPicker: z.boolean().default(false),
  contentHash: z.string().nullable().default(null),
  visibleContent: visibleContentAnalysisSchema.nullable().default(null),
  displayName: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
  byteSize: z.number().int().min(0).nullable().default(null)
});

export const assetThemeUsageLocationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("component"), key: z.enum(componentIds) }),
  z.object({ type: z.literal("free"), id: z.string(), label: z.string() }),
  z.object({ type: z.literal("surface"), key: z.string(), label: z.string() }),
  z.object({ type: z.literal("eventOverlay"), which: z.enum(["concede", "base", "winner"]) }),
  z.object({ type: z.literal("momentOverlay"), which: z.enum(["timeout", "gameFinished"]) }),
  z.object({ type: z.literal("font"), family: z.string() }),
  z.object({ type: z.literal("version"), name: z.string() })
]);

export const assetUsageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("theme"),
    themeId: z.string(),
    themeName: z.string(),
    builtin: z.boolean(),
    published: z.boolean(),
    location: assetThemeUsageLocationSchema
  }),
  z.object({
    kind: z.literal("team"),
    teamId: z.string(),
    teamName: z.string(),
    slot: z.enum(["primary", "alternate"])
  }),
  z.object({
    kind: z.literal("branding")
  })
]);

export const assetLibraryEntrySchema = assetSchema.extend({
  usages: z.array(assetUsageSchema),
  original: z
    .object({
      id: z.string(),
      url: z.string(),
      byteSize: z.number().int().min(0).nullable()
    })
    .nullable(),
  backgroundRemoved: z.boolean(),
  fileMissing: z.boolean()
});

const assetCleanupItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  byteSize: z.number().int().min(0).nullable(),
  createdAt: z.string().nullable(),
  recent: z.boolean()
});

export const assetCleanupReportSchema = z.object({
  unusedAssets: z.array(assetCleanupItemSchema),
  orphanOriginals: z.array(assetCleanupItemSchema),
  strayFiles: z.array(z.object({ fileName: z.string(), byteSize: z.number().int().min(0) })),
  brokenRecords: z.array(assetCleanupItemSchema),
  reclaimableBytes: z.number().int().min(0)
});

export const assetCleanupRequestSchema = z.object({
  assetIds: z.array(z.string()).default([]),
  originalIds: z.array(z.string()).default([]),
  strayFiles: z.array(z.string()).default([]),
  brokenRecordIds: z.array(z.string()).default([])
});

export const assetCleanupResultSchema = z.object({
  deleted: z.number().int().min(0),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
  freedBytes: z.number().int().min(0)
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

export const backupReasons = ["manual", "startup", "shutdown", "pre-restore", "pre-import", "export"] as const;
export type BackupReason = (typeof backupReasons)[number];

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** Backup v2: v1 plus operations state, the originating version and per-entry checksums. */
export const appExportV2Schema = z.object({
  version: z.literal(2),
  exportedAt: z.string(),
  appVersion: z.string(),
  reason: z.enum(backupReasons),
  settings: settingsSchema,
  themes: z.array(themeSchema),
  teams: z.array(teamRecordSchema),
  operations: operationsStateSchema,
  assets: z.array(
    z.object({
      asset: assetSchema,
      data: z.string(),
      sha256: sha256Schema,
      size: z.number().int().nonnegative()
    })
  ),
  checksums: z.object({
    settings: sha256Schema,
    themes: sha256Schema,
    teams: sha256Schema,
    operations: sha256Schema
  })
});

export const anyAppExportSchema = z.discriminatedUnion("version", [appExportSchema, appExportV2Schema]);

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
export type FreeTextComponent = z.infer<typeof freeTextComponentSchema>;
export type FreeImageComponent = z.infer<typeof freeImageComponentSchema>;
export type FreeShapeComponent = z.infer<typeof freeShapeComponentSchema>;
export type FreeComponent = z.infer<typeof freeComponentSchema>;
export type ThemeDefinition = z.infer<typeof themeSchema>;
export type AppSettings = z.infer<typeof settingsSchema>;
export type NormalizedLiveState = z.infer<typeof normalizedLiveStateSchema>;
export type StoredAsset = z.infer<typeof assetSchema>;
export type AssetUsage = z.infer<typeof assetUsageSchema>;
export type AssetThemeUsageLocation = z.infer<typeof assetThemeUsageLocationSchema>;
export type AssetLibraryEntry = z.infer<typeof assetLibraryEntrySchema>;
export type AssetCleanupReport = z.infer<typeof assetCleanupReportSchema>;
export type AssetCleanupRequest = z.infer<typeof assetCleanupRequestSchema>;
export type AssetCleanupResult = z.infer<typeof assetCleanupResultSchema>;
export type VisibleContentAnalysis = z.infer<typeof visibleContentAnalysisSchema>;
export type TeamRecord = z.infer<typeof teamRecordSchema>;
export type TeamMatchResult = z.infer<typeof teamMatchResultSchema>;
export type TeamResolutionOverride = z.infer<typeof teamResolutionOverrideSchema>;
export type OperatorTextOverride = z.infer<typeof operatorTextOverrideSchema>;
export type OperatorTextField = z.infer<typeof operatorTextFieldSchema>;
export type OperatorTextState = z.infer<typeof operatorTextStateSchema>;
export type OperationsState = z.infer<typeof operationsStateSchema>;
export type ThemeExportPackage = z.infer<typeof themeExportSchema>;
export type AppExportPackage = z.infer<typeof appExportSchema>;
export type AppExportV2Package = z.infer<typeof appExportV2Schema>;
export type AnyAppExportPackage = z.infer<typeof anyAppExportSchema>;
export type TeamRegistryExportPackage = z.infer<typeof teamRegistryExportSchema>;

export const defaultSettings: AppSettings = {
  upstreamBaseUrl: "http://127.0.0.1:5000",
  publishedThemeId: "theme-7ad8adb8-e017-4853-93b1-fb608a750253",
  pollEnabled: true,
  pollIntervalMs: 1000,
  autoRemoveBackgroundUploads: true,
  reduceMotion: false,
  updateCheckEnabled: true,
  updateCheckIntervalHours: 6,
  updateAutoDownload: false,
  brandName: "",
  brandLogoAssetId: null,
  brandPoweredBy: true
};

export function createThemeId(prefix = "theme"): string {
  return `${prefix}-${randomUuid()}`;
}
