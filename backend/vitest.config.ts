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
    // Pinned so a developer's .env (loaded by dotenv inside config modules)
    // cannot switch the photo tests onto Emergent storage and the network.
    env: { PHOTO_STORAGE: 'cloudinary' },
  },
});
