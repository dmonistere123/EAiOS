"""Data-only whiteboard renderer and local audio alignment for podcast promos.
No generated Python, shell commands, remote images, or URLs are executed.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
import textwrap
import os
import signal
import sys
import re
import difflib
from PIL import Image, ImageDraw, ImageFont

W, H, SCALE, FPS, DURATION = 1280, 720, 2, 24, 90.0
VIDEO_TITLE = "PODCAST PREVIEW"
PAPER, INK, TEAL = '#FAF8F2', '#183544', '#087F82'
MUTED, CORAL, GOLD = '#6C7F85', '#C45B48', '#D19C3D'
FONT_ROOT = Path('/usr/share/fonts/truetype/lato')
FONTS = {}


def font(size, bold=False):
    key = size, bold
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str((FONT_ROOT / ('Lato-Bold.ttf' if bold else 'Lato-Regular.ttf')) if FONT_ROOT.exists() else Path('/usr/share/fonts/truetype/dejavu') / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), round(size*SCALE))
    return FONTS[key]


def pts(points):
    return [(round(x*SCALE), round(y*SCALE)) for x, y in points]


def arc(x, y, radius, start=0, end=360, count=90):
    return [(x+radius*math.cos(math.radians(start+(end-start)*i/count)), y+radius*math.sin(math.radians(start+(end-start)*i/count))) for i in range(count+1)]


def curve(a, b, c, d):
    return [((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],
             (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1]) for t in [i/60 for i in range(61)]]


def line(points, at, duration=.7, color=INK, width=3):
    return {'kind':'path','points':points,'at':at,'duration':duration,'color':color,'width':width}


def label(text, x, y, at, size=27, color=INK, bold=False, duration=.55):
    return {'kind':'text','text':text,'x':x,'y':y,'at':at,'duration':duration,'size':size,'color':color,'bold':bold}


def box(x,y,w,h,at,color=INK):
    return line([(x+12,y),(x+w-12,y),(x+w,y+12),(x+w,y+h-12),(x+w-12,y+h),(x+12,y+h),(x,y+h-12),(x,y+12),(x+12,y)],at,1,color)


def person(x,y,at,color=INK,scale=1):
    def tr(p): return [(x+a*scale,y+b*scale) for a,b in p]
    return [line(tr(arc(0,0,24)),at,.6,color),line(tr(curve((-47,92),(-47,28),(47,28),(47,92))),at+.55,.7,color),
            line(tr([(-47,92),(47,92)]),at+1.2,.4,color),line(tr([(-17,111),(-17,150)]),at+1.5,.25,color),line(tr([(17,111),(17,150)]),at+1.75,.25,color)]


def arrow(x1,y1,x2,y2,at,color=None,duration=.6):
    color=color or TEAL
    theta=math.atan2(y2-y1,x2-x1)
    return [line([(x1,y1),(x2,y2)],at,duration,color),line([(x2-13*math.cos(theta-.5),y2-13*math.sin(theta-.5)),(x2,y2),(x2-13*math.cos(theta+.5),y2-13*math.sin(theta+.5))],at+duration,.2,color)]


def check(x,y,at,color=None): return line([(x,y+12),(x+12,y+24),(x+36,y-5)],at,.6,color or TEAL,5)


def scene(title, subtitle, start, end, items):
    return {'title':title,'subtitle':subtitle,'start':start,'end':end,'items':items}


def hand(draw,x,y):
    # Small illustrated hand holding a marker; its nib stays at the drawing tip.
    draw.line(pts([(x+3,y+3),(x+54,y+64)]),fill=INK,width=11*SCALE)
    draw.line(pts([(x+12,y+13),(x+43,y+50)]),fill='#D8E5E1',width=7*SCALE)
    draw.polygon(pts([(x+37,y+35),(x+56,y+28),(x+71,y+39),(x+76,y+59),(x+101,y+91),(x+72,y+112),(x+42,y+81),(x+21,y+60),(x+21,y+47),(x+28,y+43),(x+41,y+57),(x+47,y+52)]),fill='#E8BE9B',outline='#98715B',width=2*SCALE)
    draw.polygon(pts([(x+71,y+108),(x+100,y+86),(x+122,y+111),(x+91,y+136)]),fill=TEAL)
    draw.line(pts([(x+49,y+38),(x+58,y+52),(x+59,y+67)]),fill='#B38366',width=SCALE)


def render_frame(t, scenes, show_hand=False):
    s=next((s for s in scenes if s['start']<=t<s['end']),scenes[-1]); local=t-s['start']
    im=Image.new('RGB',(W*SCALE,H*SCALE),PAPER); d=ImageDraw.Draw(im)
    for x in range(24,W,30):
        for y in range(103,624,30):
            d.ellipse((x*SCALE,y*SCALE,x*SCALE+1,y*SCALE+1),fill='#DCE4DE')
    d.text((42*SCALE,22*SCALE),'2EP',font=font(30,True),fill=INK)
    d.text((113*SCALE,28*SCALE),'by Allygnment',font=font(20),fill=MUTED)
    d.text((926*SCALE,30*SCALE),'THE WHITEBOARD SERIES',font=font(15,True),fill=TEAL)
    d.line(pts([(42,76),(1238,76)]),fill='#DCE4DE',width=SCALE)
    if True:
        d.text((64*SCALE,116*SCALE),s['title'],font=font(38,True),fill=INK)
        d.text((65*SCALE,174*SCALE),s['subtitle'],font=font(23),fill=MUTED)
    tip=None
    for item in sorted(s['items'],key=lambda x:x['at']):
        progress=max(0,min(1,(local-item['at'])/item['duration']))
        if progress<=0:continue
        if item['kind']=='path':
            p=item['points']; lengths=[math.dist(a,b) for a,b in zip(p,p[1:])]; left=sum(lengths)*progress; shown=[p[0]]
            for a,b,length in zip(p,p[1:],lengths):
                if left>=length:shown.append(b);left-=length
                else:
                    f=left/max(length,1e-6);shown.append((a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])));break
            d.line(pts(shown),fill=item['color'],width=item['width']*SCALE,joint='curve')
            if progress<1:tip=shown[-1]
        else:
            f=font(item['size'],item['bold']); x,y=item['x'],item['y']; text=item['text']
            bounds=d.textbbox((0,0),text,font=f); width=bounds[2]+4; height=item['size']*SCALE+18
            layer=Image.new('RGB',(width,height),PAPER);ld=ImageDraw.Draw(layer);ld.text((0,0),text,font=f,fill=item['color'])
            reveal=round(width*progress)
            im.paste(layer.crop((0,0,reveal,height)),(round(x*SCALE),round(y*SCALE)))
            if progress<1:tip=(x+reveal/SCALE,y+item['size']*.8)
    if show_hand and tip and tip[0]<W-115 and tip[1]<H-150:hand(d,*tip)
    d.line(pts([(43,641),(1238,641)]),fill='#DCE4DE',width=SCALE)
    d.text((44*SCALE,664*SCALE),VIDEO_TITLE[:55].upper(),font=font(16,True),fill=MUTED)
    d.text((1095*SCALE,663*SCALE),f'{scenes.index(s)+1:02} / {len(scenes):02}',font=font(18,True),fill=TEAL)
    d.line(pts([(43,641),(43+1195*t/DURATION,641)]),fill=TEAL,width=3*SCALE)
    return im.resize((W,H),Image.Resampling.LANCZOS)


def make_scenes(plan):
    result=[]
    for index, data in enumerate(plan['scenes']):
        start=data['at'];end=plan['scenes'][index+1]['at'] if index+1<len(plan['scenes']) else plan['audioDuration']
        labels=data['labels'];kind=data['visual'];items=[]
        def caption(text,x,y,at,width=22):
            wrapped=textwrap.wrap(text,width)
            size=27 if len(wrapped)<=3 else 23
            return [label(t,x,y+j*31,at+j*.25,size,INK,j==0) for j,t in enumerate(wrapped)]
        if kind=='flow':
            for i,text in enumerate(labels[:4]):
                x=84+i*302;at=.4+i*.8
                items += [box(x,305,212,143,at,TEAL)]+caption(text,x+18,332,at+.65,15)
                if i<min(3,len(labels)-1):items+=arrow(x+221,377,x+289,377,at+.7)
        elif kind=='people':
            for i,text in enumerate(labels):
                x=200+i*(880/max(1,len(labels)-1));at=.4+i*.8
                items += person(x,284,at,TEAL,.85)+caption(text,x-115,455,at+1.8,18)
        elif kind=='comparison':
            for i,text in enumerate(labels):
                column=i%2;row=i//2;x=100+column*620;at=.5+i
                if row==0:items += [box(x,260,460,320,at,TEAL if column else CORAL)]
                items += caption(text,x+30,293+row*140,at+1,25)
        elif kind=='cycle':
            items += [box(110,310,340,170,.5),box(825,310,340,170,1)]+caption(labels[0],140,348,1.4)+caption(labels[-1],855,348,2)
            items += arrow(465,370,810,370,2.4)+[line(curve((1030,495),(990,610),(260,610),(240,495)),3.4,1.2,CORAL)]
            if len(labels)>2:items+=caption(labels[1],460,515,3.4,27)
            if len(labels)>3:items+=caption(labels[2],460,235,2.5,27)
        elif kind=='warning':
            items += [line([(250,275),(375,485),(125,485),(250,275)],.5,1.3,CORAL),label('!',234,356,1.8,62,CORAL,True)]
            for i,text in enumerate(labels):items+=caption(text,480,260+i*78,1+i*.9,39)
        else:
            for i,text in enumerate(labels[:4]):
                at=.4+i*.9;y=270+i*77
                items += [check(145,y+2,at),line([(205,y+48),(1120,y+48)],at+.3,.4,'#CDD7D5',1)]+caption(text,212,y,at+.5,46)
        result.append(scene(data['title'],data['subtitle'],start,end,items))
    result.append(scene('Keep the conversation going.', 'Listen to the full podcast for the complete discussion.',plan['audioDuration'],plan['duration'],[
        *person(277,282,.3,TEAL,1.05),label('Listen to the full episode',514,305,.5,38,TEAL,True),
        *[label(t,514,379+i*35,1+i*.3,26,INK) for i,t in enumerate(textwrap.wrap(plan['title'],37)[:2])],
        line([(513,473),(1118,473)],1.8,.8,GOLD,4),label('2EP by Allygnment',515,508,2,24,MUTED)]))
    return result


def analyze(audio,out):
    from faster_whisper import WhisperModel
    print('Aligning the podcast audio',flush=True)
    model=WhisperModel('base',device='cpu',compute_type='int8',cpu_threads=4)
    segments,_=model.transcribe(str(audio),word_timestamps=True,beam_size=3,vad_filter=True)
    data=[]
    for s in segments:
        data.append({'start':s.start,'end':s.end,'text':s.text.strip(),'words':[{'start':w.start,'end':w.end,'word':w.word} for w in s.words]})
    if not data:raise ValueError('No speech was found in this podcast')
    # Correct aligned word spellings from the saved podcast script when the
    # token counts agree. Keep the measured timestamps, never invent timing.
    source=out/'source.txt'
    if source.exists():
        expected=re.sub(r'</?Person[12]>', ' ',source.read_text()).split()
        actual=[w for segment in data for w in segment['words']]
        norm=lambda value:re.sub(r'\W+', '',value).lower()
        matcher=difflib.SequenceMatcher(None,[norm(w['word']) for w in actual],[norm(w) for w in expected],autojunk=False)
        for kind,a,b,c,d in matcher.get_opcodes():
            if kind=='equal' or kind=='replace' and b-a==d-c:
                for offset,word in enumerate(expected[c:d]):actual[a+offset]['word']=' '+word
        for segment in data:segment['text']=''.join(w['word'] for w in segment['words']).strip()
    (out/'alignment.json').write_text(json.dumps(data))


def timecode(t):
    ms=round(t*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'


def render(audio,out,plan):
    global DURATION,VIDEO_TITLE,TEAL
    DURATION=plan['duration'];VIDEO_TITLE=plan['title']
    TEAL={'teal':'#087F82','blue':'#2670A7','purple':'#7951A1'}.get(plan.get('accent'),'#087F82')
    scenes=make_scenes(plan);show_hand=plan.get('showHand',False)
    lines=['WEBVTT','']
    for segment in json.loads((out/'alignment.json').read_text()):
        words=[w for w in segment['words'] if w['start']>=plan['excerptStart'] and w['end']<=plan['excerptStart']+plan['audioDuration']+.15]
        for offset in range(0,len(words),12):
            chunk=words[offset:offset+12]
            text=''.join(w['word'] for w in chunk).strip()
            lines.extend([f"{timecode(max(0,chunk[0]['start']-plan['excerptStart']))} --> {timecode(min(plan['audioDuration'],chunk[-1]['end']-plan['excerptStart']))}",'\n'.join(textwrap.wrap(text,60)),''])
    (out/'captions.vtt').write_text('\n'.join(lines))
    for i,s in enumerate(scenes):render_frame(s['end']-.2,scenes,show_hand).save(out/f'scene-{i}.jpg',quality=90)
    render_frame(min(scenes[0]['end']-.2,6),scenes,show_hand).save(out/'poster.jpg',quality=92)
    command=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-ss',str(plan['excerptStart']),'-t',str(plan['audioDuration']),'-i',str(audio),'-map','0:v:0','-map','1:a:0','-t',str(DURATION),'-c:v','libx264','-preset','fast','-crf','20','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-af',f"afade=t=out:st={max(0,plan['audioDuration']-.2)}:d=0.2,apad",'-movflags','+faststart',str(out/'rendering.mp4')]
    proc=subprocess.Popen(command,stdin=subprocess.PIPE)
    try:
        for frame in range(math.ceil(DURATION*FPS)):
            proc.stdin.write(render_frame(frame/FPS,scenes,show_hand).tobytes())
            if frame%(FPS*10)==0:print(f'Rendering video: {round(frame/FPS)} / {DURATION:g} seconds',flush=True)
    finally:proc.stdin.close()
    if proc.wait():raise RuntimeError('Video rendering failed')
    subprocess.run(['ffmpeg','-v','error','-i',str(out/'rendering.mp4'),'-f','null','-'],check=True,timeout=120)
    (out/'rendering.mp4').replace(out/'video.mp4')
    print('Video ready',flush=True)


if __name__=='__main__':
    # Do not leave CPU-heavy rendering running after the owning server exits.
    if sys.platform=='linux':
        import ctypes
        parent=os.getppid()
        ctypes.CDLL(None).prctl(1,signal.SIGTERM)
        if os.getppid()!=parent:sys.exit(1)
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['analyze','render','check']);parser.add_argument('--audio',type=Path);parser.add_argument('--out',type=Path);args=parser.parse_args()
    if args.mode=='check':
        import faster_whisper
        subprocess.run(['ffmpeg','-version'],stdout=subprocess.DEVNULL,check=True)
        font(24)
        print('ready')
    else:
        if not args.audio or not args.out:parser.error('Audio and output directory are required')
        args.out.mkdir(parents=True,exist_ok=True)
        if args.mode=='analyze':analyze(args.audio,args.out)
        else:render(args.audio,args.out,json.loads((args.out/'plan.json').read_text()))


