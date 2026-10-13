/**
 * Legacy mode: the 0.2.x server, unchanged in behaviour, for users without
 * a workspace API key. It serves the public tools and the design-scoped
 * tools behind DESIGNFLOW_HANDOFF_KEY (deprecated; legacy keys retire
 * 2027-01-31, see ./config).
 *
 * Deliberately HTTP-backed, never a second DB access path: any machine with
 * network access to BRANDPILOT_ORIGIN can run it - no DB credentials, no
 * Prisma. Tool registration is data-driven from `TOOL_CATALOG` (./catalog),
 * never a hand-typed parallel list.
 *
 * The handoff key is optional at startup - required only by the
 * design-scoped tools; each tool also accepts an explicit handoffKey
 * argument that overrides the env. Copy it from the DESIGN page
 * (/designs/<id>, section "Continue this design", "Copy API key").
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { TOOL_CATALOG, type ToolArgSpec, type ToolSpec } from './catalog.js';
import { promptPackPath, type PromptPackQuery } from './prompt-pack-query.js';
import { VERSION } from './version.js';

export interface LegacyOptions {
  origin: string;
  handoffKey?: string;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

async function request(base: string, path: string, opts: { key?: string; method?: string; body?: unknown } = {}): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text; // markdown documents (agent-prompt, prompt pack, handoff prompt)
  }
}

function resolveKey(envKey: string | undefined, explicit?: string): string {
  const key = explicit ?? envKey;
  if (!key) {
    throw new Error(
      'A design handoff key is required: pass handoffKey, or set DESIGNFLOW_HANDOFF_KEY (copy it from the design page, /designs/<id>, section "Continue this design").',
    );
  }
  return key;
}

async function wrap(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: String(err) }], isError: true };
  }
}

function zodForArg(arg: ToolArgSpec): ZodTypeAny {
  let base: ZodTypeAny;
  switch (arg.type) {
    case 'string':
      base = arg.enum && arg.enum.length > 0 ? z.enum(arg.enum as [string, ...string[]]) : z.string();
      break;
    case 'number':
      base = z.number();
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'object':
      base = z.any();
      break;
  }
  base = base.describe(arg.description);
  if (arg.required) return base;
  return arg.default !== undefined ? base.default(arg.default) : base.optional();
}

function schemaFromCatalog(spec: ToolSpec): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const arg of spec.args) shape[arg.name] = zodForArg(arg);
  return shape;
}

const SCHEMA_OVERRIDES: Partial<Record<string, ZodRawShape>> = {
  import_design_artifacts: {
    designId: z.string().describe('The Design id (cuid) - shown on the design page URL and in the continuation card'),
    handoffKey: z.string().optional().describe('Design handoff key; falls back to DESIGNFLOW_HANDOFF_KEY'),
    components: z
      .array(
        z.object({
          name: z.string(),
          category: z.string().describe('BUTTON, INPUT, CARD, NAVIGATION, MODAL, TABLE, FORM, LAYOUT, FEEDBACK or DATA_DISPLAY'),
          code: z.string(),
        }),
      )
      .optional(),
    pages: z
      .array(
        z.object({
          pageType: z
            .enum(['LANDING', 'PRICING', 'ABOUT', 'FEATURES', 'CONTACT', 'DASHBOARD', 'SETTINGS', 'DATA_TABLE', 'FORM', 'PROFILE', 'CUSTOM', 'BLOG', 'PRIVACY', 'TERMS'])
            .describe('Any PageType except MOOD_BOARD (the pipeline produces that one)'),
          title: z.string(),
          code: z.string(),
        }),
      )
      .optional(),
    assets: z
      .array(
        z.object({
          type: z.string().describe('e.g. SOCIAL_TEMPLATE, BANNER_AD, SLIDE_TEMPLATE'),
          name: z.string(),
          format: z.enum(['png', 'svg', 'webp', 'jpg']).default('png'),
          role: z.string().optional(),
          dataBase64: z.string().optional(),
          url: z.string().optional(),
          sourceCode: z.string().optional(),
        }),
      )
      .optional(),
    source: z
      .enum(['external-design-late', 'harness'])
      .optional()
      .describe('Producer label for the Pending review queue: "harness" when archiving from an external build harness onto a harness carrier (default external-design-late)'),
  },
};

function createHandlers({ origin, handoffKey: envKey }: LegacyOptions): Record<string, ToolHandler> {
  const call = (path: string, opts?: { key?: string; method?: string; body?: unknown }): Promise<unknown> => request(origin, path, opts);
  const keyFor = (explicit: unknown): string => resolveKey(envKey, explicit as string | undefined);
  return {
    'list_systems': async () => wrap(() => call('/api/v1/systems')),

    'get_system_adoption': async ({ name }) =>
      wrap(() => call(`/api/v1/systems/${encodeURIComponent(String(name))}/adoption`)),

    'get_system_tokens': async ({ name, format }) =>
      wrap(() =>
        call(`/api/systems/export/${encodeURIComponent(String(name))}?format=${format ?? 'globals-css'}`),
      ),

    'get_agent_prompt': async ({ name }) =>
      wrap(() => call(`/api/v1/systems/${encodeURIComponent(String(name))}/agent-prompt`)),

    'get_design_handoff': async ({ designId, handoffKey }) =>
      wrap(() => call(`/api/v1/designs/${designId}/handoff`, { key: keyFor(handoffKey) })),

    'get_design_prompt_pack': async ({ designId, handoffKey, pass, direction, with3d, format }) =>
      wrap(() =>
        call(promptPackPath(String(designId), { pass, direction, with3d, format } as PromptPackQuery), {
          key: keyFor(handoffKey),
        }),
      ),

    'import_design_artifacts': async ({ designId, handoffKey, components, pages, assets, source }) =>
      wrap(() =>
        call(`/api/v1/designs/${designId}/external-artifacts`, {
          method: 'POST',
          key: keyFor(handoffKey),
          body: { components, pages, assets, ...(source ? { source } : {}) },
        }),
      ),

    'finish_external_design': async ({ designId, handoffKey, acceptAll }) =>
      wrap(() =>
        call(`/api/v1/designs/${designId}/finish-external`, {
          method: 'POST',
          key: keyFor(handoffKey),
          body: { acceptAll },
        }),
      ),
  };
}

export function createLegacyServer(options: LegacyOptions): McpServer {
  const handlers = createHandlers(options);
  const server = new McpServer({ name: 'brandpilot', version: VERSION });
  for (const spec of TOOL_CATALOG) {
    const handler = handlers[spec.name];
    if (!handler) {
      throw new Error(`No handler registered for catalog tool "${spec.name}" - add one to createHandlers in src/legacy.ts`);
    }
    const shape = SCHEMA_OVERRIDES[spec.name] ?? schemaFromCatalog(spec);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.tool(spec.name, spec.summary, shape, handler as any);
  }
  return server;
}
