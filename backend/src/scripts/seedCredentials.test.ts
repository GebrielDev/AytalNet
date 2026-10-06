import { describe, it, expect } from 'vitest';
import { ALPHABET, randomPassword, resolvePassword, productionSeedBlocked } from './seedCredentials';

describe('randomPassword', () => {
  it('is the requested length', () => {
    expect(randomPassword(20)).toHaveLength(20);
    expect(randomPassword(8)).toHaveLength(8);
  });

  it('differs every call', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomPassword()));
    expect(seen.size).toBe(200);
  });

  it('avoids glyphs that are misread off a terminal', () => {
    const sample = Array.from({ length: 200 }, () => randomPassword()).join('');
    for (const confusable of ['O', '0', 'I', 'l', '1']) {
      expect(sample).not.toContain(confusable);
    }
  });

  // `byte % ALPHABET.length` is biased in a precise way: 256 is not a multiple
  // of 57, so the first few symbols can be produced by one more byte value
  // than the rest, making them 25% more likely each.
  //
  // Comparing the two groups' per-symbol means isolates exactly that: an
  // unbiased generator puts the ratio at 1.00, the modulo version at 1.25.
  // Grouping keeps the noise near 1%, so the gap is not a coin flip.
  it('draws symbols without modulo bias', () => {
    const ALPHABET_SIZE = ALPHABET.length;
    // 256 = 4*57 + 28, so the first 28 symbols get five byte values and the
    // rest get four.
    const OVERSAMPLED = 256 % ALPHABET_SIZE;

    const counts = new Map<string, number>();
    const sample = Array.from({ length: 2000 }, () => randomPassword()).join('');
    for (const ch of sample) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(ALPHABET_SIZE);

    // Rank by the alphabet's own order, which is the order modulo favours.
    const ordered = [...counts.entries()].sort(
      (a, b) => ALPHABET.indexOf(a[0]) - ALPHABET.indexOf(b[0])
    ).map(([, n]) => n);

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ratio = mean(ordered.slice(0, OVERSAMPLED)) / mean(ordered.slice(OVERSAMPLED));

    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });
});

describe('resolvePassword', () => {
  it('prefers an explicit environment value', () => {
    expect(resolvePassword('SEED_ADMIN_PASSWORD', { SEED_ADMIN_PASSWORD: 'chosen' } as NodeJS.ProcessEnv))
      .toEqual({ value: 'chosen', fromEnv: true });
  });

  it('generates one when the variable is absent or empty', () => {
    for (const env of [{}, { SEED_ADMIN_PASSWORD: '' }]) {
      const result = resolvePassword('SEED_ADMIN_PASSWORD', env as NodeJS.ProcessEnv);
      expect(result.fromEnv).toBe(false);
      expect(result.value).toHaveLength(20);
    }
  });

  // The old literals must not come back through a default.
  it('never returns a known seeded literal by default', () => {
    for (let i = 0; i < 100; i += 1) {
      const { value } = resolvePassword('SEED_ADMIN_PASSWORD', {} as NodeJS.ProcessEnv);
      expect(['admin123', 'dispatch123', 'driver123']).not.toContain(value);
    }
  });
});

describe('productionSeedBlocked', () => {
  it('blocks in production by default', () => {
    expect(productionSeedBlocked({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('allows production only with the explicit opt-in', () => {
    expect(productionSeedBlocked({
      NODE_ENV: 'production', ALLOW_PRODUCTION_SEED: 'yes',
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is not satisfied by a merely truthy opt-in', () => {
    for (const v of ['1', 'true', 'YES', 'please']) {
      expect(productionSeedBlocked({
        NODE_ENV: 'production', ALLOW_PRODUCTION_SEED: v,
      } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  it('does not block outside production', () => {
    expect(productionSeedBlocked({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(productionSeedBlocked({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
