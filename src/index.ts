#!/usr/bin/env node
/**
 * brandpilot-mcp: the stdio MCP server for BrandPilot.
 *
 * Two modes, picked from the environment by ./config:
 *  - BRANDPILOT_API_KEY set: a thin proxy onto the hosted BrandPilot MCP
 *    (BRANDPILOT_MCP_URL, default https://brandpilot.dev/api/mcp), which owns
 *    the tool catalog (./proxy).
 *  - otherwise: the 0.2.x server (./legacy), public tools plus the
 *    design-scoped tools behind the deprecated DESIGNFLOW_HANDOFF_KEY.
 *
 * Env: BRANDPILOT_API_KEY, BRANDPILOT_MCP_URL, BRANDPILOT_TIMEOUT_MS,
 * BRANDPILOT_ORIGIN, DESIGNFLOW_HANDOFF_KEY. Key values are never printed.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfig } from './config.js';
import { createLegacyServer } from './legacy.js';
import { createProxyServer } from './proxy.js';
import { TOOL_CATALOG } from './catalog.js';

async function main(): Promise<void> {
  const config = resolveConfig(process.env);
  for (const notice of config.notices) console.error(`[brandpilot-mcp] ${notice}`);

  const transport = new StdioServerTransport();
  if (config.mode === 'proxy') {
    await createProxyServer(config).connect(transport);
    console.error(`[brandpilot-mcp] connected, proxying to ${config.url}`);
  } else {
    await createLegacyServer({ origin: config.origin, handoffKey: config.handoffKey }).connect(transport);
    console.error(`[brandpilot-mcp] connected (${config.origin}), ${TOOL_CATALOG.length} legacy tools; set BRANDPILOT_API_KEY for the hosted tools`);
  }
}

main().catch((err) => {
  console.error('[brandpilot-mcp] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
