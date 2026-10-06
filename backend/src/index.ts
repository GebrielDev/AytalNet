import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { connectDatabase } from './config/database';
import { authConfig, assertAuthSecrets } from './config/auth';
import { allowedOrigins, isOriginAllowed } from './config/cors';
import { User } from './models';
import routes from './routes';
import { ApiError, errorHandler, notFound } from './middleware/errorHandler';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

// The dashboard feed carries driver names, employee IDs, vehicle plates and
// trip GPS. Without this, any client that completed the handshake received all
// of it - which contradicts the privacy policy's claim that only dispatchers
// and administrators can see trip data.
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    next(new Error('Authentication required'));
    return;
  }
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret) as {
      id: number;
      type?: string;
      exp?: number;
    };
    if (decoded.type !== 'user') {
      next(new Error('Dashboard access is limited to dispatchers and administrators'));
      return;
    }
    // Matches authenticateToken: the signed claims are not enough on their own.
    // A dispatcher deleted through deleteUser still holds a valid token until it
    // expires, and without this would keep receiving the feed for up to an hour.
    if (!(await User.findByPk(decoded.id))) {
      next(new Error('User not found'));
      return;
    }
    socket.data.tokenExp = decoded.exp;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Make io available in routes
app.set('io', io);

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new ApiError(403, `Origin ${origin} is not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Health check for Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Socket.io events
io.on('connection', (socket) => {
  // Joined on connect rather than on request: the handshake above has already
  // established that this socket belongs to a dispatcher or administrator.
  // Previously the room was joined but never emitted to, so it did nothing.
  socket.join('dashboard');

  // The handshake runs once, but a socket lives for as long as the tab stays
  // open. Without this, an expired token - or a dispatcher deleted after
  // connecting - keeps streaming driver names and trip GPS indefinitely, which
  // would leave the socket weaker than the REST path, where authenticateToken
  // re-checks the user on every request.
  //
  // Closing at the token's own expiry bounds that to the token lifetime and
  // makes the client reconnect, which re-runs the full handshake.
  const exp = socket.data.tokenExp as number | undefined;
  const expiresInMs = exp ? exp * 1000 - Date.now() : 0;
  const expiryTimer = setTimeout(
    () => socket.disconnect(true),
    Math.max(0, expiresInMs)
  );

  socket.on('disconnect', () => {
    clearTimeout(expiryTimer);
    socket.leave('dashboard');
  });
});

// Start server
const PORT = process.env.PORT || 3000;

const start = async () => {
  // Fail at boot, not on the first login attempt.
  assertAuthSecrets();

  await connectDatabase();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Allowed browser origins: ${allowedOrigins.join(', ')}`);
  });
};

start().catch((error) => {
  console.error('Startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

export { app, io };
