import crypto from 'crypto';
import sequelize from '../config/database';
import { Driver, Vehicle } from '../models';

/**
 * Creates (or refreshes) the demo driver account handed to Google Play reviewers
 * under App access. The app has no self-signup, so without working credentials a
 * reviewer cannot get past the login screen and the submission is rejected.
 *
 * The account is given an assigned vehicle on purpose: StartTripScreen refuses to
 * start a trip without one, so a driver with no vehicle looks like a broken app.
 *
 * Idempotent - safe to run repeatedly. Set DEMO_DRIVER_PASSWORD to choose the
 * password; otherwise a strong one is generated and printed once.
 *
 *   npm run demo:driver
 */

const DEMO_EMAIL = 'play.review@startechsolutions.us';
const DEMO_PLATE = 'DEMO-0001';

const run = async (): Promise<void> => {
  await sequelize.authenticate();

  const password =
    process.env.DEMO_DRIVER_PASSWORD || `Review-${crypto.randomBytes(9).toString('base64url')}`;

  // A dedicated vehicle, so the reviewer's trips never collide with a real driver's.
  let vehicle = await Vehicle.findOne({ where: { plateNumber: DEMO_PLATE } });
  if (!vehicle) {
    vehicle = await Vehicle.create({
      plateNumber: DEMO_PLATE,
      make: 'Toyota',
      model: 'Camry',
      year: 2024,
      vin: 'DEMOVIN0000REVIEW',
      status: 'active',
      currentOdometer: 10000,
    });
    console.log(`Created demo vehicle ${DEMO_PLATE} (id ${vehicle.id})`);
  } else {
    console.log(`Demo vehicle ${DEMO_PLATE} already exists (id ${vehicle.id})`);
  }

  let driver = await Driver.findOne({ where: { email: DEMO_EMAIL } });
  if (!driver) {
    driver = await Driver.create({
      employeeId: 'PLAY-REVIEW',
      name: 'Play Review',
      email: DEMO_EMAIL,
      phone: '480-572-5727',
      passwordHash: password, // beforeCreate hashes this
      licenseNumber: 'DEMO-LICENSE',
      assignedVehicleId: vehicle.id,
      status: 'active',
    });
    console.log(`Created demo driver ${DEMO_EMAIL} (id ${driver.id})`);
  } else {
    driver.passwordHash = password; // beforeUpdate re-hashes it
    driver.assignedVehicleId = vehicle.id;
    driver.status = 'active';
    await driver.save();
    console.log(`Refreshed demo driver ${DEMO_EMAIL} (id ${driver.id})`);
  }

  console.log('\n--- Credentials for Play Console > App access ---');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${password}`);
  console.log(`  Vehicle:  ${DEMO_PLATE} assigned, so a trip can be started`);
  console.log('------------------------------------------------\n');
};

run()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Failed to create demo driver:', error);
    await sequelize.close();
    process.exit(1);
  });
