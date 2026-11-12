# -*- coding: utf-8 -*-
"""Offline macOS say + FFmpeg; no service or model APIs."""
from pathlib import Path
import json,subprocess,hashlib,re
BASE=Path(__file__).resolve().parent
R=BASE/'中文配音-v2';R.mkdir(exist_ok=True)
T=json.loads((BASE/'final/timeline.json').read_text())
VOICE='Tingting';RATE='220'
def run(cmd):
 p=subprocess.run(cmd,capture_output=True,text=True)
 if p.returncode:raise RuntimeError(p.stderr[-1500:])
 return p
def duration(file):
 p=subprocess.run(['ffmpeg','-hide_banner','-i',str(file)],capture_output=True,text=True)
 m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',p.stderr)
 assert m,p.stderr
 return int(m[1])*3600+int(m[2])*60+float(m[3])
def spoken(s):
 return s.replace('Eli','艾利').replace('Qwen3.8 Flash','千问三点八 Flash').replace('B站','哔哩哔哩').replace('App','手机应用').replace('0.002188元','零点零零二一八八元').replace('0.000267元','零点零零零二六七元').replace('177','一百七十七').replace('758','七百五十八').replace(' tokens','个词元')
rows=[];parts=[]
for s in T['shots']:
 i=s['index'];span=s['end']-s['start'];caption=s['caption']
 if i==6:caption='如果上传结果不明，先核对，不重复上传。'
 if i==17:caption='候选不会自动上传，最终发布仍然禁用。'
 txt=spoken(caption);(R/f'{i:02d}.txt').write_text(txt)
 raw=R/f'{i:02d}.aiff'
 run(['/usr/bin/say','-v',VOICE,'-r',RATE,'-f',str(R/f'{i:02d}.txt'),'-o',str(raw)])
 length=duration(raw);target=span-0.6;tempo=max(1.0,length/target)
 assert tempo<=1.8,(i,length,span)
 out=R/f'{i:02d}.wav'
 run(['ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(raw),'-af',f'atempo={tempo:.6f},afade=t=in:d=0.02,afade=t=out:st={max(0,length/tempo-0.03):.4f}:d=0.03,adelay=200,apad,atrim=duration={span}', '-ar','48000','-ac','1','-c:a','pcm_s16le',str(out)])
 parts.append(f"file '{out.name}'");rows.append({'index':i,'start':s['start'],'end':s['end'],'caption':s['caption'],'spoken':txt,'rawDuration':length,'tempo':tempo,'voice':VOICE,'rate':int(RATE)})
 print(f'voice {i+1}/25 duration={length:.2f}s tempo={tempo:.3f}',flush=True)
(R/'concat.txt').write_text('\n'.join(parts))
run(['ffmpeg','-hide_banner','-loglevel','error','-n','-f','concat','-safe','0','-i',str(R/'concat.txt'),'-af','loudnorm=I=-16:TP=-1.5:LRA=7','-ar','48000','-ac','1',str(R/'中文配音-180秒.wav')])
source=BASE/'final/Eli-参赛演示-审阅版-v1.mp4'
# Correct burned-in "no narration" badge. Cover only its footer area, keeping
# evidence, captions, dates, and timing intact; no source overwrite.
label=R/'footer.txt';label.write_text('中文配音 · macOS本地语音 · 仅使用现有证据')
vf=f"drawbox=x=70:y=1030:w=1100:h=36:color=0xf2f4f8:t=fill,drawtext=fontfile=/System/Library/Fonts/Hiragino Sans GB.ttc:textfile={label}:fontsize=20:fontcolor=0x586875:x=76:y=1036"
final=R/'Eli-参赛演示-中文配音审阅版-v2.mp4'
run(['ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(source),'-i',str(R/'中文配音-180秒.wav'),'-map','0:v:0','-map','1:a:0','-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t','180','-movflags','+faststart',str(final)])
(R/'配音时间线.json').write_text(json.dumps({'provider':'macOS installed voice /usr/bin/say','voice':VOICE,'network':False,'modelApiCalls':0,'duration':180,'originalVideoSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'videoSha256':hashlib.sha256(final.read_bytes()).hexdigest(),'bytes':final.stat().st_size,'segments':rows},ensure_ascii=False,indent=2))
print(str(final),flush=True)
