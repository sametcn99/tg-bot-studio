import { describe, expect, it } from 'bun:test';
import {
  audienceBucket,
  isInTestSplit,
  variantIndexFor,
  variantScore,
} from '../modules/broadcast/broadcast-ab.util';

describe('broadcast A/B assignment', () => {
  it('maps ids to a stable bucket in [0, 99]', () => {
    for (const id of [1, 2, 42, 987654321, 12345678901234]) {
      const bucket = audienceBucket(id);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThanOrEqual(99);
      expect(audienceBucket(id)).toBe(bucket); // deterministic across calls
    }
  });

  it('accepts the same id in every shape (number, bigint, string)', () => {
    expect(audienceBucket(12345)).toBe(audienceBucket(BigInt(12345)));
    expect(audienceBucket(12345)).toBe(audienceBucket('12345'));
  });

  it('assigns the test split deterministically by bucket bound', () => {
    const inSplit = [...Array(500).keys()].filter((i) => isInTestSplit(BigInt(i + 1), 20)).length;
    // Roughly 20% of a 500-user sample (statistical bounds).
    expect(inSplit).toBeGreaterThan(60);
    expect(inSplit).toBeLessThan(140);
  });

  it('covers every variant exactly by bucket modulo', () => {
    for (let variant = 0; variant < 3; variant++) {
      const count = [...Array(600).keys()].filter(
        (i) => variantIndexFor(BigInt(i + 1), 3) === variant,
      ).length;
      expect(count).toBeGreaterThan(120);
      expect(count).toBeLessThan(280);
    }
  });
});

describe('broadcast winner scoring', () => {
  it('ranks click-through above delivery rate', () => {
    const higherCtr = variantScore({ clicks: 50, successCount: 100, totalRecipients: 100 });
    const lowerCtr = variantScore({ clicks: 5, successCount: 100, totalRecipients: 100 });
    expect(higherCtr).toBeGreaterThan(lowerCtr);
  });

  it('breaks near-tied CTR by delivery rate', () => {
    const betterDelivery = variantScore({ clicks: 10, successCount: 100, totalRecipients: 110 });
    const worseDelivery = variantScore({ clicks: 10, successCount: 100, totalRecipients: 500 });
    expect(betterDelivery).toBeGreaterThan(worseDelivery);
  });

  it('never divides by zero on undelivered variants', () => {
    expect(variantScore({ clicks: 0, successCount: 0, totalRecipients: 0 })).toBe(0);
  });
});
