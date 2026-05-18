# YesSir — CLAUDE.md

Chrome 扩展，Manifest V3，极简标签页管理。当前版本 **v1.5.2**。

---

## 项目结构

```
YesSir/
├── manifest.json              # MV3 清单，权限声明
├── background.js              # Service Worker 入口（importScripts 顺序加载）
├── bg-core.js                 # 全局标签历史、favicon 缓存、设备 UUID
├── bg-telemetry.js            # 遥测上报（install/update/startup/first_use/feature_daily）
├── bg-ai-network.js           # AI 网络请求（DeepSeek API / pmtools 中转）
├── bg-i18n.js                 # background 侧 i18n（bgT 函数）
├── bg-messages.js             # chrome.runtime.onMessage 路由总线
├── rules.js                   # 过滤规则（被 background.js 最先加载）
├── content.js                 # 内容脚本主体：浮动组件、Toast、修饰键检测
├── content-switcher/
│   ├── 00-i18n.js             # 内容脚本 i18n（ysT 函数）
│   ├── 01-utils-and-state.js  # 公共状态与工具函数
│   ├── 02-selection-and-scroll.js  # 键盘导航、滚动
│   ├── 03-build-tab-item.js   # 单条标签 DOM 构建
│   ├── 04-show-switcher.js    # 面板壳体、顶栏、事件委托
│   ├── 04b-switcher-list-bundle.js  # 列表渲染 + 网页搜索建议
│   └── 05-hide-and-toasts.js  # hideSwitcher + 面板内 Toast
├── _locales/
│   ├── zh_CN/messages.json    # 简体中文字符串
│   └── en/messages.json       # 英文字符串
└── proxy-server/              # Node.js 代理服务器（遥测分析，独立服务）
```

---

## 核心功能

| 操作 | 触发方式 |
|------|---------|
| 关闭当前标签页 | 按住修饰键 + 双击页面空白处 |
| 呼出 / 关闭切换面板 | 双击修饰键（连续两次按下）或点击扩展栏图标 |
| 切回上一个标签页 | 修饰键 + E |
| 后悔药（恢复最近 3 个标签） | 面板内「后悔药」按钮 |
| AI 智能分组 | 面板内「AI 聚合」按钮 |

修饰键默认：Mac → `Command`，Windows/Linux → `Ctrl`，可在设置弹窗中更改并持久化到 `chrome.storage.local`。

---

## 消息总线（background ↔ content）

所有跨层通信走 `chrome.runtime.sendMessage`，路由在 `bg-messages.js`。

| action | 方向 | 说明 |
|--------|------|------|
| `ping` | content → bg | 唤醒 Service Worker |
| `close_and_toast` | content → bg | 关闭当前标签并显示计数 Toast |
| `close_tab_by_id` | content → bg | 面板内关闭指定标签 |
| `switch_tab` / `switch_tab_global` | content → bg | 切换标签（支持跨窗口） |
| `switch_to_last_tab` | content → bg | 切回全局上一个标签（Mod+E） |
| `restore_last_3_tabs` | content → bg | 恢复最近关闭的 3 个标签 |
| `get_tabs` | content → bg | 获取所有窗口的标签列表 |
| `get_daily_stats` | content → bg | 获取近 5 日使用统计 |
| `track_event` | content → bg | 埋点上报（`kind:'click'` 本地累计，`kind:'first_use'` 立即上报） |
| `ai_batch_group` | content → bg | AI 聚类并创建 Chrome 标签组 |
| `ai_search_tabs` | content → bg | AI 语义搜索（关键词提取） |
| `get_search_suggestions` | content → bg | 获取网页搜索建议 |
| `search_web` | content → bg | 用浏览器默认引擎新标签页搜索 |
| `update_tab_topic` | content → bg | 拖拽重分类：更新缓存 + 移动 Chrome 原生标签组（带 `lang` 字段区分中英） |
| `show_toast` | bg → content | 背景推送计数 Toast |
| `show_message_toast` | bg → content | 背景推送自定义文案 Toast |
| `force_hide_switcher` | bg → content | 强制关闭切换面板 |
| `toggle_switcher` | bg → content | 扩展图标点击后呼出/关闭切换面板 |
| `get_page_meta` | bg → content | AI 分组时获取模糊标题页的 meta 描述 |
| `refresh_category_bar` | bg → content | 分组变更后实时刷新面板分类 pill |

content 侧发消息统一使用 `ysRuntimeSendMessageRetry`（带指数退避重试，最多 4 次），避免 SW 睡眠唤醒后首条消息丢失。

---

## 主题与样式系统

- **CSS 变量**：所有颜色通过 `--ys-*` 变量声明，在 `content.js:ensureYsThemeStylesInjected()` 中注入到 `document.head`，只注入一次（幂等）。
- **深色模式切换**：通过 `document.documentElement.setAttribute('data-ys-theme', 'dark'|'light')` 控制，不依赖宿主页的 `color-scheme`，避免某些网站强制浅色时误判。
- **存储键**：`themeMode`，值为 `'light'` | `'dark'` | `'system'`（默认 `'system'`）。
- 新增 UI 组件请全部使用 `var(--ys-*)` 变量，不要写硬编码颜色值。
- **面板模糊度**：主卡片 `saturate(180%) blur(30px)`，遮罩层 `blur(10px)`，下拉菜单 `saturate(180%) blur(30px)`，置顶卡片 `saturate(180%) blur(30px)`。
- **标签行淡显**：非选中/非活跃行 `opacity: 0.8`，hover 或选中时恢复为 `1`，带 `0.15s` 过渡；当前窗口活跃标签始终为 `1`。
- **Favicon**：始终以 `opacity: 0.7` 显示（`TAB_ROW_ICON_VISIBLE_OPACITY`），不再依赖 hover。
- **AI 归纳标签**：使用 `--ys-ai-text` / `--ys-ai-bg` / `--ys-ai-border` 配色，与 AI 聚合按钮视觉统一。
- **面板透明度**：`--ys-card-bg` 浅色 `rgba(248,248,246,0.38)`，深色 `rgba(30,30,30,0.65)`。

---

## 国际化（i18n）

- content 脚本：`ysT(key, [params])` —— 定义在 `content-switcher/00-i18n.js`
- background 脚本：`bgT(key, [params])` —— 定义在 `bg-i18n.js`
- 字符串文件：`_locales/zh_CN/messages.json` / `_locales/en/messages.json`
- 占位符用 `$1`、`$2` 表示，`ysT`/`bgT` 负责替换。
- 新增文案必须同时在两个语言文件里加，缺一不可。

---

## 新手引导

- **触发条件**：安装时 `bg-telemetry.js` 写入 `ysOnboardingPending: true`；content script 在下次 http/https 页访问时读取，展示一次后清除该标记。
- **UI**：右下角毛玻璃浮窗（与「我要好评」样式一致），展示两条手势说明，修饰键名动态注入。
- **关闭**：点击 × 写入 `ysOnboardingDismissed: true` 永久关闭；从设置菜单「使用指引」手动打开时关闭不写永久标记，可重复查看。
- **入口**：设置下拉菜单 → 「📖 使用指引」。
- **Storage 键**：`ysOnboardingPending`（待展示标记）、`ysOnboardingDismissed`（永久关闭标记）。

---

## 遥测埋点

上报端点：`https://api.pmtools.com.cn/yessir/telemetry`，字段 `{ uuid, event, version, feature?, count?, date? }`。

| 事件 | 触发时机 | 上报方式 |
|------|---------|---------|
| `install` | 扩展安装 | 实时 |
| `update` | 扩展更新 | 实时 |
| `startup` | 每日首次 SW 激活 | 实时，按本地日期去重 |
| `first_use` | 用户首次触发某手势（`feature: first_close / first_switcher_open`） | 实时，每个 feature 终身仅一次 |
| `feature_daily` | 按钮点击（`feature: ai_aggregate / web_search / undo / drag_reclassify / rename_group`） | 本地按日累计，次日 startup 时 flush |

- **Storage 键**：`ysDailyCounters`（按日点击计数）、`ysFirstUseReported`（已上报的 first_use 集合）、`ysLastTelemetryStartupDate`。
- **分析脚本**：`proxy-server/analyze-telemetry.js`，输出每日基础指标、累计用户数、功能激活率、每日功能点击量。

---

## AI 功能

- 模型：`deepseek-chat`（DeepSeek API）
- 未配置用户 API Key 时走 `https://api.pmtools.com.cn/*` 中转（每日 10 次限额）；配置后直连 `https://api.deepseek.com/*`。
- API Key 存储键：`deepseekApiKey`（`chrome.storage.local`）。
- AI 快照缓存（分类结果）由 `bg-ai-network.js` 管理，key 为标签 ID，含 `sig`（标题+URL hash）用于失效判断。
- **topic 双语存储**：同一条 entry 里 `topic` 存中文分类名，`topic_en` 存英文分类名，互不干扰；面板按当前语言读对应字段。
- **分类 pill 筛选栏**：面板搜索框下方，AI 分组后自动出现；点击某 pill 只显示该分类标签页，与搜索框互斥。
- **拖拽重分类**：
  - 拖动标签行到 pill 上松手 → 飞入动画 + pill 闪烁 → 重新归类
  - 同步移动 Chrome 原生标签组（`update_tab_topic` 消息）
  - 写入用户偏好（`ysUserTopicPrefs` / `ysUserTopicPrefs_en`，按语言分存）
  - 显示 toast「分组偏好已记录」
- **用户偏好记忆**：
  - 拖拽重分类：`domain → topic` 写入对应语言的 `ysUserTopicPrefs` / `ysUserTopicPrefs_en`
  - Chrome 原生改分组名（`tabGroups.onUpdated`）：批量更新组内 tab 的偏好和快照
  - AI 分组时命中偏好的 tab 直接跳过 LLM，按用户设定分配
- **分组同步**：
  - 删除 / 取消分组（`tabGroups.onRemoved`）→ 从 storage 清除 topic 字段 → 广播刷新面板 pill
  - `_groupTabsMap`（`groupId → Set<tabId>`）在 SW 启动时重建，`tabs.onUpdated` 实时维护

---

## 置顶 Dock

面板左/右侧的 3 槽悬浮 dock，用于把高频标签页置顶随时取用。代码集中在 `content-switcher/04-show-switcher.js`。

- **数据结构**：单列 3 槽 + 当前侧别 → `chrome.storage.local` 的 `ysPinnedTabs = { slots: [s1, s2, s3], side: 'left'|'right' }`。每槽含 `{ tabId, title, url, favicon, siteName, windowId, pageLabel }`。`bg-core.js:onRemoved` 会兼容新旧两种格式自动清理。
- **显隐规则**：
  - 默认隐藏；有任意置顶数据 → 面板打开就直接显示
  - 无数据：仅拖拽中鼠标越过面板左/右边界才临时浮现，拖拽结束自动淡出
  - 落到置顶槽后保持显示（让用户看到结果）
- **布局**：dock 用 `position: absolute` + `calc(50% + …)` 紧贴扩张后的主面板边缘，**不挤压** flex 流；主面板用 `translateX(±CARD_SHIFT)` 让出空间。pair（dock + 主面板）整体在 viewport 居中：`CARD_SHIFT = (DOCK_WIDTH + DOCK_GAP) / 2 = 132.5px`。
- **三幕剧动画**（全程 `cubic-bezier(0.22, 1, 0.36, 1)`）：
  - **Stage 1 感知**：拖拽中光标距面板边 < 80px → 该侧 `box-shadow` 渐显 `--ys-accent-glow`，给用户「这边可以放」的预判信号
  - **Stage 2 扩张**：跨过边界 → 主面板宽度 `700 → 740px`、横移 `±132.5px`，同步 420ms apple-ease（不是被推开，而是主动让位）
  - **Stage 3 浮现**：dock 从 `blur(12px) opacity(0) scale(0.96) translateX(±16)` → `blur(0) opacity(1) scale(1) 0`；3 个 slot 额外 70ms stagger（`translateY(8px) scale(0.96)` → `0/1`）
- **隐藏动画**：420ms apple-ease 反向跑，主面板收回宽度 + 平移、dock 解析回 blur + 滑出 + 淡出
- **关键常量**（`04-show-switcher.js` 顶部）：`CARD_WIDTH_BASE/EXPANDED`、`DOCK_WIDTH`、`DOCK_GAP`、`CARD_SHIFT`、`DOCK_SLIDE`、`EDGE_SENSE_DIST`、`SHOW_DURATION`、`HIDE_DURATION`、`APPLE_EASE`
- **竞态防护**：入场 rAF 设 `card.style.transform` 时会根据 `pinnedSlots.some(s => s)` 判断是否带横向位移，避免和 storage 回调里的 `showPinnedColOnSide(side, false)` 互相覆盖导致 dock 与主面板重叠
- **拖动交互**：从 slot 拖出 → 垃圾桶动画 + 删除；slot 之间拖动 → 互换；点击 → 跳转对应标签；slot hover 仅强化阴影（不放大）

---

## 开发注意事项

- **不要直接改 `main` 分支**，在 `dev` 分支开发，commit message 用中文。
- 版本号在 `manifest.json` 的 `version` 字段和 `README.md` 末行同步维护。
- `dist/`、`node_modules/`、`.DS_Store`、`*.png` 不提交 git。
- manifest 中 `host_permissions` 若需新增域名，必须同步更新 `bg-ai-network.js` 里的 fetch 调用域名。
- Service Worker 无 DOM，`bg-*.js` 里不能使用任何 DOM API。
- `content-switcher/` 各文件按编号顺序注入，共享同一全局作用域，注意变量命名冲突。
- `manifest.json` 已配置 `"action": {}`（无 popup），点击图标触发 `chrome.action.onClicked`；若将来需要弹出页，改为 `"action": { "default_popup": "popup.html" }` 后 `onClicked` 将失效。
- 设置菜单项顺序：界面语言 → 修饰键 → 主题模式 → API Key → 统计浮窗 → 使用指引 → 好评。
- 统计浮窗默认关闭（`showFloatingWidget` 默认 `false`），用户可在设置菜单中开启。
