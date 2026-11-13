import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { keyContext, type KeyContext } from './apiKeys.ts';
import { displayName } from '../src/domain/identity.ts';

/** Read the serving box's configuration, including the installer's preserved env symlink.
 * Only these public display names are returned; credentials never enter the response.
 * The active release's env takes precedence over the persistent data checkout.
 */
export function boxIdentity(ctx = keyContext.getStore()) {
  const values: Record<string, string> = {};
  const roots = ctx ? [...new Set([ctx.eaiosRoot, ctx.dataRoot].filter(Boolean))] : [];
  for (const root of roots) {
    try {
      const env = parseEnv(readFileSync(join(root!, 'app', '.env.local'), 'utf8'));
      for (const key of ['VITE_AGENT_NAME', 'VITE_EXECUTIVE_NAME']) {
        if (!values[key] && env[key]?.trim()) values[key] = env[key];
      }
    } catch { /* Environment-only installs and fresh boxes may have no file. */ }
  }
  return {
    assistantName: displayName(values.VITE_AGENT_NAME || process.env.EAIOS_AGENT_NAME || process.env.VITE_AGENT_NAME),
    executiveName: displayName(values.VITE_EXECUTIVE_NAME || process.env.VITE_EXECUTIVE_NAME, 'Executive'),
  };
}

export function assistantName(ctx?: KeyContext): string {
  return boxIdentity(ctx).assistantName;
}
