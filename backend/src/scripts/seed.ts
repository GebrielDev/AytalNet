import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase } from '../config/database';
import { User, Driver, Vehicle, Trip } from '../models';

const seed = async () => {
  await connectDatabase();

  console.log('Seeding database...');

  // Create admin user
  const adminExists = await User.findOne({ where: { email: 'admin@fleet.com' } });
  if (!adminExists) {
    await User.create({
      email: 'admin@fleet.com',
      passwordHash: 'admin123',
      name: 'Admin User',
      role: 'admin',
    });
    console.log('Admin user created: admin@fleet.com / admin123');
  }

  // Create dispatcher
  const dispatcherExists = await User.findOne({ where: { email: 'dispatcher@fleet.com' } });
  if (!dispatcherExists) {
    await User.create({
      email: 'dispatcher@fleet.com',
      passwordHash: 'dispatch123',
      name: 'Dispatcher User',
      role: 'dispatcher',
    });
    console.log('Dispatcher created: dispatcher@fleet.com / dispatch123');
  }

  // Create sample drivers
  const driverExists = await Driver.findOne({ where: { email: 'driver@fleet.com' } });
  let driver1: Driver | null = null;
  let driver2: Driver | null = null;
  let driver3: Driver | null = null;

  if (!driverExists) {
    driver1 = await Driver.create({
      employeeId: 'DRV001',
      name: 'John Driver',
      email: 'driver@fleet.com',
      phone: '555-0100',
      passwordHash: 'driver123',
      licenseNumber: 'DL12345',
    });
    driver2 = await Driver.create({
      employeeId: 'DRV002',
      name: 'Sarah Miller',
      email: 'sarah.miller@fleet.com',
      phone: '555-0101',
      passwordHash: 'driver123',
      licenseNumber: 'DL23456',
    });
    driver3 = await Driver.create({
      employeeId: 'DRV003',
      name: 'Mike Johnson',
      email: 'mike.johnson@fleet.com',
      phone: '555-0102',
      passwordHash: 'driver123',
      licenseNumber: 'DL34567',
    });
    console.log('Drivers created');
  } else {
    driver1 = await Driver.findOne({ where: { employeeId: 'DRV001' } });
    driver2 = await Driver.findOne({ where: { employeeId: 'DRV002' } });
    driver3 = await Driver.findOne({ where: { employeeId: 'DRV003' } });
  }

  // Create sample vehicles
  const vehicleExists = await Vehicle.findOne({ where: { plateNumber: 'ABC-1234' } });
  let vehicle1: Vehicle | null = null;
  let vehicle2: Vehicle | null = null;
  let vehicle3: Vehicle | null = null;

  if (!vehicleExists) {
    const vehicles = await Vehicle.bulkCreate([
      { plateNumber: 'ABC-1234', make: 'Toyota', model: 'Camry', year: 2022, vin: 'VIN001ABC', currentOdometer: 15000 },
      { plateNumber: 'XYZ-5678', make: 'Honda', model: 'Accord', year: 2023, vin: 'VIN002XYZ', currentOdometer: 8000 },
      { plateNumber: 'DEF-9012', make: 'Ford', model: 'F-150', year: 2021, vin: 'VIN003DEF', currentOdometer: 25000 },
    ]);
    vehicle1 = vehicles[0];
    vehicle2 = vehicles[1];
    vehicle3 = vehicles[2];
    console.log('Sample vehicles created');
  } else {
    vehicle1 = await Vehicle.findOne({ where: { plateNumber: 'ABC-1234' } });
    vehicle2 = await Vehicle.findOne({ where: { plateNumber: 'XYZ-5678' } });
    vehicle3 = await Vehicle.findOne({ where: { plateNumber: 'DEF-9012' } });
  }

  // Create sample trips
  const tripExists = await Trip.findOne();
  if (!tripExists && driver1 && driver2 && driver3 && vehicle1 && vehicle2 && vehicle3) {
    const now = new Date();
    const trips = [];

    // Generate 15 completed trips over the past 30 days
    for (let i = 0; i < 15; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const startTime = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      startTime.setHours(8 + Math.floor(Math.random() * 10)); // Random hour 8am-6pm

      const durationMinutes = 30 + Math.floor(Math.random() * 180); // 30min to 3.5hrs
      const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

      const drivers = [driver1, driver2, driver3];
      const vehicles = [vehicle1, vehicle2, vehicle3];
      const selectedDriver = drivers[i % 3];
      const selectedVehicle = vehicles[i % 3];

      const startOdometer = 15000 + i * 50;
      const totalMileage = 10 + Math.floor(Math.random() * 50);

      trips.push({
        driverId: selectedDriver.id,
        vehicleId: selectedVehicle.id,
        status: 'completed' as const,
        startTime,
        endTime,
        durationMinutes,
        startOdometer,
        endOdometer: startOdometer + totalMileage,
        totalMileage,
        startLatitude: 40.7128 + (Math.random() - 0.5) * 0.1,
        startLongitude: -74.006 + (Math.random() - 0.5) * 0.1,
        startAddress: `${100 + i * 10} Main Street, New York, NY`,
        endLatitude: 40.7128 + (Math.random() - 0.5) * 0.1,
        endLongitude: -74.006 + (Math.random() - 0.5) * 0.1,
        endAddress: `${200 + i * 10} Broadway, New York, NY`,
      });
    }

    // Add 2 in-progress trips
    trips.push({
      driverId: driver1.id,
      vehicleId: vehicle1.id,
      status: 'in_progress' as const,
      startTime: new Date(now.getTime() - 45 * 60 * 1000), // Started 45 mins ago
      startOdometer: 15800,
      startLatitude: 40.758,
      startLongitude: -73.9855,
      startAddress: 'Times Square, New York, NY',
    });

    trips.push({
      driverId: driver2.id,
      vehicleId: vehicle2.id,
      status: 'in_progress' as const,
      startTime: new Date(now.getTime() - 20 * 60 * 1000), // Started 20 mins ago
      startOdometer: 8200,
      startLatitude: 40.7484,
      startLongitude: -73.9857,
      startAddress: 'Empire State Building, New York, NY',
    });

    // Add 3 cancelled trips
    for (let i = 0; i < 3; i++) {
      const daysAgo = Math.floor(Math.random() * 14);
      const startTime = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      trips.push({
        driverId: driver3.id,
        vehicleId: vehicle3.id,
        status: 'cancelled' as const,
        startTime,
        startOdometer: 25000 + i * 20,
        startLatitude: 40.7128 + (Math.random() - 0.5) * 0.05,
        startLongitude: -74.006 + (Math.random() - 0.5) * 0.05,
        startAddress: `${300 + i * 50} Park Avenue, New York, NY`,
      });
    }

    await Trip.bulkCreate(trips);
    console.log('Sample trips created (15 completed, 2 in-progress, 3 cancelled)');
  }

  console.log('Seeding complete!');
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
