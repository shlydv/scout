/** Coalesce concurrent identical searches without caching errors or mixing preferences. */
export function singleFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, run: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(run).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
