# -*- coding: utf-8 -*-
from pathlib import Path
import subprocess,json,hashlib
B=Path(__file__).resolve().parent;R=B/'中文配音-v2'
captions=[(43,49.999,'如果上传结果不明，先核对，不重复上传。'),(123,129.999,'候选不会自动上传，最终发布仍然禁用。')]
filters=[f"drawbox=x=70:y=1030:w=1100:h=36:color=0xf2f4f8:t=fill",f"drawtext=fontfile=/System/Library/Fonts/Hiragino Sans GB.ttc:textfile={R/'footer.txt'}:fontsize=20:fontcolor=0x586875:x=76:y=1036"]
for n,(a,b,txt) in enumerate(captions):
 p=R/f'subtitle-fix-{n}.txt';p.write_text(txt)
 en=f"between(t,{a},{b})"
 filters += [f"drawbox=x=76:y=890:w=1768:h=129:color=0x172332:t=fill:enable='{en}'",f"drawtext=fontfile=/System/Library/Fonts/Hiragino Sans GB.ttc:textfile={p}:fontsize=34:fontcolor=white:x=(w-text_w)/2:y=929:enable='{en}'"]
out=R/'Eli-参赛演示-中文配音审阅版-v2-final.mp4'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(B/'final/Eli-参赛演示-审阅版-v1.mp4'),'-i',str(R/'中文配音-180秒.wav'),'-map','0:v:0','-map','1:a:0','-vf',','.join(filters),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t','180','-movflags','+faststart',str(out)],check=True)
(R/'final-manifest.json').write_text(json.dumps({'file':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'captionCorrections':[{'start':a,'end':b,'text':s} for a,b,s in captions],'modelApiCalls':0,'paymentActions':0},ensure_ascii=False,indent=2))
print(out)
