import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

/** A short one-way note from a dispatcher to a driver, shown on the trip screen. */
interface DriverNoteAttributes {
  id: number;
  driverId: number;
  message: string;
  sentById?: number | null;
  sentByName?: string | null;
  readAt?: Date | null;
  // The driver's quick reply, e.g. "On my way".
  reply?: string | null;
  repliedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DriverNoteCreationAttributes extends Optional<DriverNoteAttributes, 'id' | 'sentById' | 'sentByName' | 'readAt' | 'reply' | 'repliedAt' | 'createdAt' | 'updatedAt'> {}

class DriverNote extends Model<DriverNoteAttributes, DriverNoteCreationAttributes> implements DriverNoteAttributes {
  public id!: number;
  public driverId!: number;
  public message!: string;
  public sentById?: number | null;
  public sentByName?: string | null;
  public readAt?: Date | null;
  public reply?: string | null;
  public repliedAt?: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DriverNote.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    driverId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'driver_id',
      references: { model: 'drivers', key: 'id' },
      onDelete: 'CASCADE',
    },
    message: { type: DataTypes.STRING(500), allowNull: false },
    sentById: { type: DataTypes.INTEGER, allowNull: true, field: 'sent_by_id' },
    sentByName: { type: DataTypes.STRING(255), allowNull: true, field: 'sent_by_name' },
    readAt: { type: DataTypes.DATE, allowNull: true, field: 'read_at' },
    reply: { type: DataTypes.STRING(100), allowNull: true },
    repliedAt: { type: DataTypes.DATE, allowNull: true, field: 'replied_at' },
  },
  { sequelize, tableName: 'driver_notes', underscored: true }
);

export default DriverNote;
