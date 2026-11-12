import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {initializeEdition} from '../configure-edition.mjs';
test('edition initialization preserves existing module choices byte-for-byte',()=>{
 const root=mkdtempSync(join(tmpdir(),'eaios-edition-'));try{
 assert.equal(initializeEdition(root,'core'),true);const before=readFileSync(join(root,'modules.local.json'));
 assert.equal(initializeEdition(root,'full'),false);assert.deepEqual(readFileSync(join(root,'modules.local.json')),before);
 assert.throws(()=>initializeEdition(root,'invalid'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('piped core installer downloads its release and selects that version unless overridden',async()=>{
 const {execFileSync}=await import('node:child_process');const {writeFileSync,chmodSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'eaios-core-bootstrap-'));
 try{
  const version=JSON.parse(readFileSync(new URL('../../release-manifest.json',import.meta.url))).version;
  const curl=join(root,'curl');writeFileSync(curl,`#!/bin/bash
set -euo pipefail
url=''
while [[ $# -gt 0 ]]; do
 case "$1" in
  https://*) url="$1" ;;
  -o) shift; target="$1" ;;
 esac
 shift
done
[[ "$url" == "https://raw.githubusercontent.com/dmonistere123/EAiOS/v${version}/install/install.sh" ]]
printf '%s\\n' 'test "$EAIOS_EDITION" = core' 'test "$EAIOS_BRANCH" = "$EAIOS_TEST_EXPECTED_REF"' 'echo BOOTSTRAP_OK' > "$target"
`);chmodSync(curl,0o700);
  const source=readFileSync(new URL('../../install/install-core.sh',import.meta.url));
  for(const override of [undefined,'chosen-version']){
   const env={...process.env,PATH:root+':'+process.env.PATH,EAIOS_TEST_EXPECTED_REF:override??`v${version}`};
   delete env.EAIOS_BRANCH;if(override)env.EAIOS_BRANCH=override;
   const result=execFileSync('bash',[],{input:source,cwd:root,env,encoding:'utf8'});
   assert.match(result,/BOOTSTRAP_OK/);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
