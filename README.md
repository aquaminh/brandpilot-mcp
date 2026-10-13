# brandpilot-mcp

MCP server for [BrandPilot](https://brandpilot.dev) (DesignFlow): bring a brand into your coding agent - list your brands, read a design's context and continuation contract, install its repo rules pack and tokens, and fetch its Claude Design kit - natively from Claude Code, Codex, Cursor, Claude Desktop or any other MCP client.

The package runs in one of two modes:

- **With a workspace API key** (`BRANDPILOT_API_KEY`): a thin stdio proxy onto the hosted BrandPilot MCP at `https://brandpilot.dev/api/mcp`. Every `tools/list`, `tools/call`, `prompts/list` and `prompts/get` is forwarded and the answer relayed, so the tool list is always the one BrandPilot serves today - new tools arrive without a package update.
- **Without one**: the legacy 0.2.x server - the public design-system tools, plus the design-scoped tools behind a per-design handoff key (deprecated, see [Legacy handoff keys](#legacy-handoff-keys)).

It never touches a database; any machine with network access to `brandpilot.dev` can run it. Requires Node.js 20 or newer.

## Connect with an API key

Create a workspace API key in BrandPilot under **Settings, API keys**. It starts with `bp_live_`. Replace `bp_live_your_key_here` below with it, and keep it out of committed files.

### Claude Code

```bash
claude mcp add brandpilot --scope user -e BRANDPILOT_API_KEY=bp_live_your_key_here -- npx -y brandpilot-mcp
```

Then run `/mcp` in Claude Code to confirm `brandpilot` is connected, and ask "Ask BrandPilot who I am and list my brands".

### Codex

```bash
codex mcp add brandpilot --env BRANDPILOT_API_KEY=bp_live_your_key_here -- npx -y brandpilot-mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.brandpilot]
command = "npx"
args = ["-y", "brandpilot-mcp"]

[mcp_servers.brandpilot.env]
BRANDPILOT_API_KEY = "bp_live_your_key_here"
```

To keep the key out of the file, export `BRANDPILOT_API_KEY` in your shell and use `env_vars = ["BRANDPILOT_API_KEY"]` in place of the `env` table.

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "brandpilot": {
      "command": "npx",
      "args": ["-y", "brandpilot-mcp"],
      "env": {
        "BRANDPILOT_API_KEY": "bp_live_your_key_here"
      }
    }
  }
}
```

### Any other MCP client

Run `npx -y brandpilot-mcp` as a stdio server with `BRANDPILOT_API_KEY` in its environment. The same shape works in Claude Desktop's `claude_desktop_config.json`.

### What the errors mean

| Message | Cause | Fix |
|---------|-------|-----|
| BrandPilot rejected the API key (HTTP 401) | The key is mistyped, expired or revoked | Create a new key and restart the server |
| The API key does not have the permission this call needs (HTTP 403) | The key lacks a scope (for example a read-only key calling `finish_external_design`) | Use a key with that scope |
| The hosted BrandPilot MCP is not enabled (HTTP 404) | The hosted MCP is not switched on for that BrandPilot instance yet | Unset `BRANDPILOT_API_KEY` to use the legacy tools meanwhile, or check `BRANDPILOT_MCP_URL` |
| did not answer within N s | The hosted call took longer than `BRANDPILOT_TIMEOUT_MS` | Retry; raise the timeout for slow calls |

The key is sent only in the `Authorization` header and is never printed, including in error messages and on stderr.

## Tools

In API-key mode the tools and prompts come from the hosted server (`whoami`, `list_brands`, `get_design_context`, `get_repo_rules_pack`, `get_claude_design_kit`, `finish_external_design` and more, plus the deprecated aliases below); the current list is at `https://brandpilot.dev/api/v1/mcp/tools` and on [brandpilot.dev/docs](https://brandpilot.dev/docs). A good first call is `whoami`.

The legacy mode serves these eight tools:

| Tool | Auth | What it does |
|------|------|---------------|
| `list_systems` | none | List public design systems (name, slug, brand color, token count, status) |
| `get_system_adoption` | none | Full adoption manifest for a public system: tokens, components, pages, brand assets, direction |
| `get_system_tokens` | none | Export a system's tokens (globals-css, colors-ts, spacing-ts, typography-ts, tailwind-theme, brand-manifest) |
| `get_agent_prompt` | none | Markdown onboarding doc with copy-paste prompts for bootstrapping a design package |
| `get_design_handoff` | handoff key | A design's continuation bundle: brief, tokens, board digest, continuation contract, inventory, coherence audit |
| `get_design_prompt_pack` | handoff key | The sequential Claude Design prompt pack for continuing a design: v1 by default, the v2 explore/lock passes with `pass`, or the copy map |
| `import_design_artifacts` | handoff key | Import externally designed components/pages/assets back as DRAFT for review |
| `finish_external_design` | handoff key | Resume a mid-flow external design run at the coherence audit |

On the hosted server, `list_systems`, `get_agent_prompt` and `get_design_handoff` are deprecated aliases of `list_brands`, `get_repo_rules_pack` and `get_design_context`.

## Prompt pack v2

`get_design_prompt_pack` returns the v1 pack when called with only `designId`. The v2 pack runs in two passes in one Claude Design project:

1. `pass: "explore"` - every surface asks for 2-3 clearly different directions with a short critique. Add `with3d: true` for one 3D Objects prompt.
2. `pass: "lock", direction: "<the direction you picked>"` - every surface is built in the chosen direction (max 2000 characters, required for this pass).

`format: "json"` returns the structured pack instead of markdown, and `format: "copy-map"` returns the copy map the v2 pack lists as a project file. `direction` and `with3d` without a `pass` are rejected rather than silently returning v1.

## Legacy handoff keys

Legacy per-design handoff keys are deprecated and **stop working on 2027-01-31**. Move to a workspace API key: one key covers every design in the workspace.

Until then, the legacy design-scoped tools (`get_design_handoff`, `get_design_prompt_pack`, `import_design_artifacts`, `finish_external_design`) accept a Bearer key scoped to one design, minted on the design page (`/designs/<id>`, section "Continue this design", "Copy API key"). Pass it as `DESIGNFLOW_HANDOFF_KEY` in the server's environment, or as a per-call `handoffKey` argument, which overrides the environment variable for that one call. When `DESIGNFLOW_HANDOFF_KEY` is set the server prints one deprecation line to stderr at startup. When `BRANDPILOT_API_KEY` is also set, the API key wins and the handoff key is ignored.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BRANDPILOT_API_KEY` | (none) | Workspace API key; turns on proxy mode |
| `BRANDPILOT_MCP_URL` | `${BRANDPILOT_ORIGIN}/api/mcp` | Hosted MCP endpoint in proxy mode. Must be https, except on localhost |
| `BRANDPILOT_TIMEOUT_MS` | `70000` | Per-request timeout in proxy mode (1000 to 600000) |
| `BRANDPILOT_ORIGIN` | `https://brandpilot.dev` | Origin for the legacy tools, and the base of the default `BRANDPILOT_MCP_URL` - override to point at a local dev server |
| `DESIGNFLOW_HANDOFF_KEY` | (none) | Deprecated default Bearer key for the legacy design-scoped tools |

## Local development

```bash
npm install
npm run build
npm test
```

`npm link` then an MCP config pointing at the linked bin is the fastest way to verify against a live server: in API-key mode confirm `whoami` names your workspace; without a key confirm `list_systems` returns the curated pool and nothing private.

See [CHANGELOG.md](CHANGELOG.md) for release notes.
