import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { connectDatabase } from './config/database';
import { assertAuthSecrets } from './config/auth';
import { allowedOrigins, isOriginAllowed } from './config/cors';
import routes from './routes';
import { ApiError, errorHandler, notFound } from './middleware/errorHandler';
import { configureDashboardSocket, configureDriverSocket } from './socket';

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

// Handshake, per-user rooms and token-expiry handling live in ./socket.
configureDashboardSocket(io);
configureDriverSocket(io);

// Make io available in routes
app.set('io', io);

// Real client IP (for login attempt limits) from the proxy in front: Railway = 1 hop.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops >= 0 && proxyHops <= 5 ? proxyHops : 1);

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
