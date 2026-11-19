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
  tripId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DriverStopCreationAttributes
  extends Optional<DriverStopAttributes, 'id' | 'note' | 'latitude' | 'longitude' | 'arrivedAt' | 'arrivedDistanceMeters' | 'tripId' | 'createdAt' | 'updatedAt'> {}

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
  public tripId?: number | null;
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
    tripId: { type: DataTypes.INTEGER, allowNull: true, field: 'trip_id' },
  },
  { sequelize, tableName: 'driver_stops', underscored: true }
);

export default DriverStop;
