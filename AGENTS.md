# YesSir 扩展 — AI / 协作者说明

本文档依据**当前仓库代码**整理，用于后续改代码时对齐结构；若与实现不一致，以代码为准。

---

## 1. 项目背景与定位

- **仓库内产品说明**：根目录 `README.md` 将 YesSir 描述为面向高频办公的 Chrome 扩展，强调修饰键交互（如双击空白处关闭、双击修饰键打开面板切换/后悔药）、域名聚合分组、使用统计、毛玻璃风格 UI 等；具体文案以 `README.md` 为准。
- **商店展示文案（i18n）**：扩展名称与简介来自 `_locales/zh_CN/messages.json` / `en/messages.json`（`extensionName`、`extensionDescription`），当前中文概要包含：跨窗口标签整理、AI 自动分组、快速切换、双击关闭、智能语义搜索、毛玻璃风格等表述。
- **实现形态**：本仓库主体为 **Manifest V3 扩展**（Service Worker + 全站注入的 content scripts）；AI 能力依赖 **DeepSeek API**（可直连或通过 `api.pmtools.com.cn` 中转，见 `manifest.json` 的 `host_permissions` 与 `bg-ai-network.js`）。根目录 **`proxy-server/`** 为可选的独立 Node 中转服务，**不**随扩展安装自动运行。

---

## 2. 仓库目录结构（当前）

以下为扩展根目录主要条目（不含 `.git` 等版本控制元数据）：

```text
YesSir/
├── AGENTS.md                 # 本说明（AI / 协作者）
├── README.md                 # 产品简介与使用说明
├── manifest.json             # MV3 清单：权限、后台、content_scripts 顺序
├── background.js             # Service Worker 入口：importScripts 与启动恢复
├── rules.js                  # 分组 / 域名等共享规则（被 SW import）
├── bg-core.js                # 标签轨迹、favicon 缓存、设备 UUID 等
├── bg-ai-network.js          # DeepSeek、AI 快照/聚类、搜索建议等网络逻辑
├── bg-messages.js            # chrome.runtime.onMessage 唯一路由
├── content.js                # 页面内入口：消息重试封装、快捷键、与后台通信
├── content-switcher/         # 标签切换面板（按 manifest 顺序加载）
│   ├── 01-utils-and-state.js
│   ├── 02-selection-and-scroll.js
│   ├── 03-build-tab-item.js
│   ├── 04b-switcher-list-bundle.js
│   ├── 04-show-switcher.js
│   └── 05-hide-and-toasts.js
├── _locales/
│   ├── zh_CN/messages.json
│   └── en/messages.json
├── icon_16.png / icon_48.png / icon_128.png
├── proxy-server/             # 独立 Node 中转（非扩展打包必需）
│   ├── package.json
│   └── server.js
└── .github/workflows/deploy.yml
```

`manifest.json` 中声明的 `web_accessible_resources` 含 `_favicon/*`；代码中通过 `chrome-extension://…/_favicon/?pageUrl=…` 使用浏览器提供的 favicon 能力（见 `content-switcher/01-utils-and-state.js`），**仓库内未必存在物理 `_favicon/` 目录**。

---

## 3. 项目是什么（技术要点）

- **Chrome 扩展（Manifest V3）**，名称与描述走 i18n：`manifest.json` 中 `__MSG_extensionName__` 等，默认语言 `zh_CN`（见 `_locales/zh_CN/messages.json`、`en`）。
- **当前版本号**：见 `manifest.json` 的 `"version"` 字段（编写时为 `1.4`）。
- **根目录 `proxy-server/`**：独立的 **Node.js 中转服务**，用于 DeepSeek 代理与限流；**不属于**扩展打包进 `.crx` 的部分，需单独部署。

---

## 4. 扩展入口与权限

- **后台**：`manifest.json` → `"background": { "service_worker": "background.js" }`。
- **内容脚本**：`manifest.json` → `content_scripts[0].js` 数组，**顺序敏感**（同一页面共享全局作用域，见下节）。
- **权限 / 主机权限**：以 `manifest.json` 中 `permissions`、`host_permissions` 为准（含 `tabs`、`storage`、`sessions`、`tabGroups`、`windows`、`favicon`、`search` 及 DeepSeek/中转/搜索建议域名）。

---

## 5. Service Worker（后台）加载顺序

`background.js` 仅负责 `importScripts`，**顺序不可随意调换**（共享全局，后加载脚本依赖先加载脚本中的函数与变量）：

1. `rules.js` — 与分组/域名/分类规范化等相关的共享函数（被 `bg-ai-network.js` 等使用）。
2. `bg-core.js` — 全局标签轨迹（Mod+E「上一个标签」）、favicon 缓存、设备 UUID 等。
3. `bg-ai-network.js` — DeepSeek 调用、AI 快照/聚类、搜索建议 `fetch` 等。
4. `bg-messages.js` — **唯一**注册 `chrome.runtime.onMessage` 的消息路由。

`background.js` 在全部 `importScripts` 执行完毕后，依次调用（与历史单文件行为对齐）：

- `void restoreGlobalTabHistory();`
- `void restoreAiSnapshotCache();`
- `void restoreFaviconCache();`

新增后台逻辑时：优先放入职责对应的 `bg-*.js`，并在 `background.js` 中保持上述顺序；**不要**重复 `importScripts('rules.js')`（仅入口引用一次）。

---

## 6. 内容脚本（页面内）加载顺序

`manifest.json` 中 `js` 数组**从上到下**执行，须满足：

1. **`content.js` 必须第一个** — 提供 `ysRuntimeSendMessageRetry`、`window.__ysRuntimeSendMessageRetry`、弹窗/浮窗等；`content-switcher` 内通过 `ysSendToBg` 依赖该封装。
2. 随后为 `content-switcher/` 下模块，**数字与 04b 顺序固定**：
   - `01-utils-and-state.js`
   - `02-selection-and-scroll.js`
   - `03-build-tab-item.js`
   - `04b-switcher-list-bundle.js` — `ysSwitcherAttachListRenderBundle`（列表渲染与网页建议等）
   - `04-show-switcher.js` — `showSwitcher` 主流程
   - `05-hide-and-toasts.js` — `hideSwitcher`、处理中 Toast 等

新增 `content-switcher` 文件时：**不要**破坏「`04b` 在 `04` 之前」的依赖关系；大段逻辑应放在新文件并在 `manifest` 中插入到正确位置。

---

## 7. `rules.js`

- 由 **Service Worker** 通过 `importScripts('rules.js')` 加载。
- 提供如 `getDomainFromUrl`、`getTabGroupDomainKey`、分类/站点名规范化等，供后台 AI 聚类与 content-switcher 侧注释中的「一致性」约定参考。

---

## 8. 前台 → 后台消息（`bg-messages.js` 中处理的 `request.action`）

以下列表摘自 `bg-messages.js` 的 `if / else if` 分支（**以代码为准**）：

| action | 说明（简要） |
|--------|----------------|
| `ping` | 唤醒 SW，返回 `{ ok: true }` |
| `close_and_toast` | 关闭当前标签并记录用量，向新 active 页发 `show_toast` |
| `close_tab_by_id` | 按 id 关闭标签 |
| `switch_tab` | 激活指定标签 |
| `switch_tab_global` | 跨窗口激活标签 |
| `restore_last_3_tabs` | 恢复最近关闭的会话 |
| `get_daily_stats` | 读取 `dailyStats` |
| `get_tabs` | 全窗口标签列表（供面板） |
| `get_ai_snapshot` | AI 快照缓存 |
| `prewarm_ai_snapshot` | 预热 AI 快照 |
| `prewarm_ai_current_window` | 当前窗口静默预热 |
| `classify_tabs` | 分类 |
| `get_tab_page_labels` | 页面标签 |
| `ai_batch_group` | 批量 AI 建组 |
| `switch_to_last_tab` | 切到全局记录的「上一个」标签 |
| `get_last_context` | 上一标签上下文（面板 footer 等） |
| `get_search_suggestions` | 搜索建议 |
| `search_web` | 网页搜索 |
| `ai_search_tabs` | AI 搜索标签 |

部分分支使用 `sendResponse` 且 `return true` 表示异步响应，**修改时勿破坏**该约定。

后台向 **content** 发送的消息（示例，见 `bg-messages.js`）包括：`force_hide_switcher`、`show_message_toast` 等。

---

## 9. `content.js` 侧接收的后台消息

`content.js` 中 `chrome.runtime.onMessage` 处理：

- `show_toast`
- `show_message_toast`
- `force_hide_switcher`

（实现见 `content.js` 内监听器。）

---

## 10. 前台主要交互（与 `content.js` 相关）

- **修饰键 + E**：`keydown` 捕获阶段，`action: 'switch_to_last_tab'`（经 `ysRuntimeSendMessageRetry`）。
- **双击修饰键**：打开标签面板 — `get_tabs` → `showSwitcher`（定义在 `content-switcher`）→ `initSwitcherHighlight`、`checkAndShowFeedbackFlyout`。
- **Escape**：若面板可见则 `hideSwitcher`。
- **静默预热**：如 `trySilentAiPrewarm` 使用 `prewarm_ai_current_window` 等（见 `content.js`）。

具体快捷键常量、双击间隔等以 `content.js` 内变量为准。

---

## 11. 与 AI 相关的网络路径

- 扩展内直连：`api.deepseek.com`（用户自填 Key 等逻辑见 `bg-ai-network.js`）。
- 中转：`api.pmtools.com.cn`（与 manifest `host_permissions` 一致）。
- 搜索建议：`suggestqueries.google.com`（见 `bg-ai-network.js` 中 `fetchSearchSuggestions`）。

---

## 12. `proxy-server/`

- Node HTTP(S) 服务，入口 `proxy-server/server.js`。
- 用途与限流说明见该文件头部注释；环境变量（如 `DEEPSEEK_API_KEY`、`PORT`、每日限额）以注释为准。
- **不**随扩展自动运行；本地开发需自行 `npm`/`node` 启动。

---

## 13. 修改代码时的约定（建议）

1. **新增 `content_scripts` 文件**：必须同时改 `manifest.json` 的 `js` 数组，并确认依赖顺序。
2. **新增后台脚本**：在 `background.js` 的 `importScripts` 中插入到正确依赖位置，并避免循环依赖。
3. **新增 `request.action`**：在 `bg-messages.js` 增加分支，并同步文档；若 content 需调用，统一走 `chrome.runtime.sendMessage` / 已有的 `ysRuntimeSendMessageRetry` 封装。
4. **不要**在多个文件中重复 `registerListener` 导致同一事件重复注册（当前 `onMessage` 仅在 `bg-messages.js`）。

---

## 14. 文档维护

- 若架构或 `action` 列表有变，**以本文件与代码同步更新**；若仅一处变更，优先改代码后更新本文件对应小节。
