import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/catalog.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  sourcemap: false,
  // The MCP SDK stays external so a client that already depends on it (or
  // dedupes it in a monorepo) doesn't get a second bundled copy.
  noExternal: [],
  banner: (ctx) => (ctx.format === 'esm' && ctx.entry?.includes('index') ? { js: '#!/usr/bin/env node' } : {}),
});
