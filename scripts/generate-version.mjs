#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function generateVersion(repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')) {
  function git(...args) {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  }
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'app', 'package.json'), 'utf8'));
  const dirty = git('status', '--porcelain').length > 0;
  const exact = git('tag', '--points-at', 'HEAD').split('\n').filter(t => /^v\d+\.\d+\.\d+$/.test(t));
  const gitTag = exact.find(t => t === `v${pkg.version}`);
  const version = {
    version: pkg.version,
    gitSha: git('rev-parse', 'HEAD'),
    gitBranch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    ...(gitTag ? { gitTag } : {}),
    dirty,
    releaseChannel: gitTag && !dirty ? 'stable' : 'dev',
    builtAt: new Date().toISOString(),
  };
  const outFile = join(repoRoot, 'app', 'public', 'version.json');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(version, null, 2) + '\n');
  return version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { generateVersion(); console.log('Generated version.json'); }
  catch (error) { console.error(`Version generation failed: ${error.message}`); process.exitCode = 1; }
}
