/** Minimal bounded-concurrency limiter — no external dependency needed. */
export function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function scheduleNext() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active += 1;
    const run = queue.shift();
    run?.();
  }

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      scheduleNext();
    });
    try {
      return await fn();
    } finally {
      active -= 1;
      scheduleNext();
    }
  };
}
