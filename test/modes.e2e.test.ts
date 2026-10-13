import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Drives the BUILT bin over stdio in both modes against a fake origin that
// plays the hosted /api/mcp (JSON-RPC) and the legacy REST routes, and reads
// the bin's stderr so the notices (and the absence of any key) are checked
// where users actually see them.
const __dirname = dirname(fileURLToPath(import.meta.url));
const distIndex = join(__dirname, '../dist/index.js');
const built = existsSync(distIndex);
if (!built) console.warn('dist/index.js not found - skipping modes.e2e.test.ts (run `npm run build` first)');

const API_KEY = 'bp_live_e2e_secret_key';
const HANDOFF_KEY = 'e2e-legacy-handoff-secret';

interface Hit {
  path: string;
  auth: string | undefined;
  rpc?: { method: string; params?: Record<string, unknown> };
}

async function startBin(env: Record<string, string>): Promise<{ client: Client; stderr: () => string }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [distIndex], env, stderr: 'pipe' });
  let output = '';
  transport.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const client = new Client({ name: 'e2e', version: '0.0.0' });
  await client.connect(transport);
  return { client, stderr: () => output };
}

describe.skipIf(!built)('bin modes over stdio', () => {
  const hits: Hit[] = [];
  let origin: Server;
  let base: string;

  beforeAll(async () => {
    origin = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const hit: Hit = { path: req.url ?? '', auth: req.headers.authorization };
        hits.push(hit);
        if (req.url === '/api/mcp') {
          if (req.headers.authorization !== `Bearer ${API_KEY}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid, expired or revoked API key', code: 'INVALID_API_KEY' }));
            return;
          }
          const msg = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
          hit.rpc = { method: msg.method, params: msg.params };
          const result =
            msg.method === 'tools/list'
              ? { tools: [{ name: 'whoami', description: 'Who am I', inputSchema: { type: 'object', properties: {} } }] }
              : msg.method === 'tools/call'
                ? { content: [{ type: 'text', text: 'workspace: Acme' }], structuredContent: { workspace: 'Acme' } }
                : msg.method === 'prompts/list'
                  ? { prompts: [{ name: 'build_from_design' }] }
                  : { messages: [] };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      });
    });
    await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (origin ? origin.close(() => resolve()) : resolve()));
  });

  it('proxy mode relays the hosted tools, calls and prompts with the key as Bearer', async () => {
    const { client, stderr } = await startBin({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_MCP_URL: `${base}/api/mcp`, DESIGNFLOW_HANDOFF_KEY: HANDOFF_KEY });
    try {
      const before = hits.length;
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['whoami']);
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.structuredContent).toEqual({ workspace: 'Acme' });
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name)).toEqual(['build_from_design']);

      const mine = hits.slice(before);
      expect(mine.map((h) => h.path)).toEqual(['/api/mcp', '/api/mcp', '/api/mcp']);
      expect(mine.map((h) => h.rpc?.method)).toEqual(['tools/list', 'tools/call', 'prompts/list']);
      for (const h of mine) expect(h.auth).toBe(`Bearer ${API_KEY}`);

      expect(stderr()).toContain(`proxying to ${base}/api/mcp`);
      expect(stderr()).toContain('DESIGNFLOW_HANDOFF_KEY is ignored');
      expect(stderr()).not.toContain(API_KEY);
      expect(stderr()).not.toContain(HANDOFF_KEY);
    } finally {
      await client.close();
    }
  });

  it('proxy mode turns a rejected key into a readable tool error', async () => {
    const { client, stderr } = await startBin({ BRANDPILOT_API_KEY: 'bp_live_wrong_key', BRANDPILOT_MCP_URL: `${base}/api/mcp` });
    try {
      const result = (await client.callTool({ name: 'whoami', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/rejected the API key \(HTTP 401\)/);
      expect(result.content[0].text).not.toContain('bp_live_wrong_key');
      expect(stderr()).not.toContain('bp_live_wrong_key');
    } finally {
      await client.close();
    }
  });

  it('legacy mode keeps the 0.2.x tools and prints one deprecation line without the key', async () => {
    const { client, stderr } = await startBin({ BRANDPILOT_ORIGIN: base, DESIGNFLOW_HANDOFF_KEY: HANDOFF_KEY });
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(8);
      expect(tools.map((t) => t.name)).toContain('get_design_handoff');
      const before = hits.length;
      await client.callTool({ name: 'get_design_handoff', arguments: { designId: 'd1' } });
      expect(hits.slice(before)).toEqual([{ path: '/api/v1/designs/d1/handoff', auth: `Bearer ${HANDOFF_KEY}` }]);

      const lines = stderr().split('\n').filter((line) => line.includes('deprecated'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('2027-01-31');
      expect(stderr()).not.toContain(HANDOFF_KEY);
    } finally {
      await client.close();
    }
  });

  it('legacy mode without any key prints no deprecation line', async () => {
    const { client, stderr } = await startBin({ BRANDPILOT_ORIGIN: base });
    try {
      await client.listTools();
      expect(stderr()).toContain('legacy tools');
      expect(stderr()).not.toContain('deprecated');
    } finally {
      await client.close();
    }
  });
});
