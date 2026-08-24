/**
 * A queue that runs async jobs one at a time and never drops one.
 *
 * Written for proctoring evidence: the exam client enqueues exactly one
 * screenshot capture per warning, and the guarantee that matters is that N
 * warnings produce N attempts — in order, with no overlap, and with a failed
 * job costing only itself. Running captures in parallel instead would have
 * several of them drawing from the same `<video>` element and uploading at
 * once, and a rejected promise in that pile is easy to lose.
 *
 * Deliberately not a React hook and not tied to state: warnings can arrive
 * faster than React re-renders, so the pending list has to live somewhere a
 * stale closure cannot reach. Callers hold the queue in a ref.
 */

export interface SerialQueue {
  /** Adds a job. Starts the worker if it is not already running. */
  push(job: () => Promise<unknown>): void;
  /** Jobs waiting to start (excludes the one currently running). */
  readonly size: number;
  /** Whether the worker is currently working through the queue. */
  readonly draining: boolean;
}

/**
 * @param onError Called with whatever a job threw. The queue keeps going
 *   regardless — a handler that throws would itself be swallowed, so keep it
 *   to logging.
 */
export function createSerialQueue(onError?: (error: unknown) => void): SerialQueue {
  const jobs: Array<() => Promise<unknown>> = [];
  let draining = false;

  const drain = async () => {
    try {
      // Re-checked each pass rather than snapshotted: a job may enqueue more
      // work, and warnings raised while a capture is in flight must be picked
      // up by this same worker instead of starting a second one.
      while (jobs.length > 0) {
        const job = jobs.shift();
        if (!job) continue;
        try {
          await job();
        } catch (error) {
          try {
            onError?.(error);
          } catch {
            // A broken error handler must not stop the queue either.
          }
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    push(job) {
      jobs.push(job);
      if (draining) return;
      draining = true;
      void drain();
    },
    get size() {
      return jobs.length;
    },
    get draining() {
      return draining;
    },
  };
}
