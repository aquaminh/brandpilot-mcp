# brandpilot-mcp

MCP server for [BrandPilot](https://brandpilot.dev) (DesignFlow): browse the
public design-system pool, pull a design's continuation bundle and Claude
Design prompt pack, import externally designed work back, and finish a
mid-flow external design run - natively from Claude Code, Claude Desktop,
Cursor, or any other MCP-capable agent.

It is a thin HTTP wrapper over BrandPilot's public `v1` API. No database
access, no credentials required for the public tools - any machine with
network access to `brandpilot.dev` can run it.

> **Not published yet.** The source will live in the public
> `aquaminh/brandpilot-mcp` repo once the owner creates it; nothing is on
> npm yet - the "BrandPilot" name is pending a trademark search. See
> `docs/mcp-listing.md` in the DesignFlow app repo for the gate. Once
> published, install with `npx brandpilot-mcp` as shown below.

## Install

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "brandpilot": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "brandpilot-mcp"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "brandpilot": {
      "command": "npx",
      "args": ["-y", "brandpilot-mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "brandpilot": {
      "command": "npx",
      "args": ["-y", "brandpilot-mcp"]
    }
  }
}
```

## Tools

The public tools need no account or API key - the curated public pool is
open to any MCP client. Design-scoped tools need a handoff key (see below).

| Tool | Auth | What it does |
|------|------|---------------|
| `list_systems` | none | List public design systems (name, slug, brand color, token count, status) |
| `get_system_adoption` | none | Full adoption manifest for a public system: tokens, components, pages, brand assets, direction |
| `get_system_tokens` | none | Export a system's tokens (globals-css, colors-ts, spacing-ts, typography-ts, tailwind-theme, brand-manifest) |
| `get_agent_prompt` | none | Markdown onboarding doc with copy-paste prompts for bootstrapping a design package |
| `get_design_handoff` | handoff key | A design's continuation bundle: brief, tokens, board digest, continuation contract, inventory, coherence audit |
| `get_design_prompt_pack` | handoff key | The sequential Claude Design prompt pack for continuing a design |
| `import_design_artifacts` | handoff key | Import externally designed components/pages/assets back as DRAFT for review |
| `finish_external_design` | handoff key | Resume a mid-flow external design run at the coherence audit |

## The handoff key

Design-scoped tools (`get_design_handoff`, `get_design_prompt_pack`,
`import_design_artifacts`, `finish_external_design`) require a Bearer key
scoped to one design. Mint or view it from the design page
(`/designs/<id>`, section "Continue this design", "Copy API key").

Pass it either as an environment variable when launching the server:

```json
{
  "mcpServers": {
    "brandpilot": {
      "command": "npx",
      "args": ["-y", "brandpilot-mcp"],
      "env": {
        "DESIGNFLOW_HANDOFF_KEY": "your-key-here"
      }
    }
  }
}
```

or as a per-call `handoffKey` argument, which overrides the environment
variable for that one call.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BRANDPILOT_ORIGIN` | `https://brandpilot.dev` | Target origin - override to point at a local dev server |
| `DESIGNFLOW_HANDOFF_KEY` | (none) | Default Bearer key for design-scoped tools |

## Local development

```bash
npm install
npm run build
npm test
```

`npm link` then a `.mcp.json` pointing at the linked bin is the fastest way
to verify against a live server: confirm `list_systems` returns the curated
pool and nothing private.
