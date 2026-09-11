import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Product QA must not discover/execute private recordings, research helpers,
    // exported datasets, or independent node:test scripts elsewhere in the tree.
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
});
