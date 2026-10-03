/**
 * Builds the request path for `get_design_prompt_pack`. Kept apart from
 * `index.ts` (which connects stdio on import) so it is unit-testable.
 *
 * The route (`/api/v1/designs/{id}/prompt-pack` in the DesignFlow app)
 * serves the v1 pack when `pass` is absent and silently ignores `direction`
 * and `with3d` there, so an agent that sent them without `pass` would get
 * v1 while believing it asked for v2 - this rejects that combination
 * locally instead. `pass=lock` without a direction is rejected the same
 * way the route would (400), one round trip earlier.
 */

export interface PromptPackQuery {
  pass?: 'explore' | 'lock';
  direction?: string;
  with3d?: boolean;
  format?: 'markdown' | 'json' | 'copy-map';
}

export function promptPackPath(designId: string, query: PromptPackQuery = {}): string {
  const direction = query.direction?.trim() || undefined;
  if (!query.pass && (direction !== undefined || query.with3d)) {
    throw new Error('direction and with3d only apply to a v2 pack: set pass to "explore" or "lock" (omit all three for the v1 pack).');
  }
  if (query.pass === 'lock' && direction === undefined) {
    throw new Error('pass "lock" needs direction: the direction chosen from the explore pass.');
  }

  const params = new URLSearchParams();
  if (query.pass) params.set('pass', query.pass);
  if (direction !== undefined) params.set('direction', direction);
  if (query.with3d) params.set('with3d', '1');
  if (query.format && query.format !== 'markdown') params.set('format', query.format);

  const qs = params.toString();
  return `/api/v1/designs/${encodeURIComponent(designId)}/prompt-pack${qs ? `?${qs}` : ''}`;
}
