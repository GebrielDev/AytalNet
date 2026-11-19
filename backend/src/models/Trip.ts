import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface TripAttributes {
  id: number;
  // Nullable because the retention job severs it: seven years on, a trip is
  // anonymised and keeps its mileage, dates and vehicle but loses the link to
  // a person. See scripts/retentionPolicy.ts. Every live trip has a driver -
  // startTrip always sets one - so only historical rows carry null.
  driverId: number | null;
  vehicleId: number;
  status: 'in_progress' | 'completed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  durationMinutes?: number;
  startOdometer: number;
  endOdometer?: number;
  totalMileage?: number;
  // Cleared by the same job: a trip's endpoints are a home address as often
  // as not.
  startLatitude: number | null;
  startLongitude: number | null;
  startAddress?: string;
  endLatitude?: number;
  endLongitude?: number;
  endAddress?: string;
  // Set by the driver app on every start. Lets a start recorded offline be
  // re-sent any number of times and still create exactly one trip.
  clientRef?: string | null;
  // When the end reached the server. Far after endTime means it was recorded
  // offline; created_at plays the same part for the start.
  endReceivedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TripCreationAttributes extends Optional<TripAttributes, 'id' | 'status' | 'endTime' | 'durationMinutes' | 'endOdometer' | 'totalMileage' | 'startAddress' | 'endLatitude' | 'endLongitude' | 'endAddress' | 'clientRef' | 'endReceivedAt' | 'createdAt' | 'updatedAt'> {}

class Trip extends Model<TripAttributes, TripCreationAttributes> implements TripAttributes {
  public id!: number;
  public driverId!: number | null;
  public vehicleId!: number;
  public status!: 'in_progress' | 'completed' | 'cancelled';
  public startTime!: Date;
  public endTime?: Date;
  public durationMinutes?: number;
  public startOdometer!: number;
  public endOdometer?: number;
  public totalMileage?: number;
  public startLatitude!: number | null;
  public startLongitude!: number | null;
  public startAddress?: string;
  public endLatitude?: number;
  public endLongitude?: number;
  public endAddress?: string;
  public clientRef?: string | null;
  public endReceivedAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Trip.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    driverId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'driver_id',
    },
    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'vehicle_id',
    },
    status: {
      type: DataTypes.ENUM('in_progress', 'completed', 'cancelled'),
      allowNull: false,
      defaultValue: 'in_progress',
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'start_time',
    },
    endTime: {
      type: DataTypes.DATE,
      field: 'end_time',
    },
    durationMinutes: {
      type: DataTypes.INTEGER,
      field: 'duration_minutes',
    },
    startOdometer: {
      type: DataTypes.DECIMAL(10, 1),
      allowNull: false,
      field: 'start_odometer',
    },
    endOdometer: {
      type: DataTypes.DECIMAL(10, 1),
      field: 'end_odometer',
    },
    totalMileage: {
      type: DataTypes.DECIMAL(10, 1),
      field: 'total_mileage',
    },
    startLatitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
      field: 'start_latitude',
    },
    startLongitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
      field: 'start_longitude',
    },
    startAddress: {
      type: DataTypes.STRING(500),
      field: 'start_address',
    },
    endLatitude: {
      type: DataTypes.DECIMAL(10, 8),
      field: 'end_latitude',
    },
    endLongitude: {
      type: DataTypes.DECIMAL(11, 8),
      field: 'end_longitude',
    },
    endAddress: {
      type: DataTypes.STRING(500),
      field: 'end_address',
    },
    clientRef: {
      type: DataTypes.STRING(64),
      allowNull: true,
      unique: true,
      field: 'client_ref',
    },
    endReceivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'end_received_at',
    },
  },
  {
    sequelize,
    tableName: 'trips',
    underscored: true,
  }
);

export default Trip;
