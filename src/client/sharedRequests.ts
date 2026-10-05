// Several components often load the same list at the same moment: the sidebar and the open page on mount, and every
// subscriber when one change event arrives. They share one request instead of each fetching it.

let generation = 0;
const inFlight = new Map<string, { generation: number; promise: Promise<unknown> }>();

/** Call when the server announces a change, so later loads never reuse a request that started before it. */
export function markServerChange() {
  generation += 1;
}

/**
 * Wraps a loader so concurrent calls share one request. A caller only joins a request started since the last server
 * change. Joiners get their own copy, so no two components hold the same mutable object.
 */
export function sharedLoader<T>(key: string, load: () => Promise<T>): () => Promise<T> {
  return () => {
    const current = inFlight.get(key);
    if (current && current.generation === generation) {
      return (current.promise as Promise<T>).then((value) => structuredClone(value));
    }
    const entry = { generation, promise: load() as Promise<unknown> };
    inFlight.set(key, entry);
    const clear = () => {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    };
    entry.promise.then(clear, clear);
    return entry.promise as Promise<T>;
  };
}
