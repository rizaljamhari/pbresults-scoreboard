import { describe, expect, it, vi } from "vitest";
import { markServerChange, sharedLoader } from "./sharedRequests";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("sharedLoader", () => {
  it("shares one request between concurrent callers and hands each its own copy", async () => {
    const pending = deferred<{ items: string[] }>();
    const load = vi.fn(() => pending.promise);
    const shared = sharedLoader("concurrent", load);
    const first = shared();
    const second = shared();
    pending.resolve({ items: ["a"] });
    const [a, b] = await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
  });

  it("starts a fresh request after a server change", async () => {
    const pending = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(2);
    const shared = sharedLoader("changed", load);
    const before = shared();
    markServerChange();
    const after = shared();
    pending.resolve(1);
    expect(await before).toBe(1);
    expect(await after).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fetches again once the previous request has settled, including after a failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("ok");
    const shared = sharedLoader("settled", load);
    await expect(shared()).rejects.toThrow("offline");
    expect(await shared()).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
