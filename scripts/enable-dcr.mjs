#!/usr/bin/env node
import {copyFileSync,constants,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.argv[2]==='--help'){console.log('Usage: node scripts/enable-dcr.mjs EXISTING_DATA_ROOT\nCreates the local example policy without replacing an existing one. Configure your dashboard origin and source accounts separately.');process.exit(0);}
const data=process.argv[2]||process.env.EAIOS_DATA_ROOT;
if(!data||process.argv.length>3){console.error('Usage: node scripts/enable-dcr.mjs EXISTING_DATA_ROOT');process.exit(2);}
const target=join(resolve(data),'dcr.local.json');
process.umask(0o077);
try{
 copyFileSync(fileURLToPath(new URL('../config/dcr.example.json',import.meta.url)),target,constants.COPYFILE_EXCL);
 chmodSync(target,0o600);console.log('DCR enabled for the local executive dashboards. AI and background scanning remain off.');
}catch(e){if(e.code==='EEXIST')console.log('Existing DCR configuration preserved.');else throw e;}
