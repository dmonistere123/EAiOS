// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {listDismissed,dismissWorkItem} from '../../server/dismissed';
it('preserves legacy dismissals until meaningful activity changes and remembers the new dismissal',()=>{
 const root=mkdtempSync(join(tmpdir(),'dismissal-revisions-'));
 try{writeFileSync(join(root,'dismissed.json'),JSON.stringify(['task']));
 expect(listDismissed(root,{task:'first'})).toEqual(['task']);
 expect(listDismissed(root,{task:'first'})).toEqual(['task']);
 expect(listDismissed(root,{task:'second'})).toEqual([]);
 expect(dismissWorkItem(root,'task',{task:'second'})).toEqual(['task']);
 expect(listDismissed(root,{task:'second'})).toEqual(['task']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
