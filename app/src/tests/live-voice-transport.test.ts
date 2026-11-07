import {afterEach,expect,it,vi} from 'vitest';
import {VoiceLiveSession,toLiveHistory,chunkForCommentary} from '../lib/voiceLive';
afterEach(()=>vi.unstubAllGlobals());
it('releases a microphone permission grant that arrives after the user ended voice',async()=>{
 let grant!:(value:unknown)=>void;const stop=vi.fn();const close=vi.fn();const closed=vi.fn();
 vi.stubGlobal('Audio',class{autoplay=false;srcObject=null;pause=vi.fn();});
 vi.stubGlobal('RTCPeerConnection',class{addEventListener=vi.fn();close=close;});
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{grant=resolve;})}});
 const session=new VoiceLiveSession({onClosed:closed,onError:vi.fn(),onDelegation:vi.fn()});
 const starting=session.start([]);session.dispose();grant({getTracks:()=>[{stop}]});await starting;
 expect(stop).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(closed).toHaveBeenCalledOnce();
});
it('bounds history and splits long replies to the audio protocol limit',()=>{
 const history=toLiveHistory(Array.from({length:40},()=>({role:'user' as const,text:'word '.repeat(300)})));
 expect(history.length).toBeLessThanOrEqual(24);expect(history.reduce((n,m)=>n+m.content[0].text.length,0)).toBeLessThanOrEqual(6000);
 expect(chunkForCommentary('a'.repeat(3500)).every(s=>s.length<=1400)).toBe(true);
});
