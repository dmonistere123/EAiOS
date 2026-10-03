import {act, renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {VoiceCapture} from '../hooks/voiceCapture';
import {useVoice} from '../hooks/useVoice';
class Recognition extends EventTarget {
 continuous=false;interimResults=false;lang='';
 start=vi.fn();stop=vi.fn();abort=vi.fn();
 emit(type:string){this.dispatchEvent(new Event(type));}
 result(parts:[string,boolean][],resultIndex=0){
  const results=parts.map(([transcript,isFinal])=>Object.assign([{transcript}],{isFinal}));
  this.dispatchEvent(Object.assign(new Event('result'),{results,resultIndex}));
 }
 error(error:string){this.dispatchEvent(Object.assign(new Event('error'),{error}));}
}
let recs:Recognition[],capture:VoiceCapture;
const cb={final:vi.fn(),draft:vi.fn(),listening:vi.fn(),error:vi.fn()};
beforeEach(()=>{vi.useFakeTimers();recs=[];vi.clearAllMocks();capture=new VoiceCapture(()=>{const r=new Recognition();recs.push(r);return r as unknown as SpeechRecognition;},cb);capture.start();});
afterEach(()=>{capture.cancel(false);vi.useRealTimers();vi.unstubAllGlobals();});
describe('three-second browser-event quiet window',()=>{
 it('uses continuous recognition, waits a full quiet window and sends once after finalization',()=>{
  const r=recs[0];expect(r.continuous).toBe(true);expect(r.interimResults).toBe(true);
  r.emit('speechstart');r.result([['first',true]]);vi.advanceTimersByTime(5000);expect(r.stop).not.toHaveBeenCalled();
  r.emit('speechend');vi.advanceTimersByTime(2999);expect(r.stop).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(r.stop).toHaveBeenCalledOnce();expect(cb.final).not.toHaveBeenCalled();
  r.emit('end');r.emit('end');vi.advanceTimersByTime(5000);expect(cb.final).toHaveBeenCalledExactlyOnceWith('first');
 });
 it('resumed speech cancels the old countdown, and a later quiet period starts a new one',()=>{
  const r=recs[0];r.result([['one',true]]);r.emit('speechend');vi.advanceTimersByTime(2500);r.emit('speechstart');
  vi.advanceTimersByTime(5000);expect(r.stop).not.toHaveBeenCalled();r.result([['one',true],['two',true]],1);r.emit('speechend');
  vi.advanceTimersByTime(2999);expect(r.stop).not.toHaveBeenCalled();vi.advanceTimersByTime(1);r.emit('end');expect(cb.final).toHaveBeenCalledWith('one two');
 });
 it('new interim or final result events reset the countdown and repeated finals are not duplicated',()=>{
  const r=recs[0];r.result([['one',true]]);vi.advanceTimersByTime(2500);r.result([['one',true],['tw',false]],1);
  vi.advanceTimersByTime(2500);expect(r.stop).not.toHaveBeenCalled();r.result([['one',true],['two',true]],1);r.result([['one',true],['two',true]],1);
  vi.advanceTimersByTime(3000);r.emit('end');expect(cb.final).toHaveBeenCalledExactlyOnceWith('one two');
 });
 it('reopens after an early browser end without immediate send or resetting the quiet deadline',()=>{
  const first=recs[0];first.result([['one',true]]);first.emit('speechend');vi.advanceTimersByTime(1000);first.emit('end');
  expect(recs).toHaveLength(2);expect(cb.final).not.toHaveBeenCalled();vi.advanceTimersByTime(1999);expect(recs[1].stop).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);recs[1].emit('end');expect(cb.final).toHaveBeenCalledExactlyOnceWith('one');
 });
 it('collects resumed speech after a browser restart and ignores stale recognizer events',()=>{
  const first=recs[0];first.result([['one',true]]);first.emit('end');vi.advanceTimersByTime(2000);
  const next=recs[1];next.emit('speechstart');first.result([['stale',true]]);first.emit('end');next.result([['two',true]]);next.emit('speechend');
  vi.advanceTimersByTime(3000);next.emit('end');expect(cb.final).toHaveBeenCalledExactlyOnceWith('one two');
 });
 it('manual stop finishes immediately after final results, without another delayed submit',()=>{
  const r=recs[0];r.result([['one',false]]);capture.stop();capture.stop();expect(r.stop).toHaveBeenCalledOnce();
  r.result([['one',true]]);r.emit('end');vi.advanceTimersByTime(9000);expect(cb.final).toHaveBeenCalledExactlyOnceWith('one');expect(recs).toHaveLength(1);
 });
 it('cancellation preserves the draft and prevents all late callbacks/restarts/submissions',()=>{
  const r=recs[0];r.result([['draft',true]]);capture.cancel();r.emit('end');r.result([['late',true]]);vi.advanceTimersByTime(9000);
  expect(cb.final).not.toHaveBeenCalled();expect(cb.draft).toHaveBeenLastCalledWith('draft');expect(r.abort).toHaveBeenCalledOnce();expect(recs).toHaveLength(1);
 });
 it('keeps unfinished interim words for review rather than auto-sending only a final prefix',()=>{
  const r=recs[0];r.result([['final prefix',true],['unfinished tail',false]]);r.emit('speechend');vi.advanceTimersByTime(3000);r.emit('end');
  expect(cb.final).not.toHaveBeenCalled();expect(cb.draft).toHaveBeenLastCalledWith('final prefix unfinished tail');expect(cb.error).toHaveBeenCalled();
 });
 it('retains an interim-only natural end as a draft without restarting or sending it',()=>{
  recs[0].result([['unfinished',false]]);recs[0].emit('end');expect(cb.final).not.toHaveBeenCalled();expect(cb.error).toHaveBeenCalled();expect(recs).toHaveLength(1);
 });
 it.each(['not-allowed','network','aborted'])('stops on %s without submitting buffered words',error=>{
  recs[0].result([['draft',true]]);recs[0].error(error);recs[0].emit('end');vi.advanceTimersByTime(5000);expect(cb.final).not.toHaveBeenCalled();expect(recs).toHaveLength(1);
 });
 it('bounds empty browser restart loops',()=>{
  for(let i=0;i<3;i++){recs[i].error('no-speech');recs[i].emit('end');}
  expect(recs).toHaveLength(3);expect(cb.error).toHaveBeenCalled();expect(cb.final).not.toHaveBeenCalled();
 });
 it('a missing end after stop fails safely to a draft',()=>{
  recs[0].result([['draft',true]]);vi.advanceTimersByTime(4500);expect(cb.final).not.toHaveBeenCalled();expect(cb.error).toHaveBeenCalled();expect(recs[0].abort).toHaveBeenCalled();
 });
});
it('hook unmount/navigation aborts capture and cancels delayed submission',()=>{
 const instances:Recognition[]=[];vi.stubGlobal('SpeechRecognition',class extends Recognition{constructor(){super();instances.push(this);}});
 const submit=vi.fn();const hook=renderHook(()=>useVoice(submit));act(()=>hook.result.current.startListening());
 act(()=>instances[0].result([['must not send',true]]));hook.unmount();instances[0].emit('end');vi.advanceTimersByTime(6000);
 expect(submit).not.toHaveBeenCalled();expect(instances[0].abort).toHaveBeenCalledOnce();
});
it('hook uses the latest callback during a continuing dictation',()=>{
 const instances:Recognition[]=[];vi.stubGlobal('SpeechRecognition',class extends Recognition{constructor(){super();instances.push(this);}});
 const first=vi.fn(),latest=vi.fn();const hook=renderHook(({submit})=>useVoice(submit),{initialProps:{submit:first}});
 act(()=>hook.result.current.startListening());hook.rerender({submit:latest});
 act(()=>{instances[0].result([['latest',true]]);vi.advanceTimersByTime(3000);instances[0].emit('end');});expect(first).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledExactlyOnceWith('latest');hook.unmount();
});
