import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/unit/**/*.test.ts'],
          exclude: ['test/unit/browser/**'],
          // test/unit/performance.test.ts times parses in process CPU time, which counts only that test file while
          // each worker is a process of its own; threads would share it with the test files running alongside.
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/unit/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
