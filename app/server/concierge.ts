import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONCIERGE_PROFILE, validConciergeContext } from '../src/domain/concierge.ts';
import type { ConciergeContext } from '../src/domain/concierge.ts';

/** One fixed packaged SOUL only. No user paths, retrieval, provider calls or writes. */
export function readConciergeContext(eaiosRoot: string, hermesHome: string): ConciergeContext {
  const root = join(eaiosRoot, 'concierge');
  const instructions = readFileSync(join(root, 'SOUL.md'), 'utf8');
  const profileRoot = join(hermesHome, 'profiles', CONCIERGE_PROFILE);
  const marker = JSON.parse(readFileSync(join(profileRoot, 'eaios-concierge.json'), 'utf8'));
  if (marker.schema !== 1 || marker.profile !== CONCIERGE_PROFILE
    || readFileSync(join(profileRoot, 'SOUL.md'), 'utf8') !== instructions) {
    throw new Error('Concierge profile needs reviewed setup');
  }
  const revision = createHash('sha256').update(instructions).digest('hex');
  const context: ConciergeContext = { profile: CONCIERGE_PROFILE, revision, instructions };
  if (!validConciergeContext(context)) throw new Error('Concierge documents unavailable');
  return context;
}
