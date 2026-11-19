# 阅读工作台视觉调整 Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans; preserve the existing uncommitted workspace and do not perform git writes.

**Goal:** 将功能原型打磨为安静、清楚的阅读工作台，并交付实际可运行界面预览。
**Architecture:** 保留现有活动栏 / 同级侧栏 / 标签 / 阅读器布局及全部接口，只调整主题 token、控件呈现、组件样式与排版。
**Tech Stack:** 现有 Vue 3、TypeScript、CSS、inline SVG；无新增依赖。
**Spec:** 用户 2026-11-05 确认“改一下看看吧”；沿用 `docs/design/15-reader-workbench.md` 的交互与功能，落实本轮已讨论的字体、工具栏、层级和间距视觉修正。

> 历史记录：本方案随后被用户明确否定，不作为当前设计基准。当前界面与验证见 [VS Code 工作台重做记录](./vscode-workbench-plan.md)。以下保留当时方案与产物口径。

## Global Constraints

- 不增加功能、不改变目录 / 标签 / 搜索行为，不安装、不提交 / 分支 / 推送，不改系统设置。
- 浅色为白色阅读面、蓝灰侧栏、柔和靛蓝强调；深色使用对应的蓝灰层次。App / Markdown 主题仍独立。
- UI 基础文字 13px；树行约 29px；工具控件约 30px；图标与选中态统一。中文阅读字体显式指定无衬线字体。
- 阅读区用留白和轻边界突出内容，保持约 800px 的正文行宽；纸张主题继续保留。
- 本轮为可逆视觉修改，验证已有交互、主题隔离和多窗口尺寸；不写仅重复 CSS 数值的单测，不重跑性能矩阵。

## Review Focus

- 640 / 960 / 1440 宽度下工具栏不遮住主题和文件操作；长标签可访问。
- 浅 / 深 App Theme 不污染正文主题，纸张主题不回退为外壳颜色。
- 侧栏调宽 / 收起及选中、hover、键盘 focus 状态清楚可见。
- 图标按钮保留可访问名称，原生 select 的键盘操作继续可用。
- 字体和排版确实应用到正文；截图须用实际浏览器渲染，不伪造静态界面。

## Task 1 — 整体主题与阅读面（root）

Files: `src/ui/src/styles/{base,markdown}.css`、`src/ui/src/App.vue` 的工具栏 markup。
- [x] 统一配色 token、字体、布局间距、工具栏控件，保留行为和 testid。
- [x] 细化欢迎页、状态栏、正文排版与内容表面。

## Task 2 — 导航组件视觉（component agent）

Files: `app/{ActivityBar,ExplorerPanel,DocumentTabs,SearchPanel}.vue` 的 scoped styles / 必要 class。
- [x] 统一 29px 树行、活动栏按钮底色、标签选中状态、搜索控件；非活动文件图标使用中性灰。
- [x] 保留全部 props / emits / aria-label / testid 与键盘逻辑，针对类型 / lint 检查。

## Task 3 — 实际预览与回归（root + QA agent）

Files: 新增 `tests/e2e/visual-preview.spec.ts`（截图与实际交互断言）、本执行记录。
- [x] 捕获浅色、深色、纸张与窄窗口截图，核对字体和溢出；开发样本选择工具在截图前隐藏以匹配正式界面。
- [x] 运行类型 / lint、既有浏览器交互回归与必要单测，审查截图后处理可见问题。
- [x] 构建新版本地 EXE；给用户实际截图与程序路径，不声明其已批准最终风格。

## Ledger

- 本轮用户已确认修改并查看效果；沿用当前工作目录，保留此前全部产物。
- 不调用图片生成器绘制应用截图；通过真实应用的浏览器渲染提供预览。
- 整体采用蓝灰外壳、靛蓝选中态与单一阅读面；原生 select 保留键盘操作并统一呈现，图标不引入新库。
- 实时验证：`pnpm.cmd e2e --workers 1` 共 18 项通过；新增视觉预览之后再次单独通过，覆盖 1440 浅 / 深、960 纸张、640 窄窗，主题隔离与工具可访问性正确。`ui:typecheck`、`lint:ci` 通过（原有非阻断 info 保留）。
- 字体证据：CDP 实际平台字体显示浅色 / 深色 / 640 正文为 MicrosoftYaHei，标题为 MicrosoftYaHei-Bold；纸张主题为 SimSun。`document.fonts.check` 仅作为 FontFaceSet 状态，不作为系统字体存在证据。
- 截图已由独立代理只读复核，无明显裁切、错位或对比度问题。640 宽度下正文空间较窄，用户可用同级活动栏收起侧栏；本轮不增加自动收起行为。
- 真实截图与字体记录位于 `artifacts/visual-refresh/`；该目录为本地预览产物，不提交。
- `pnpm.cmd tauri build --no-bundle` 通过，产物 `src/host/target/release/md-preview.exe`，10,302,464 bytes，SHA256 `1FF3E6DE695413D40D708BE1D1B3C4221A211AE3EEF876D461C92FF4ADB729E7`。
- 2026-11-05 10:23（上海）原生功能复验通过，见 `benchmarks/native-visual.json`：四档 IPC、七样本、实际目录与两标签缓存、位置 700 → 700、搜索、路径越界均正确。未重采 idle 或性能矩阵，也未扩大 Git 范围。
- 本轮仅样式 / 控件呈现 / 预览 QA；未运行无改动的 Rust 单测。原生选择器人工点击的既有桌面工具限制未外推为已解决。
