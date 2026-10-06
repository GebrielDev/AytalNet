import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth';
import { User, Driver } from '../models';

interface JwtPayload {
  id: number;
  email: string;
  type: 'user' | 'driver';
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      driver?: Driver;
      authType?: 'user' | 'driver';
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;

    if (decoded.type === 'user') {
      const user = await User.findByPk(decoded.id);
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      req.user = user;
      req.authType = 'user';
    } else {
      const driver = await Driver.findByPk(decoded.id);
      if (!driver || driver.status !== 'active') {
        res.status(401).json({ error: 'Driver not found or inactive' });
        return;
      }
      req.driver = driver;
      req.authType = 'driver';
    }
    next();
  } catch {
    // 401, not 403. An expired or malformed token is a failure to
    // authenticate, which is what 401 means; 403 says "we know who you are and
    // you still may not", which is what requireUser and requireDriver below
    // report. Every other branch in this function already answers 401.
    //
    // It also has to be 401 for the clients' refresh interceptors to fire: an
    // access token expires after an hour, and the one-hour expiry IS the case
    // the refresh flow exists for. Answering 403 there meant it never ran.
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireUser = (req: Request, res: Response, next: NextFunction): void => {
  if (req.authType !== 'user') {
    res.status(403).json({ error: 'User access required' });
    return;
  }
  next();
};

export const requireDriver = (req: Request, res: Response, next: NextFunction): void => {
  if (req.authType !== 'driver') {
    res.status(403).json({ error: 'Driver access required' });
    return;
  }
  next();
};

export const generateAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, authConfig.jwtSecret, { expiresIn: '1h' } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, authConfig.jwtRefreshSecret, { expiresIn: '7d' } as jwt.SignOptions);
};

export const verifyRefreshToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, authConfig.jwtRefreshSecret) as JwtPayload;
  } catch {
    return null;
  }
};
