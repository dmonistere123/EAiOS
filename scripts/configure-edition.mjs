#!/usr/bin/env node
import {openSync,writeFileSync,closeSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function initializeEdition(root,edition){
 if(!['core','full'].includes(edition))throw new Error('Edition must be core or full');
 mkdirSync(root,{recursive:true});const file=join(root,'modules.local.json');
 if(existsSync(file))return false;
 const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,JSON.stringify({edition,addons:[]},null,2)+'\n');}finally{closeSync(fd);}return true;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 const root=process.argv[2],edition=process.argv[3];if(!root)throw new Error('Usage: configure-edition.mjs DATA_ROOT core|full');
 console.log(initializeEdition(resolve(root),edition)?'Module edition initialized.':'Existing module selection preserved.');
}
