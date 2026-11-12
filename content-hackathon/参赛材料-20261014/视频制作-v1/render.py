# -*- coding: utf-8 -*-
"""Local-only evidence video. No model, network, account, or workbench calls."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import json, subprocess, hashlib

BASE=Path(__file__).resolve().parent
ROOT=BASE/'final'; ROOT.mkdir(exist_ok=True)
PROJECT=BASE.parents[1]
EVIDENCE=PROJECT/'evidence'
FRAMES=ROOT/'frames'; FRAMES.mkdir(exist_ok=True)
W,H=1920,1080
FONT='/System/Library/Fonts/Hiragino Sans GB.ttc'
INK='#172332'; SUB='#586875'; BLUE='#3659d9'; BG='#f2f4f8'
def font(n):return ImageFont.truetype(FONT,n)
def wrap(text,f,width):
    lines=[];line=''
    for c in text:
        if c=='\n':lines.append(line);line='';continue
        if f.getlength(line+c)>width:lines.append(line);line=c
        else:line+=c
    if line:lines.append(line)
    return lines
def text(d,xy,value,size=34,width=560,fill=INK,gap=14):
    x,y=xy;f=font(size)
    for line in wrap(value,f,width):d.text((x,y),line,font=f,fill=fill);y+=size+gap
    return y

# Each caption is an approved-script segment; evidence/date labels are editorial.
shots=[
 [7,1,'自己的重复工作','一份内容，\n分别准备到多个平台。','我做内容时，同一条视频经常需要在多个平台重新找素材、复制文字。','hero',None],
 [7,1,'集中整理','素材、母稿、\n各平台版本。','Eli把素材、母稿和各平台版本集中管理，','screen',('TokenPay首次实测-候选未采用次数耗尽-20261014.png',(230,30,1240,1230))],
 [6,1,'产品定位','投稿准备助手','先帮我把发布前的重复准备做好。','hero',None],
 [8,2,'母稿与平台版本','共用素材，\n分别保留文案。','一份母稿可以复用，各平台也能保留自己的标题、正文和标签。','screen',('TokenPay首次实测-候选未采用次数耗尽-20261014.png',(270,140,1230,1180))],
 [8,2,'草稿管理','保存与完整备份','这里有草稿备份、素材替换和撤销，','screen',('TokenPay首次实测-候选未采用次数耗尽-20261014.png',(0,150,825,1210))],
 [7,2,'准备与发布分开','修改不等于发布','修改不会直接变成对外发布。','screen',('TokenPay首次实测-候选未采用次数耗尽-20261014.png',(280,1870,810,2130))],
 [7,2,'稿件保护','旧稿保留，\n异常先核对。','修改不会直接变成对外发布。','safety',None],
 [8,3,'多平台准备队列','一起发起，\n分别核对。','选中多个平台后，工作台按平台分别准备。','screen',('工作台三平台准备通过-20261013.png',(275,430,842,960))],
 [7,3,'历史实测 · 2026-10-13','历史证据，\n不冒充当前会话。','小红书和抖音已有上传及文案回读证据，','screen',('工作台三平台准备通过-20261013.png',(290,675,830,1040))],
 [6,3,'重载后的当前边界','小红书 / 抖音\n当前会话待核。','本次重载后没有重传，当前会话待核。','safety',None],
 [9,3,'B站回执摘要 · 2026-10-14','三条真实视频\n恢复并核对。','B站三条真实视频已恢复，上传、文案、封面、分区与标签核对通过，前稿仍保留。','bili',None],
 [7,4,'通路能力','不同平台，\n分别处理。','不同平台能力不同。','capability',None],
 [7,4,'B站图文专栏','原图 + 文案包\n→ 手机App接续','B站图文专栏走原图与文案准备包，再由本人在手机App接续。','handoff',None],
 [6,4,'App接续边界','准备包完成\n≠ 平台编辑完成','它不会被计为平台编辑页已经准备成功。','handoff',None],
 [8,5,'AI候选审阅','先核对事实，\n再决定采用。','AI只生成当前平台的候选文案，创作者先核事实再采用。','screen',('TokenPay首次实测-候选未采用次数耗尽-20261014.png',(275,3755,1230,4140))],
 [8,5,'真实候选 · 2026-10-14','已生成，\n尚未采用。','本次Qwen3.8 Flash真实调用一次，候选仍未采用；','screen',('TokenPay首次实测-候选未采用次数耗尽-20261014.png',(285,3820,1220,4110))],
 [7,5,'本轮调用限额','已用 1 / 1 次','调用限额已用完，不能在演示时重复消费。','budget',None],
 [7,5,'控制权属于本人','候选不自动上传，\n最终发布禁用。','调用限额已用完，不能在演示时重复消费。','budget',None],
 [9,6,'真实账单摘要','调用消费\n¥0.002188','这次调用输入177、输出758 tokens，消费0.002188元。','cost',None],
 [8,6,'官网应用归因 · 2026-10-14','后台收益\n¥0.000267','官方Eli应用后台出现成功记录，收益0.000267元。','screen',('TokenPay首次实测-应用归因收益列-20261014.png',(0,95,1245,350))],
 [8,6,'本人流程自测','证明接入通路，\n尚未证明市场价值。','这是开发者本人自测，证明接入归因通路，不代表外部用户或市场验证。','cost',None],
 [8,7,'充值步骤示意 · 非实测交易','余额不足时，\n先暂停原请求。','余额不足会暂停请求。用户确认金额、本人支付、核实到账后，再确认重试原请求。','recharge',None],
 [7,7,'充值实现与离线测试','余额充足，\n真实充值未测试。','当前余额充足，没有为演示制造不足，也没有创建支付会话。','recharge',None],
 [3,8,'当前版本','只准备，\n不发布。','当前版本只准备、不发布。','ending',None],
 [7,8,'下一步验收','真实使用，\n才能证明价值。','下一步要完成真实充值验收和独立试用，再用持续使用与净省时证据决定是否有价值。','ending',None],
]
assert sum(s[0] for s in shots)==180
source_names=sorted({s[6][0] for s in shots if s[6]})
sources=[{'path':str(EVIDENCE/n),'sha256':hashlib.sha256((EVIDENCE/n).read_bytes()).hexdigest()} for n in source_names]
bili=json.loads((EVIDENCE/'TokenPay重载-B站三稿恢复总回执-20261014.json').read_text())
bill=json.loads((EVIDENCE/'TokenPay首次真实调用-归因及账单核对-20261014.json').read_text())
assert bill['status']['receipt']['costMicros']==2188
assert bill['officialAppVerification']['revenueYuan']=='0.000267'
assert all(x['videoStage']['stage']=='prepared' and x['settingsStage']['stage']=='settings_verified' for x in bili['drafts'])

def panel(d,x=710,y=182,w=1130,h=660):d.rounded_rectangle((x,y,x+w,y+h),radius=22,fill='white',outline='#dce1e9',width=2)
def card(d,y,title,body,accent=False):
    d.rounded_rectangle((752,y,1798,y+150),radius=14,fill='#eaf0ff' if accent else '#f5f7fa')
    text(d,(780,y+18),title,34,980,BLUE if accent else INK)
    text(d,(780,y+74),body,27,980,SUB)
def compose(i,s,start):
    duration,section,kicker,title,caption,kind,asset=s
    im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
    d.text((76,32),'Eli 社媒发布工作台',font=font(27),fill=INK)
    d.text((1335,35),'参赛审阅版 · 未提交 / 未发布',font=font(24),fill=SUB)
    d.line((76,95,1844,95),fill='#dce1e9',width=2)
    text(d,(76,175),f'{section:02d} / {kicker}',25,570,BLUE)
    y=text(d,(76,240),title,54,560,INK,19)
    notes={'screen':'现有真实截图的局部画面\n不点击，不触发新的上传或调用。','hero':'本机运行的多平台投稿准备助手。\n最终发布仍由本人核对。','safety':'历史准备证据与当前会话分开。\n未知状态先核对，不盲目重传。','bili':'已记录回执摘要，不是实时界面。\n三个视频文件SHA256逐项一致。','capability':'单MP4 ≤100 MB。\n当前能力不等于所有平台自动发布。','handoff':'工作台生成本地原图与文案包。\n手机App填写、保存与发布尚未验收。','budget':'限额已耗尽；候选尚未采用。\n本次视频制作没有新增模型请求。','cost':'费用与分润分别记录。\n本人自测，不是外部付费用户。','recharge':'示意图，非真实交易。\n当前充值创建关闭，无支付会话。','ending':'本地技术演示可用。\n商业结果与获奖资格尚未证明。'}
    text(d,(76,max(480,y+32)),notes[kind],29,555,SUB,18)
    panel(d)
    if asset:
        p,crop=asset;src=Image.open(EVIDENCE/p).convert('RGB');src=src.crop(crop)
        fit=ImageOps.contain(src,(1080,580),Image.Resampling.LANCZOS)
        im.paste(fit,(735+(1080-fit.width)//2,217+(580-fit.height)//2));d=ImageDraw.Draw(im)
        label='真实截图 · '+('2026-10-13历史实测' if '20261013' in p else '2026-10-14')
        d.text((746,807),label,font=font(23),fill=BLUE)
    elif kind in ('hero','safety'):
        card(d,215,'01  整理素材与母稿','草稿、独立平台版本、完整备份')
        card(d,393,'02  分别准备与核对','原生编辑页 / App接续包分别记录',True)
        card(d,571,'03  最终决定由本人作出','候选先审阅；暂不发布')
    elif kind=='bili':
        for j,row in enumerate(bili['drafts']):card(d,215+j*178,row['title'],f"上传与文案通过 · 分区：{' / '.join(row['category'])} · 标签：{'、'.join(row['tags'])}",j==2)
        d.text((770,773),'前两稿页面仍打开，标题 / 简介未变。',font=font(26),fill=SUB)
    elif kind=='capability':
        card(d,215,'小红书','图文 / 视频：历史原生准备实测')
        card(d,393,'抖音','图文 / 视频：历史实测，含视频封面与话题')
        card(d,571,'B站','视频本次三稿恢复；图文为App接续',True)
    elif kind=='handoff':
        card(d,215,'本地原图与独立文案','图片按顺序编号，标题、正文、标签分别导出')
        card(d,393,'ZIP准备包已实际下载并核验','原图字节与顺序保持；不上传B站',True)
        card(d,571,'本人在手机App手动接续','尚未核实App填写、保存与发布')
    elif kind=='budget':
        text(d,(780,232),'Qwen3.8 Flash',46,980,INK)
        text(d,(780,327),'1 / 1 次',90,980,BLUE)
        text(d,(780,475),'当前授权次数已用完',36,980,INK)
        text(d,(780,565),'候选未采用 · 事实确认未勾选\n再次生成禁用 · 最终发布禁用',32,980,SUB,22)
        text(d,(780,724),'来源：真实状态回执与工作台截图',24,980,SUB)
    elif kind=='cost':
        text(d,(780,227),'一次真实调用 · 本人流程自测',34,1000,INK)
        text(d,(780,313),'¥0.002188',84,1000,BLUE)
        text(d,(780,439),'余额 ¥20 → ¥19.997812',38,1000,INK)
        text(d,(780,524),'输入 177 / 输出 758 tokens\n官网应用收益 ¥0.000267',34,1000,SUB,22)
        text(d,(780,720),'具体trace匹配账单；应用归因由官网独立核实。',25,1000,SUB)
    elif kind=='recharge':
        labels=['余额不足 → 暂停原请求','用户确认金额 → 本人支付','核实到账 → 本人确认重试']
        for j,label in enumerate(labels):card(d,215+j*178,f'{j+1:02d}  {label}','实现及离线验证；真实充值、到账与重试未实测',j==2)
    elif kind=='ending':
        card(d,215,'已核实：本地产品与准备通路','一次真实模型调用、账单与应用归因',True)
        card(d,393,'待验收：真实充值与独立试用','不制造调用，不耗空额度，不冒充外部用户')
        card(d,571,'待证明：净省时与持续使用','真实使用和收益，才是赛事评价依据')
    # Burned-in approved captions. Entire caption remains static in this shot.
    d.rounded_rectangle((76,890,1844,1019),radius=15,fill='#172332')
    lines=wrap(caption,font(34),1640);assert len(lines)<=2,(i,len(lines))
    y=906+(2-len(lines))*23
    for line in lines:
        f=font(34);d.text(((W-f.getlength(line))/2,y),line,font=f,fill='white');y+=48
    d.text((76,1036),'字幕演示 · 无配音 · 仅使用现有证据',font=font(20),fill=SUB)
    d.text((1695,1036),f'{start//60:02d}:{start%60:02d} / 03:00',font=font(20),fill=SUB)
    d.rectangle((76,1070,1844,1075),fill='#dce1e9');d.rectangle((76,1070,76+1768*(start+duration)/180,1075),fill=BLUE)
    im.save(FRAMES/f'{i:02d}.png')

def ts(v):return f'{int(v)//3600:02d}:{int(v)//60%60:02d}:{int(v)%60:02d},000'
timeline=[];srt=[];start=0
for i,s in enumerate(shots):
    compose(i,s,start)
    timeline.append({'index':i,'start':start,'end':start+s[0],'section':s[1],'label':s[2],'title':s[3],'caption':s[4],'source':s[6]})
    srt.append(f'{i+1}\n{ts(start)} --> {ts(start+s[0])}\n{s[4]}\n')
    start+=s[0]
(ROOT/'字幕-v1.srt').write_text('\n'.join(srt))
(ROOT/'timeline.json').write_text(json.dumps({'duration':180,'resolution':[W,H],'audio':'none','network':False,'sources':sources,'shots':timeline},ensure_ascii=False,indent=2))

concat=[]
for i,s in enumerate(shots):
    out=ROOT/f'shot-{i:02d}.mp4'
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-n','-loop','1','-framerate','24','-i',str(FRAMES/f'{i:02d}.png'),'-t',str(s[0]),'-vf',f'fade=t=in:st=0:d=0.15,fade=t=out:st={s[0]-0.15}:d=0.15','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',str(out)]
    subprocess.run(cmd,check=True)
    concat.append(f"file '{out.name}'")
    print(f'rendered {i+1}/{len(shots)}',flush=True)
(ROOT/'concat.txt').write_text('\n'.join(concat))
final=ROOT/'Eli-参赛演示-审阅版-v1.mp4'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-n','-f','concat','-safe','0','-i',str(ROOT/'concat.txt'),'-c','copy','-movflags','+faststart',str(final)],check=True)
print(str(final),flush=True)
