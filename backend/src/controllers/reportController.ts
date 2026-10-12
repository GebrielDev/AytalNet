import { Request, Response } from 'express';
import { Trip, Driver, Vehicle } from '../models';
import { Op } from 'sequelize';
import * as XLSX from 'xlsx';

export const getTripReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, driverId, vehicleId, status } = req.query;
    const where: any = {};

    if (startDate && endDate) {
      where.startTime = { [Op.between]: [new Date(startDate as string), new Date(endDate as string)] };
    } else if (startDate) {
      where.startTime = { [Op.gte]: new Date(startDate as string) };
    } else if (endDate) {
      where.startTime = { [Op.lte]: new Date(endDate as string) };
    }

    if (driverId) where.driverId = driverId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (status) where.status = status;

    const trips = await Trip.findAll({
      where,
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'employeeId'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'plateNumber', 'make', 'model'] },
      ],
      order: [['startTime', 'DESC']],
    });

    const completed = trips.filter((t) => t.status === 'completed');
    const totalMileage = completed.reduce((sum, t) => sum + (Number(t.totalMileage) || 0), 0);
    const totalDuration = completed.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);

    res.json({
      trips,
      summary: {
        totalTrips: trips.length,
        completedTrips: completed.length,
        inProgressTrips: trips.filter((t) => t.status === 'in_progress').length,
        cancelledTrips: trips.filter((t) => t.status === 'cancelled').length,
        totalMileage,
        totalDuration,
        averageMileage: completed.length ? totalMileage / completed.length : 0,
        averageDuration: completed.length ? totalDuration / completed.length : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

export const getSummaryStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // Captured before the counts run and sent back as `asOf`, so a drill-down
    // can ask for the same window that was counted rather than everything
    // since. Without an upper bound a trip that starts after this response but
    // before the card is clicked appears in the list and not in the number
    // above it - and the cards only refresh on a reconnect, so that gap can be
    // the whole time a tab is left open.
    const asOf = new Date();

    const today = new Date(asOf);
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [totalDrivers, activeDrivers, totalVehicles, activeVehicles, activeTrips, todayTrips, weekTrips, monthTrips] = await Promise.all([
      Driver.count(),
      Driver.count({ where: { status: 'active' } }),
      Vehicle.count(),
      Vehicle.count({ where: { status: 'active' } }),
      Trip.count({ where: { status: 'in_progress' } }),
      Trip.count({ where: { startTime: { [Op.gte]: today } } }),
      Trip.count({ where: { startTime: { [Op.gte]: weekAgo } } }),
      Trip.count({ where: { startTime: { [Op.gte]: monthAgo } } }),
    ]);

    // The dashboard's stat cards open a list of the trips behind each number,
    // and that list has to be the same set the count came from. If the browser
    // derived these boundaries itself it would use its own timezone, while
    // these are the server's - so a dispatcher in Phoenix would see a count of
    // 12 above a list of 9. Returning them means the drill-down filters on the
    // exact instant that was counted.
    //
    // Note the windows are rolling, not calendar: week is the last 7 days and
    // month the last month, both from midnight today.
    const ranges = {
      today: today.toISOString(),
      week: weekAgo.toISOString(),
      month: monthAgo.toISOString(),
      asOf: asOf.toISOString(),
    };

    res.json({ totalDrivers, activeDrivers, totalVehicles, activeVehicles, activeTrips, todayTrips, weekTrips, monthTrips, ranges });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
};

export const exportReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { format, startDate, endDate, driverId } = req.query;
    const where: any = {};

    if (startDate && endDate) {
      where.startTime = { [Op.between]: [new Date(startDate as string), new Date(endDate as string)] };
    }
    if (driverId) where.driverId = driverId;

    const trips = await Trip.findAll({
      where,
      include: [
        { model: Driver, as: 'driver', attributes: ['id', 'name', 'employeeId'] },
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'plateNumber', 'make', 'model'] },
      ],
      order: [['startTime', 'DESC']],
    });

    const data = trips.map((trip: any) => ({
      'Trip ID': trip.id,
      'Driver': trip.driver?.name || 'N/A',
      'Employee ID': trip.driver?.employeeId || 'N/A',
      'Vehicle': trip.vehicle?.plateNumber || 'N/A',
      'Status': trip.status,
      'Start Time': trip.startTime,
      'End Time': trip.endTime || 'N/A',
      'Duration (min)': trip.durationMinutes || 'N/A',
      'Start Odometer': trip.startOdometer,
      'End Odometer': trip.endOdometer || 'N/A',
      'Total Mileage': trip.totalMileage || 'N/A',
    }));

    if (format === 'csv') {
      const headers = Object.keys(data[0] || {}).join(',');
      const rows = data.map((row) => Object.values(row).join(','));
      const csv = [headers, ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=trips-report.csv');
      res.send(csv);
    } else {
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Trips');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=trips-report.xlsx');
      res.send(buffer);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to export report' });
  }
};
