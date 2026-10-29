import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4321' },
  webServer: {
    command: 'pnpm dev --port 4321',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
  },
});
