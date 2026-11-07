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
