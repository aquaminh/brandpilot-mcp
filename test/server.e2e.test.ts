import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Drives the BUILT server (dist/index.js) over stdio against a fake origin,
// so the zod schema derived from the catalog and the handler are exercised
// together: an arg the schema strips never reaches the URL.
const __dirname = dirname(fileURLToPath(import.meta.url));
const distIndex = join(__dirname, '../dist/index.js');
const built = existsSync(distIndex);
if (!built) console.warn('dist/index.js not found - skipping server.e2e.test.ts (run `npm run build` first)');

interface Seen {
  url: string;
  auth: string | undefined;
}

describe.skipIf(!built)('get_design_prompt_pack over stdio', () => {
  const seen: Seen[] = [];
  let origin: Server;
  let client: Client;

  beforeAll(async () => {
    origin = createServer((req, res) => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'text/markdown' });
      res.end('# pack');
    });
    await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
    const { port } = origin.address() as AddressInfo;

    client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [distIndex],
        env: { BRANDPILOT_ORIGIN: `http://127.0.0.1:${port}`, DESIGNFLOW_HANDOFF_KEY: 'env-key' },
        stderr: 'ignore',
      }),
    );
  });

  afterAll(async () => {
    await client?.close();
    await new Promise<void>((resolve) => (origin ? origin.close(() => resolve()) : resolve()));
  });

  async function call(args: Record<string, unknown>): Promise<{ isError: boolean; text: string; url?: string; auth?: string }> {
    const before = seen.length;
    const result = (await client.callTool({ name: 'get_design_prompt_pack', arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    const hit = seen.length > before ? seen[seen.length - 1] : undefined;
    return { isError: !!result.isError, text: result.content.map((c) => c.text ?? '').join(''), url: hit?.url, auth: hit?.auth };
  }

  it('lists the v2 params in the tool input schema', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_design_prompt_pack');
    const props = (tool?.inputSchema.properties ?? {}) as Record<string, { enum?: string[]; default?: unknown }>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['designId', 'handoffKey', 'pass', 'direction', 'with3d', 'format']));
    expect(props.pass.enum).toEqual(['explore', 'lock']);
    expect(props.format.default).toBe('markdown');
  });

  it('keeps the v1 request when no v2 param is given', async () => {
    const r = await call({ designId: 'cd1' });
    expect(r.isError).toBe(false);
    expect(r.text).toBe('# pack');
    expect(r.url).toBe('/api/v1/designs/cd1/prompt-pack');
    expect(r.auth).toBe('Bearer env-key');
  });

  it('forwards pass, direction, with3d and format, with the per-call key', async () => {
    const r = await call({ designId: 'cd1', handoffKey: 'call-key', pass: 'lock', direction: 'Calm editorial', with3d: true, format: 'json' });
    expect(r.isError).toBe(false);
    expect(r.url).toBe('/api/v1/designs/cd1/prompt-pack?pass=lock&direction=Calm+editorial&with3d=1&format=json');
    expect(r.auth).toBe('Bearer call-key');
  });

  it('requests the copy map', async () => {
    const r = await call({ designId: 'cd1', format: 'copy-map' });
    expect(r.url).toBe('/api/v1/designs/cd1/prompt-pack?format=copy-map');
  });

  it('fails without a request when direction is given without pass', async () => {
    const r = await call({ designId: 'cd1', direction: 'Bold' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/only apply to a v2 pack/);
    expect(r.url).toBeUndefined();
  });

  it('rejects a pass outside the enum without a request', async () => {
    const before = seen.length;
    let rejected = false;
    try {
      const result = await client.callTool({ name: 'get_design_prompt_pack', arguments: { designId: 'cd1', pass: 'final' } });
      rejected = !!result.isError;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(seen.length).toBe(before);
  });
});
