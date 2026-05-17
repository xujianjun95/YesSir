# YesSir — CLAUDE.md

Chrome 扩展，Manifest V3，极简标签页管理。当前版本 **v1.5.1**。

---

## 项目结构

```
YesSir/
├── manifest.json              # MV3 清单，权限声明
├── background.js              # Service Worker 入口（importScripts 顺序加载）
├── bg-core.js                 # 全局标签历史、favicon 缓存、设备 UUID
├── bg-telemetry.js            # 使用统计（dailyStats / closeCount）
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
| 呼出 / 关闭切换面板 | 双击修饰键（连续两次按下） |
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
| `ai_batch_group` | content → bg | AI 聚类并创建 Chrome 标签组 |
| `classify_tabs` | content → bg | DeepSeek 分类标签页 |
| `ai_search_tabs` | content → bg | AI 语义搜索（关键词提取） |
| `get_search_suggestions` | content → bg | 获取网页搜索建议 |
| `search_web` | content → bg | 用浏览器默认引擎新标签页搜索 |
| `show_toast` | bg → content | 背景推送计数 Toast |
| `show_message_toast` | bg → content | 背景推送自定义文案 Toast |
| `force_hide_switcher` | bg → content | 强制关闭切换面板 |

content 侧发消息统一使用 `ysRuntimeSendMessageRetry`（带指数退避重试，最多 4 次），避免 SW 睡眠唤醒后首条消息丢失。

---

## 主题与样式系统

- **CSS 变量**：所有颜色通过 `--ys-*` 变量声明，在 `content.js:ensureYsThemeStylesInjected()` 中注入到 `document.head`，只注入一次（幂等）。
- **深色模式切换**：通过 `document.documentElement.setAttribute('data-ys-theme', 'dark'|'light')` 控制，不依赖宿主页的 `color-scheme`，避免某些网站强制浅色时误判。
- **存储键**：`themeMode`，值为 `'light'` | `'dark'` | `'system'`（默认 `'system'`）。
- 新增 UI 组件请全部使用 `var(--ys-*)` 变量，不要写硬编码颜色值。

---

## 国际化（i18n）

- content 脚本：`ysT(key, [params])` —— 定义在 `content-switcher/00-i18n.js`
- background 脚本：`bgT(key, [params])` —— 定义在 `bg-i18n.js`
- 字符串文件：`_locales/zh_CN/messages.json` / `_locales/en/messages.json`
- 占位符用 `$1`、`$2` 表示，`ysT`/`bgT` 负责替换。
- 新增文案必须同时在两个语言文件里加，缺一不可。

---

## AI 功能

- 模型：`deepseek-chat`（DeepSeek API）
- 未配置用户 API Key 时走 `https://api.pmtools.com.cn/*` 中转（每日 10 次限额）；配置后直连 `https://api.deepseek.com/*`。
- API Key 存储键：`deepseekApiKey`（`chrome.storage.local`）。
- AI 快照缓存（分类结果）由 `bg-ai-network.js` 管理，key 为标签 ID，含 `sig`（标题+URL hash）用于失效判断。

---

## 开发注意事项

- **不要直接改 `main` 分支**，在 `dev` 分支开发，commit message 用中文。
- 版本号在 `manifest.json` 的 `version` 字段和 `README.md` 末行同步维护。
- `dist/`、`node_modules/`、`.DS_Store`、`*.png` 不提交 git。
- manifest 中 `host_permissions` 若需新增域名，必须同步更新 `bg-ai-network.js` 里的 fetch 调用域名。
- Service Worker 无 DOM，`bg-*.js` 里不能使用任何 DOM API。
- `content-switcher/` 各文件按编号顺序注入，共享同一全局作用域，注意变量命名冲突。
