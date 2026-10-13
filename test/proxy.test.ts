import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createProxyServer, type FetchLike } from '../src/proxy';
import type { ProxyConfig } from '../src/config';
import { VERSION } from '../src/version';

const KEY = 'bp_live_test_key_do_not_log';
const URL = 'https://hosted.example.com/api/mcp';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { jsonrpc: string; id: number; method: string; params?: Record<string, unknown> };
}

type Reply = { status?: number; body: unknown; contentType?: string; headers?: Record<string, string> } | ((sent: Sent, signal: AbortSignal) => Promise<Response>);

function jsonRpc(sent: Sent, result: unknown): unknown {
  return { jsonrpc: '2.0', id: sent.body.id, result };
}

async function connect(reply: (sent: Sent) => Reply, overrides: Partial<ProxyConfig> = {}): Promise<{ client: Client; sent: Sent[] }> {
  const sent: Sent[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const entry: Sent = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    };
    sent.push(entry);
    const r = reply(entry);
    if (typeof r === 'function') return r(entry, init.signal as AbortSignal);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(text, {
      status: r.status ?? 200,
      headers: { 'Content-Type': r.contentType ?? 'application/json', ...r.headers },
    });
  };
  const config: ProxyConfig = { mode: 'proxy', apiKey: KEY, url: URL, timeoutMs: 5_000, notices: [], ...overrides };
  const server = createProxyServer(config, fetchImpl);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'proxy-test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, sent };
}

const HOSTED_TOOLS = [
  { name: 'whoami', description: 'Who the key belongs to', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'list_brands', description: 'List brands', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: [] } },
];

describe('proxy mode', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers initialize locally with the package version and both capabilities', async () => {
    const { client, sent } = await connect(() => ({ body: {} }));
    expect(client.getServerVersion()).toMatchObject({ name: 'brandpilot', version: VERSION });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {} });
    expect(sent).toHaveLength(0);
  });

  it('forwards tools/list with the Bearer key and relays exactly the hosted list (no local catalog)', async () => {
    const { client, sent } = await connect((s) => ({ body: jsonRpc(s, { tools: HOSTED_TOOLS }) }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['whoami', 'list_brands']);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(URL);
    expect(sent[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent[0].headers['Content-Type']).toBe('application/json');
    expect(sent[0].headers.Accept).toBe('application/json, text/event-stream');
    expect(sent[0].body).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
  });

  it('forwards tools/call arguments and relays content, structuredContent and isError', async () => {
    const { client, sent } = await connect((s) =>
      s.body.method === 'tools/call'
        ? {
            body: jsonRpc(s, {
              content: [{ type: 'text', text: 'INSUFFICIENT_SCOPE: This API key does not have the PIPELINE permission' }],
              structuredContent: { code: 'INSUFFICIENT_SCOPE', status: 403 },
              isError: true,
            }),
          }
        : { body: jsonRpc(s, { tools: HOSTED_TOOLS }) },
    );
    const result = await client.callTool({ name: 'finish_external_design', arguments: { designId: 'd1' } });
    expect(sent[sent.length - 1].body).toMatchObject({ method: 'tools/call', params: { name: 'finish_external_design', arguments: { designId: 'd1' } } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: 'INSUFFICIENT_SCOPE', status: 403 });
  });

  it('forwards prompts/list and prompts/get', async () => {
    const { client, sent } = await connect((s) =>
      s.body.method === 'prompts/list'
        ? { body: jsonRpc(s, { prompts: [{ name: 'build_from_design', arguments: [{ name: 'designId', required: true }] }] }) }
        : { body: jsonRpc(s, { messages: [{ role: 'user', content: { type: 'text', text: 'Adopt the brand of design d1' } }] }) },
    );
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['build_from_design']);
    const got = await client.getPrompt({ name: 'build_from_design', arguments: { designId: 'd1' } });
    expect(got.messages[0].content).toEqual({ type: 'text', text: 'Adopt the brand of design d1' });
    expect(sent.map((s) => s.body.method)).toEqual(['prompts/list', 'prompts/get']);
    expect(sent[1].body.params).toMatchObject({ name: 'build_from_design', arguments: { designId: 'd1' } });
  });

  it('relays a hosted JSON-RPC error with its code', async () => {
    const { client } = await connect((s) => ({ body: { jsonrpc: '2.0', id: s.body.id, error: { code: -32602, message: 'Unknown tool: nope' } } }));
    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('Unknown tool: nope') });
    await expect(client.getPrompt({ name: 'nope' })).rejects.toMatchObject({ code: -32602 });
  });

  it('relays an error with a single "MCP error" prefix', async () => {
    const { client } = await connect(() => ({ status: 404, body: { error: 'Not found' } }));
    const err = (await client.listTools().catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/^MCP error -32603: The hosted BrandPilot MCP is not enabled/);
    expect(err.message.match(/MCP error/g)).toHaveLength(1);
  });

  it('reads a text/event-stream answer, skipping notifications before it', async () => {
    const { client } = await connect((s) => ({
      contentType: 'text/event-stream',
      body: `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${JSON.stringify(jsonRpc(s, { tools: HOSTED_TOOLS }))}\n\n`,
    }));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(2);
  });

  describe('HTTP failures', () => {
    const cases: Array<[number, unknown, RegExp]> = [
      [401, { error: 'Invalid, expired or revoked API key', code: 'INVALID_API_KEY' }, /rejected the API key \(HTTP 401\).*INVALID_API_KEY.*BRANDPILOT_API_KEY/],
      [403, { error: 'This API key does not have the READ permission', code: 'INSUFFICIENT_SCOPE', required: 'READ' }, /permission.*\(HTTP 403\).*INSUFFICIENT_SCOPE/],
      [404, { error: 'Not found' }, /hosted BrandPilot MCP is not enabled at https:\/\/hosted\.example\.com\/api\/mcp \(HTTP 404\)/],
      [500, 'upstream exploded', /answered HTTP 500 \(upstream exploded\)/],
    ];

    for (const [status, body, pattern] of cases) {
      it(`${status}: tools/call returns a readable tool error, tools/list a JSON-RPC error`, async () => {
        const { client } = await connect(() => ({ status, body }));
        const result = (await client.callTool({ name: 'whoami', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(pattern);
        expect(result.content[0].text).not.toContain(KEY);
        await expect(client.listTools()).rejects.toThrow(pattern);
      });
    }

    it('429 names the retry delay', async () => {
      const { client } = await connect(() => ({ status: 429, body: { error: 'Too many requests' }, headers: { 'Retry-After': '30' } }));
      const result = (await client.callTool({ name: 'whoami', arguments: {} })) as { content: Array<{ text: string }> };
      expect(result.content[0].text).toMatch(/Rate limited.*retry after 30 s/);
    });

    it('a response for another request id is rejected', async () => {
      const { client } = await connect(() => ({ body: { jsonrpc: '2.0', id: 999, result: { tools: [] } } }));
      await expect(client.listTools()).rejects.toThrow(/not JSON-RPC/);
    });

    it('a 200 that is not JSON-RPC is an error, not a silent empty result', async () => {
      const { client } = await connect(() => ({ body: '<html>login</html>', contentType: 'text/html' }));
      await expect(client.listTools()).rejects.toThrow(/not JSON-RPC/);
    });
  });

  it('times out with a clear message and aborts the request', async () => {
    let aborted = false;
    const { client } = await connect(
      () => (_sent, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
      { timeoutMs: 50 },
    );
    const result = (await client.callTool({ name: 'whoami', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(aborted).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/did not answer tools\/call within 0.05 s \(BRANDPILOT_TIMEOUT_MS\)/);
  });

  it('reports an unreachable host without the key', async () => {
    const { client } = await connect(() => async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND hosted.example.com') });
    });
    const result = (await client.callTool({ name: 'whoami', arguments: {} })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('Could not reach the hosted BrandPilot MCP at https://hosted.example.com/api/mcp: getaddrinfo ENOTFOUND hosted.example.com');
  });

  it('never writes the key to stderr or stdout', async () => {
    const err = vi.spyOn(console, 'error');
    const log = vi.spyOn(console, 'log');
    const { client } = await connect(() => ({ status: 401, body: { error: 'bad' } }));
    await client.callTool({ name: 'whoami', arguments: {} });
    await client.listTools().catch(() => undefined);
    for (const call of [...err.mock.calls, ...log.mock.calls]) expect(JSON.stringify(call)).not.toContain(KEY);
  });
});
