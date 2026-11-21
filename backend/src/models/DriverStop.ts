import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

/**
 * One stop in the ordered list a dispatcher gives a driver. The first stop not
 * yet arrived at is the driver's current destination (mirrored onto the
 * driver's destination fields, which trips and the arrival check read).
 */
interface DriverStopAttributes {
  id: number;
  driverId: number;
  position: number;
  address: string;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  arrivedAt?: Date | null;
  arrivedDistanceMeters?: number | null;
  // Where the phone was when the stop was reached (driver tap or trip end).
  arrivedLatitude?: number | null;
  arrivedLongitude?: number | null;
  tripId?: number | null;
  // Optional proof at the stop: odometer reading and its photo.
  arrivedOdometer?: number | null;
  arrivedPhotoUrl?: string | null;
  // Set when a dispatcher fixes the reading: what the driver first entered.
  originalOdometer?: number | null;
  odometerCorrectedAt?: Date | null;
  odometerCorrectedBy?: string | null;
  odometerCorrectionReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DriverStopCreationAttributes
  extends Optional<DriverStopAttributes, 'id' | 'note' | 'latitude' | 'longitude' | 'arrivedAt' | 'arrivedDistanceMeters' | 'arrivedLatitude' | 'arrivedLongitude' | 'tripId' | 'arrivedOdometer' | 'arrivedPhotoUrl' | 'originalOdometer' | 'odometerCorrectedAt' | 'odometerCorrectedBy' | 'odometerCorrectionReason' | 'createdAt' | 'updatedAt'> {}

class DriverStop extends Model<DriverStopAttributes, DriverStopCreationAttributes> implements DriverStopAttributes {
  public id!: number;
  public driverId!: number;
  public position!: number;
  public address!: string;
  public note?: string | null;
  public latitude?: number | null;
  public longitude?: number | null;
  public arrivedAt?: Date | null;
  public arrivedDistanceMeters?: number | null;
  public arrivedLatitude?: number | null;
  public arrivedLongitude?: number | null;
  public tripId?: number | null;
  public arrivedOdometer?: number | null;
  public arrivedPhotoUrl?: string | null;
  public originalOdometer?: number | null;
  public odometerCorrectedAt?: Date | null;
  public odometerCorrectedBy?: string | null;
  public odometerCorrectionReason?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DriverStop.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    driverId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'driver_id',
      references: { model: 'drivers', key: 'id' },
      onDelete: 'CASCADE',
    },
    position: { type: DataTypes.INTEGER, allowNull: false },
    address: { type: DataTypes.STRING(500), allowNull: false },
    note: { type: DataTypes.STRING(500), allowNull: true },
    latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    arrivedAt: { type: DataTypes.DATE, allowNull: true, field: 'arrived_at' },
    arrivedDistanceMeters: { type: DataTypes.INTEGER, allowNull: true, field: 'arrived_distance_meters' },
    arrivedLatitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'arrived_latitude' },
    arrivedLongitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'arrived_longitude' },
    tripId: { type: DataTypes.INTEGER, allowNull: true, field: 'trip_id' },
    arrivedOdometer: { type: DataTypes.DECIMAL(10, 1), allowNull: true, field: 'arrived_odometer' },
    arrivedPhotoUrl: { type: DataTypes.TEXT, allowNull: true, field: 'arrived_photo_url' },
    originalOdometer: { type: DataTypes.DECIMAL(10, 1), allowNull: true, field: 'original_odometer' },
    odometerCorrectedAt: { type: DataTypes.DATE, allowNull: true, field: 'odometer_corrected_at' },
    odometerCorrectedBy: { type: DataTypes.STRING(255), allowNull: true, field: 'odometer_corrected_by' },
    odometerCorrectionReason: { type: DataTypes.STRING(255), allowNull: true, field: 'odometer_correction_reason' },
  },
  { sequelize, tableName: 'driver_stops', underscored: true }
);

export default DriverStop;
