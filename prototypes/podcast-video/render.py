"""Local authored whiteboard proof of concept. Requires Pillow and FFmpeg.

python render.py --audio path/to/source.mp3 --out path/to/review
Only an 84.55 second excerpt is used; the source is never modified.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

W, H, SCALE, FPS, DURATION = 1280, 720, 2, 24, 84.55
PAPER, INK, TEAL = '#FAF8F2', '#183544', '#087F82'
MUTED, CORAL, GOLD = '#6C7F85', '#C45B48', '#D19C3D'
FONT_ROOT = Path('/usr/share/fonts/truetype/lato')
FONTS = {}


def font(size, bold=False):
    key = size, bold
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str(FONT_ROOT / ('Lato-Bold.ttf' if bold else 'Lato-Regular.ttf')), round(size*SCALE))
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


def arrow(x1,y1,x2,y2,at,color=TEAL,duration=.6):
    theta=math.atan2(y2-y1,x2-x1)
    return [line([(x1,y1),(x2,y2)],at,duration,color),line([(x2-13*math.cos(theta-.5),y2-13*math.sin(theta-.5)),(x2,y2),(x2-13*math.cos(theta+.5),y2-13*math.sin(theta+.5))],at+duration,.2,color)]


def check(x,y,at,color=TEAL): return line([(x,y+12),(x+12,y+24),(x+36,y-5)],at,.6,color,5)


def scene(title, subtitle, start, end, items):
    return {'title':title,'subtitle':subtitle,'start':start,'end':end,'items':items}


def storyboard():
    scenes=[]
    scenes.append(scene('Stop scaling heroics.', 'A better system for exceptional people.',0,6,[
        label('Stop scaling',88,211,.5,64,bold=True,duration=1),label('heroics.',88,291,1.6,74,TEAL,True,1),
        line([(91,389),(536,389)],2.8,.7,GOLD,5),*person(910,260,.8,scale=1.25),
        line([(953,301),(1055,328),(1023,412),(961,375)],2,1.2,CORAL),
        label('Build a system that scales.',90,442,3.5,28,MUTED),label('THE EXECUTIVE BRIEFING',90,172,.1,18,TEAL,True)]))
    scenes.append(scene('A great rescue. A useful question.', 'Why did ordinary work need extraordinary effort?',6,15.6,[
        *person(246,275,.3,TEAL,1.15),label('Your best employee',118,491,2,26,bold=True),
        box(710,265,320,176,.7),label('Ordinary project',754,294,1.7,27,bold=True),
        line([(755,352),(915,352)],2.3,.4,MUTED),line([(755,380),(953,380)],2.7,.4,MUTED),
        *arrow(352,356,675,356,3,TEAL,1),label('Friday rescue',421,386,4.2,25,TEAL),
        label('Why was rescue necessary?',654,491,5.4,29,CORAL,True),line(arc(1046,210,26),5.8,.7,GOLD),label('?',1035,191,6.5,31,GOLD,True)]))
    scenes.append(scene('Outstanding people. Inconsistent results.', 'Individual talent cannot repair every gap.',15.6,22.5,[
        *person(192,283,.2,TEAL,.9),*person(332,283,.5,TEAL,.9),*person(472,283,.8,TEAL,.9),
        label('CAPABLE PEOPLE',192,486,2.3,23,TEAL,True),
        line([(760,462),(1128,462)],.6,.7,MUTED),
        box(791,359,65,102,1.4,TEAL),box(900,272,65,189,2.2,GOLD),box(1009,401,65,60,3,CORAL),
        label('UNEVEN OUTCOMES',786,486,4.1,23,CORAL,True),*arrow(560,350,720,350,3.6,MUTED)]))
    items=[]
    for i,(name,detail) in enumerate([('Promise','Clear'),('Scope','Unclear'),('Handoff','Incomplete'),('Delivery','Late')]):
        x=83+i*304; at=max(0,i*1.05+3.1)
        items += [box(x,285,210,160,at,TEAL if i==0 else INK),label(name,x+24,312,at+.6,29,bold=True),label(detail,x+24,369,at+1.1,24,TEAL if i==0 else CORAL)]
        if i<3: items+=arrow(x+220,362,x+291,362,at+.9,CORAL)
    scenes.append(scene('Customers experience the whole system.', 'Follow the work from promise to delivery.',22.5,31.7,items+[
        line([(104,511),(1178,511)],7,.8,GOLD),label('Every handoff shapes the customer experience.',291,539,7.7,27,MUTED)]))
    scenes.append(scene('Rescue can hide the broken system.', 'Repeated rescue is an operating signal.',31.7,42,[
        box(104,360,300,105,.1),label('Work starts',180,395,.8,29,bold=True),box(871,360,300,105,.7),label('Work continues',909,395,1.4,29,bold=True),
        line(curve((404,360),(535,228),(738,228),(871,360)),2,1.5,TEAL,5),*person(640,208,1,TEAL,.58),
        label('Skilled people bridge the gap',418,475,3.5,27,TEAL),
        line(curve((1060,480),(1030,613),(231,613),(202,479)),5.5,1.5,CORAL),
        line([(189,495),(202,479),(217,491)],7,.3,CORAL),label('Again. And again.',538,566,7.4,24,CORAL,True)]))
    scenes.append(scene('Control failures have consequences.', 'The source uses Knight Capital as an extreme warning.',42,55.5,[
        line([(225,267),(346,465),(104,465),(225,267)],.4,1.2,CORAL,4),label('!',210,341,1.9,64,CORAL,True),
        label('Deployment',457,278,.9,33,bold=True),line([(458,329),(1125,329)],2,.7,MUTED),
        label('Incident response',457,358,2.8,33,bold=True),line([(458,409),(1125,409)],3.8,.7,MUTED),
        label('Unresolved weaknesses add risk.',457,456,5,28,CORAL,True),
        label('An extreme example — not a forecast for your firm.',276,561,8.7,25,MUTED)]))
    items=[box(95,244,707,344,5.6), label('RESCUE REGISTER',124,269,6.6,22,TEAL,True)]
    for i,(text,at) in enumerate([('Customer commitment',7.4),('Failure point',9),('Labor + concession costs',10.4),('Temporary containment',12)]):
        y=325+i*57
        items += [line([(123,y+34),(771,y+34)],at,.5,'#CDD7D5',1),label(text,170,y,at+.2,25),check(118,y+3,at+.7)]
    items += [*person(1022,297,14.4,TEAL,.75),label('Corrective owner',897,459,15.5,26,TEAL,True),
              label('Review weekly',923,502,17,25),*arrow(819,393,938,393,15,TEAL),label('Recovery is not closure.',865,555,18.6,24,CORAL,True)]
    scenes.append(scene('Make recurring failure visible.', 'Start with a lightweight rescue register.',55.5,75.9,items))
    scenes.append(scene('Appreciate the rescue. Then fix the system.', 'Ordinary commitments should not need extraordinary effort.',75.9,DURATION,[
        *person(292,276,.5,TEAL,1),check(342,297,1.7),label('Recognize the person',141,481,2.1,30,TEAL,True),
        box(717,296,121,93,3.9),box(995,296,121,93,4.5),*arrow(853,343,976,343,5,TEAL),check(756,324,5.7),check(1032,324,6.1),
        label('Improve the system',749,481,6.5,30,TEAL,True),line([(105,558),(1176,558)],7.2,.7,GOLD,4)]))
    return scenes


def hand(draw,x,y):
    # Small illustrated hand holding a marker; its nib stays at the drawing tip.
    draw.line(pts([(x+3,y+3),(x+54,y+64)]),fill=INK,width=11*SCALE)
    draw.line(pts([(x+12,y+13),(x+43,y+50)]),fill='#D8E5E1',width=7*SCALE)
    draw.polygon(pts([(x+37,y+35),(x+56,y+28),(x+71,y+39),(x+76,y+59),(x+101,y+91),(x+72,y+112),(x+42,y+81),(x+21,y+60),(x+21,y+47),(x+28,y+43),(x+41,y+57),(x+47,y+52)]),fill='#E8BE9B',outline='#98715B',width=2*SCALE)
    draw.polygon(pts([(x+71,y+108),(x+100,y+86),(x+122,y+111),(x+91,y+136)]),fill=TEAL)
    draw.line(pts([(x+49,y+38),(x+58,y+52),(x+59,y+67)]),fill='#B38366',width=SCALE)


def render_frame(t, scenes):
    s=next((s for s in scenes if s['start']<=t<s['end']),scenes[-1]); local=t-s['start']
    im=Image.new('RGB',(W*SCALE,H*SCALE),PAPER); d=ImageDraw.Draw(im)
    for x in range(24,W,30):
        for y in range(103,624,30):
            d.ellipse((x*SCALE,y*SCALE,x*SCALE+1,y*SCALE+1),fill='#DCE4DE')
    d.text((42*SCALE,22*SCALE),'2EP',font=font(30,True),fill=INK)
    d.text((113*SCALE,28*SCALE),'by Allygnment',font=font(20),fill=MUTED)
    d.text((926*SCALE,30*SCALE),'THE WHITEBOARD SERIES',font=font(15,True),fill=TEAL)
    d.line(pts([(42,76),(1238,76)]),fill='#DCE4DE',width=SCALE)
    if s['start']:
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
            im.paste(layer.crop((0,0,reveal,height)),(x*SCALE,y*SCALE))
            if progress<1:tip=(x+reveal/SCALE,y+item['size']*.8)
    if tip and tip[0]<W-115 and tip[1]<H-150:hand(d,*tip)
    d.line(pts([(43,641),(1238,641)]),fill='#DCE4DE',width=SCALE)
    d.text((44*SCALE,664*SCALE),'STOP SCALING HEROICS',font=font(16,True),fill=MUTED)
    d.text((1095*SCALE,663*SCALE),f'{scenes.index(s)+1:02} / {len(scenes):02}',font=font(18,True),fill=TEAL)
    d.line(pts([(43,641),(43+1195*t/DURATION,641)]),fill=TEAL,width=3*SCALE)
    return im.resize((W,H),Image.Resampling.LANCZOS)


def main():
    p=argparse.ArgumentParser();p.add_argument('--audio',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--stills',action='store_true');args=p.parse_args()
    if not args.audio.is_file():p.error('Source audio does not exist')
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type','-of','json',str(args.audio)]))
    if not any(s.get('codec_type')=='audio' for s in probe['streams']):p.error('Source has no audio stream')
    if float(probe['format']['duration'])<DURATION:p.error(f'Source must be at least {DURATION} seconds long for this authored sample')
    args.out.mkdir(parents=True,exist_ok=True); scenes=storyboard()
    (args.out/'storyboard.json').write_text(json.dumps([{k:v for k,v in s.items() if k!='items'} for s in scenes],indent=2))
    for i,s in enumerate(scenes):
        render_frame(min(s['end']-.3,s['start']+18),scenes).save(args.out/f'scene-{i+1}.jpg',quality=92)
    render_frame(5.5,scenes).save(args.out/'poster.jpg',quality=94)
    if args.stills:return
    pending=args.out/'rendering.mp4'
    command=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(args.audio),'-map','0:v:0','-map','1:a:0','-t',str(DURATION),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-af',f'afade=t=out:st={DURATION-.18}:d=0.18','-movflags','+faststart',str(pending)]
    proc=subprocess.Popen(command,stdin=subprocess.PIPE)
    try:
        for frame in range(math.ceil(DURATION*FPS)):
            proc.stdin.write(render_frame(frame/FPS,scenes).tobytes())
            if frame%(FPS*10)==0:print(f'Rendered {frame//FPS}s / {DURATION}s',flush=True)
    finally:proc.stdin.close()
    if proc.wait():raise RuntimeError('FFmpeg render failed')
    pending.replace(args.out/'stop-scaling-heroics.mp4')
    print('Video ready',flush=True)


if __name__=='__main__':main()
