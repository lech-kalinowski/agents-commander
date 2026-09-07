import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/agents-commander.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: {
    entry: 'src/index.ts',
  },
  // Keep the interactive UI behind the CLI's dynamic import so lightweight
  // commands can run even when optional terminal UI modules cannot load.
  splitting: true,
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
