import dotenv from 'dotenv';
dotenv.config();

import { Op } from 'sequelize';
import { connectDatabase } from '../config/database';
import { Trip, TripPhoto, Driver } from '../models';
import cloudinary from '../config/cloudinary';
import { emergentObjectPath, erasePhoto } from '../config/photoStorage';
import {
  retentionCutoff,
  anonymisedValues,
  parseRetentionArgs,
  cloudinaryPublicId,
  anonymisedDriverValues,
} from './retentionPolicy';

/**
 * Applies the retention rules the privacy policy publishes:
 *
 *  - seven years on, photographs are deleted and trip records anonymised,
 *    while mileage, dates and vehicle survive for fleet reporting;
 *  - account records are kept "for as long as you drive for us and for seven
 *    years afterwards", so a driver inactive for seven years is anonymised too.
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

  // The two steps are queried independently so each is retryable on its own.
  // Scoping photographs to not-yet-anonymised trips would mean that a photo
  // whose Cloudinary delete failed could never be retried: its trip would
  // already have lost its driver link and would never be selected again.
  const tripsDue = await Trip.findAll({
    where: { startTime: { [Op.lte]: cutoff }, driverId: { [Op.ne]: null } },
    attributes: ['id'],
  });
  const tripIds = tripsDue.map((t) => t.id);

  const photosDue = await TripPhoto.findAll({
    attributes: ['id', 'photoUrl'],
    include: [{
      model: Trip, as: 'trip', attributes: [], required: true,
      where: { startTime: { [Op.lte]: cutoff } },
    }],
  });

  const remoteAssets = photosDue.filter((p) => cloudinaryPublicId(p.photoUrl) || emergentObjectPath(p.photoUrl));

  // Account records, the other half of the policy. deactivatedAt is set by the
  // Driver model's hook when a driver is made inactive; rows that went
  // inactive before that column existed carry NULL, and there is no honest way
  // to infer when they left - so they are reported, never guessed at.
  const driversDue = await Driver.findAll({
    where: {
      status: 'inactive',
      deactivatedAt: { [Op.ne]: null, [Op.lte]: cutoff },
      // Already-anonymised rows carry a placeholder employee id.
      employeeId: { [Op.notLike]: 'ANON-%' },
    },
    attributes: ['id'],
  });

  const undatedInactive = await Driver.count({
    where: {
      status: 'inactive',
      deactivatedAt: null as unknown as Date,
      employeeId: { [Op.notLike]: 'ANON-%' },
    },
  });

  console.log(`Retention window: ${years} year${years === 1 ? '' : 's'}`);
  console.log(`Cutoff:           ${cutoff.toISOString()} (trips starting on or before)`);
  console.log(`Trips to anonymise:     ${tripIds.length}`);
  console.log(`Photographs to delete:  ${photosDue.length} (${remoteAssets.length} stored remotely)`);
  console.log(`Driver accounts to anonymise: ${driversDue.length}`);

  if (undatedInactive > 0) {
    console.warn(
      `\n${undatedInactive} inactive driver account(s) have no deactivation date, so\n` +
      'their seven years cannot be counted and they are NOT touched. They went\n' +
      'inactive before that was recorded. Set drivers.deactivated_at for them to\n' +
      'bring them under the policy; leaving it null keeps them indefinitely.'
    );
  }

  if (!tripIds.length && !photosDue.length && !driversDue.length) {
    console.log('\nNothing is due. No changes made.');
    process.exit(0);
  }

  if (!commit) {
    console.log(
      '\nDRY RUN - nothing was changed.\n' +
      'Re-run with --commit to delete those photographs - from Cloudinary as\n' +
      'well as the database - and anonymise those trips. Both are irreversible.'
    );
    process.exit(0);
  }

  // Cloudinary first, and outside the transaction: a remote delete cannot be
  // rolled back, so the database row is the record that it still needs doing.
  // A row is removed only once its image is actually gone.
  const deletable: number[] = [];
  let remoteDeleted = 0;
  const remoteFailures: string[] = [];

  for (const photo of photosDue) {
    const objectPath = emergentObjectPath(photo.photoUrl);
    if (objectPath) {
      // Emergent storage has no delete call; overwriting with nothing
      // destroys the image. The row goes only once that has succeeded.
      try {
        await erasePhoto(objectPath);
        remoteDeleted += 1;
        deletable.push(photo.id);
      } catch (error) {
        remoteFailures.push(`${objectPath}: ${error instanceof Error ? error.message : error}`);
      }
      continue;
    }
    const publicId = cloudinaryPublicId(photo.photoUrl);
    if (!publicId) {
      // Nothing stored remotely - an inline data URI. The row is the only copy.
      deletable.push(photo.id);
      continue;
    }
    try {
      const result = await cloudinary.uploader.destroy(publicId, { invalidate: true });
      // 'not found' counts as done: the asset is gone either way.
      if (result.result === 'ok' || result.result === 'not found') {
        remoteDeleted += result.result === 'ok' ? 1 : 0;
        deletable.push(photo.id);
      } else {
        remoteFailures.push(`${publicId}: ${result.result}`);
      }
    } catch (error) {
      remoteFailures.push(`${publicId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Chunked because the first run after seven years of operation clears the
  // whole backlog at once, and a single IN list holding every id is how that
  // query stops being acceptable.
  const CHUNK = 500;
  const sequelize = Trip.sequelize!;
  let photosRemoved = 0;
  let tripsAnonymised = 0;
  let driversAnonymised = 0;

  await sequelize.transaction(async (transaction) => {
    for (let i = 0; i < deletable.length; i += CHUNK) {
      photosRemoved += await TripPhoto.destroy({
        where: { id: { [Op.in]: deletable.slice(i, i + CHUNK) } },
        transaction,
      });
    }
    for (let i = 0; i < tripIds.length; i += CHUNK) {
      const [updated] = await Trip.update(anonymisedValues(), {
        where: { id: { [Op.in]: tripIds.slice(i, i + CHUNK) } },
        transaction,
      });
      tripsAnonymised += updated;
    }

    // One statement each: employeeId and email are unique, so the replacement
    // values have to be derived per row.
    for (const driver of driversDue) {
      const [updated] = await Driver.update(anonymisedDriverValues(driver.id), {
        where: { id: driver.id },
        transaction,
        // The model's beforeUpdate hook would bcrypt the placeholder into a
        // real, if unguessable, hash, and would also clear deactivatedAt. The
        // stored value must stay something no password can produce.
        hooks: false,
      });
      driversAnonymised += updated;
    }
  });

  console.log(`\nDeleted ${remoteDeleted} stored photo file(s).`);
  console.log(`Removed ${photosRemoved} photograph record(s).`);
  console.log(`Anonymised ${tripsAnonymised} trip(s).`);
  console.log(`Anonymised ${driversAnonymised} driver account(s).`);

  if (remoteFailures.length) {
    console.error(
      `\n${remoteFailures.length} stored photo(s) could not be deleted. Their\n` +
      'records were kept so a later run retries them:'
    );
    for (const failure of remoteFailures.slice(0, 20)) console.error(`  ${failure}`);
    if (remoteFailures.length > 20) console.error(`  ...and ${remoteFailures.length - 20} more`);
    process.exit(1);
  }

  console.log('Done.');
  process.exit(0);
};

run().catch((error) => {
  console.error('Retention run failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
