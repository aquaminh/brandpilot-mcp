import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS, LEGACY_KEY_SUNSET, resolveConfig } from '../src/config';

const API_KEY = 'bp_live_secret_value_123';
const HANDOFF = 'legacy-handoff-secret-456';

describe('resolveConfig', () => {
  it('proxies to the hosted MCP when BRANDPILOT_API_KEY is set', () => {
    const config = resolveConfig({ BRANDPILOT_API_KEY: API_KEY });
    expect(config).toEqual({ mode: 'proxy', apiKey: API_KEY, url: 'https://brandpilot.dev/api/mcp', timeoutMs: DEFAULT_TIMEOUT_MS, notices: [] });
  });

  it('keeps the 0.2.x legacy server with only the handoff key, plus one deprecation notice', () => {
    const config = resolveConfig({ DESIGNFLOW_HANDOFF_KEY: HANDOFF });
    expect(config.mode).toBe('legacy');
    if (config.mode !== 'legacy') return;
    expect(config.handoffKey).toBe(HANDOFF);
    expect(config.origin).toBe('https://brandpilot.dev');
    expect(config.notices).toHaveLength(1);
    expect(config.notices[0]).toContain('deprecated');
    expect(config.notices[0]).toContain(LEGACY_KEY_SUNSET);
    expect(config.notices[0]).toContain('BRANDPILOT_API_KEY');
  });

  it('serves the public legacy tools with no key and no deprecation notice', () => {
    expect(resolveConfig({})).toEqual({ mode: 'legacy', origin: 'https://brandpilot.dev', handoffKey: undefined, notices: [] });
  });

  it('treats a blank API key as unset', () => {
    expect(resolveConfig({ BRANDPILOT_API_KEY: '  ' }).mode).toBe('legacy');
  });

  it('prefers the API key when both keys are set and says the handoff key is ignored', () => {
    const config = resolveConfig({ BRANDPILOT_API_KEY: API_KEY, DESIGNFLOW_HANDOFF_KEY: HANDOFF });
    expect(config.mode).toBe('proxy');
    expect(config.notices).toHaveLength(1);
    expect(config.notices[0]).toContain('ignored');
  });

  it('never puts a key value in a notice', () => {
    for (const env of [{ DESIGNFLOW_HANDOFF_KEY: HANDOFF }, { BRANDPILOT_API_KEY: API_KEY, DESIGNFLOW_HANDOFF_KEY: HANDOFF }]) {
      for (const notice of resolveConfig(env).notices) {
        expect(notice).not.toContain(HANDOFF);
        expect(notice).not.toContain(API_KEY);
      }
    }
  });

  it('honours BRANDPILOT_MCP_URL, then BRANDPILOT_ORIGIN, for the hosted endpoint', () => {
    expect(resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_MCP_URL: 'https://staging.example.com/api/mcp' })).toMatchObject({
      url: 'https://staging.example.com/api/mcp',
    });
    expect(resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_ORIGIN: 'http://localhost:3005/' })).toMatchObject({
      url: 'http://localhost:3005/api/mcp',
    });
  });

  it('refuses plain http outside loopback so the key never travels unencrypted', () => {
    expect(() => resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_MCP_URL: 'http://example.com/api/mcp' })).toThrow(/https/);
    expect(() => resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_MCP_URL: 'not a url' })).toThrow(/valid URL/);
    expect(resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_MCP_URL: 'http://127.0.0.1:9/api/mcp' }).mode).toBe('proxy');
  });

  it('validates BRANDPILOT_TIMEOUT_MS', () => {
    expect(resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_TIMEOUT_MS: '5000' })).toMatchObject({ timeoutMs: 5000 });
    expect(() => resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_TIMEOUT_MS: 'soon' })).toThrow(/BRANDPILOT_TIMEOUT_MS/);
    expect(() => resolveConfig({ BRANDPILOT_API_KEY: API_KEY, BRANDPILOT_TIMEOUT_MS: '10' })).toThrow(/BRANDPILOT_TIMEOUT_MS/);
  });
});
