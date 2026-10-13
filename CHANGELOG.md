# Changelog

## 0.3.1 - 2026-10-13

### Changed

- Tool summaries and package metadata name the product BrandPilot only.

## 0.3.0 - 2026-10-13

### Added

- Proxy mode: with `BRANDPILOT_API_KEY` set, the stdio server forwards `tools/list`, `tools/call`, `prompts/list` and `prompts/get` to the hosted BrandPilot MCP (`BRANDPILOT_MCP_URL`, default `https://brandpilot.dev/api/mcp`) and relays the answers, so the tool list is the one BrandPilot serves (`whoami`, `list_brands`, `get_design_context`, `get_repo_rules_pack`, `get_claude_design_kit`, `finish_external_design` and the deprecated aliases) and new tools need no package release.
- Clear errors for a rejected key (401), a missing scope (403), a hosted MCP that is not enabled (404), rate limits (429), timeouts (`BRANDPILOT_TIMEOUT_MS`, default 70 s) and unreachable hosts. A failed `tools/call` comes back as a tool error the agent can read.
- `BRANDPILOT_MCP_URL` must be https except on localhost, so the key never travels unencrypted.
- README section "Connect with an API key" with Claude Code, Codex and Cursor setup.

### Changed

- Without `BRANDPILOT_API_KEY` the server behaves as 0.2.0 (legacy mode). Setting `DESIGNFLOW_HANDOFF_KEY` now prints one deprecation line to stderr: legacy handoff keys stop working on 2027-01-31.
- The server reports the package version in its handshake (read from `package.json`).

### Unchanged

- The `brandpilot-mcp/catalog` export (the eight legacy tools) is kept as-is for existing consumers.
- Key values are never logged.

## 0.2.0 - 2026-10-03

- `get_design_prompt_pack` takes `pass`, `direction`, `with3d` and `format` for the v2 prompt pack and the copy map.

## 0.1.0 - 2026-09-17

- First release: public design-system tools and the design-scoped handoff tools over the BrandPilot REST API.
