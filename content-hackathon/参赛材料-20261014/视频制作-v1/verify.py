# -*- coding: utf-8 -*-
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, subprocess, hashlib
R=Path(__file__).resolve().parent/'final'
F=R/'Eli-参赛演示-审阅版-v1.mp4'
T=json.loads((R/'timeline.json').read_text())
Q=R/'qa';Q.mkdir(exist_ok=True)
r=subprocess.run(['ffmpeg','-hide_banner','-i',str(F),'-f','null','-','-progress','pipe:1','-nostats'],capture_output=True,text=True)
(Q/'full-decode.log').write_text(r.stderr)
(Q/'decode-progress.txt').write_text(r.stdout)
assert r.returncode==0,r.stderr
assert 'frame=4320' in r.stdout
images=[]
for s in T['shots']:
 t=s['start']+(s['end']-s['start'])/2
 p=Q/f"decoded-{s['index']:02d}.png"
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-n','-ss',str(t),'-i',str(F),'-frames:v','1',str(p)],check=True)
 im=Image.open(p).convert('RGB');assert im.size==(1920,1080)
 images.append((s,im))
for group in range(3):
 sheet=Image.new('RGB',(1920,1164),'#172332');d=ImageDraw.Draw(sheet)
 for j,(s,im) in enumerate(images[group*9:(group+1)*9]):
  x=(j%3)*640;y=(j//3)*388
  sheet.paste(im.resize((640,360),Image.Resampling.LANCZOS),(x,y))
  d.text((x+8,y+363),f"shot {s['index']:02d} | {s['start']} - {s['end']} sec",font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18),fill='white')
 sheet.save(Q/f'contact-{group+1}.jpg',quality=90)
report={'video':str(F),'bytes':F.stat().st_size,'sha256':hashlib.sha256(F.read_bytes()).hexdigest(),'fullDecodeExit':r.returncode,'decodedFrames':4320,'expectedDuration':180,'resolution':[1920,1080],'fps':24,'audio':'none','sampleCount':len(images),'screenshotSources':T['sources'],'ffprobe':'unavailable: installed x86_64 executable on arm64; FFmpeg full decode used','visualReview':'pending','userAcceptance':'pending','submitted':False,'published':False}
(Q/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:report[k] for k in ['bytes','decodedFrames','expectedDuration','sampleCount']},ensure_ascii=True))
