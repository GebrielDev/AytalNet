import { describe, it, expect, vi, beforeEach } from 'vitest';

const findAllUsers = vi.fn();
const sendMail = vi.fn();

vi.mock('../models', () => ({
  User: { findAll: (...a: unknown[]) => findAllUsers(...a) },
  Driver: { findByPk: vi.fn().mockResolvedValue({ name: 'John Smith', employeeId: 'DRV001' }) },
  Vehicle: { findByPk: vi.fn().mockResolvedValue({ plateNumber: 'ABC-1234' }) },
}));
vi.mock('../config/email', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

const trip = { id: 7, driverId: 1, vehicleId: 1 };
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60000);

describe('late trip alerts', () => {
  beforeEach(() => {
    findAllUsers.mockResolvedValue([{ email: 'dispatch@x.com' }, { email: 'admin@x.com' }]);
    sendMail.mockResolvedValue(true);
  });

  it('emails every dashboard user when a part arrives more than an hour late', async () => {
    const { sendLateTripAlert } = await import('./lateTripAlerts');
    await sendLateTripAlert(trip, 'start', at(90), new Date());
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(['dispatch@x.com', 'admin@x.com']);
    expect(sendMail.mock.calls[0][0].subject).toContain('trip #7');
    expect(sendMail.mock.calls[0][0].text).toContain('John Smith (DRV001)');
    expect(sendMail.mock.calls[0][0].text).toContain('ABC-1234');
  });

  it('stays quiet for a trip that arrived within the hour', async () => {
    const { sendLateTripAlert } = await import('./lateTripAlerts');
    await sendLateTripAlert(trip, 'end', at(45), new Date());
    expect(findAllUsers).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never throws, even when the lookup fails', async () => {
    findAllUsers.mockRejectedValue(new Error('db down'));
    const { sendLateTripAlert } = await import('./lateTripAlerts');
    await expect(sendLateTripAlert(trip, 'start', at(120), new Date())).resolves.toBeUndefined();
  });
});
