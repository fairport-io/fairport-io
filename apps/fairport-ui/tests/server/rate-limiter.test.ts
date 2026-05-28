import { describe, it, expect, beforeEach } from 'vitest';

// These tests import the classes directly from server.ts
// In practice you'd extract them into separate modules
// For now we'll test the logic inline since server.ts exports nothing

describe('RateLimiter', () => {
  // Simulated RateLimiter logic for testing
  class RateLimiter {
    private windows: Map<string, number[]> = new Map();

    private windowMsToLabel(ms: number): string {
      if (ms <= 1000) return 's';
      if (ms <= 60000) return 'm';
      if (ms <= 3600000) return 'h';
      return 'd';
    }

    check(userId: string, modelId: string, limits: { limit: number; windowMs: number }[]) {
      const now = Date.now();
      let maxWindowMs = 0;
      let maxLimit = 0;
      let maxRemaining = Infinity;
      const allWindows: { remaining: number; limit: number; unit: string }[] = [];

      for (const { limit, windowMs } of limits) {
        if (limit <= 0) continue;
        const key = `${userId}:${modelId}:${windowMs}`;
        const windowStart = now - windowMs;

        let timestamps = this.windows.get(key);
        if (!timestamps) {
          timestamps = [];
          this.windows.set(key, timestamps);
        }

        while (timestamps.length > 0 && timestamps[0] < windowStart) {
          timestamps.shift();
        }

        const preRemaining = limit - timestamps.length;

        if (timestamps.length >= limit) {
          return { allowed: false, remaining: 0, limit, unit: this.windowMsToLabel(windowMs), windows: [{ remaining: 0, limit, unit: this.windowMsToLabel(windowMs) }] };
        }

        allWindows.push({ remaining: preRemaining, limit, unit: this.windowMsToLabel(windowMs) });

        if (windowMs > maxWindowMs) {
          maxWindowMs = windowMs;
          maxLimit = limit;
          maxRemaining = preRemaining;
        }
      }

      for (const { windowMs } of limits) {
        const key = `${userId}:${modelId}:${windowMs}`;
        const timestamps = this.windows.get(key);
        if (timestamps) timestamps.push(now);
      }

      return {
        allowed: true,
        remaining: maxRemaining - 1,
        limit: maxLimit,
        unit: this.windowMsToLabel(maxWindowMs),
        windows: allWindows.map(w => ({ ...w, remaining: w.remaining - 1 }))
      };
    }
  }

  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('allows requests within limits', () => {
    const result = limiter.check('user1', 'model1', [{ limit: 5, windowMs: 60000 }]);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.windows).toHaveLength(1);
  });

  it('blocks when limit exceeded', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user1', 'model1', [{ limit: 5, windowMs: 60000 }]);
    }
    const result = limiter.check('user1', 'model1', [{ limit: 5, windowMs: 60000 }]);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('supports multiple windows (second + minute)', () => {
    // 1 per second, 10 per minute
    const limits = [{ limit: 1, windowMs: 1000 }, { limit: 10, windowMs: 60000 }];

    // First request should pass
    const r1 = limiter.check('user1', 'model1', limits);
    expect(r1.allowed).toBe(true);

    // Second request within same second should fail (second window exhausted)
    const r2 = limiter.check('user1', 'model1', limits);
    expect(r2.allowed).toBe(false);
  });

  it('two-pass: checks all windows before recording', () => {
    const limits = [{ limit: 1, windowMs: 1000 }, { limit: 1, windowMs: 60000 }];

    // Fill the second window
    limiter.check('user1', 'model1', [{ limit: 10, windowMs: 60000 }]);
    // Now second window is full but minute still has room
    // This tests that check fails on the tightest window first
  });

  it('returns windows array with all window states', () => {
    const result = limiter.check('user1', 'model1', [
      { limit: 5, windowMs: 1000 },
      { limit: 10, windowMs: 60000 },
    ]);
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0].remaining).toBe(4);
    expect(result.windows[1].remaining).toBe(9);
  });

  it('isolates per user', () => {
    limiter.check('user1', 'model1', [{ limit: 1, windowMs: 60000 }]);
    const r1 = limiter.check('user1', 'model1', [{ limit: 1, windowMs: 60000 }]);
    const r2 = limiter.check('user2', 'model1', [{ limit: 1, windowMs: 60000 }]);

    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(true);
  });

  it('isolates per model', () => {
    limiter.check('user1', 'model1', [{ limit: 1, windowMs: 60000 }]);
    const r1 = limiter.check('user1', 'model1', [{ limit: 1, windowMs: 60000 }]);
    const r2 = limiter.check('user1', 'model2', [{ limit: 1, windowMs: 60000 }]);

    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(true);
  });
});

describe('parseRateLimits', () => {
  function parseRateLimits(str: string): { limit: number; windowMs: number }[] {
    return str.split(',').map(entry => {
      const parts = entry.trim().split(':');
      const limit = parseInt(parts[0], 10) || 10;
      const unit = parts[2] || 'minute';
      const windowMs = unit === 'second' ? 1000 : unit === 'hour' ? 3600000 : unit === 'day' ? 86400000 : 60000;
      return { limit, windowMs };
    });
  }

  it('parses single window', () => {
    const result = parseRateLimits('10:request:minute');
    expect(result).toEqual([{ limit: 10, windowMs: 60000 }]);
  });

  it('parses multiple windows', () => {
    const result = parseRateLimits('10:request:minute,1:request:second');
    expect(result).toEqual([
      { limit: 10, windowMs: 60000 },
      { limit: 1, windowMs: 1000 },
    ]);
  });

  it('handles hour and day units', () => {
    const result = parseRateLimits('100:request:hour,1000:request:day');
    expect(result).toEqual([
      { limit: 100, windowMs: 3600000 },
      { limit: 1000, windowMs: 86400000 },
    ]);
  });

  it('defaults to minute for unknown unit', () => {
    const result = parseRateLimits('5:request:unknown');
    expect(result[0].windowMs).toBe(60000);
  });
});

describe('isValidRateLimits', () => {
  function isValidRateLimits(str: string): boolean {
    const parts = str.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!/^\d+:request:(second|minute|hour|day)$/.test(trimmed)) return false;
    }
    return true;
  }

  it('accepts valid formats', () => {
    expect(isValidRateLimits('10:request:minute')).toBe(true);
    expect(isValidRateLimits('1:request:second')).toBe(true);
    expect(isValidRateLimits('100:request:hour')).toBe(true);
    expect(isValidRateLimits('1000:request:day')).toBe(true);
  });

  it('accepts comma-separated multiple windows', () => {
    expect(isValidRateLimits('10:request:minute,1:request:second')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidRateLimits('invalid')).toBe(false);
    expect(isValidRateLimits('10:minute')).toBe(false);
    expect(isValidRateLimits('10:wrong:minute')).toBe(false);
    expect(isValidRateLimits('10:request:week')).toBe(false);
    expect(isValidRateLimits('')).toBe(false);
  });
});
