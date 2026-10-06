/**
 * The retention rule the published privacy policy commits to.
 *
 * landing/public/privacy.html, "How long it is kept":
 *
 *   "Trip records and their photographs are retained for seven years, which
 *    covers the period we are required to keep vehicle and mileage records for
 *    tax and insurance purposes. After that, photographs are deleted and trip
 *    records are anonymised: the mileage, dates and vehicle are kept for fleet
 *    reporting, but they are no longer linked to you."
 *
 * Nothing implemented it. This module holds the parts worth testing on their
 * own - the cutoff arithmetic and what "anonymised" means field by field - so
 * the script that touches the database stays thin.
 */

export const RETENTION_YEARS = 7;

/**
 * Trips that started on or before this instant are past their retention
 * period.
 *
 * setFullYear alone is not enough. Going back seven years from 29 February
 * lands on a year with no such date, and JavaScript rolls the overflow forward
 * to 1 March - which moves the cutoff LATER and would anonymise a trip a day
 * before its seven years are up. For a one-way data operation the error has to
 * fall the other way, so an overflow is pulled back to the last day of the
 * intended month instead.
 */
export const retentionCutoff = (now: Date = new Date(), years = RETENTION_YEARS): Date => {
  const cutoff = new Date(now.getTime());
  const month = cutoff.getUTCMonth();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);

  if (cutoff.getUTCMonth() !== month) {
    // Rolled into the next month; step back onto the last day of the right one.
    cutoff.setUTCDate(0);
  }
  return cutoff;
};

/**
 * What an anonymised trip keeps and what it loses.
 *
 * Kept, because the policy promises fleet reporting continues: mileage,
 * odometer readings, dates, duration, vehicle, status.
 *
 * Cleared, because they are what links the record to a person: the driver
 * reference, and the start and end coordinates and addresses - a trip's
 * endpoints are a home address as often as not.
 */
export const ANONYMISED_FIELDS = [
  'driverId',
  'startLatitude',
  'startLongitude',
  'startAddress',
  'endLatitude',
  'endLongitude',
  'endAddress',
] as const;

export const anonymisedValues = (): Record<string, null> =>
  Object.fromEntries(ANONYMISED_FIELDS.map((field) => [field, null]));

/** Fields the policy promises to keep, asserted so a careless edit is caught. */
export const PRESERVED_FIELDS = [
  'id',
  'vehicleId',
  'status',
  'startTime',
  'endTime',
  'durationMinutes',
  'startOdometer',
  'endOdometer',
  'totalMileage',
] as const;

export interface RetentionArgs {
  commit: boolean;
  years: number;
}

/**
 * Dry run is the default and `--commit` is the only thing that changes it.
 * Deleting photographs and severing driver links cannot be undone, so a
 * forgotten flag has to be the harmless mistake.
 */
export const parseRetentionArgs = (argv: string[]): RetentionArgs => {
  const years = argv.find((a) => a.startsWith('--years='));
  return {
    commit: argv.includes('--commit'),
    years: years ? Number(years.split('=')[1]) : RETENTION_YEARS,
  };
};

/**
 * The Cloudinary public_id behind a stored photo URL, or null when the URL is
 * not a Cloudinary asset.
 *
 * Photos go to Cloudinary and only the secure_url is kept, so deleting the
 * trip_photos row removes the only record of where the image lives while the
 * image itself stays public. The policy says photographs are deleted, so the
 * remote object has to go too - and the id has to be recovered from the URL,
 * since nothing stored it.
 *
 * A Cloudinary delivery URL looks like:
 *   https://res.cloudinary.com/<cloud>/image/upload/v1699999999/folder/name.jpg
 * everything after the version segment, minus the extension, is the public_id.
 * Transformation segments may sit between `upload` and the version.
 *
 * photo_url was widened to TEXT to allow base64 data URIs, so some rows are not
 * Cloudinary URLs at all; those return null and have nothing remote to delete.
 */
export const cloudinaryPublicId = (photoUrl: string): string | null => {
  if (!/^https?:\/\/res\.cloudinary\.com\//.test(photoUrl)) return null;

  const path = photoUrl.split('?')[0];
  const afterUpload = path.split('/upload/')[1];
  if (!afterUpload) return null;

  const segments = afterUpload.split('/');
  // Drop the version segment (v1699999999) and anything before it, which is
  // where transformations appear.
  const versionAt = segments.findIndex((s) => /^v\d+$/.test(s));
  const idSegments = versionAt >= 0 ? segments.slice(versionAt + 1) : segments;
  if (!idSegments.length) return null;

  const joined = idSegments.join('/');
  const withoutExtension = joined.replace(/\.[a-zA-Z0-9]+$/, '');
  return withoutExtension || null;
};

/**
 * What an anonymised driver account keeps and what it loses.
 *
 * The privacy policy keeps account records "for as long as you drive for us
 * and for seven years afterwards". Nothing implemented that half either: a
 * driver set to inactive kept their name, email, phone, licence number and
 * password hash indefinitely.
 *
 * The row is anonymised rather than deleted, because trips reference it and a
 * trip whose own seven years are not yet up still needs a driver_id to point
 * at. employeeId and email are NOT NULL and unique, so they take unique
 * placeholders rather than null.
 *
 * The password hash is replaced with a value no password can produce, so the
 * account cannot be signed into even if the email were guessed.
 */
export const anonymisedDriverValues = (id: number): Record<string, string> => ({
  employeeId: `ANON-${id}`,
  name: 'Former driver',
  // .invalid is reserved by RFC 2606 and can never resolve, and the domain
  // needs a dot: the model validates this column with isEmail, which rejects a
  // bare `user@invalid`.
  email: `anonymised-${id}@anonymised.invalid`,
  phone: '',
  licenseNumber: '',
  // bcrypt hashes start with $2; this cannot be one, so compare always fails.
  passwordHash: 'anonymised-no-login',
});
