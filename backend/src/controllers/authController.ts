import { Request, Response } from 'express';
import { User, Driver, PasswordResetToken } from '../models';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth';
import { sendPasswordResetEmail, isEmailConfigured } from '../config/email';

/**
 * Pull a required string out of a request body.
 *
 * Sequelize validates `where` values before it opens a connection and throws
 * on anything that is not a scalar - `WHERE parameter "email" has invalid
 * "undefined" value` for a missing field, `Invalid value {...}` for a nested
 * object. Passing req.body fields straight into findOne therefore turned a
 * malformed request into a 500: the wrong status for the caller, and a server
 * fault recorded for what is a client error.
 */
const requiredString = (body: unknown, field: string): string | null => {
  const value = (body as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = requiredString(req.body, 'email');
    const password = requiredString(req.body, 'password');
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ where: { email } });

    if (!user || !(await user.validatePassword(password))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const payload = { id: user.id, email: user.email, type: 'user' as const };
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken: generateAccessToken(payload),
      refreshToken: generateRefreshToken(payload),
    });
  } catch (error) {
    // `details: String(error)` used to go out with this response, handing an
    // unauthenticated caller Sequelize's message - table and column names, and
    // sometimes the failing SQL. It belongs in the log, not the body.
    console.error('User login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

export const loginDriver = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = requiredString(req.body, 'email');
    const password = requiredString(req.body, 'password');
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const driver = await Driver.findOne({ where: { email } });

    if (!driver || driver.status !== 'active' || !(await driver.validatePassword(password))) {
      res.status(401).json({ error: 'Invalid credentials or inactive account' });
      return;
    }

    const payload = { id: driver.id, email: driver.email, type: 'driver' as const };
    res.json({
      driver: { id: driver.id, employeeId: driver.employeeId, email: driver.email, name: driver.name, phone: driver.phone },
      accessToken: generateAccessToken(payload),
      refreshToken: generateRefreshToken(payload),
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = requiredString(req.body, 'refreshToken');
    if (!token) {
      res.status(400).json({ error: 'A refresh token is required' });
      return;
    }

    const payload = verifyRefreshToken(token);

    if (!payload) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const newPayload = { id: payload.id, email: payload.email, type: payload.type };
    res.json({
      accessToken: generateAccessToken(newPayload),
      refreshToken: generateRefreshToken(newPayload),
    });
  } catch (error) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  if (req.user) {
    res.json({ type: 'user', user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role } });
  } else if (req.driver) {
    res.json({ type: 'driver', driver: { id: req.driver.id, employeeId: req.driver.employeeId, email: req.driver.email, name: req.driver.name } });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    // Periodically clean up expired tokens
    await PasswordResetToken.cleanExpired();

    const email = requiredString(req.body, 'email');
    if (!email) {
      res.status(400).json({ error: 'An email address is required' });
      return;
    }
    const accountType = (req.body as { type?: unknown })?.type === 'driver' ? 'driver' : 'user';

    // Always respond with success to prevent email enumeration
    const successMsg = { message: 'If an account with that email exists, a reset link has been generated.' };

    let exists = false;
    if (accountType === 'driver') {
      const driver = await Driver.findOne({ where: { email } });
      exists = !!driver;
    } else {
      const user = await User.findOne({ where: { email } });
      exists = !!user;
    }

    if (!exists) {
      res.json(successMsg);
      return;
    }

    const token = await PasswordResetToken.createToken(email, accountType);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    const sent = await sendPasswordResetEmail(email, resetLink);

    if (!sent) {
      // The address exists but we could not reach it. Say nothing different to
      // the caller - that would leak which addresses are registered - but make
      // it loud in the logs, and in development print the link so the flow is
      // still testable without an SMTP server.
      console.error(
        `[auth] Could not email a reset link to ${email} (${accountType}).`,
        isEmailConfigured ? 'SMTP send failed.' : 'SMTP is not configured.'
      );
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[auth] Development reset link for ${email}: ${resetLink}`);
      }
    }

    // The token is deliberately NOT returned. It is a bearer credential for the
    // account, and this endpoint is unauthenticated, so returning it would let
    // anyone reset any account by knowing only its email address.
    res.json(successMsg);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const resetRecord = await PasswordResetToken.findValidToken(token);
    if (!resetRecord) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    if (resetRecord.accountType === 'driver') {
      const driver = await Driver.findOne({ where: { email: resetRecord.email } });
      if (!driver) {
        res.status(400).json({ error: 'Account not found' });
        return;
      }
      driver.passwordHash = password; // beforeUpdate hook will hash it
      await driver.save();
    } else {
      const user = await User.findOne({ where: { email: resetRecord.email } });
      if (!user) {
        res.status(400).json({ error: 'Account not found' });
        return;
      }
      user.passwordHash = password; // beforeUpdate hook will hash it
      await user.save();
    }

    // Mark token as used
    resetRecord.usedAt = new Date();
    await resetRecord.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};
