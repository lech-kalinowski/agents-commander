import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/agents-commander.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  shims: true,
  noExternal: [],
  external: [
    'blessed',
    'marked',
    'marked-terminal',
    'chokidar',
    'commander',
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
