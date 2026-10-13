import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLegacyServer, type LegacyOptions } from '../src/legacy';
import { TOOL_CATALOG } from '../src/catalog';
import { VERSION } from '../src/version';

// Legacy mode must keep the 0.2.x behaviour: the eight catalog tools, REST
// calls against BRANDPILOT_ORIGIN, the env handoff key as the Bearer with the
// per-call handoffKey overriding it.
interface Seen {
  url: string;
  method: string;
  auth: string | undefined;
  body: unknown;
}

let seen: Seen[];

beforeEach(() => {
  seen = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.push({ url, method: init.method ?? 'GET', auth: headers.Authorization, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/forbidden/handoff')) return new Response('{"error":"Invalid handoff key"}', { status: 401 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => vi.unstubAllGlobals());

async function connect(options: LegacyOptions): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createLegacyServer(options).connect(serverSide);
  const client = new Client({ name: 'legacy-test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('legacy mode (0.2.x behaviour)', () => {
  it('lists the eight catalog tools and reports the package version', async () => {
    const client = await connect({ origin: 'https://origin.example.com' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOL_CATALOG.map((t) => t.name));
    expect(tools).toHaveLength(8);
    expect(client.getServerVersion()).toMatchObject({ name: 'brandpilot', version: VERSION });
  });

  it('calls public tools without a key', async () => {
    const client = await connect({ origin: 'https://origin.example.com' });
    const result = await client.callTool({ name: 'list_systems', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(seen).toEqual([{ url: 'https://origin.example.com/api/v1/systems', method: 'GET', auth: undefined, body: undefined }]);
  });

  it('sends the env handoff key, and a per-call handoffKey overrides it', async () => {
    const client = await connect({ origin: 'https://origin.example.com', handoffKey: 'env-key' });
    await client.callTool({ name: 'get_design_handoff', arguments: { designId: 'd1' } });
    await client.callTool({ name: 'finish_external_design', arguments: { designId: 'd1', handoffKey: 'call-key', acceptAll: true } });
    expect(seen[0]).toMatchObject({ url: 'https://origin.example.com/api/v1/designs/d1/handoff', auth: 'Bearer env-key' });
    expect(seen[1]).toMatchObject({ url: 'https://origin.example.com/api/v1/designs/d1/finish-external', method: 'POST', auth: 'Bearer call-key', body: { acceptAll: true } });
  });

  it('fails a design-scoped tool without any key and makes no request', async () => {
    const client = await connect({ origin: 'https://origin.example.com' });
    const result = (await client.callTool({ name: 'get_design_handoff', arguments: { designId: 'd1' } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/design handoff key is required/);
    expect(seen).toHaveLength(0);
  });

  it('surfaces an HTTP error as a tool error', async () => {
    const client = await connect({ origin: 'https://origin.example.com', handoffKey: 'env-key' });
    const result = (await client.callTool({ name: 'get_design_handoff', arguments: { designId: 'forbidden' } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 401');
  });
});
