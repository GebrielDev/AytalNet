import { describe, it, expect } from 'vitest';
import {
  anonymisedDriverValues,
  cloudinaryPublicId,
  RETENTION_YEARS,
  retentionCutoff,
  anonymisedValues,
  ANONYMISED_FIELDS,
  PRESERVED_FIELDS,
} from './retentionPolicy';

describe('retentionCutoff', () => {
  it('is seven years back, matching the published policy', () => {
    expect(RETENTION_YEARS).toBe(7);
    expect(retentionCutoff(new Date('2026-10-06T00:00:00Z')).toISOString())
      .toBe(new Date('2019-10-06T00:00:00Z').toISOString());
  });

  // Going back seven years from 29 February has no exact answer. JavaScript's
  // own rollover gives 1 March, which is LATER than seven years and would
  // anonymise a trip a day early; the cutoff must never move in that
  // direction, so it lands on 28 February instead.
  it('never moves the cutoff later when a leap day has no counterpart', () => {
    const cutoff = retentionCutoff(new Date(Date.UTC(2024, 1, 29)));

    expect(cutoff.getUTCFullYear()).toBe(2017);
    expect(cutoff.getUTCMonth()).toBe(1); // February, not March
    expect(cutoff.getUTCDate()).toBe(28);
  });

  // The property that matters for a one-way operation: whatever the calendar
  // does, the cutoff is never later than the naive "seven years of days" mark,
  // so nothing is anonymised before its time.
  it('never anonymises earlier than seven years for any date in a leap cycle', () => {
    for (let day = 0; day < 365 * 4 + 1; day += 1) {
      const now = new Date(Date.UTC(2024, 0, 1) + day * 24 * 60 * 60 * 1000);
      const cutoff = retentionCutoff(now);
      const sevenYearsOfDays = now.getTime() - (365 * 7 + 2) * 24 * 60 * 60 * 1000;

      expect(cutoff.getTime()).toBeLessThanOrEqual(now.getTime() - 365 * 7 * 24 * 60 * 60 * 1000);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(sevenYearsOfDays);
    }
  });

  it('accepts a shorter window for testing a run without waiting seven years', () => {
    expect(retentionCutoff(new Date('2026-10-06T00:00:00Z'), 1).getUTCFullYear()).toBe(2025);
  });
});

describe('anonymisedValues', () => {
  it('clears every field that ties a trip to a person', () => {
    const values = anonymisedValues();
    for (const field of ['driverId', 'startLatitude', 'startLongitude', 'startAddress',
      'endLatitude', 'endLongitude', 'endAddress']) {
      expect(values[field]).toBeNull();
    }
  });

  // The policy promises mileage, dates and vehicle survive. If one of them
  // ever appears in the cleared set, fleet reporting loses history silently.
  it('never clears a field the policy promises to keep', () => {
    const cleared = new Set(Object.keys(anonymisedValues()));
    for (const kept of PRESERVED_FIELDS) {
      expect(cleared.has(kept)).toBe(false);
    }
  });

  it('clears exactly the declared set, nothing more', () => {
    expect(Object.keys(anonymisedValues()).sort()).toEqual([...ANONYMISED_FIELDS].sort());
  });
});

describe('cloudinaryPublicId', () => {
  it('reads the id out of a plain delivery URL', () => {
    expect(cloudinaryPublicId(
      'https://res.cloudinary.com/demo/image/upload/v1699999999/fleet-management/trips/abc123.jpg'
    )).toBe('fleet-management/trips/abc123');
  });

  it('ignores transformation segments', () => {
    expect(cloudinaryPublicId(
      'https://res.cloudinary.com/demo/image/upload/c_limit,w_1200/q_auto/v1699999999/fleet-management/trips/abc123.webp'
    )).toBe('fleet-management/trips/abc123');
  });

  it('ignores a query string', () => {
    expect(cloudinaryPublicId(
      'https://res.cloudinary.com/demo/image/upload/v1/fleet-management/trips/a.png?_a=xyz'
    )).toBe('fleet-management/trips/a');
  });

  // photo_url was widened to TEXT for base64 data URIs; those have no remote
  // object, and must not be mistaken for one.
  it('returns null for things that are not Cloudinary assets', () => {
    for (const url of [
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      'https://example.com/image.jpg',
      'https://res.cloudinary.com/demo/image/fetch/http://x/y.jpg',
      '',
      'not a url',
    ]) {
      expect(cloudinaryPublicId(url)).toBeNull();
    }
  });
});

describe('anonymisedDriverValues', () => {
  it('replaces every identifying field', () => {
    const values = anonymisedDriverValues(42);

    expect(values.name).toBe('Former driver');
    expect(values.email).toBe('anonymised-42@anonymised.invalid');
    expect(values.phone).toBe('');
    expect(values.licenseNumber).toBe('');
  });

  // employeeId and email are NOT NULL and unique, so two anonymised drivers
  // must not collide - and nulling them is not an option.
  it('keeps the unique columns unique and non-null', () => {
    const a = anonymisedDriverValues(1);
    const b = anonymisedDriverValues(2);

    expect(a.employeeId).not.toBe(b.employeeId);
    expect(a.email).not.toBe(b.email);
    for (const v of [a.employeeId, a.email]) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  // The address must not be deliverable - an anonymised record should not be
  // able to receive a password-reset link - and it must still satisfy the
  // column's isEmail validation, which rejects a domain with no dot. The first
  // attempt here used `user@invalid` and the update failed against a real
  // database with "Validation isEmail on email failed".
  it('uses a reserved TLD that cannot receive mail, and still parses as an address', () => {
    const email = anonymisedDriverValues(7).email;
    const [local, domain] = email.split('@');

    expect(domain.endsWith('.invalid')).toBe(true);
    expect(domain).toContain('.');
    expect(local.length).toBeGreaterThan(0);
    expect(email.split('@')).toHaveLength(2);
  });

  // bcrypt hashes begin with $2. Anything that cannot be one makes every
  // comparison fail, so the account cannot be signed into.
  it('leaves a password hash no password can match', () => {
    expect(anonymisedDriverValues(7).passwordHash.startsWith('$2')).toBe(false);
  });
});
