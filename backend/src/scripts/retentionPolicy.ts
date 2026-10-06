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
