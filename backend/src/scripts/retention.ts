import dotenv from 'dotenv';
dotenv.config();

import { Op } from 'sequelize';
import { connectDatabase } from '../config/database';
import { Trip, TripPhoto } from '../models';
import {
  retentionCutoff,
  anonymisedValues,
  parseRetentionArgs,
} from './retentionPolicy';

/**
 * Applies the retention rule the privacy policy publishes: seven years on,
 * photographs are deleted and trip records are anonymised, while mileage,
 * dates and vehicle survive for fleet reporting.
 *
 * Nothing ran this before, so the promise was on the website only.
 *
 *   npm run retention            # report what is due, change nothing
 *   npm run retention -- --commit
 *
 * It reports by default because both steps are irreversible and there is no
 * undo: a deleted photograph is gone, and an anonymised trip cannot be
 * re-linked to its driver. Deciding to run it is a person's job, so this is a
 * script rather than a timer inside the server - wire it to whatever scheduler
 * you use once you have seen a dry run you believe.
 */

const run = async () => {
  const { commit, years } = parseRetentionArgs(process.argv.slice(2));

  if (!Number.isFinite(years) || years <= 0) {
    console.error('--years must be a positive number of years.');
    process.exit(1);
  }

  const cutoff = retentionCutoff(new Date(), years);

  await connectDatabase();

  // Already-anonymised trips have no driver link, so they are not picked up
  // twice and the job is safe to re-run.
  const due = await Trip.findAll({
    where: {
      startTime: { [Op.lte]: cutoff },
      driverId: { [Op.ne]: null },
    },
    attributes: ['id'],
  });
  const tripIds = due.map((t) => t.id);

  const photoCount = tripIds.length
    ? await TripPhoto.count({ where: { tripId: { [Op.in]: tripIds } } })
    : 0;

  console.log(`Retention window: ${years} year${years === 1 ? '' : 's'}`);
  console.log(`Cutoff:           ${cutoff.toISOString()} (trips starting on or before)`);
  console.log(`Trips to anonymise: ${tripIds.length}`);
  console.log(`Photographs to delete: ${photoCount}`);

  if (!tripIds.length) {
    console.log('\nNothing is due. No changes made.');
    process.exit(0);
  }

  if (!commit) {
    console.log(
      '\nDRY RUN - nothing was changed.\n' +
      'Re-run with --commit to delete those photographs and anonymise those\n' +
      'trips. Both are irreversible.'
    );
    process.exit(0);
  }

  // One transaction: a half-applied run would leave photographs attached to
  // trips that no longer name anyone, or the reverse.
  //
  // Chunked because the first run after seven years of operation clears the
  // whole backlog at once, and a single IN list holding every id is how that
  // query stops being acceptable.
  const CHUNK = 500;
  const sequelize = Trip.sequelize!;
  let photosDeleted = 0;
  let tripsAnonymised = 0;

  await sequelize.transaction(async (transaction) => {
    for (let i = 0; i < tripIds.length; i += CHUNK) {
      const batch = tripIds.slice(i, i + CHUNK);
      photosDeleted += await TripPhoto.destroy({
        where: { tripId: { [Op.in]: batch } },
        transaction,
      });
      const [updated] = await Trip.update(anonymisedValues(), {
        where: { id: { [Op.in]: batch } },
        transaction,
      });
      tripsAnonymised += updated;
    }
  });

  console.log(`\nDeleted ${photosDeleted} photograph(s).`);
  console.log(`Anonymised ${tripsAnonymised} trip(s).`);

  console.log('Done.');
  process.exit(0);
};

run().catch((error) => {
  console.error('Retention run failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
