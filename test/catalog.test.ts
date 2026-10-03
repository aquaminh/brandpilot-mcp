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

  it('get_design_prompt_pack exposes the v2 pack params', () => {
    const tool = TOOL_CATALOG.find((t) => t.name === 'get_design_prompt_pack');
    const args = Object.fromEntries((tool?.args ?? []).map((arg) => [arg.name, arg]));
    expect(Object.keys(args)).toEqual(['designId', 'handoffKey', 'pass', 'direction', 'with3d', 'format']);
    expect(args.pass.enum).toEqual(['explore', 'lock']);
    expect(args.with3d.type).toBe('boolean');
    expect(args.format.enum).toEqual(['markdown', 'json', 'copy-map']);
    for (const name of ['pass', 'direction', 'with3d', 'format']) expect(args[name].required).toBe(false);
  });

  it('every enum arg default is one of its enum values', () => {
    for (const tool of TOOL_CATALOG) {
      for (const arg of tool.args) {
        if (arg.enum && arg.default !== undefined) expect(arg.enum).toContain(arg.default);
      }
    }
  });
});

describe('release version', () => {
  it('package.json, package-lock.json, server.json and the server handshake agree', () => {
    const read = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf-8');
    const { version } = JSON.parse(read('package.json')) as { version: string };
    const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version: string }> };
    const server = JSON.parse(read('server.json')) as { version: string; packages: Array<{ version: string }> };
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
    expect(server.version).toBe(version);
    for (const pkg of server.packages) expect(pkg.version).toBe(version);
    expect(read('src/index.ts')).toContain(`new McpServer({ name: 'brandpilot', version: '${version}' })`);
  });
});
