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

    await sequelize.sync();
    console.log('Database models synchronized');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

export default sequelize;
