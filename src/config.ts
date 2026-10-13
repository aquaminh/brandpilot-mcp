/**
 * Picks the server mode from the environment, without side effects so the
 * choice is unit-testable.
 *
 *  - BRANDPILOT_API_KEY set: proxy mode. The stdio server forwards
 *    tools/list, tools/call, prompts/list and prompts/get to the hosted
 *    BrandPilot MCP (BRANDPILOT_MCP_URL) and relays the answers.
 *  - otherwise: legacy mode, the 0.2.x server (public tools plus the
 *    design-scoped tools behind DESIGNFLOW_HANDOFF_KEY). Setting the handoff
 *    key adds a one-line deprecation notice: legacy keys retire on
 *    LEGACY_KEY_SUNSET.
 *
 * Notices never contain a key value.
 */

export const DEFAULT_ORIGIN = 'https://brandpilot.dev';
/** Slightly above the hosted route's 60 s maxDuration, so its own timeout answer arrives first. */
export const DEFAULT_TIMEOUT_MS = 70_000;
/** The handoff-key sunset (DesignFlow HANDOFF_SUNSET). */
export const LEGACY_KEY_SUNSET = '2027-01-31';

export interface ProxyConfig {
  mode: 'proxy';
  apiKey: string;
  url: string;
  timeoutMs: number;
  notices: string[];
}

export interface LegacyConfig {
  mode: 'legacy';
  origin: string;
  handoffKey?: string;
  notices: string[];
}

export type ServerConfig = ProxyConfig | LegacyConfig;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The hosted endpoint, refusing plain http except on loopback so the key never travels unencrypted. */
export function resolveMcpUrl(env: NodeJS.ProcessEnv): string {
  const origin = nonEmpty(env.BRANDPILOT_ORIGIN) ?? DEFAULT_ORIGIN;
  const raw = nonEmpty(env.BRANDPILOT_MCP_URL) ?? `${origin.replace(/\/+$/, '')}/api/mcp`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`BRANDPILOT_MCP_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(`BRANDPILOT_MCP_URL must use https (plain http is allowed only for localhost): ${url.origin}`);
  }
  return url.toString();
}

function resolveTimeout(env: NodeJS.ProcessEnv): number {
  const raw = nonEmpty(env.BRANDPILOT_TIMEOUT_MS);
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 1_000 || ms > 600_000) {
    throw new Error(`BRANDPILOT_TIMEOUT_MS must be a whole number of milliseconds between 1000 and 600000, got ${raw}`);
  }
  return ms;
}

export function resolveConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const apiKey = nonEmpty(env.BRANDPILOT_API_KEY);
  const handoffKey = nonEmpty(env.DESIGNFLOW_HANDOFF_KEY);

  if (apiKey) {
    const notices = handoffKey ? ['DESIGNFLOW_HANDOFF_KEY is ignored because BRANDPILOT_API_KEY is set; you can remove it.'] : [];
    return { mode: 'proxy', apiKey, url: resolveMcpUrl(env), timeoutMs: resolveTimeout(env), notices };
  }

  const notices = handoffKey
    ? [
        `DESIGNFLOW_HANDOFF_KEY is deprecated and stops working on ${LEGACY_KEY_SUNSET}: create a workspace API key in BrandPilot (Settings, API keys) and set BRANDPILOT_API_KEY instead.`,
      ]
    : [];
  return { mode: 'legacy', origin: nonEmpty(env.BRANDPILOT_ORIGIN) ?? DEFAULT_ORIGIN, handoffKey, notices };
}
