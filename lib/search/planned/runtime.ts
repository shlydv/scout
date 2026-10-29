/** Cancellation follows the work; a deadline never merely abandons a promise. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Search cancelled", "AbortError");
}

export function createDeadline(timeoutMs?: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs == null ? undefined : setTimeout(
    () => controller.abort(new DOMException("Search deadline exceeded", "TimeoutError")),
    Math.max(0, timeoutMs),
  );
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abort); },
  };
}

export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** postgres.js cancel removes queued queries or sends a PostgreSQL CancelRequest.
 * Await settlement as well: do not release a worker while its SQL still runs.
 */
export async function abortableQuery<T>(query: PromiseLike<T> & { cancel(): unknown }, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  const cancel = () => {
    try { void Promise.resolve(query.cancel()).catch(() => {}); }
    catch { /* Still await query settlement; never detach database work. */ }
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) cancel();
    const result = await query;
    throwIfAborted(signal);
    return result;
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** Shared operations are cancelled only when their last consumer leaves.
 * A cancelled last consumer waits for resource cleanup before releasing work.
 */
export class SharedWork<T> {
  private entries = new Map<string, { controller: AbortController; promise: Promise<T>; users: number; settled: boolean }>();

  clear(): void {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }

  run(key: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created = { controller, users: 0, settled: false, promise: null as unknown as Promise<T> };
      created.promise = Promise.resolve().then(() => {
        throwIfAborted(controller.signal);
        return work(controller.signal);
      }).finally(() => {
        created.settled = true;
        if (this.entries.get(key) === created) this.entries.delete(key);
      });
      // A consumer may cancel before the task's first microtask starts.
      void created.promise.catch(() => {});
      this.entries.set(key, created);
      entry = created;
    }
    const shared = entry;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        shared.users--;
        if (!shared.users && !shared.settled) {
          if (this.entries.get(key) === shared) this.entries.delete(key);
          shared.controller.abort(signal?.reason);
        }
      };
      const finish = (ok: boolean, value: unknown) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        release();
        if (ok) resolve(value as T);
        else reject(value);
      };
      const onAbort = () => {
        release();
        const reason = signal?.reason ?? new DOMException("Search cancelled", "AbortError");
        if (!shared.users && !shared.settled) {
          void shared.promise.then(() => finish(false, reason), () => finish(false, reason));
        } else finish(false, reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void shared.promise.then(value => {
        if (signal?.aborted) finish(false, signal.reason);
        else finish(true, value);
      }, error => finish(false, error));
      if (signal?.aborted) onAbort();
    });
  }
}

type Waiting = { start(): void; signal: AbortSignal; reject(error: unknown): void; onAbort(): void };

/** Per-instance concurrency bound and same-key single flight, including wait time. */
export class KeyedWorkQueue<T> {
  private active = 0;
  private waiting: Waiting[] = [];
  private shared = new SharedWork<T>();

  constructor(private concurrency: number, private maxQueued: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueued) || maxQueued < 0) throw new Error("Invalid work queue limits");
  }

  run(key: string, work: (signal: AbortSignal) => Promise<T>, opts: { signal?: AbortSignal; timeoutMs: number }): Promise<T> {
    return this.shared.run(key, async sharedSignal => {
      const deadline = createDeadline(opts.timeoutMs, sharedSignal);
      try { return await this.enqueue(work, deadline.signal); }
      finally { deadline.dispose(); }
    }, opts.signal);
  }

  private enqueue(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    if (this.active >= this.concurrency && this.waiting.length >= this.maxQueued) {
      return Promise.reject(new Error("Shelf generation queue is full"));
    }
    return new Promise<T>((resolve, reject) => {
      const entry: Waiting = {
        signal, reject,
        onAbort: () => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(signal.reason);
        },
        start: () => {
          signal.removeEventListener("abort", entry.onAbort);
          if (signal.aborted) { reject(signal.reason); return; }
          this.active++;
          void Promise.resolve().then(() => {
            throwIfAborted(signal);
            return work(signal);
          }).then(resolve, reject).finally(() => { this.active--; this.drain(); });
        },
      };
      if (this.active < this.concurrency) entry.start();
      else {
        this.waiting.push(entry);
        signal.addEventListener("abort", entry.onAbort, { once: true });
        if (signal.aborted) entry.onAbort();
      }
    });
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!.start();
  }
}
