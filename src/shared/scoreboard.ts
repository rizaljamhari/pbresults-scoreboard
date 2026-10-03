import { z } from "zod";

/**
 * Whether the operator has the scoreboard on air. It lives on the server, so an overlay that loads or reloads while
 * the scoreboard is hidden stays hidden. `token` changes with every Show or Hide; overlays animate only on a change.
 */
export const scoreboardStateSchema = z.object({
  visible: z.boolean().default(true),
  token: z.number().int().nonnegative().default(0),
  changedAt: z.string().nullable().default(null)
});

export type ScoreboardState = z.infer<typeof scoreboardStateSchema>;

export const defaultScoreboardState: ScoreboardState = { visible: true, token: 0, changedAt: null };

export const scoreboardVisibilityRequestSchema = z.object({ visible: z.boolean() });
