import { User, Driver, Vehicle } from '../models';
import { sendMail } from '../config/email';

/**
 * Emails every dashboard user (dispatchers and admins) when part of a trip
 * reaches the office long after it happened - recorded on a phone with no
 * signal and sent later.
 *
 * LATE_TRIP_ALERT_MINUTES sets the threshold (default 60).
 * ALERT_TIMEZONE sets how times are written (default America/Phoenix).
 *
 * Best effort by design: it runs after the response has gone, and a mail
 * failure is logged, never surfaced to the driver whose trip it is.
 */

export const lateAlertMinutes = (): number => Number(process.env.LATE_TRIP_ALERT_MINUTES) || 60;

const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60000);

export const isLateForAlert = (happenedAt: Date, receivedAt: Date): boolean =>
  minutesBetween(happenedAt, receivedAt) > lateAlertMinutes();

const formatDelay = (minutes: number) =>
  minutes < 120 ? `${minutes} minutes` : minutes < 2880 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes / 1440)} days`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface AlertTrip {
  id: number;
  driverId: number | null;
  vehicleId: number;
}

export const sendLateTripAlert = async (
  trip: AlertTrip,
  part: 'start' | 'end',
  happenedAt: Date,
  receivedAt: Date
): Promise<void> => {
  try {
    if (!isLateForAlert(happenedAt, receivedAt)) return;

    const [users, driver, vehicle] = await Promise.all([
      User.findAll({ attributes: ['email'] }),
      trip.driverId ? Driver.findByPk(trip.driverId, { attributes: ['name', 'employeeId'] }) : null,
      Vehicle.findByPk(trip.vehicleId, { attributes: ['plateNumber'] }),
    ]);
    if (!users.length) return;

    const timeZone = process.env.ALERT_TIMEZONE || 'America/Phoenix';
    const when = (d: Date) => d.toLocaleString('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
    const delay = formatDelay(minutesBetween(happenedAt, receivedAt));
    const who = driver ? `${driver.name} (${driver.employeeId})` : 'A driver';
    const plate = vehicle?.plateNumber || `vehicle ${trip.vehicleId}`;
    const link = `${(process.env.FRONTEND_URL || 'https://dashboard.startechsolutions.us').replace(/\/+$/, '')}/trips`;

    const subject = `Late trip ${part}: trip #${trip.id} arrived ${delay} after it happened`;
    const lines = [
      `${who} recorded the ${part} of trip #${trip.id} (${plate}) without signal.`,
      '',
      `Trip ${part}ed: ${when(happenedAt)}`,
      `Reached the office: ${when(receivedAt)} (${delay} later)`,
      '',
      `Review it on the dashboard: ${link} (tick "Recorded offline only").`,
    ];
    const html = `<p>${lines
      .filter(Boolean)
      .map((l) => escapeHtml(l))
      .join('</p><p>')}</p>`;

    for (const { email } of users) {
      const sent = await sendMail({ to: email, subject, text: lines.join('\n'), html });
      if (!sent) console.error(`[alerts] Late trip alert for trip #${trip.id} was not delivered to ${email}`);
    }
  } catch (error) {
    console.error(`[alerts] Could not send the late trip alert for trip #${trip.id}`, error);
  }
};
