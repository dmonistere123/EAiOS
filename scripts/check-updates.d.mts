import type { ReleaseUpdateInfo, PublishedRelease } from '../app/src/domain/types.ts';
export interface UpdateOptions {
  hermesHome?: string; codeRoot?: string; dataRoot?: string; repoRoot?: string;
  repository?: string; stateDir?: string; releasesDir?: string;
  fetcher?: typeof fetch;
}
export const WEEK_MS: number;
export function updateOptions(options?: UpdateOptions): UpdateOptions & Required<Pick<UpdateOptions, 'codeRoot' | 'dataRoot' | 'repoRoot' | 'stateDir' | 'hermesHome' | 'repository' | 'releasesDir'>>;
export function checkUpdates(options?: UpdateOptions): Promise<Partial<ReleaseUpdateInfo>>;
export function getUpdateStatus(options: UpdateOptions, currentVersion: string): ReleaseUpdateInfo;
export function atomicJson(path: string, value: unknown): void;
export function readJson(path: string, fallback?: unknown): unknown;
export function githubJson(path: string, options?: UpdateOptions): Promise<unknown>;
export function normalizeRelease(value: unknown, repository: string): PublishedRelease;
export function compareVersions(a: string, b: string): number;
