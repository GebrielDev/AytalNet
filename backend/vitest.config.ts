import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node, not jsdom: everything under test here is server code.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // No database is available in CI, so nothing here may open a connection.
    // Tests that need a model stub it; see src/controllers/*.test.ts.
    clearMocks: true,
    restoreMocks: true,
  },
});
