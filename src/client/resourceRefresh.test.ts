import { describe, expect, it, vi } from "vitest";
import { ResourceRefreshCoordinator } from "./resourceRefresh";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("ResourceRefreshCoordinator", () => {
  it("coalesces a burst into one refresh with the latest token", async () => {
    vi.useFakeTimers();
    const tokens: string[] = [];
    const coordinator = new ResourceRefreshCoordinator(async (token) => {
      tokens.push(token);
    });

    coordinator.invalidate("one");
    coordinator.invalidate("two");
    coordinator.invalidate("three");
    await vi.advanceTimersByTimeAsync(100);

    expect(tokens).toEqual(["three"]);
    coordinator.dispose();
    vi.useRealTimers();
  });

  it("suppresses an obsolete result and runs once more after an in-flight invalidation", async () => {
    const first = deferred();
    const applications: string[] = [];
    let calls = 0;
    const coordinator = new ResourceRefreshCoordinator(async (token, shouldApply) => {
      calls += 1;
      if (calls === 1) await first.promise;
      if (shouldApply()) applications.push(token);
    });

    coordinator.refreshNow("initial");
    coordinator.invalidate("newer");
    first.resolve();
    await first.promise;
    await vi.waitFor(() => expect(calls).toBe(2));

    expect(applications).toEqual(["newer"]);
    coordinator.dispose();
  });

  it("does not run scheduled work after disposal", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const coordinator = new ResourceRefreshCoordinator(task);
    coordinator.invalidate("later");
    coordinator.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(task).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
