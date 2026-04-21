// Service Worker 入口：按依赖顺序加载（共享全局作用域）
importScripts('rules.js');
importScripts('bg-core.js');
importScripts('bg-ai-network.js');
importScripts('bg-messages.js');

// 与拆分前单文件 background.js 一致：三个异步恢复按 1→2→3 触发（在全部脚本执行完之后）
void restoreGlobalTabHistory();
void restoreAiSnapshotCache();
void restoreFaviconCache();
