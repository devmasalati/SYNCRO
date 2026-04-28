import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  resolve: {
    alias: {
      '@': dirname,
    },
  },
  test: {
    globals: true,
    name: 'unit',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'hooks/**/*.test.ts',
      'hooks/**/*.test.tsx',
      'lib/**/*.test.ts',
      'lib/**/*.test.tsx',
    ],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
