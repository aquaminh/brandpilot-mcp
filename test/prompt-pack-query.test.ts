import { describe, expect, it } from 'vitest';
import { promptPackPath } from '../src/prompt-pack-query';

describe('promptPackPath', () => {
  it('sends no query for the v1 pack', () => {
    expect(promptPackPath('cd1')).toBe('/api/v1/designs/cd1/prompt-pack');
    expect(promptPackPath('cd1', { format: 'markdown' })).toBe('/api/v1/designs/cd1/prompt-pack');
  });

  it('keeps format=json on the v1 pack', () => {
    expect(promptPackPath('cd1', { format: 'json' })).toBe('/api/v1/designs/cd1/prompt-pack?format=json');
  });

  it('requests the explore pass, with the optional 3D prompt', () => {
    expect(promptPackPath('cd1', { pass: 'explore' })).toBe('/api/v1/designs/cd1/prompt-pack?pass=explore');
    expect(promptPackPath('cd1', { pass: 'explore', with3d: true, format: 'json' })).toBe(
      '/api/v1/designs/cd1/prompt-pack?pass=explore&with3d=1&format=json',
    );
  });

  it('url-encodes the trimmed lock direction', () => {
    expect(promptPackPath('cd1', { pass: 'lock', direction: '  Editorial & calm, 50/50 split  ' })).toBe(
      '/api/v1/designs/cd1/prompt-pack?pass=lock&direction=Editorial+%26+calm%2C+50%2F50+split',
    );
  });

  it('omits with3d when false', () => {
    expect(promptPackPath('cd1', { pass: 'explore', with3d: false })).toBe('/api/v1/designs/cd1/prompt-pack?pass=explore');
  });

  it('requests the copy map', () => {
    expect(promptPackPath('cd1', { format: 'copy-map' })).toBe('/api/v1/designs/cd1/prompt-pack?format=copy-map');
  });

  it('encodes the design id', () => {
    expect(promptPackPath('a/b?c')).toBe('/api/v1/designs/a%2Fb%3Fc/prompt-pack');
  });

  it('rejects lock without a direction, including a blank one', () => {
    expect(() => promptPackPath('cd1', { pass: 'lock' })).toThrow(/needs direction/);
    expect(() => promptPackPath('cd1', { pass: 'lock', direction: '   ' })).toThrow(/needs direction/);
  });

  // The route ignores direction and with3d without pass and serves v1, so a
  // caller would silently get the old pack - fail loudly instead.
  it('rejects direction or with3d without a pass', () => {
    expect(() => promptPackPath('cd1', { direction: 'Bold' })).toThrow(/only apply to a v2 pack/);
    expect(() => promptPackPath('cd1', { with3d: true })).toThrow(/only apply to a v2 pack/);
    expect(() => promptPackPath('cd1', { with3d: true, format: 'copy-map' })).toThrow(/only apply to a v2 pack/);
  });
});
