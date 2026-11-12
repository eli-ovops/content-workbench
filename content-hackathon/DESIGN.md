---
name: Eli 社媒发布工作台
description: 本地素材、母稿与三个渠道版本的编辑工作台
colors:
  primary: "#2463dd"
  primary-hover: "#174dba"
  text: "#20252e"
  muted: "#5b677a"
  page: "#f6f7fa"
  surface: "#ffffff"
  sidebar: "#eff2f7"
  line: "#e3e7ee"
  button: "#edf0f5"
  button-hover: "#e4e9f2"
  disabled-bg: "#eceff3"
  disabled-text: "#5e6775"
  selected-draft: "#e1e9f8"
  selected-channel: "#f0f5ff"
  selected-channel-line: "#a9c4f8"
  input-placeholder: "#667182"
  segmented-bg: "#f0f3f8"
  segmented-active-text: "#1c4b9c"
  upload-bg: "#f9fbfe"
  upload-line: "#b7c4d8"
  upload-hover: "#edf4ff"
  toast: "#27344b"
  xhs: "#cf2446"
  douyin: "#252a31"
  bilibili: "#146b99"
  check-error: "#b4233d"
  check-success: "#34654e"
typography:
  heading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  section:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "17px"
    fontWeight: 620
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
  field:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  supporting:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
rounded:
  input: "9px"
  control: "10px"
  upload: "12px"
  panel: "14px"
spacing:
  segmented-inset: "4px"
  field-gap: "9px"
  action-gap: "10px"
  field-padding: "12px"
  mobile-gutter: "16px"
  compact-panel: "20px"
  field-separation: "22px"
  panel-padding: "26px"
  editor-gap: "28px"
  workspace-padding: "38px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-default:
    backgroundColor: "{colors.button}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-disabled:
    backgroundColor: "{colors.disabled-bg}"
    textColor: "{colors.disabled-text}"
  field-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.input}"
    padding: "{spacing.field-padding}"
  editor-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
  channel-selected:
    backgroundColor: "{colors.selected-channel}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Eli 社媒发布工作台

## Overview

**Creative North Star: "清晰准备，一份母稿，逐平台定制"**

当前系统是 Operate 阶段的本地编辑 UI：使用已确认图标 `assets/eli-social-publisher-icon-v5.png`，提供素材导入、母稿编辑、小红书/抖音/B站选择及渠道版本编辑。白色编辑面、冷灰侧栏、深色正文和蓝色操作色支持长时间阅读与输入；平台色仅用于渠道识别。

本记录提取自 `app/style.css` 的实际实现，按文件末尾覆盖后的生效值记录；具体 CSS 不标为用户逐项确认。产品边界以 `PRODUCT.md` 为准：支持视频、图文、纯文字的编辑准备，平台自动发布、TokenPay OAuth 和 AI 尚未接入。

**Key Characteristics:**

- 共享母稿与平台版本并列呈现。
- 用间距、底色和细边线划分区域。
- 真实保存状态与操作反馈始终可辨。
- 桌面双编辑列，窄屏顺序堆叠。

## Colors

操作主色 `#2463dd`，悬停 `#174dba`；正文 `#20252e`，辅助色 `#5b677a`。页面底色 `#f6f7fa`，面板白色，侧栏 `#eff2f7`，边线 `#e3e7ee`。输入占位色为 `#667182`，禁用操作文字为 `#5e6775`。

小红书 `#cf2446`、抖音 `#252a31`、B站 `#146b99`。选中草稿使用 `#e1e9f8`；选中渠道使用 `#f0f5ff` 与 `#a9c4f8` 边线。前述值均来自 CSS；没有另建或推演色阶。

## Typography

系统栈为 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`。正文根字号14px；主标题桌面28px/650，行高1.35、字距-0.025em，在950px及以下变为25px，在640px及以下变为23px。分区标题17px/620，输入文字13px/400、行高1.7。

提示、侧栏本地说明、草稿副标题、分区说明、复用说明及素材文件名的最终字号均为12px；手机端分区说明也保持12px。品牌名桌面23px、手机20px；其他局部字号以实际组件 CSS 为准。

## Layout

桌面 `body` 采用232px侧栏和弹性主区；主区最大宽1340px、内边距38px。编辑区为 `minmax(0,1.25fr) minmax(285px,.85fr)`，列间距28px；编辑和预览面板内边距26px。导航侧栏、共享编辑、平台版本构成整体阅读顺序。

1150px及以下主区内边距28px、编辑间距18px、面板内边距20px。950px及以下侧栏190px、编辑区单列。640px及以下页面改为块布局、侧栏置顶、导航三列、草稿列表横向滚动；主区内边距24px 16px，面板内边距20px 17px，操作区允许换行。素材列表固定两列，媒体容器高130px并使用 `object-fit:contain`。

## Elevation & Depth

普通编辑面板依靠底色与圆角，无投影。选中的内容类型按钮使用 `0 2px 5px #00000012`；浮动反馈使用 `0 8px 28px #00000022`，深色底配白字。只记录 CSS 已存在的两种阴影。

按钮只有 `background .16s` 转场；没有装饰动画。焦点使用2px蓝色轮廓、3px偏移，适用于按钮、链接、输入、文本域及含聚焦输入的标签。

## Shapes

面板圆角14px，按钮/分段控件/渠道选项/素材容器10px，输入9px，上传框与浮动反馈12px。按钮默认最小高度42px；内容类型分段按钮最小高度36px。这些是现有组件事实，不能概括成所有触控控件均至少42px。

## Components

- **按钮**：主操作蓝底白字，次操作白底细边线，普通操作冷灰底；禁用状态明确改变文字、底色和鼠标指针。
- **输入**：13px正文、12px内边距、9px圆角、1px边线；文本域允许垂直调整且最小高130px。只读字段使用浅灰底和较弱文字。
- **内容类型**：三个等宽分段按钮，选中项白底、蓝色文字及轻阴影；保留 `aria-pressed` 状态。
- **渠道选项**：原生16px复选框、平台文字色与选中底色共同表示选择；标签含聚焦输入时显示轮廓。
- **导航**：普通导航透明底，当前项白底；当前草稿蓝灰底。手机端导航三列、草稿横向滚动。
- **素材导入**：虚线边框、浅色底、真实文件输入；悬停或拖入时使用更明显的蓝色边框和浅蓝底。
- **预览**：称为“文案预览”，保留换行和长词换行；平台标签选中项以蓝色下边线标记，不冒充平台最终排版。
- **状态**：未保存/保存中/已保存在此浏览器/保存失败分别呈现。发布连接未建立时禁用发布并说明原因；复制/导出需要标题或正文及至少一个选择平台。素材预览使用浏览器 Blob URL，切换草稿时释放。

## Do's and Don'ts

### Do:

- 保持母稿共享与平台定制版本的区别。
- 使用现有系统字体、蓝色操作色和可见焦点。
- 空状态给出真实导入入口，保存失败明确报错。
- 将编辑准备、账号连接和真实发布结果分别表达。

### Don't:

- 不填虚假素材、登录头像或发布成功状态。
- 不将平台色用于无关主操作。
- 不加入密钥输入框或假 AI 生成按钮。
- 不把文案预览描述为平台最终排版。

记录日期：2026-10-12。阶段证据：`evidence/工作台桌面复验-20261012.png`、`evidence/工作台手机复验-20261012.png`。本记录不代表平台发布或 TokenPay 接入验收。
