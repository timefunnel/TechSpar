# 简历模块(移植自 Magic Resume)

本目录代码移植自 [Magic Resume](https://github.com/JOYCEQL/magic-resume),
基于其 v2.0.7(commit `33b9b6db1bba480af630951472446feea3e2993b`,2026-07-27)。

## 协议

本目录代码遵循上游原始协议:**Apache License 2.0 + 附加商业限制条款**,
全文见本目录 [`LICENSE`](./LICENSE)。要点:

- 仅限个人非商业用途免费使用;任何商业化使用(SaaS、嵌入商业产品、二开商用等)须先获得上游作者的商业授权。
- TechSpar 本身为 CC BY-NC 4.0 的非商业开源项目,与上述条款不冲突;但如果你 fork 本项目并商用,需自行处理本目录的授权问题。

## 相对上游的主要改动(Apache 2.0 §4 要求的变更声明)

- **框架适配**:TanStack Start / Next.js 残留 → Vite + react-router-dom;路由 shim(`lib/navigation.ts`)重写。
- **剥离 AI 能力**:删除 AI 润色、语法检查及 Gemini 依赖(`components/ai`、`grammar`、相关 store/hooks/api)。
  TechSpar 自有的评估/优化入口位于 `advice/`，复用账号的模型服务，不依赖上游 Gemini 服务。
- **PDF 导出**:删除依赖上游远程服务(api.magicv.art)的导出路径,保留纯客户端的浏览器打印、JSON、Markdown 导出。
- **数据持久化**:仅保留 localStorage(zustand persist);删除 File System Access API 目录同步与 IndexedDB 句柄存储。
- **i18n**:上游 next-intl shim 精简为仅中文的静态实现,删除英文文案与示例数据。
- **字体**:不再随仓库分发上游的 ttf/otf 字体原件(约 149MB),改用 `@fontsource/noto-sans-sc`、`@fontsource/noto-serif-sc`(SIL OFL)自托管 woff2 切片,按 unicode-range 按需加载;另保留系统楷体选项(`utils/fonts.ts`、`styles/fonts.ts`)。
- **模板缩略图**:删除 Playwright 生成的静态 PNG 快照,改为用当前简历数据实时缩放渲染(`shared/TemplateSheet.tsx`)。
- **HeroUI**:移除仅剩的两个 HeroUI 日期输入组件,日期字段改为自由文本输入(`editor/Field.tsx`)。
- **杂项**:lodash 用内联 throttle/debounce 替代;uuid 依赖改为 `crypto.randomUUID`;`tiptap.scss` 预编译为 CSS;样式令牌桥接到 TechSpar 的 Tailwind 4 主题变量。

## 入口

- 列表页:`src/pages/ResumeManager.jsx`(路由 `/resume-manager`)
- 编辑器:`src/pages/ResumeEditor.jsx` → `WorkbenchPage.tsx`(路由 `/resume-manager/:id`)

## 简历评估与优化

- PDF 区可评估当前账号的原始 PDF；需要优化时先“解析为模板简历”。
- 编辑器顶部“评估 / 优化”分析可见文本，可选填写目标岗位和 JD。
- 评估给出五维参考分、原文依据、问题和待补信息；总分为五维等权平均。它不代表录用概率或真实性认证。
- 优化仅修改已有正文字段，逐项展示前后对比。明确选择并确认后另存优化版，原稿、联系方式、日期字段、经历条目、模板和全局排版设置均保留；不会替换面试使用的 PDF。
- 使用“设置”中现有模型服务和额度。可见联系方式会随文本发送给该服务，照片和证书图片不发送。
- 文本最多 40000 字符，JD 最多 12000 字符；超长明确拒绝，不截断。异常模型输出、未知字段和新增数字被拒绝，不自动重试或产生兜底报告。
- 分析期间切换账号、修改原稿会使旧建议失效。保存失败明确报错，不声称已保存。
