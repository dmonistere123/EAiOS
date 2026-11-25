#!/usr/bin/env node
/** Builds separate release assets from a clean tagged commit. Never installs. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const tag=git('describe','--tags','--exact-match','HEAD');
if(!/^v\d+\.\d+\.\d+$/.test(tag)||git('status','--porcelain'))throw Error('Commit and tag a clean stable release first.');
const commit=git('rev-parse','HEAD');
const out=resolve(process.argv[2]??join(root,'.local','distribution'));mkdirSync(out,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'2ep-distribution-'));
try{
 const name='2EP-'+tag+'-existing-box-update',pkg=join(temp,name);mkdirSync(join(pkg,'scripts'),{recursive:true});
 for(const file of ['install-package.mjs','install-release.mjs','check-updates.mjs'])copyFileSync(join(root,'scripts',file),join(pkg,'scripts',file));
 const bundle=join(pkg,'2EP.bundle');git('bundle','create',bundle,'refs/tags/'+tag);
 const sha256=createHash('sha256').update(readFileSync(bundle)).digest('hex');
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name,tag,commit,sha256,type:'module'},null,2)+'\n');
 writeFileSync(join(pkg,'UPDATE-2EP.sh'),'#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\nexec node scripts/install-package.mjs "$@"\n',{mode:0o755});
 writeFileSync(join(pkg,'README.txt'),`2EP ${tag} — EXISTING-BOX UPDATE\n\nExtract this archive, then run bash UPDATE-2EP.sh as the user who owns 2EP.\nFor a nondefault installation: bash UPDATE-2EP.sh --root /path/to/eaios\nNode 24+, git, npm, uv, ffmpeg, ffprobe and internet for dependencies are required.\nThis uses the standard backup, build, health-check and rollback updater.\nIt preserves existing Core/Full edition, optional modules, assistant identity, credentials and data.\nIt refuses customized/personal installations and unexpected service overrides.\nThis is NOT a fresh installer and does not include Moxie.\nFresh machines: use the separate Bare Bones or Complete installer.\n`);
 const files=[name+'.zip','2EP-'+tag+'-bare-bones-installer.sh','2EP-'+tag+'-complete-installer.sh'];
 execFileSync('zip',['-q','-r',join(out,files[0]),name],{cwd:temp});
 copyFileSync(join(root,'install/install-bare-bones.sh'),join(out,files[1]));
 copyFileSync(join(root,'install/install-complete.sh'),join(out,files[2]));
 writeFileSync(join(out,'SHA256SUMS.txt'),files.map(f=>createHash('sha256').update(readFileSync(join(out,f))).digest('hex')+'  '+f).join('\n')+'\n');
 console.log(out);
}finally{rmSync(temp,{recursive:true,force:true});}
