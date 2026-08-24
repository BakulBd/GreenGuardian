/**
 * The queue behind "one warning, one snapshot attempt".
 *
 * The exam client pushes one capture job per genuine warning
 * (`app/exam/[id]/ExamClient.tsx`). What has to hold, and what these tests
 * pin down, is that a burst of warnings loses none of them and that a
 * screenshot which fails to capture or upload does not take the rest of the
 * session's evidence with it.
 */
import { describe, it, expect, vi } from "vitest";
import { createSerialQueue } from "@/lib/utils/serial-queue";

/** Lets the microtask queue and any pending timers run to completion. */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("createSerialQueue", () => {
  it("runs one job per push, in order", async () => {
    const ran: number[] = [];
    const queue = createSerialQueue();

    for (const n of [1, 2, 3, 4, 5]) {
      queue.push(async () => {
        ran.push(n);
      });
    }

    await settle();
    expect(ran).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([1, 2, 5, 10])("runs exactly %i jobs for %i pushes", async (count) => {
    const job = vi.fn(async () => {});
    const queue = createSerialQueue();

    for (let i = 0; i < count; i++) queue.push(job);

    await settle();
    expect(job).toHaveBeenCalledTimes(count);
  });

  it("never overlaps two jobs, even when they are pushed in the same tick", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const queue = createSerialQueue();

    for (let i = 0; i < 6; i++) {
      queue.push(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      });
    }

    await settle();
    expect(maxInFlight).toBe(1);
  });

  it("keeps going after a job rejects, and reports it", async () => {
    // The case that matters in production: a warning whose frame could not be
    // captured, or whose upload failed, must not stop later warnings from
    // leaving evidence.
    const ran: string[] = [];
    const onError = vi.fn();
    const queue = createSerialQueue(onError);

    queue.push(async () => {
      ran.push("first");
    });
    queue.push(async () => {
      throw new Error("upload failed");
    });
    queue.push(async () => {
      ran.push("third");
    });

    await settle();
    expect(ran).toEqual(["first", "third"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("upload failed");
  });

  it("survives a job that throws synchronously", async () => {
    const ran: string[] = [];
    const onError = vi.fn();
    const queue = createSerialQueue(onError);

    queue.push((() => {
      throw new Error("capture threw");
    }) as () => Promise<unknown>);
    queue.push(async () => {
      ran.push("after");
    });

    await settle();
    expect(ran).toEqual(["after"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("survives a broken error handler", async () => {
    const ran: string[] = [];
    const queue = createSerialQueue(() => {
      throw new Error("logger blew up");
    });

    queue.push(async () => {
      throw new Error("first failure");
    });
    queue.push(async () => {
      ran.push("still ran");
    });

    await settle();
    expect(ran).toEqual(["still ran"]);
  });

  it("picks up work enqueued while a job is already running", async () => {
    // A warning raised during a slow upload must be served by the same worker,
    // not start a second concurrent drain.
    const ran: string[] = [];
    const queue = createSerialQueue();

    queue.push(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      ran.push("slow");
      queue.push(async () => {
        ran.push("enqueued from inside");
      });
    });

    await settle();
    expect(ran).toEqual(["slow", "enqueued from inside"]);
    expect(queue.draining).toBe(false);
    expect(queue.size).toBe(0);
  });

  it("restarts cleanly after the queue has emptied", async () => {
    const job = vi.fn(async () => {});
    const queue = createSerialQueue();

    queue.push(job);
    await settle();
    expect(queue.draining).toBe(false);

    queue.push(job);
    await settle();
    expect(job).toHaveBeenCalledTimes(2);
  });
});
