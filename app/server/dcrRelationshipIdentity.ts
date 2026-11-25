import type {DcrFields} from '../src/domain/dcr.ts';
const name=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const email=(s:string)=>s.trim().toLowerCase();
const organization=(s:string)=>name(s.replace(/\b(?:llc|incorporated|inc|ltd|limited)\.?\s*$/i,''));
/** Email is authoritative. A name alone never merges two contacts. */
export function relationshipMatches(a:DcrFields,b:DcrFields){
 if(a.kind!=='relationship'||b.kind!=='relationship')return false;
 if(a.email.trim()&&b.email.trim())return email(a.email)===email(b.email);
 return a.personName.trim().split(/\s+/).length>1&&name(a.personName)===name(b.personName)&&!!organization(a.organization)&&organization(a.organization)===organization(b.organization);
}
export function relationshipGroup<T>(f:DcrFields,items:T[],fields:(item:T)=>DcrFields):T[]{
 const matches=items.filter(item=>relationshipMatches(f,fields(item)));
 // Without an email, a shared name and organization can still be ambiguous.
 if(!f.email.trim()&&new Set(matches.map(item=>email(fields(item).email)).filter(Boolean)).size>1)return [];
 return matches;
}
