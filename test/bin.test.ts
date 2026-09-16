import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distIndex = join(__dirname, '../dist/index.js');

describe('dist/index.js (bin entry)', () => {
  it('starts with the shebang and is executable, once built', () => {
    if (!existsSync(distIndex)) {
      // Skip in environments where `npm run build` has not been run yet
      // (e.g. a fresh checkout before the first build). CI / the publish
      // checklist runs `npm run build` before this test.
      console.warn('dist/index.js not found - skipping bin.test.ts (run `npm run build` first)');
      return;
    }
    const content = readFileSync(distIndex, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);

    const mode = statSync(distIndex).mode;
    const isExecutableByOwner = (mode & 0o100) !== 0;
    expect(isExecutableByOwner).toBe(true);
  });
});
