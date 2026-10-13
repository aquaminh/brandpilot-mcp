/**
 * Proxy mode (0.3.0): a stdio MCP server that owns no tool list. Every
 * tools/list, tools/call, prompts/list and prompts/get is forwarded as one
 * JSON-RPC POST to the hosted BrandPilot MCP (stateless Streamable HTTP,
 * JSON responses) with the workspace API key as the Bearer, and the hosted
 * answer is relayed unchanged. The app owns the catalog, so a tool added
 * there reaches proxy users without a package release.
 *
 * initialize and ping stay local (the hosted server is stateless, so there
 * is no session to open). The key is sent only in the Authorization header
 * and never appears in an error message or on stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ProxyConfig } from './config.js';
import { VERSION } from './version.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A transport or HTTP failure talking to the hosted endpoint (never a JSON-RPC error, which is relayed as-is). */
export class HostedError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HostedError';
  }
}

/**
 * A JSON-RPC error to send back to the client. Not McpError on purpose: the
 * SDK client already prefixes "MCP error <code>:" to whatever message it
 * receives, and McpError bakes the same prefix into its own message, so a
 * relayed McpError would read "MCP error -32603: MCP error -32603: ...".
 * The SDK's Protocol sends any thrown error's `code`, `message` and `data`.
 */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

interface RpcEnvelope {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

const MAX_DETAIL_CHARS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `error` / `code` fields of a JSON error body, for the message tail. Never echoes request data. */
function bodyDetail(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body)) {
      const code = typeof body.code === 'string' ? body.code : '';
      const error = typeof body.error === 'string' ? body.error : isRecord(body.error) && typeof body.error.message === 'string' ? body.error.message : '';
      const detail = [code, error].filter(Boolean).join(': ');
      if (detail) return detail.slice(0, MAX_DETAIL_CHARS);
    }
  } catch {
    // not JSON - fall through to the raw text
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_CHARS);
}

function httpError(status: number, text: string, url: string, retryAfter: string | null): HostedError {
  const detail = bodyDetail(text);
  const tail = detail ? ` (${detail})` : '';
  switch (status) {
    case 401:
      return new HostedError(
        `BrandPilot rejected the API key (HTTP 401)${tail}. Check BRANDPILOT_API_KEY: it may be mistyped, expired or revoked. Create a new workspace API key in BrandPilot (Settings, API keys) and restart the MCP server.`,
        status,
      );
    case 403:
      return new HostedError(
        `The API key does not have the permission this call needs (HTTP 403)${tail}. Create a key with the required scope in BrandPilot (Settings, API keys), or ask a workspace admin.`,
        status,
      );
    case 404:
      return new HostedError(
        `The hosted BrandPilot MCP is not enabled at ${url} (HTTP 404). Check BRANDPILOT_MCP_URL, or unset BRANDPILOT_API_KEY to use the legacy tools until it is enabled.`,
        status,
      );
    case 413:
      return new HostedError(`The request is too large for the hosted BrandPilot MCP (HTTP 413)${tail}.`, status);
    case 429:
      return new HostedError(
        `Rate limited by BrandPilot (HTTP 429)${retryAfter ? `; retry after ${retryAfter} s` : ''}${tail}.`,
        status,
      );
    default:
      return new HostedError(`The hosted BrandPilot MCP answered HTTP ${status}${tail}.`, status);
  }
}

/** The JSON-RPC response for `id` in a text/event-stream body, skipping notifications sent before it. */
function parseSse(text: string, id: number): unknown {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const message: unknown = JSON.parse(data);
    if (isRecord(message) && message.id === id) return message;
  }
  throw new Error('no response in the event stream');
}

export interface HostedClient {
  call(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<unknown>;
}

export function createHostedClient(config: Pick<ProxyConfig, 'apiKey' | 'url' | 'timeoutMs'>, fetchImpl: FetchLike = fetch): HostedClient {
  let nextId = 1;
  return {
    async call(method, params, signal) {
      const id = nextId++;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);
      const onCancel = (): void => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', onCancel, { once: true });

      let res: Response;
      let text: string;
      try {
        res = await fetchImpl(config.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'User-Agent': `brandpilot-mcp/${VERSION}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
          signal: controller.signal,
          // A redirect would resend the key; the endpoint never redirects.
          redirect: 'error',
        });
        text = await res.text();
      } catch (err) {
        if (timedOut) throw new HostedError(`The hosted BrandPilot MCP did not answer ${method} within ${config.timeoutMs / 1000} s (BRANDPILOT_TIMEOUT_MS).`);
        if (signal?.aborted) throw new HostedError(`${method} was cancelled by the client.`);
        const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : 'unknown error';
        throw new HostedError(`Could not reach the hosted BrandPilot MCP at ${config.url}: ${reason}`);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCancel);
      }

      if (!res.ok) throw httpError(res.status, text, config.url, res.headers.get('retry-after'));

      let envelope: RpcEnvelope;
      try {
        const contentType = res.headers.get('content-type') ?? '';
        const parsed: unknown = contentType.includes('text/event-stream') ? parseSse(text, id) : JSON.parse(text);
        if (!isRecord(parsed) || parsed.id !== id) throw new Error('not the response to this request');
        envelope = parsed;
      } catch {
        throw new HostedError(`The hosted BrandPilot MCP sent a response that is not JSON-RPC (HTTP ${res.status}).`, res.status);
      }
      if (envelope.error) {
        const code = typeof envelope.error.code === 'number' ? envelope.error.code : ErrorCode.InternalError;
        const message = typeof envelope.error.message === 'string' ? envelope.error.message : 'Unknown error';
        throw new RpcError(code, message, envelope.error.data);
      }
      if (!('result' in envelope)) {
        throw new HostedError('The hosted BrandPilot MCP sent a JSON-RPC response without a result.', res.status);
      }
      return envelope.result;
    },
  };
}

/** List and get methods surface a hosted failure as a JSON-RPC error. */
function asRpcError(err: unknown): never {
  if (err instanceof RpcError) throw err;
  throw new RpcError(ErrorCode.InternalError, err instanceof Error ? err.message : String(err));
}

export function createProxyServer(config: ProxyConfig, fetchImpl: FetchLike = fetch): Server {
  const hosted = createHostedClient(config, fetchImpl);
  const server = new Server(
    { name: 'brandpilot', title: 'BrandPilot', version: VERSION },
    {
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
      instructions: 'Tools and prompts come from the hosted BrandPilot MCP. Call whoami to check the connection.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (req, extra) =>
    (await hosted.call('tools/list', req.params, extra.signal).catch(asRpcError)) as never,
  );

  // A tool call that fails in transport comes back as a tool error, so the
  // agent reads the reason (401, 404, timeout) instead of a bare protocol error.
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    try {
      return (await hosted.call('tools/call', req.params, extra.signal)) as never;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (req, extra) =>
    (await hosted.call('prompts/list', req.params, extra.signal).catch(asRpcError)) as never,
  );

  server.setRequestHandler(GetPromptRequestSchema, async (req, extra) =>
    (await hosted.call('prompts/get', req.params, extra.signal).catch(asRpcError)) as never,
  );

  return server;
}
