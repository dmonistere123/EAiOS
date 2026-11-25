// @vitest-environment node
import {it,expect} from 'vitest';
import {blankDcr} from '../domain/dcr';
import {relationshipMatches,relationshipGroup} from '../../server/dcrRelationshipIdentity';
const jeff={...blankDcr('relationship'),personName:'Jeff Mitchell',email:'jeff@example.test',organization:'Example'};
it('matches case-insensitive addresses without stripping meaningful address punctuation',()=>{expect(relationshipMatches(jeff,{...jeff,email:'JEFF@example.test',organization:'Other label'})).toBe(true);expect(relationshipMatches(jeff,{...jeff,email:'j.eff@example.test'})).toBe(false);});
it('uses a full name and organization only when an address is missing and the match is unambiguous',()=>{expect(relationshipMatches(jeff,{...jeff,email:''})).toBe(true);expect(relationshipMatches(jeff,{...jeff,email:'',organization:'Different'})).toBe(false);expect(relationshipMatches(jeff,{...jeff,email:'',personName:'Jeff'})).toBe(false);expect(relationshipGroup({...jeff,email:''},[jeff,{...jeff,email:'another@example.test'}],x=>x)).toEqual([]);});
