#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {installRelease} from './install-release.mjs';
async function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node scripts/install-package.mjs [--root PATH]\nRun on the standard 2EP installation as its own user, not root.');return;
  }
  if(args.length!==0&&(args.length!==2||args[0]!=='--root'||!args[1]))throw Error('Expected --root PATH or no arguments.');
  if(process.getuid?.()===0)throw Error('Run this as the user who owns 2EP, not root.');
  const base=dirname(dirname(fileURLToPath(import.meta.url)));
  const meta=JSON.parse(readFileSync(join(base,'package.json'),'utf8'));
  const bundle=join(base,'2EP.bundle');
  const digest=createHash('sha256').update(readFileSync(bundle)).digest('hex');
  if(digest!==meta.sha256)throw Error('The update bundle failed its integrity check.');
  const repoRoot=resolve(args[1]||process.env.EAIOS_REPO_ROOT||join(homedir(),'eaios'));
  const dataRoot=resolve(process.env.EAIOS_DATA_ROOT||repoRoot);
  const result=await installRelease('local:'+meta.tag,{repoRoot,dataRoot,codeRoot:repoRoot,localBundle:bundle,localTag:meta.tag,localSha:meta.commit});
  if(!result.ok)throw Error(result.error);
  console.log('2EP '+meta.tag+' installed. Both dashboard versions verified. Persistent data was retained.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
