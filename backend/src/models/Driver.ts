import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';
import bcrypt from 'bcryptjs';
import { authConfig } from '../config/auth';

interface DriverAttributes {
  id: number;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  licenseNumber: string;
  assignedVehicleId: number | null;
  status: 'active' | 'inactive';
  // When this driver stopped driving. The privacy policy keeps account records
  // "for as long as you drive for us and for seven years afterwards", and
  // without a date there is nothing to count seven years from. Set by the hook
  // below whenever status moves to inactive, cleared on reinstatement.
  deactivatedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface DriverCreationAttributes extends Optional<DriverAttributes, 'id' | 'status' | 'assignedVehicleId' | 'deactivatedAt' | 'createdAt' | 'updatedAt'> {}

class Driver extends Model<DriverAttributes, DriverCreationAttributes> implements DriverAttributes {
  public id!: number;
  public employeeId!: string;
  public name!: string;
  public email!: string;
  public phone!: string;
  public passwordHash!: string;
  public licenseNumber!: string;
  public assignedVehicleId!: number | null;
  public status!: 'active' | 'inactive';
  public deactivatedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, authConfig.saltRounds);
  }
}

Driver.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    employeeId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      field: 'employee_id',
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'password_hash',
    },
    licenseNumber: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'license_number',
    },
    assignedVehicleId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      field: 'assigned_vehicle_id',
      references: {
        model: 'vehicles',
        key: 'id',
      },
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    },
    deactivatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      field: 'deactivated_at',
    },
  },
  {
    sequelize,
    tableName: 'drivers',
    underscored: true,
    hooks: {
      beforeCreate: async (driver) => {
        driver.passwordHash = await Driver.hashPassword(driver.passwordHash);
      },
      beforeUpdate: async (driver) => {
        if (driver.changed('passwordHash')) {
          driver.passwordHash = await Driver.hashPassword(driver.passwordHash);
        }

        // The seven years the privacy policy promises are counted from here.
        // Nothing recorded when a driver stopped driving, so account records
        // had no expiry at all - name, email, phone, licence number and
        // password hash simply stayed.
        if (driver.changed('status')) {
          driver.deactivatedAt = driver.status === 'inactive' ? new Date() : null;
        }
      },
    },
  }
);

export default Driver;
