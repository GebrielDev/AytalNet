import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

/**
 * Permanent record of a dispatcher correcting a stop's odometer reading.
 * Kept even after the stop itself is cleared from the driver's list.
 */
interface OdometerCorrectionAttributes {
  id: number;
  driverId: number;
  stopId?: number | null;
  tripId?: number | null;
  stopPosition?: number | null;
  stopAddress?: string | null;
  originalOdometer: number;
  previousOdometer: number;
  newOdometer: number;
  reason: string;
  correctedById?: number | null;
  correctedByName?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface OdometerCorrectionCreationAttributes
  extends Optional<OdometerCorrectionAttributes, 'id' | 'stopId' | 'tripId' | 'stopPosition' | 'stopAddress' | 'correctedById' | 'correctedByName' | 'createdAt' | 'updatedAt'> {}

class OdometerCorrection extends Model<OdometerCorrectionAttributes, OdometerCorrectionCreationAttributes> implements OdometerCorrectionAttributes {
  public id!: number;
  public driverId!: number;
  public stopId?: number | null;
  public tripId?: number | null;
  public stopPosition?: number | null;
  public stopAddress?: string | null;
  public originalOdometer!: number;
  public previousOdometer!: number;
  public newOdometer!: number;
  public reason!: string;
  public correctedById?: number | null;
  public correctedByName?: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

OdometerCorrection.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    driverId: { type: DataTypes.INTEGER, allowNull: false, field: 'driver_id' },
    stopId: { type: DataTypes.INTEGER, allowNull: true, field: 'stop_id' },
    tripId: { type: DataTypes.INTEGER, allowNull: true, field: 'trip_id' },
    stopPosition: { type: DataTypes.INTEGER, allowNull: true, field: 'stop_position' },
    stopAddress: { type: DataTypes.STRING(500), allowNull: true, field: 'stop_address' },
    originalOdometer: { type: DataTypes.DECIMAL(10, 1), allowNull: false, field: 'original_odometer' },
    previousOdometer: { type: DataTypes.DECIMAL(10, 1), allowNull: false, field: 'previous_odometer' },
    newOdometer: { type: DataTypes.DECIMAL(10, 1), allowNull: false, field: 'new_odometer' },
    reason: { type: DataTypes.STRING(255), allowNull: false },
    correctedById: { type: DataTypes.INTEGER, allowNull: true, field: 'corrected_by_id' },
    correctedByName: { type: DataTypes.STRING(255), allowNull: true, field: 'corrected_by_name' },
  },
  { sequelize, tableName: 'odometer_corrections', underscored: true }
);

export default OdometerCorrection;
