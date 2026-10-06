import { describe, it, expect } from 'vitest';
import { parseRetentionArgs as parseArgs } from './retentionPolicy';

describe('retention arguments', () => {
  // The default has to be the harmless one. A run that deletes photographs
  // because someone forgot a flag is not recoverable.
  it('defaults to a dry run', () => {
    expect(parseArgs([]).commit).toBe(false);
    expect(parseArgs(['--years=1']).commit).toBe(false);
  });

  it('commits only on the explicit flag', () => {
    expect(parseArgs(['--commit']).commit).toBe(true);
  });

  it('is not triggered by a lookalike flag', () => {
    for (const flag of ['--commit=false', '--no-commit', '-c', 'commit']) {
      expect(parseArgs([flag]).commit).toBe(false);
    }
  });

  it('defaults to the published seven-year window', () => {
    expect(parseArgs([]).years).toBe(7);
  });

  it('accepts an explicit window', () => {
    expect(parseArgs(['--years=1']).years).toBe(1);
  });

  it('surfaces a malformed window as NaN so the script can reject it', () => {
    expect(Number.isFinite(parseArgs(['--years=soon']).years)).toBe(false);
  });
});
