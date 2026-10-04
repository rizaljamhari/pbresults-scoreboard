import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REMOTE_ACCESS_PROVIDER, type RemoteAccessConfigurationSource } from "../shared/remoteAccess.js";

/**
 * Where the long-lived ngrok authtoken lives. v1 stores it as plain text by decision (plan section 9.2); this module
 * is the one place to change if it ever needs protecting at rest.
 */

export type StoredAuthtoken = { authtoken: string; source: RemoteAccessConfigurationSource };

export interface RemoteAccessSecretStore {
  /** The token in effect, or null when none is configured or the stored file cannot be used. */
  read(): StoredAuthtoken | null;
  /** Replace the stored token. Throws when the environment override is in effect. */
  save(authtoken: string): void;
  /** Delete the stored token. Throws when the environment override is in effect. */
  remove(): void;
}

export class SecretStoreFailure extends Error {
  constructor(
    readonly reason: "environment-override" | "write-failed" | "remove-failed",
    message: string
  ) {
    super(message);
  }
}

const secretFileSchema = z.object({
  version: z.literal(1),
  provider: z.literal(REMOTE_ACCESS_PROVIDER),
  protection: z.literal("none"),
  authtoken: z.string().min(1),
  updatedAt: z.string()
});

function environmentToken(env: NodeJS.ProcessEnv): string | null {
  const value = env.NGROK_AUTHTOKEN?.trim();
  return value ? value : null;
}

function assertNoEnvironmentOverride(env: NodeJS.ProcessEnv) {
  if (environmentToken(env)) {
    throw new SecretStoreFailure("environment-override", "The ngrok authtoken is set by the NGROK_AUTHTOKEN environment variable.");
  }
}

/** Write through a unique temporary file in the same directory, so a crash never leaves a half-written token behind. */
function writeSecretFile(target: string, contents: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(descriptor, contents, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function createFileSecretStore(options: { filePath: string; env?: NodeJS.ProcessEnv; now?: () => Date }): RemoteAccessSecretStore {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  return {
    read() {
      const fromEnvironment = environmentToken(env);
      if (fromEnvironment) return { authtoken: fromEnvironment, source: "environment" };
      try {
        const parsed = secretFileSchema.safeParse(JSON.parse(fs.readFileSync(options.filePath, "utf8")));
        return parsed.success ? { authtoken: parsed.data.authtoken, source: "file" } : null;
      } catch {
        // Missing or unreadable: not configured. Never partially use a damaged file.
        return null;
      }
    },
    save(authtoken) {
      assertNoEnvironmentOverride(env);
      const file: z.infer<typeof secretFileSchema> = {
        version: 1,
        provider: REMOTE_ACCESS_PROVIDER,
        protection: "none",
        authtoken,
        updatedAt: now().toISOString()
      };
      try {
        writeSecretFile(options.filePath, `${JSON.stringify(file, null, 2)}\n`);
      } catch {
        throw new SecretStoreFailure("write-failed", "The ngrok authtoken could not be saved.");
      }
    },
    remove() {
      assertNoEnvironmentOverride(env);
      try {
        fs.rmSync(options.filePath, { force: true });
      } catch {
        throw new SecretStoreFailure("remove-failed", "The ngrok authtoken could not be removed.");
      }
    }
  };
}

export function createMemorySecretStore(initial: StoredAuthtoken | null = null): RemoteAccessSecretStore {
  let current = initial;
  return {
    read: () => current,
    save(authtoken) {
      if (current?.source === "environment") {
        throw new SecretStoreFailure("environment-override", "The ngrok authtoken is set by the NGROK_AUTHTOKEN environment variable.");
      }
      current = { authtoken, source: "file" };
    },
    remove() {
      if (current?.source === "environment") {
        throw new SecretStoreFailure("environment-override", "The ngrok authtoken is set by the NGROK_AUTHTOKEN environment variable.");
      }
      current = null;
    }
  };
}
