import dotenv from 'dotenv';
dotenv.config();

import { Op } from 'sequelize';
import { connectDatabase } from '../config/database';
import { Trip, TripPhoto } from '../models';
import cloudinary from '../config/cloudinary';
import {
  retentionCutoff,
  anonymisedValues,
  parseRetentionArgs,
  cloudinaryPublicId,
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

  const remoteAssets = photosDue.filter((p) => cloudinaryPublicId(p.photoUrl));

  console.log(`Retention window: ${years} year${years === 1 ? '' : 's'}`);
  console.log(`Cutoff:           ${cutoff.toISOString()} (trips starting on or before)`);
  console.log(`Trips to anonymise:     ${tripIds.length}`);
  console.log(`Photographs to delete:  ${photosDue.length} (${remoteAssets.length} stored on Cloudinary)`);

  if (!tripIds.length && !photosDue.length) {
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
  });

  console.log(`\nDeleted ${remoteDeleted} Cloudinary asset(s).`);
  console.log(`Removed ${photosRemoved} photograph record(s).`);
  console.log(`Anonymised ${tripsAnonymised} trip(s).`);

  if (remoteFailures.length) {
    console.error(
      `\n${remoteFailures.length} Cloudinary asset(s) could not be deleted. Their\n` +
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
