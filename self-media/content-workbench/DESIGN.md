---
name: Eli 内容工作台
description: 延续Eli身份与排版的白色写作工作空间
colors:
  primary: "#6b46d9"
  primary-hover: "#5934c1"
  accent: "#6037c8"
  ink: "#202020"
  muted: "#666666"
  ground: "#ffffff"
  rail: "#fafafa"
  paper: "#ffffff"
  line: "#e5e5e5"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.018em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
  writing:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    lineHeight: 1.9
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
rounded:
  input: "8px"
  control: "999px"
  sheet: "20px"
spacing:
  small: "8px"
  medium: "16px"
  section: "24px"
  workspace: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "9px 11px"
---
## Overview
2026-10-13用户最新明确要求白色界面，保留白色背景，Logo、主要按钮和选中元素可用紫色。保留此前官网参考中的Eli标识、系统字体、胶囊控件和动效节奏，配色遵从此次白底紫色元素偏好。模式Operate，稿件优先；同Owner实施与有界视觉检查。
## Colors
背景和编辑面#ffffff，侧栏/顶栏#fafafa，正文#202020，次要文字#666666，主动作#6b46d9，悬停#5934c1，焦点#6037c8，选中面#f3efff，边线#e5e5e5。错误与待保存仍保留独立语义色。全部功能页面统一浅色。
## Typography
Helvetica Neue/PingFang SC系统字族；正文16px/1.9、界面14px，标签12px；标题30px/650，窄屏22px。正文区域保留75ch最大宽度。
## Layout
维持侧栏、中央稿件、右侧资料和平台双栏。桌面212px侧栏，900px以下单列工作区，640px以下导航移上方。保留专注模式、来源渐进披露、键盘标签页与显式保存。
## Elevation & Depth
白色编辑面与浅灰导航区分层。轻灰边框、普通面板无投影；反馈浮层使用0 6px 22px rgb(0 0 0 / 10%)。
## Shapes
主操作和标签胶囊形；稿件导航12px、编辑表面20px、输入8px、窄屏编辑面16px。Eli八向几何标记使用紫色。
## Components
原有120/200ms功能反馈与cubic-bezier(.16,1,.3,1)缓动保留；减少动态效果规则保留。输入白底深字、键盘焦点紫色。保存、版本、恢复和默认空间保留。启动器自动进入稿件，不显示连接编号；未连接网页提示从启动器打开，可以检查已有连接。页面未保存编辑保留。
稿件标题下方“删除稿件”使用次级动作，移到回收站后可即时恢复；左侧底部固定回收站入口。回收站以列表显示标题、版本数与移入时间，提供单篇恢复；删除最后一篇后展示新建入口。未保存编辑阻止切换/删除，保持页面缓冲。
## Do's and Don'ts
- 保持白色与浅灰工作面、深灰文字与紫色主按钮。
- 延续Eli身份、字体和排版，紫色限于标识、动作与选中元素，保持白色工作面。
- 让正文、保存状态和来源易读。
- 原稿与历史版本保留；个人网站无需改动。

2026-10-13交互补充：未保存编辑用原生模态确认保护焦点，返回编辑为默认焦点，支持Esc；只有保存成功后继续操作。白色16px圆角表面、现有紫色主动作、克制背景遮罩。新建优先写稿和标题，列表显示真实活动时间并在窄屏保持选中项可见。颜色、主体排版和原动效保留。
