import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false,
    } : false,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');

    // Add assigned_vehicle_id column if it doesn't exist
    try {
      await sequelize.query(`
        ALTER TABLE drivers ADD COLUMN IF NOT EXISTS assigned_vehicle_id INTEGER
        REFERENCES vehicles(id) ON DELETE SET NULL;
      `);
      console.log('Migration: assigned_vehicle_id column ensured');
    } catch (migrationError) {
      console.log('Migration note:', (migrationError as Error).message);
    }

    // Change photo_url from VARCHAR(500) to TEXT to support base64 data URIs
    try {
      await sequelize.query(`
        ALTER TABLE trip_photos ALTER COLUMN photo_url TYPE TEXT;
      `);
      console.log('Migration: photo_url column changed to TEXT');
    } catch (migrationError) {
      console.log('Migration note:', (migrationError as Error).message);
    }

    // The retention job anonymises trips past their seven-year window by
    // nulling the driver link and the coordinates (scripts/retentionPolicy.ts).
    // sequelize.sync() does not relax an existing NOT NULL, so the constraint
    // is dropped here, idempotently, in the same style as the migrations above.
    for (const column of ['driver_id', 'start_latitude', 'start_longitude']) {
      try {
        await sequelize.query(`ALTER TABLE trips ALTER COLUMN ${column} DROP NOT NULL;`);
      } catch (migrationError) {
        console.log(`Migration note (trips.${column}):`, (migrationError as Error).message);
      }
    }
    console.log('Migration: trips anonymisable columns ensured nullable');

    // Counts the seven years the privacy policy gives account records after a
    // driver stops driving. Existing inactive drivers get NULL: there is no
    // honest way to infer when they left, and the retention job reports them
    // rather than guessing a date that would delete real data early or late.
    try {
      await sequelize.query('ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE;');
      console.log('Migration: drivers.deactivated_at column ensured');
    } catch (migrationError) {
      console.log('Migration note (drivers.deactivated_at):', (migrationError as Error).message);
    }

    // Offline starts from the driver app carry a client reference so a re-sent
    // start is recognised instead of creating a second trip.
    try {
      await sequelize.query('ALTER TABLE trips ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64) UNIQUE;');
      console.log('Migration: trips.client_ref column ensured');
    } catch (migrationError) {
      console.log('Migration note (trips.client_ref):', (migrationError as Error).message);
    }
    try {
      await sequelize.query('ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_received_at TIMESTAMP WITH TIME ZONE;');
      console.log('Migration: trips.end_received_at column ensured');
    } catch (migrationError) {
      console.log('Migration note (trips.end_received_at):', (migrationError as Error).message);
    }

    for (const statement of [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS late_trip_alerts BOOLEAN NOT NULL DEFAULT TRUE;',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS destination_address VARCHAR(500);',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS destination_note VARCHAR(500);',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS destination_updated_at TIMESTAMP WITH TIME ZONE;',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS destination_latitude DECIMAL(10,7);',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS destination_longitude DECIMAL(10,7);',
      'ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_address VARCHAR(500);',
      'ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_note VARCHAR(500);',
      'ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_latitude DECIMAL(10,7);',
      'ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_longitude DECIMAL(10,7);',
      'ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_distance_meters INTEGER;',
      'ALTER TABLE trips ADD COLUMN IF NOT EXISTS arrived_at_destination BOOLEAN;',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS arrived_latitude DECIMAL(10,7);',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_latitude DECIMAL(10,7);',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_longitude DECIMAL(10,7);',
      'ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_located_at TIMESTAMP WITH TIME ZONE;',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS arrived_longitude DECIMAL(10,7);',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS arrived_odometer DECIMAL(10,1);',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS arrived_photo_url TEXT;',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS original_odometer DECIMAL(10,1);',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS odometer_corrected_at TIMESTAMPTZ;',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS odometer_corrected_by VARCHAR(255);',
      'ALTER TABLE driver_stops ADD COLUMN IF NOT EXISTS odometer_correction_reason VARCHAR(255);',
      'ALTER TABLE IF EXISTS driver_notes ADD COLUMN IF NOT EXISTS reply VARCHAR(100);',
      'ALTER TABLE IF EXISTS driver_notes ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;',
    ]) {
      try {
        await sequelize.query(statement);
      } catch (migrationError) {
        console.log('Migration note:', (migrationError as Error).message);
      }
    }
    console.log('Migration: alert recipients and driver destinations ensured');

    await sequelize.sync();

    // A destination set before multi-stop jobs existed becomes a one-stop job.
    try {
      await sequelize.query(`
        INSERT INTO driver_stops (driver_id, position, address, note, latitude, longitude, created_at, updated_at)
        SELECT d.id, 1, d.destination_address, d.destination_note, d.destination_latitude, d.destination_longitude, NOW(), NOW()
        FROM drivers d
        WHERE d.destination_address IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM driver_stops s WHERE s.driver_id = d.id);`);
    } catch (migrationError) {
      console.log('Migration note (driver_stops):', (migrationError as Error).message);
    }
    console.log('Database models synchronized');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

export default sequelize;
