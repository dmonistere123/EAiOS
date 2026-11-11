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

test('core installer works via stdin without running a real installation',async()=>{
 const {execFileSync}=await import('node:child_process');const {writeFileSync,chmodSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'eaios-core-bootstrap-'));
 try{
  const curl=join(root,'curl');writeFileSync(curl,`#!/bin/bash\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == '-o' ]]; then shift; target="$1"; fi; shift; done\nprintf '%s\\n' 'test "$EAIOS_EDITION" = core' 'test "$EAIOS_BRANCH" = v0.1.15' 'echo BOOTSTRAP_OK' > "$target"\n`);chmodSync(curl,0o700);
  const source=readFileSync(new URL('../../install/install-core.sh',import.meta.url));
  const result=execFileSync('bash',[],{input:source,cwd:root,env:{...process.env,EAIOS_BRANCH:'v0.1.15',PATH:root+':'+process.env.PATH},encoding:'utf8'});
  assert.match(result,/BOOTSTRAP_OK/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
