/**
 * Loaded via `--require` before any test file, so that src/config/* - which
 * throws at import time when these are missing - can be imported at all.
 *
 * DATABASE_URL is only parsed, never connected to: the Sequelize constructor
 * does not open a connection, and the tests stub the model methods they need.
 * Existing values win, so a developer's own .env is left alone.
 */
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/aytalnet_test_unused';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-jwt-refresh-secret';
process.env.NODE_ENV ||= 'test';
