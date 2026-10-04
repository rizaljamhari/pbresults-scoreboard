import { z } from "zod";

/**
 * Temporary remote access over an ngrok endpoint. See docs/remote-access-technical-plan.md.
 */

export const REMOTE_ACCESS_PROVIDER = "ngrok";

/** Session lengths offered on Start; the server rejects anything else. */
export const REMOTE_ACCESS_DURATIONS_MINUTES = [30, 60, 120, 240, 480] as const;
export const REMOTE_ACCESS_DEFAULT_DURATION_MINUTES = 120;

export const REMOTE_ACCESS_CONFIRMATIONS = {
  saveConfiguration: "SAVE_AND_TEST_NGROK",
  removeConfiguration: "REMOVE_NGROK_CONFIGURATION",
  start: "START_REMOTE_ACCESS",
  stop: "STOP_REMOTE_ACCESS"
} as const;

export const remoteAccessPhaseValues = ["unconfigured", "inactive", "starting", "active", "degraded", "stopping", "failed"] as const;
export const remoteConnectionStateValues = ["disconnected", "connecting", "connected", "reconnecting"] as const;
export const remoteAccessConfigurationSourceValues = ["file", "environment"] as const;

export const remoteAccessErrorCodeValues = [
  "REMOTE_ACCESS_LOCAL_REQUEST_REQUIRED",
  "REMOTE_ACCESS_ORIGIN_REQUIRED",
  "REMOTE_SESSION_INVALID",
  "REMOTE_ACCESS_INVALID_REQUEST",
  "REMOTE_ACCESS_NOT_CONFIGURED",
  "REMOTE_ACCESS_CONFIGURED_BY_ENVIRONMENT",
  "REMOTE_ACCESS_BUSY",
  "REMOTE_ACCESS_ALREADY_ACTIVE",
  "REMOTE_ACCESS_INVALID_DURATION",
  "REMOTE_ACCESS_SECRET_STORE_FAILED",
  "REMOTE_ACCESS_TOKEN_INVALID",
  "REMOTE_ACCESS_PROVIDER_UNAVAILABLE",
  "REMOTE_ACCESS_POLICY_REJECTED",
  "REMOTE_ACCESS_PUBLIC_URL_INVALID",
  "REMOTE_ACCESS_PROBE_FAILED",
  "REMOTE_ACCESS_STOP_FAILED",
  "REMOTE_ACCESS_NATIVE_MODULE_UNAVAILABLE"
] as const;

export const remoteAccessPhaseSchema = z.enum(remoteAccessPhaseValues);
export const remoteConnectionStateSchema = z.enum(remoteConnectionStateValues);
export const remoteAccessConfigurationSourceSchema = z.enum(remoteAccessConfigurationSourceValues);
export const remoteAccessErrorCodeSchema = z.enum(remoteAccessErrorCodeValues);

export type RemoteAccessPhase = z.infer<typeof remoteAccessPhaseSchema>;
export type RemoteConnectionState = z.infer<typeof remoteConnectionStateSchema>;
export type RemoteAccessConfigurationSource = z.infer<typeof remoteAccessConfigurationSourceSchema>;
export type RemoteAccessErrorCode = z.infer<typeof remoteAccessErrorCodeSchema>;

/** ngrok authtokens are URL-safe ASCII; anything with whitespace or control characters is a paste mistake. */
export const ngrokAuthtokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(512)
  .regex(/^[A-Za-z0-9_\-.]+$/);

export const remoteAccessConfigurationRequestSchema = z.object({
  authtoken: ngrokAuthtokenSchema,
  confirmation: z.literal(REMOTE_ACCESS_CONFIRMATIONS.saveConfiguration)
});

export const remoteAccessRemoveConfigurationRequestSchema = z.object({
  confirmation: z.literal(REMOTE_ACCESS_CONFIRMATIONS.removeConfiguration)
});

export const remoteAccessStartRequestSchema = z.object({
  durationMinutes: z
    .number()
    .int()
    .refine((value) => (REMOTE_ACCESS_DURATIONS_MINUTES as readonly number[]).includes(value)),
  confirmation: z.literal(REMOTE_ACCESS_CONFIRMATIONS.start)
});

export const remoteAccessStopRequestSchema = z.object({
  confirmation: z.literal(REMOTE_ACCESS_CONFIRMATIONS.stop)
});

export const remoteAccessErrorSchema = z.object({
  code: remoteAccessErrorCodeSchema,
  message: z.string(),
  at: z.string()
});

/** What every origin may see: local, LAN, and authenticated remote. */
export const remoteAccessStatusSchema = z.object({
  provider: z.literal(REMOTE_ACCESS_PROVIDER),
  configured: z.boolean(),
  phase: remoteAccessPhaseSchema,
  connection: remoteConnectionStateSchema,
  managementAllowed: z.boolean(),
  remoteRequest: z.boolean(),
  url: z.string().nullable(),
  startedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Admin pages open through the tunnel right now (browser tabs, not people: everyone shares one login). */
  remoteConnections: z.number().int().nonnegative(),
  lastError: remoteAccessErrorSchema.nullable()
});

/** Added only for requests that pass the onsite management check. Never sent to LAN or remote browsers. */
export const localRemoteAccessStatusSchema = remoteAccessStatusSchema.extend({
  configurationSource: remoteAccessConfigurationSourceSchema.nullable(),
  credentials: z.object({ username: z.string(), password: z.string() }).nullable()
});

export type RemoteAccessError = z.infer<typeof remoteAccessErrorSchema>;
export type RemoteAccessStatus = z.infer<typeof remoteAccessStatusSchema>;
export type LocalRemoteAccessStatus = z.infer<typeof localRemoteAccessStatusSchema>;
