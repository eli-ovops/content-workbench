# Eli 内容工作台

版本0.1.3，白色工作面与紫色Logo、主按钮。统一启动入口：在 Finder 双击“启动内容工作台.command”，自动启动服务、连接Chrome并打开稿件。已有会话时也可直接打开[工作台](http://127.0.0.1:56442/)。

在 Finder 双击工程根“启动内容工作台.command”；停止和恢复也使用同目录对应入口。旧“启动已验收工作台.command”是同一入口的兼容别名。默认根由 [workspace.json](/Volumes/EXTERNAL/自媒体/content-workbench/workspace.json) 唯一指定，不再分成两个工作台。

原来的两份稿件已完整复制到默认工作空间，正文、版本、来源、备注和平台文案保留；原库 data/synthetic-demo 及原稿仍保留原样。当前列表同时保留验收稿。公开文字的临时确认未迁移，使用前须重新核对。

本版通过29项自动检查，以及真实Finder启动、Chrome自动连接、新建写稿、保存、刷新、关闭重开、v1/v2、删除恢复和服务重启自动重连的完整流程。原有9份稿件逐对象SHA未变。本轮验收稿已移入回收站，两个版本保留。正式内容放行、审片及发布仍按原流程办理。

首次、服务重启或会话到期后，再双击同一启动文件即可，全程不输入编号、不等待终端输入。会话有效期间同一浏览器直接打开统一网址即可使用。无需安装依赖。

- [本版启动与会话验收](/Volumes/EXTERNAL/自媒体/content-workbench/evidence/startup-repair-20261013/CHANGE_RECEIPT.json)
- [真实Finder与Chrome使用流程](/Volumes/EXTERNAL/自媒体/content-workbench/evidence/startup-repair-20261013/native-flow.json)

- [使用指南](/Volumes/EXTERNAL/自媒体/content-workbench/docs/使用指南.md)
- [运行与恢复](/Volumes/EXTERNAL/自媒体/content-workbench/docs/运行与恢复.md)
- [最新迁移与默认验收回执](/Volumes/EXTERNAL/自媒体/content-workbench/evidence/unified-default-20261013/final-receipt.json)
- [默认浏览器验收](/Volumes/EXTERNAL/自媒体/content-workbench/evidence/unified-default-20261013/browser-receipt.json)

稿件标题下方可点“删除稿件”，将整篇稿件移到回收站；正文、来源、画面备注和所有历史版本保留。左侧底部“回收站”可恢复原稿件，删除提示也提供即时恢复。未保存编辑须先保存，删掉最后一篇后显示新建入口。回收站稿件仍计入本地容量/数量限额，不自动清空。

最新写稿交互：新建直接写稿、标题自动选中，未保存时可保存并继续；稿件按最近活动排序并显示时间，搜索空态可清除。37项自动检查及桌面/窄屏实测通过，现有稿件完整保留，自动启动流程保持。
