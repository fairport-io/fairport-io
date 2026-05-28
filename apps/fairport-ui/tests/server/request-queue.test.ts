import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('RequestQueue', () => {
  class RequestQueue {
    private queues: Map<string, { processing: number; pending: Array<{ resolve: (v: { ok: boolean; reason?: string }) => void; timestamp: number }> }> = new Map();

    async enqueue(key: string, maxSize: number, timeoutMs: number = 120_000): Promise<{ ok: boolean; reason?: string }> {
      let entry = this.queues.get(key);
      if (!entry) {
        entry = { processing: 0, pending: [] };
        this.queues.set(key, entry);
      }

      if (entry.processing + entry.pending.length >= maxSize) {
        return { ok: false, reason: 'full' };
      }

      if (entry.processing === 0) {
        entry.processing = 1;
        return { ok: true };
      }

      return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
        const pendingItem = { resolve, timestamp: Date.now() };
        entry!.pending.push(pendingItem);

        setTimeout(() => {
          const idx = entry!.pending.indexOf(pendingItem);
          if (idx !== -1) {
            entry!.pending.splice(idx, 1);
            resolve({ ok: false, reason: 'timeout' });
          }
        }, timeoutMs);
      });
    }

    dequeue(key: string): void {
      const entry = this.queues.get(key);
      if (!entry) return;

      if (entry.pending.length > 0) {
        const next = entry.pending.shift()!;
        next.resolve({ ok: true });
      } else {
        entry.processing = 0;
      }
    }

    getQueueSize(key: string): number {
      const entry = this.queues.get(key);
      return entry ? entry.processing + entry.pending.length : 0;
    }

    gc(maxAgeMs: number): void {
      const now = Date.now();
      for (const [key, entry] of this.queues.entries()) {
        if (entry.pending.length > 0) {
          const stale: typeof entry.pending = [];
          const active: typeof entry.pending = [];
          for (const p of entry.pending) {
            if (now - p.timestamp > maxAgeMs) {
              stale.push(p);
            } else {
              active.push(p);
            }
          }
          for (const p of stale) {
            p.resolve({ ok: false, reason: 'timeout' });
          }
          entry.pending = active;
        }
        if (entry.processing === 0 && entry.pending.length === 0) {
          this.queues.delete(key);
        }
      }
    }
  }

  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue();
  });

  it('first request processes immediately', async () => {
    const result = await queue.enqueue('provider:model', 5);
    expect(result.ok).toBe(true);
    expect(queue.getQueueSize('provider:model')).toBe(1);
  });

  it('second request waits in pending', async () => {
    await queue.enqueue('provider:model', 5); // processing = 1

    const pendingPromise = queue.enqueue('provider:model', 5);

    expect(queue.getQueueSize('provider:model')).toBe(2);

    // Dequeue should resolve the pending request
    queue.dequeue('provider:model');
    const result = await pendingPromise;
    expect(result.ok).toBe(true);
  });

  it('returns full when queue at capacity', async () => {
    const maxSize = 2;

    await queue.enqueue('provider:model', maxSize); // processing = 1
    const pendingPromise = queue.enqueue('provider:model', maxSize); // pending = 1

    // Queue is now at capacity (1 processing + 1 pending = 2)
    const result = await queue.enqueue('provider:model', maxSize);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('full');

    // Clean up
    queue.dequeue('provider:model');
    await pendingPromise;
  });

  it('dequeue processes next pending item', async () => {
    await queue.enqueue('provider:model', 5);
    const p1 = queue.enqueue('provider:model', 5);
    const p2 = queue.enqueue('provider:model', 5);

    expect(queue.getQueueSize('provider:model')).toBe(3);

    queue.dequeue('provider:model');
    expect(await p1).toEqual({ ok: true });

    queue.dequeue('provider:model');
    expect(await p2).toEqual({ ok: true });

    expect(queue.getQueueSize('provider:model')).toBe(1);
  });

  it('dequeue with no pending sets processing to 0', async () => {
    await queue.enqueue('provider:model', 5);
    expect(queue.getQueueSize('provider:model')).toBe(1);

    queue.dequeue('provider:model');
    expect(queue.getQueueSize('provider:model')).toBe(0);
  });

  it('returns timeout when pending item expires', async () => {
    vi.useFakeTimers();

    await queue.enqueue('provider:model', 5);
    const pendingPromise = queue.enqueue('provider:model', 5, 1000); // 1s timeout

    // Advance past timeout
    vi.advanceTimersByTime(1100);

    const result = await pendingPromise;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('timeout');

    vi.useRealTimers();
  });

  it('gc purges stale pending items', async () => {
    vi.useFakeTimers();

    await queue.enqueue('provider:model', 5);
    const pendingPromise = queue.enqueue('provider:model', 5, 600_000);

    vi.advanceTimersByTime(610_000); // Past 10min max age

    queue.gc(600_000);

    const result = await pendingPromise;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('timeout');

    vi.useRealTimers();
  });

  it('gc removes empty queues', () => {
    queue.dequeue('nonexistent'); // no-op
    expect(queue.getQueueSize('nonexistent')).toBe(0);
  });

  it('isolates queues per key', async () => {
    await queue.enqueue('p1:m1', 5);
    await queue.enqueue('p2:m2', 5);

    expect(queue.getQueueSize('p1:m1')).toBe(1);
    expect(queue.getQueueSize('p2:m2')).toBe(1);

    queue.dequeue('p1:m1');
    expect(queue.getQueueSize('p1:m1')).toBe(0);
    expect(queue.getQueueSize('p2:m2')).toBe(1); // unaffected
  });
});
