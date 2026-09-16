#!/usr/bin/env node
/**
 * Generate app/public/version.json at build time.
 * Captures the package version, git SHA/branch/tag, release channel, and build
 * timestamp so the EAiOS Settings page and /api/version endpoint can report
 * what is running.
 *
 * Run from the repo root:
 *   node scripts/generate-version.mjs
 *
 * The generated file is copied into dist/ by Vite's public-dir handling.
 * It is gitignored; CI/build must run this script before `vite build`.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outFile = join(repoRoot, 'app', 'public', 'version.json');

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: repoRoot, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gitTag() {
  // Exact tag on current commit, or nearest reachable semver tag.
  const exact = git('tag --points-at HEAD');
  if (exact) return exact.split('\n')[0];
  const nearest = git('describe --tags --abbrev=0 --match "v*"');
  return nearest || '';
}

function releaseChannel() {
  const exact = git('tag --points-at HEAD');
  if (exact) return 'stable';
  const describe = git('describe --tags --long --match "v*"');
  // describe output like v0.1.0-5-gabc1234 means 5 commits after tag.
  const m = describe.match(/-(\d+)-g[0-9a-f]+$/);
  if (m && Number(m[1]) <= 10) return 'rc';
  return 'dev';
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(repoRoot, 'app', 'package.json'), 'utf8'));
} catch {
  pkg = { version: '0.0.0' };
}

const version = {
  version: pkg.version || '0.0.0',
  gitSha: git('rev-parse --short HEAD'),
  gitBranch: git('rev-parse --abbrev-ref HEAD'),
  gitTag: gitTag(),
  releaseChannel: releaseChannel(),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(version, null, 2) + '\n');
console.log(`version.json → ${outFile}`);
