import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOOL_CATALOG } from '../src/catalog';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('TOOL_CATALOG', () => {
  it('has unique tool names', () => {
    const names = TOOL_CATALOG.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every endpoint is a REST path starting with /api/', () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.endpoint.startsWith('/api/')).toBe(true);
    }
  });

  it('every arg type is one of string|number|boolean|object', () => {
    const allowed = new Set(['string', 'number', 'boolean', 'object']);
    for (const tool of TOOL_CATALOG) {
      for (const arg of tool.args) {
        expect(allowed.has(arg.type)).toBe(true);
      }
    }
  });

  // Every catalog entry needs a registered handler in src/index.ts - this
  // is the package-side mirror of the app's "list cannot fork" guard.
  it('every catalog tool has a handler registered in src/index.ts', () => {
    const source = readFileSync(join(__dirname, '../src/index.ts'), 'utf-8');
    for (const tool of TOOL_CATALOG) {
      const registered = source.includes(`'${tool.name}':`) || source.includes(`${tool.name}:`);
      expect(registered, `expected src/index.ts HANDLERS to define "${tool.name}"`).toBe(true);
    }
  });
});
