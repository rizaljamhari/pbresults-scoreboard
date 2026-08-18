import fs from "node:fs";
import path from "node:path";
import { updateStatusSchema, type UpdateStatus } from "../shared/update.js";
import { updateStatePath, updateTransactionsDir } from "./runtimePaths.js";

export type PersistedUpdateState = Pick<
  UpdateStatus,
  "available" | "prepared" | "lastCheckedAt" | "nextAutomaticCheckAt" | "skippedVersion" | "lastResult"
> & {
  etag: string | null;
  releaseMetadata: Record<string, unknown> | null;
  transactionPath: string | null;
  dismissedResultCompletedAt: string | null;
};

export function atomicWriteJson(target: string, value: unknown) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  const descriptor = fs.openSync(temporary, "w");
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  JSON.parse(fs.readFileSync(temporary, "utf8"));
  fs.renameSync(temporary, target);
}

export function readPersistedUpdateState(): PersistedUpdateState | null {
  try {
    const value = JSON.parse(fs.readFileSync(updateStatePath, "utf8")) as PersistedUpdateState;
    updateStatusSchema.pick({
      available: true,
      prepared: true,
      lastCheckedAt: true,
      nextAutomaticCheckAt: true,
      skippedVersion: true,
      lastResult: true
    }).parse(value);
    value.transactionPath = typeof value.transactionPath === "string" ? value.transactionPath : null;
    value.dismissedResultCompletedAt = typeof value.dismissedResultCompletedAt === "string" ? value.dismissedResultCompletedAt : null;
    return value;
  } catch {
    return null;
  }
}

export function writePersistedUpdateState(value: PersistedUpdateState) {
  atomicWriteJson(updateStatePath, value);
}

export function createTransaction(value: Record<string, unknown>): string {
  const transactionPath = path.join(updateTransactionsDir, `${value.id}.json`);
  atomicWriteJson(transactionPath, value);
  return transactionPath;
}

export function readTransaction(transactionPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(transactionPath, "utf8")) as Record<string, unknown>;
}

export function findLatestCompletedTransaction(): Record<string, unknown> | null {
  if (!fs.existsSync(updateTransactionsDir)) {
    return null;
  }
  const files = fs
    .readdirSync(updateTransactionsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(updateTransactionsDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  for (const file of files) {
    try {
      const transaction = readTransaction(file);
      if (["committed", "rollback-completed", "failed"].includes(String(transaction.phase))) {
        return transaction;
      }
    } catch {
      // Ignore malformed diagnostic journals when finding a completed result.
    }
  }
  return null;
}
