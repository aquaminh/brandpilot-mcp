/**
 * The single source of truth for every tool the BrandPilot MCP server
 * exposes. `scripts/mcp-server.ts` registers its tools by iterating this
 * array (never a hand-typed parallel list), `GET /api/v1/mcp/tools` (W2.1)
 * re-serves it as JSON, and `/docs` (W2.1) renders the tool table from it -
 * so the app, the deployed server and the public npm package (W2.2,
 * `packages/brandpilot-mcp/src/catalog.ts`, currently a byte-identical copy
 * pending publish) cannot describe three different tool lists.
 *
 * Kept deliberately flat and side-effect-free (no zod, no fetch) so it can
 * be imported by a stdio server, a route handler, and a static npm package
 * with zero shared runtime dependencies beyond plain TypeScript types.
 */

export type ToolArgType = 'string' | 'number' | 'boolean' | 'object';

export interface ToolArgSpec {
  /** Closed value set - rendered as a zod enum by the servers so a bad value is rejected client-side. */
  enum?: readonly string[];
  /** Applied when the arg is omitted (only meaningful with required: false). */
  default?: string | number | boolean;
  name: string;
  type: ToolArgType;
  required: boolean;
  description: string;
}

export interface ToolSpec {
  /** MCP tool name, e.g. "list_systems". */
  name: string;
  /** Short human title for docs/registry listings. */
  title: string;
  /** One or two sentences: what it returns and any auth/path caveat. */
  summary: string;
  /** 'none' = public; 'handoff-key' = design-scoped Bearer auth required. */
  auth: 'none' | 'handoff-key';
  args: ToolArgSpec[];
  /** REST path this tool calls, with {name}/{designId} placeholders. */
  endpoint: string;
  method: 'GET' | 'POST';
}

const nameArg: ToolArgSpec = {
  name: 'name',
  type: 'string',
  required: true,
  description: 'System name, public slug or alias (e.g. "launchwp")',
};

const designIdArg: ToolArgSpec = {
  name: 'designId',
  type: 'string',
  required: true,
  description: 'The Design id (cuid) - shown on the design page URL and in the continuation card',
};

const handoffKeyArg: ToolArgSpec = {
  name: 'handoffKey',
  type: 'string',
  required: false,
  description: 'Design handoff key; falls back to the DESIGNFLOW_HANDOFF_KEY environment variable',
};

export const TOOL_CATALOG: ToolSpec[] = [
  // ── Public system tools (no auth) ──
  {
    name: 'list_systems',
    title: 'List public design systems',
    summary: 'List the public design systems in the BrandPilot pool (name, slug, brand color, token count, status).',
    auth: 'none',
    args: [],
    endpoint: '/api/v1/systems',
    method: 'GET',
  },
  {
    name: 'get_system_adoption',
    title: 'Get a system adoption manifest',
    summary: 'Full adoption manifest for a public system: tokens, components, pages, brand asset URLs and the binding design-direction block.',
    auth: 'none',
    args: [nameArg],
    endpoint: '/api/v1/systems/{name}/adoption',
    method: 'GET',
  },
  {
    name: 'get_system_tokens',
    title: 'Export a system\'s tokens',
    summary: 'Export a public system\'s tokens in one format: globals-css, colors-ts, spacing-ts, typography-ts, tailwind-theme or brand-manifest. Calls the legacy /api/systems/export endpoint, not a v1 path - the export route has no v1 equivalent yet.',
    auth: 'none',
    args: [
      nameArg,
      {
        name: 'format',
        type: 'string',
        required: false,
        enum: ['globals-css', 'colors-ts', 'spacing-ts', 'typography-ts', 'tailwind-theme', 'brand-manifest'],
        default: 'globals-css',
        description: 'One of globals-css, colors-ts, spacing-ts, typography-ts, tailwind-theme, brand-manifest (default globals-css)',
      },
    ],
    endpoint: '/api/systems/export/{name}',
    method: 'GET',
  },
  {
    name: 'get_agent_prompt',
    title: 'Get the system agent-prompt doc',
    summary: 'Markdown onboarding doc for a public system: the two copy-paste prompts an external AI coding agent uses to bootstrap a design package and sync it to Claude Design.',
    auth: 'none',
    args: [nameArg],
    endpoint: '/api/v1/systems/{name}/agent-prompt',
    method: 'GET',
  },

  // ── Design-scoped continuation tools (Bearer handoffKey) ──
  {
    name: 'get_design_handoff',
    title: 'Get a design\'s continuation bundle',
    summary: 'The design\'s continuation bundle as JSON: brief, tokens, board digest, the continuation contract (hard floor first, then the latitude level), live inventory, coherence audit and the import contract. Available mid-flow (project paused at EXTERNAL_DESIGN) and post-completion.',
    auth: 'handoff-key',
    args: [designIdArg, handoffKeyArg],
    endpoint: '/api/v1/designs/{designId}/handoff',
    method: 'GET',
  },
  {
    name: 'get_design_prompt_pack',
    title: 'Get the design\'s Claude Design prompt pack',
    summary: 'The app-authored sequential Claude Design prompt pack (markdown): anchor sheet first, then template-aware component sheets and page prompts, each embedding the latitude contract in force. Regenerated from live data on every call.',
    auth: 'handoff-key',
    args: [designIdArg, handoffKeyArg],
    endpoint: '/api/v1/designs/{designId}/prompt-pack',
    method: 'GET',
  },
  {
    name: 'import_design_artifacts',
    title: 'Import externally designed artifacts',
    summary: 'Import externally designed work back into DesignFlow. Rows land as DRAFT on the carrier project\'s Deliverables tab for human review - nothing auto-approves. Components: self-contained HTML with inline styles. Pages: standalone HTML documents. Assets: PNG (base64 or URL) with optional sourceCode.',
    auth: 'handoff-key',
    args: [
      designIdArg,
      handoffKeyArg,
      { name: 'components', type: 'object', required: false, description: 'Array of { name, category, code } - self-contained component HTML' },
      { name: 'pages', type: 'object', required: false, description: 'Array of { pageType, title, code } - standalone page HTML, any PageType except MOOD_BOARD' },
      { name: 'assets', type: 'object', required: false, description: 'Array of { type, name, format, role?, dataBase64?, url?, sourceCode? }' },
      { name: 'source', type: 'string', required: false, description: 'Producer label for the Pending review queue: "harness" or "external-design-late" (default)' },
    ],
    endpoint: '/api/v1/designs/{designId}/external-artifacts',
    method: 'POST',
  },
  {
    name: 'finish_external_design',
    title: 'Finish a mid-flow external design run',
    summary: 'Validates that components and pages were imported, optionally accepts every pending imported draft, then resumes the pipeline at the coherence audit toward Design Review. Only valid while the project is paused at EXTERNAL_DESIGN.',
    auth: 'handoff-key',
    args: [
      designIdArg,
      handoffKeyArg,
      { name: 'acceptAll', type: 'boolean', required: false, description: 'Accept all pending external-import drafts in one stroke (default false)' },
    ],
    endpoint: '/api/v1/designs/{designId}/finish-external',
    method: 'POST',
  },
];
