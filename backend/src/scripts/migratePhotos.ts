import dotenv from 'dotenv';
dotenv.config();

import { Op } from 'sequelize';
import { connectDatabase } from '../config/database';
import { TripPhoto } from '../models';
import cloudinary from '../config/cloudinary';
import { cloudinaryPublicId } from './retentionPolicy';
import { storePhotoBuffer } from '../config/photoStorage';

/**
 * Copies trip photographs kept on Cloudinary - and any kept inline as a base64
 * data URI because Cloudinary was unreachable - into Emergent storage, and
 * points each photo record at the new copy.
 *
 *   npm run photos:migrate                          report only, change nothing
 *   npm run photos:migrate -- --commit              copy and repoint
 *   npm run photos:migrate -- --commit --delete-cloudinary
 *                                                   ...and delete the Cloudinary original
 *
 * Re-runnable: a migrated record no longer matches, so a second run picks up
 * only what the first could not move. A record is repointed only after its copy
 * is stored, and a Cloudinary original is deleted only after the record points
 * elsewhere, so a failure at any step leaves the photo viewable.
 *
 * Needs EMERGENT_LLM_KEY and PUBLIC_API_URL (the API's public address ending in
 * /api, which the new photo links are built from).
 */

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const deleteCloudinary = args.includes('--delete-cloudinary');

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const download = async (photoUrl: string): Promise<{ data: Buffer; mimetype: string }> => {
  const inline = /^data:([^;]+);base64,(.*)$/s.exec(photoUrl);
  if (inline) return { mimetype: inline[1], data: Buffer.from(inline[2], 'base64') };
  const res = await fetch(photoUrl);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return {
    mimetype: (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim(),
    data: Buffer.from(await res.arrayBuffer()),
  };
};

const run = async () => {
  const apiBase = process.env.PUBLIC_API_URL;
  if (!process.env.EMERGENT_LLM_KEY || !apiBase) {
    console.error('Set EMERGENT_LLM_KEY and PUBLIC_API_URL (e.g. https://api.startechsolutions.us/api) first.');
    process.exit(1);
  }

  await connectDatabase();

  const photos = await TripPhoto.findAll({
    where: {
      [Op.or]: [
        { photoUrl: { [Op.like]: 'https://res.cloudinary.com/%' } },
        { photoUrl: { [Op.like]: 'data:%' } },
      ],
    },
    attributes: ['id', 'photoUrl'],
    order: [['id', 'ASC']],
  });

  const onCloudinary = photos.filter((p) => cloudinaryPublicId(p.photoUrl)).length;
  console.log(`Photos to move: ${photos.length} (${onCloudinary} on Cloudinary, ${photos.length - onCloudinary} stored inline)`);

  if (!photos.length) {
    console.log('Nothing to move.');
    process.exit(0);
  }
  if (!commit) {
    console.log('\nDRY RUN - nothing was changed. Re-run with --commit to copy them.');
    process.exit(0);
  }

  let moved = 0;
  let cloudinaryDeleted = 0;
  const failures: string[] = [];

  for (const photo of photos) {
    const publicId = cloudinaryPublicId(photo.photoUrl);
    try {
      const { data, mimetype } = await download(photo.photoUrl);
      if (!IMAGE_TYPES.includes(mimetype) || data.length === 0) throw new Error(`not an image (${mimetype})`);
      const { photoUrl } = await storePhotoBuffer(data, mimetype, apiBase);
      await TripPhoto.update({ photoUrl }, { where: { id: photo.id } });
      moved += 1;

      if (deleteCloudinary && publicId) {
        try {
          const result = await cloudinary.uploader.destroy(publicId, { invalidate: true });
          if (result.result === 'ok') cloudinaryDeleted += 1;
        } catch (error) {
          failures.push(`photo ${photo.id}: moved, but the Cloudinary original was not deleted (${error instanceof Error ? error.message : error})`);
        }
      }
    } catch (error) {
      failures.push(`photo ${photo.id}: ${error instanceof Error ? error.message : error}`);
    }
    if (moved > 0 && moved % 50 === 0) console.log(`  ...${moved} moved`);
  }

  console.log(`\nMoved ${moved} of ${photos.length} photo(s) to Emergent storage.`);
  if (deleteCloudinary) console.log(`Deleted ${cloudinaryDeleted} Cloudinary original(s).`);
  else if (onCloudinary) console.log('Cloudinary originals were kept. Add --delete-cloudinary to remove them.');

  if (failures.length) {
    console.error(`\n${failures.length} problem(s); those photos were left as they were and a re-run retries them:`);
    for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
    if (failures.length > 20) console.error(`  ...and ${failures.length - 20} more`);
    process.exit(1);
  }
  console.log('Done.');
  process.exit(0);
};

run().catch((error) => {
  console.error('Photo migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
