/** Coalesce concurrent cache misses without adding another TTL or retaining failures. */
export function singleFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    inflight ??= Promise.resolve().then(load).finally(() => { inflight = null; });
    return inflight;
  };
}
