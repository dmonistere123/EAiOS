import {fileURLToPath} from 'node:url';
import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {startTravelStage} from '../app/server/travelHandoffStage.ts';
const root=fileURLToPath(new URL('../.local/travel-hi-stage/',import.meta.url));
const credentials=fileURLToPath(new URL('../.local/travel-hi-test.env',import.meta.url));
// Only explicitly provisioned sandbox credentials, never production env files.
if(existsSync(credentials)){
 const env=parseEnv(readFileSync(credentials,'utf8'));
 if(env.DUFFEL_API_KEY&&!env.DUFFEL_API_KEY.startsWith('duffel_test_'))throw Error('Staging accepts only a Duffel test key.');
 for(const name of ['DUFFEL_API_KEY','OPENROUTER_API_KEY'])if(env[name])process.env[name]=env[name];
}
if(process.env.DUFFEL_API_KEY&&!process.env.DUFFEL_API_KEY.startsWith('duffel_test_'))throw Error('Staging accepts only a Duffel test key.');
process.env.EAIOS_DUFFEL_LIVE_BOOKING='0';
const servers=startTravelStage(root,fileURLToPath(new URL('../.local/travel-hi-dist/',import.meta.url)));
console.log('Staging executive: http://127.0.0.1:5275/travel');
console.log('Assistant view: separate loopback service on port 5276; use the task-specific link.');
console.log('Email capture only. Provider booking disabled. Production is untouched.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{servers.executive.close();servers.assistant.close();});
