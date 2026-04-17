importScripts('rules.js');

// ─── 全局标签页轨迹（Mod+E 切回「上一个看过的」标签页，可跨窗口） ───
const globalTabHistory = { current: null, last: null };
const TAB_HISTORY_STORAGE_KEY = 'globalTabHistoryV1';
let tabHistoryReadyResolve;
const tabHistoryReady = new Promise((resolve) => {
    tabHistoryReadyResolve = resolve;
});

function normalizeHistoryItem(item) {
    if (!item || typeof item !== 'object') return null;
    const tabId = Number(item.tabId);
    const windowId = Number(item.windowId);
    if (!Number.isFinite(tabId) || !Number.isFinite(windowId)) return null;
    return {
        tabId,
        windowId,
        title: item.title ? String(item.title) : '(无标题)',
        favIconUrl: item.favIconUrl ? String(item.favIconUrl) : '',
    };
}

async function restoreGlobalTabHistory() {
    try {
        const stored = await chrome.storage.local.get(TAB_HISTORY_STORAGE_KEY);
        const raw = stored[TAB_HISTORY_STORAGE_KEY];
        if (raw && typeof raw === 'object') {
            globalTabHistory.current = normalizeHistoryItem(raw.current);
            globalTabHistory.last = normalizeHistoryItem(raw.last);
        }
    } catch (error) {
        console.warn('恢复全局标签页轨迹失败:', error);
    } finally {
        tabHistoryReadyResolve();
    }
}

async function persistGlobalTabHistory() {
    try {
        await chrome.storage.local.set({
            [TAB_HISTORY_STORAGE_KEY]: {
                current: globalTabHistory.current,
                last: globalTabHistory.last,
                updatedAt: Date.now(),
            },
        });
    } catch (error) {
        console.warn('持久化全局标签页轨迹失败:', error);
    }
}

function updateGlobalTab(tabId) {
    void (async () => {
        await tabHistoryReady;
        if (globalTabHistory.current && globalTabHistory.current.tabId === tabId) return;

        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) return;
            globalTabHistory.last = globalTabHistory.current;
            globalTabHistory.current = {
                tabId: tab.id,
                windowId: tab.windowId,
                title: tab.title || '(无标题)',
                favIconUrl: tab.favIconUrl || '',
            };
            void persistGlobalTabHistory();
        });
    })();
}

chrome.tabs.onActivated.addListener((activeInfo) => {
    updateGlobalTab(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) return;
        updateGlobalTab(tabs[0].id);
    });
});

void restoreGlobalTabHistory();
void restoreAiSnapshotCache();

// DeepSeek：优先从 chrome.storage.local.deepseekApiKey 读取，勿把密钥提交到仓库。
async function getDeepSeekApiKey() {
    const { deepseekApiKey } = await chrome.storage.local.get('deepseekApiKey');
    return (deepseekApiKey && String(deepseekApiKey).trim()) || '';
}

const CATEGORY_CACHE_VERSION = 'v3';
const SITE_NAME_CACHE_VERSION = 'v2';
const PAGE_LABEL_CACHE_VERSION = 'v1';
const AI_SNAPSHOT_STORAGE_KEY = 'aiSnapshotV1';
const AI_SNAPSHOT_MAX_ENTRIES = 600;
const AI_SNAPSHOT_CLEANUP_KEEP = 450;

function titleCacheKey(title, url = '') {
    const t = encodeURIComponent((title || '').trim().toLowerCase().slice(0, 200));
    const d = encodeURIComponent(getDomainFromUrl(url).slice(0, 120));
    return `cat_${CATEGORY_CACHE_VERSION}_${d}_${t}`;
}

function siteNameCacheKey(url = '') {
    const domain = encodeURIComponent(getDomainFromUrl(url).slice(0, 120));
    return `site_name_${SITE_NAME_CACHE_VERSION}_${domain}`;
}

function pageLabelCacheKey(title = '', url = '') {
    const t = encodeURIComponent((title || '').trim().toLowerCase().slice(0, 180));
    const u = String(url || '');
    let siteKey = '';
    if (u.startsWith('http')) {
        siteKey = getTabGroupDomainKey(u);
    } else {
        siteKey = u.slice(0, 200);
    }
    const d = encodeURIComponent(siteKey.slice(0, 120));
    let p = '';
    try {
        p = encodeURIComponent(new URL(u).pathname.slice(0, 180));
    } catch (_) {}
    return `page_label_${PAGE_LABEL_CACHE_VERSION}_${d}_${p}_${t}`;
}

let aiSnapshotCache = { entries: {} };

async function restoreAiSnapshotCache() {
    try {
        const stored = await chrome.storage.local.get(AI_SNAPSHOT_STORAGE_KEY);
        const raw = stored[AI_SNAPSHOT_STORAGE_KEY];
        if (raw && raw.entries && typeof raw.entries === 'object') {
            aiSnapshotCache = { entries: raw.entries };
        }
    } catch (error) {
        console.warn('恢复 AI 快照缓存失败:', error);
    }
}

async function persistAiSnapshotCache() {
    try {
        const entries = aiSnapshotCache.entries || {};
        const keys = Object.keys(entries);
        if (keys.length > AI_SNAPSHOT_MAX_ENTRIES) {
            const sorted = keys
                .map((k) => ({ k, ts: Number(entries[k]?.updatedAt || 0) }))
                .sort((a, b) => b.ts - a.ts);
            const keep = new Set(sorted.slice(0, AI_SNAPSHOT_CLEANUP_KEEP).map((x) => x.k));
            const nextEntries = {};
            keep.forEach((k) => { nextEntries[k] = entries[k]; });
            aiSnapshotCache.entries = nextEntries;
        }
        await chrome.storage.local.set({
            [AI_SNAPSHOT_STORAGE_KEY]: {
                entries: aiSnapshotCache.entries,
                updatedAt: Date.now(),
            },
        });
    } catch (error) {
        console.warn('持久化 AI 快照缓存失败:', error);
    }
}

function buildTabSignature(tab) {
    return `${String(tab.title || '')}\n${String(tab.url || '')}`;
}

function buildAiSnapshotFromCache(tabs) {
    const classification = {};
    const siteNames = {};
    const labels = {};
    const entries = aiSnapshotCache.entries || {};
    (tabs || []).forEach((tab) => {
        const id = String(tab.id);
        const cached = entries[id];
        if (!cached) return;
        if (cached.sig !== buildTabSignature(tab)) return;
        if (cached.category) classification[id] = cached.category;
        if (cached.siteName) siteNames[id] = cached.siteName;
        if (cached.pageLabel) labels[id] = cached.pageLabel;
    });
    return { classification, siteNames, labels };
}

async function fetchPageLabelsForTabs(tabList, apiKey) {
    if (!apiKey || !Array.isArray(tabList) || tabList.length === 0) return {};
    const tabDescriptions = tabList.map((t) => {
        const path = (() => {
            try { return new URL(t.url).pathname; } catch (_) { return ''; }
        })();
        return `ID:${t.id} 标题:${t.title || '(无)'} PATH:${path}`;
    }).join('\n');

    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `你是标签页功能提取助手。给你一组来自同一网站的标签页，请为每个页面生成一个 2-4 字的中文功能标签，描述这个页面是用来做什么的（如：项目列表、代码审查、问题详情、个人主页、设置页面）。
返回纯 JSON，格式：{"tabId": "标签文字"}，不要任何解释。`,
                    },
                    { role: 'user', content: tabDescriptions },
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' },
            }),
        });
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content?.trim() || '{}';
        let parsed = {};
        try { parsed = JSON.parse(raw); } catch (_) {}

        const labels = {};
        Object.entries(parsed).forEach(([k, v]) => {
            const clean = String(v || '').trim().slice(0, 6);
            if (clean) labels[String(k)] = clean;
        });
        return labels;
    } catch (error) {
        console.error('批量页面功能标签获取失败:', error);
        return {};
    }
}

async function computeAiSnapshotForTabs(tabs) {
    const tabList = Array.isArray(tabs) ? tabs : [];
    const apiKey = await getDeepSeekApiKey();
    const classification = {};
    const siteNames = {};
    const labels = {};
    const updates = {};
    const entries = aiSnapshotCache.entries || {};

    await Promise.all(tabList.map(async (tab) => {
        const id = String(tab.id);
        const sig = buildTabSignature(tab);
        const cached = entries[id];
        const isSigMatch = !!(cached && cached.sig === sig);

        let category = isSigMatch ? cached.category : '';
        if (!category) {
            category = await getSmartCategory(tab.title, tab.url, apiKey);
        }
        if (category) classification[id] = category;

        let siteName = isSigMatch ? cached.siteName : '';
        if (siteName === undefined || siteName === null) siteName = '';
        if (!siteName) {
            siteName = await getSmartSiteName(tab.title, tab.url, apiKey);
        }
        if (siteName) siteNames[id] = siteName;

        updates[id] = {
            ...(cached || {}),
            sig,
            category: category || '',
            siteName: siteName || '',
            pageLabel: isSigMatch ? (cached.pageLabel || '') : '',
            updatedAt: Date.now(),
        };
    }));

    const domainGroups = new Map();
    tabList.forEach((tab) => {
        const domain = getTabGroupDomainKey(tab.url);
        if (!domainGroups.has(domain)) domainGroups.set(domain, []);
        domainGroups.get(domain).push(tab);
    });

    for (const [, group] of domainGroups.entries()) {
        const missingForBatch = [];
        for (const tab of group) {
            const id = String(tab.id);
            const cacheKey = pageLabelCacheKey(tab.title, tab.url);
            const cachedLabel = await chrome.storage.local.get(cacheKey);
            const fromStorage = cachedLabel[cacheKey] ? String(cachedLabel[cacheKey]) : '';
            if (fromStorage) {
                labels[id] = fromStorage;
                const current = updates[id] || {};
                updates[id] = {
                    ...current,
                    sig: buildTabSignature(tab),
                    pageLabel: fromStorage,
                    updatedAt: Date.now(),
                };
                continue;
            }
            const existing = updates[id] && updates[id].pageLabel ? String(updates[id].pageLabel) : '';
            if (existing) {
                labels[id] = existing;
                continue;
            }
            missingForBatch.push(tab);
        }
        if (missingForBatch.length > 0) {
            const fetched = await fetchPageLabelsForTabs(
                missingForBatch.map((t) => ({ id: t.id, title: t.title || '', url: t.url || '' })),
                apiKey
            );
            for (const tab of missingForBatch) {
                const id = String(tab.id);
                const label = fetched[id] ? String(fetched[id]).trim().slice(0, 6) : '';
                if (!label) continue;
                labels[id] = label;
                const cacheKey = pageLabelCacheKey(tab.title, tab.url);
                await chrome.storage.local.set({ [cacheKey]: label });
                const current = updates[id] || {};
                updates[id] = {
                    ...current,
                    sig: buildTabSignature(tab),
                    pageLabel: label,
                    updatedAt: Date.now(),
                };
            }
        }
    }

    Object.entries(updates).forEach(([id, entry]) => {
        aiSnapshotCache.entries[id] = entry;
    });
    await persistAiSnapshotCache();
    return { classification, siteNames, labels };
}

async function getSmartCategory(title, url, apiKey) {
    const keywordCategory = inferCategoryByKeyword(title, url);
    if (keywordCategory) return keywordCategory;
    if (!apiKey) return '📁 其他分类';

    const cacheKey = titleCacheKey(title, url);
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) return normalizeCategory(cached[cacheKey]);

    try {
        const domain = getDomainFromUrl(url);
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `你是一个网页分类专家。请将网页标题归类为以下之一：
📖 信息资讯（新闻门户、科技博客、百科词典、天气预报、股票行情、企业黄页）、
🛠️ 效率办公（在线文档、任务管理、云存储、在线表单、日历日程、会议软件、云服务控制台、开发者平台、AI工具网站）、
💬 社交互动（微博/朋友圈、论坛社区、即时聊天、问答社区、评论系统、群组协作）、
🎡 生活娱乐（视频点播、音乐流媒体、在线游戏、直播平台、外卖/点评、旅游攻略）、
📁 其他分类（个人主页、实验性站点、计算器/二维码等工具类、404页面）。
如果标题不够明确，请结合 URL 和域名判断。只需返回类别名称（带 Emoji），不要解释。`,
                    },
                    {
                        role: 'user',
                        content: `标题：${title || '(无标题)'}
URL：${url || '(无URL)'}
域名：${domain || '(无域名)'}`,
                    },
                ],
                temperature: 0.3,
            }),
        });

        const data = await response.json();
        const rawCategory = data.choices?.[0]?.message?.content?.trim() || '📁 其他分类';
        const category = normalizeCategory(rawCategory);

        await chrome.storage.local.set({ [cacheKey]: category });
        return category;
    } catch (error) {
        console.error('DeepSeek 呼叫失败:', error);
        return '📁 其他分类';
    }
}

async function getSmartSiteName(title, url, apiKey) {
    const keywordName = inferSiteNameByKeyword(title, url);
    if (keywordName) return keywordName;

    const cacheKey = siteNameCacheKey(url);
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) return normalizeSiteName(cached[cacheKey], url);

    if (!apiKey) return null;

    try {
        const domain = getDomainFromUrl(url);
        if (!domain) return null;

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: '你是一个品牌提取专家。请根据域名判断这是哪个网站，返回最简洁的网站名称或品牌名（如：阿里云、GitHub、Notion、哔哩哔哩）。只需返回名称，不要解释。',
                    },
                    {
                        role: 'user',
                        content: `域名：${domain}`,
                    },
                ],
                temperature: 0.2,
            }),
        });

        const data = await response.json();
        const rawName = data.choices?.[0]?.message?.content?.trim() || '';
        const siteName = normalizeSiteName(rawName, url);
        if (siteName) {
            await chrome.storage.local.set({ [cacheKey]: siteName });
        }
        return siteName;
    } catch (error) {
        console.error('DeepSeek 站点名提取失败:', error);
        return null;
    }
}

const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

function parseDeepSeekJsonContent(raw) {
    let s = String(raw || '').trim();
    if (s.startsWith('```')) {
        s = s.replace(/^```[a-zA-Z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '');
    }
    return JSON.parse(s);
}

/**
 * @param {number|null|undefined} activeTabId 发起请求的标签页；含该标签的组展开，其余组折叠（视觉降噪）。
 */
function shouldCollapseTabGroup(tabIds, activeTabId) {
    if (activeTabId === null || activeTabId === undefined) return true;
    const active = Number(activeTabId);
    if (!Number.isFinite(active)) return true;
    return !tabIds.some((id) => Number(id) === active);
}

/**
 * 批量聚类：一次请求拿到各标签的 topic，再按窗口分别 chrome.tabs.group（跨窗口不可同组）。
 * @param {number|undefined} restrictWindowId 若传入，仅处理该窗口内的标签（避免与其它窗口混组、或误搬移标签）。
 * @param {number|null|undefined} activeTabId 发起聚合操作时的标签 id；其所在组展开，其余折叠。
 */
async function performBatchAutoGrouping(tabs, apiKey, restrictWindowId, activeTabId) {
    if (!apiKey) return { groupCount: 0, error: 'no_api_key' };
    if (!Array.isArray(tabs) || tabs.length === 0) return { groupCount: 0, error: 'no_tabs' };

    let httpTabs = tabs.filter((t) => t.url && /^https?:\/\//i.test(String(t.url)));
    if (
        restrictWindowId !== null && restrictWindowId !== undefined
        && Number.isFinite(Number(restrictWindowId))
    ) {
        const win = Number(restrictWindowId);
        httpTabs = httpTabs.filter((t) => Number(t.windowId) === win);
    }
    if (httpTabs.length === 0) return { groupCount: 0, error: 'no_http_tabs' };

    const tabIdSet = new Set(httpTabs.map((t) => t.id));
    const metaById = new Map(httpTabs.map((t) => [t.id, { windowId: t.windowId }]));
    const tabData = httpTabs.map((t) => ({
        id: t.id,
        title: t.title || '',
        url: t.url || '',
    }));

    const systemPrompt = `你是一个追求极致极简的浏览器管家。任务不是逐页「精准描述」，而是高维度「抽象归纳」：合并同类项，减少用户认知负担。

用户将提供 JSON 数组，每项含 id、title、url。你必须为每个 id 返回一条结果，且 id 与输入一致。

每条结果字段：
1. "id": 原始标签 ID（数字）。
2. "category": 五类之一（必须完全一致）：📖 信息资讯、🛠️ 效率办公、💬 社交互动、🎡 生活娱乐、📁 其他分类。
3. "topic": 4～6 个汉字左右的子主题场景，并带一个 Emoji 前缀（如 "📈 投资调研"、"💻 研发工具"、"🛒 购物消费"）。

【强制聚合规则】
- 首要目标是合并同类项：尽最大努力发现网页之间的共性，把尽可能多的页面归入**相同**的 topic 字符串。
- 模型的默认倾向是发散描述；你必须主动做**收敛归纳**（Convergence），禁止「一页一个冷门 topic」。
- 绝不允许「一页一类」。例如：关于「华夏银行分红」「紫金矿业财报」「东方财富」的页面，必须统一归入相同 topic，如 "📈 投资调研"；关于 Cursor、GitHub、Claude 的页面，应统一归入如 "💻 研发工具"。
- 同一批标签里，**不同 topic 的种数最好控制在 3～5 个以内**；能共用同一个 topic 就不要拆。

只输出一个 JSON 对象，格式严格为：{"results":[{"id":数字,"category":"...","topic":"..."},...]}，不要 Markdown、不要解释。`;

    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(tabData) },
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' },
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            const msg = data?.error?.message || response.statusText || '请求失败';
            return { groupCount: 0, error: 'api_error', message: msg };
        }

        const raw = data.choices?.[0]?.message?.content?.trim() || '';
        let parsed;
        try {
            parsed = parseDeepSeekJsonContent(raw);
        } catch (e) {
            console.error('批量聚类 JSON 解析失败:', e, raw);
            return { groupCount: 0, error: 'parse_failed' };
        }

        const results = Array.isArray(parsed.results) ? parsed.results : [];
        /** topic -> Map<windowId, number[]> */
        const topicWindowTabs = new Map();

        for (const item of results) {
            const id = Number(item.id);
            if (!Number.isFinite(id) || !tabIdSet.has(id)) continue;
            const topic = String(item.topic || '').trim() || '📁 未分组';
            const wId = metaById.get(id).windowId;
            if (!topicWindowTabs.has(topic)) topicWindowTabs.set(topic, new Map());
            const wm = topicWindowTabs.get(topic);
            if (!wm.has(wId)) wm.set(wId, []);
            const arr = wm.get(wId);
            if (!arr.includes(id)) arr.push(id);
        }

        const groupCount = await performBatchAutoGroupingApplyGroups(topicWindowTabs, activeTabId);
        return { groupCount };
    } catch (error) {
        console.error('批量聚类失败:', error);
        let message = String(error && error.message ? error.message : error);
        if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
            message = '网络无法连接 DeepSeek（api.deepseek.com）。请检查本机网络、代理或防火墙；若曾修改过扩展权限，请在 chrome://extensions 重新加载 Yes Sir。';
        }
        return { groupCount: 0, error: 'exception', message };
    }
}

const ORPHAN_MISC_GROUP_TITLE = '🗂️ 零碎浏览';

async function performBatchAutoGroupingApplyGroups(topicWindowTabs, activeTabId) {
    let groupCount = 0;
    /** 同窗口内因「单标签主题」未建组的标签，稍后放入收纳盒 */
    const orphansByWindow = new Map();

    for (const [topic, windowMap] of topicWindowTabs) {
        const title = topic.slice(0, 200);
        for (const [wId, tabIds] of windowMap.entries()) {
            if (tabIds.length === 0) continue;
            if (tabIds.length === 1) {
                if (!orphansByWindow.has(wId)) orphansByWindow.set(wId, []);
                orphansByWindow.get(wId).push(tabIds[0]);
                continue;
            }
            try {
                const groupId = await chrome.tabs.group({ tabIds });
                await chrome.tabGroups.update(groupId, {
                    title,
                    color: TAB_GROUP_COLORS[Math.floor(Math.random() * TAB_GROUP_COLORS.length)],
                    collapsed: shouldCollapseTabGroup(tabIds, activeTabId),
                });
                groupCount++;
            } catch (err) {
                console.error('tabs.group / tabGroups.update 失败:', err, tabIds);
            }
        }
    }

    // 长尾收纳：每窗口内孤儿 ≥2 个时，归入灰色折叠组；若包含当前标签则展开该组
    for (const [, orphanTabIds] of orphansByWindow) {
        if (orphanTabIds.length < 2) continue;
        try {
            const groupId = await chrome.tabs.group({ tabIds: orphanTabIds });
            await chrome.tabGroups.update(groupId, {
                title: ORPHAN_MISC_GROUP_TITLE,
                color: 'grey',
                collapsed: shouldCollapseTabGroup(orphanTabIds, activeTabId),
            });
            groupCount++;
        } catch (err) {
            console.error('零碎浏览组创建失败:', err, orphanTabIds);
        }
    }

    return groupCount;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // ── 统一记录函数：记录一次“使用” (关闭或切换) ──
    function recordUsage(callback) {
        const today = new Date().toISOString().slice(0, 10);
        chrome.storage.local.get({ closeCount: 0, dailyStats: {} }, function(result) {
            let newCount = result.closeCount + 1;
            let dailyStats = result.dailyStats;
            dailyStats[today] = (dailyStats[today] || 0) + 1;

            chrome.storage.local.set({ closeCount: newCount, dailyStats }, function() {
                if (callback) callback(newCount);
            });
        });
    }

    // ── 双击网页空白处：关闭当前标签 ──
    if (request.action === "close_and_toast") {
        recordUsage((newCount) => {
            if (sender.tab && sender.tab.id) {
                chrome.tabs.remove(sender.tab.id, function() {
                    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                        if (tabs.length > 0) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: "show_toast",
                                count: newCount
                            }).catch(() => {});
                        }
                    });
                });
            }
        });
    }

    // ── 在面板中点击：关闭指定标签 ──
    else if (request.action === "close_tab_by_id") {
        recordUsage();
        chrome.tabs.remove(request.tabId, () => {
            const err = chrome.runtime.lastError;
            sendResponse({ success: !err, error: err ? err.message : undefined });
        });
        return true;
    }

    // ── 切换标签页 ──
    else if (request.action === "switch_tab") {
        recordUsage();
        chrome.tabs.update(request.tabId, { active: true });
    }

    // ── 全局切换标签页（支持跨窗口） ──
    else if (request.action === "switch_tab_global") {
        recordUsage();
        const targetWindowId = request.windowId;
        const targetTabId = request.tabId;

        chrome.windows.update(targetWindowId, { focused: true }, () => {
            const winErr = chrome.runtime.lastError;
            if (winErr) {
                sendResponse({ success: false, error: winErr.message });
                return;
            }
            chrome.tabs.update(targetTabId, { active: true }, () => {
                const tabErr = chrome.runtime.lastError;
                sendResponse({ success: !tabErr, error: tabErr ? tabErr.message : undefined });
            });
        });
        return true;
    }

    // ── 恢复最近关闭的最多 3 条会话（标签或窗口）──
    else if (request.action === "restore_last_3_tabs") {
        chrome.sessions.getRecentlyClosed({ maxResults: 3 }, (sessions) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, message: chrome.runtime.lastError.message });
                return;
            }
            if (!sessions || sessions.length === 0) {
                sendResponse({ success: false, message: "没有可恢复的标签页" });
                return;
            }
            const toRestore = sessions.filter((s) => s.tab || s.window);
            if (toRestore.length === 0) {
                sendResponse({ success: false, message: "没有可恢复的标签页" });
                return;
            }
            let pending = toRestore.length;
            const finishOne = () => {
                pending--;
                if (pending <= 0) {
                    sendResponse({ success: true });
                }
            };
            toRestore.forEach((session) => {
                chrome.sessions.restore(session.sessionId, () => {
                    void chrome.runtime.lastError;
                    finishOne();
                });
            });
        });
        return true;
    }

    // ── 获取近五天统计 ──
    else if (request.action === "get_daily_stats") {
        chrome.storage.local.get({ dailyStats: {} }, function(result) {
            sendResponse({ dailyStats: result.dailyStats });
        });
        return true;
    }

    // ── 获取所有窗口标签页（用于全局看板） ──
    else if (request.action === "get_tabs") {
        const currentWindowId = sender.tab ? sender.tab.windowId : null;
        chrome.tabs.query({}, function(tabs) {
            const sortedTabs = tabs.slice().sort((a, b) => {
                if (a.windowId !== b.windowId) return a.windowId - b.windowId;
                return a.index - b.index;
            });
            const uniqueWindowIds = [...new Set(sortedTabs.map(t => t.windowId))];
            const windowMap = {};

            uniqueWindowIds.forEach((id) => {
                if (currentWindowId !== null && id === currentWindowId) {
                    windowMap[id] = '当前';
                } else {
                    windowMap[id] = '其他窗口';
                }
            });

            sendResponse({
                currentWindowId,
                tabs: sortedTabs.map(t => ({
                    id:         t.id,
                    windowId:   t.windowId,
                    windowName: windowMap[t.windowId] || '',
                    index:      t.index,
                    title:      t.title || '(无标题)',
                    url:        t.url   || '',
                    active:     t.active,
                    favIconUrl: t.favIconUrl || '',
                }))
            });
        });
        return true;
    }

    // ── 读取 AI 快照缓存（仅返回已命中结果，不阻塞） ──
    else if (request.action === 'get_ai_snapshot') {
        const tabList = Array.isArray(request.tabs) ? request.tabs : [];
        sendResponse(buildAiSnapshotFromCache(tabList));
        return true;
    }

    // ── 对指定 tabs 做 AI 预热并返回结果 ──
    else if (request.action === 'prewarm_ai_snapshot') {
        (async () => {
            const tabList = Array.isArray(request.tabs) ? request.tabs : [];
            if (tabList.length === 0) {
                sendResponse({ classification: {}, siteNames: {}, labels: {} });
                return;
            }
            const snapshot = await computeAiSnapshotForTabs(tabList);
            sendResponse(snapshot);
        })();
        return true;
    }

    // ── 静默预热当前窗口，供面板秒开（无需等待结果） ──
    else if (request.action === 'prewarm_ai_current_window') {
        (async () => {
            const sourceWindowId = sender.tab && Number.isFinite(Number(sender.tab.windowId))
                ? Number(sender.tab.windowId)
                : null;
            const query = sourceWindowId === null ? {} : { windowId: sourceWindowId };
            chrome.tabs.query(query, async (tabs) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                const tabList = (tabs || []).map((t) => ({
                    id: t.id,
                    title: t.title || '',
                    url: t.url || '',
                }));
                if (tabList.length === 0) {
                    sendResponse({ success: true, skipped: true });
                    return;
                }
                await computeAiSnapshotForTabs(tabList);
                sendResponse({ success: true });
            });
        })();
        return true;
    }

    // ── DeepSeek：按标签页标题智能分类（带缓存） ──
    else if (request.action === 'classify_tabs') {
        (async () => {
            const results = {};
            const siteNames = {};
            const apiKey = await getDeepSeekApiKey();
            const tabList = Array.isArray(request.tabs) ? request.tabs : [];
            const domainNameMemo = new Map();

            await Promise.all(tabList.map(async (tab) => {
                results[tab.id] = await getSmartCategory(tab.title, tab.url, apiKey);

                const domain = getDomainFromUrl(tab.url);
                if (!domain) {
                    siteNames[tab.id] = null;
                    return;
                }

                let pendingSiteName = domainNameMemo.get(domain);
                if (!pendingSiteName) {
                    pendingSiteName = getSmartSiteName(tab.title, tab.url, apiKey)
                        .then((name) => name ?? null)
                        .catch(() => null);
                    domainNameMemo.set(domain, pendingSiteName);
                }
                siteNames[tab.id] = await pendingSiteName;
            }));

            sendResponse({ classification: results, siteNames });
        })();
        return true;
    }

    else if (request.action === 'get_tab_page_labels') {
        (async () => {
            const apiKey = await getDeepSeekApiKey();
            if (!apiKey) { sendResponse({ labels: {} }); return; }

            const tabList = Array.isArray(request.tabs) ? request.tabs : [];
            if (tabList.length === 0) { sendResponse({ labels: {} }); return; }
            const labels = await fetchPageLabelsForTabs(tabList, apiKey);
            Object.entries(labels).forEach(([id, label]) => {
                const tab = tabList.find((t) => String(t.id) === String(id));
                if (!tab) return;
                aiSnapshotCache.entries[String(id)] = {
                    ...(aiSnapshotCache.entries[String(id)] || {}),
                    sig: buildTabSignature(tab),
                    pageLabel: label,
                    updatedAt: Date.now(),
                };
            });
            await persistAiSnapshotCache();
            sendResponse({ labels });
        })();
        return true;
    }

    // ── 批量 AI 聚类并创建 Chrome 标签组（需 tabGroups 权限） ──
    else if (request.action === 'ai_batch_group') {
        (async () => {
            const apiKey = await getDeepSeekApiKey();
            const tabs = Array.isArray(request.tabs) ? request.tabs : [];
            let restrictWindowId = request.windowId;
            if (
                (restrictWindowId === null || restrictWindowId === undefined)
                && sender.tab && sender.tab.windowId !== undefined
            ) {
                restrictWindowId = sender.tab.windowId;
            }
            const activeTabId = sender.tab && sender.tab.id !== undefined ? sender.tab.id : null;
            const result = await performBatchAutoGrouping(tabs, apiKey, restrictWindowId, activeTabId);
            sendResponse({
                success: !result.error,
                groupCount: result.groupCount,
                error: result.error,
                message: result.message,
            });
        })();
        return true;
    }

    // ── 切回全局「上一个看过的」标签页（先聚焦窗口再激活标签，需 windows 权限） ──
    else if (request.action === 'switch_to_last_tab') {
        (async () => {
            await tabHistoryReady;
            const last = globalTabHistory.last;
            if (!last || !last.tabId) {
                sendResponse({ success: false, reason: 'no_last' });
                return;
            }
            chrome.tabs.get(last.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    globalTabHistory.last = null;
                    void persistGlobalTabHistory();
                    sendResponse({ success: false, reason: 'gone', error: 'Tab closed' });
                    return;
                }
                const winId = tab.windowId;
                const tid = tab.id;
                chrome.windows.update(winId, { focused: true }, () => {
                    if (chrome.runtime.lastError) {
                        sendResponse({
                            success: false,
                            reason: 'window',
                            message: chrome.runtime.lastError.message,
                        });
                        return;
                    }
                    chrome.tabs.update(tid, { active: true }, () => {
                        if (chrome.runtime.lastError) {
                            sendResponse({
                                success: false,
                                reason: 'tab',
                                message: chrome.runtime.lastError.message,
                            });
                            return;
                        }
                        chrome.tabs.sendMessage(tid, { action: 'force_hide_switcher' }).catch(() => {});
                        chrome.tabs.sendMessage(tid, {
                            action: 'show_message_toast',
                            message: '🫡 Yes Sir，已切回上一个标签页',
                            durationMs: 2800,
                        }).catch(() => {});
                        sendResponse({ success: true });
                    });
                });
            });
        })();
        return true;
    }

    else if (request.action === 'get_last_context') {
        (async () => {
            await tabHistoryReady;
            sendResponse({ lastTab: globalTabHistory.last });
        })();
        return true;
    }

    // ── AI 自然语言搜索：将用户输入转为匹配关键词 ──
    else if (request.action === 'ai_search_tabs') {
        (async () => {
            const apiKey = await getDeepSeekApiKey();
            if (!apiKey) { sendResponse({ keywords: [] }); return; }
            const query = String(request.query || '').trim();
            if (!query) { sendResponse({ keywords: [] }); return; }
            try {
                const response = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [
                            {
                                role: 'system',
                                content: '你是搜索词提取专家。用户用自然语言描述想找的网页，请提取最适合匹配网页标题/URL 的关键词。只返回 JSON 字符串数组，如 ["webpack","性能","config"]，2~5 个词，优先英文技术词，中文补充，不要 Markdown 也不要解释。',
                            },
                            { role: 'user', content: query },
                        ],
                        temperature: 0.2,
                        max_tokens: 80,
                    }),
                });
                const data = await response.json();
                const raw = String(data.choices?.[0]?.message?.content || '[]')
                    .trim()
                    .replace(/^```[a-z]*\s*/i, '')
                    .replace(/\s*```$/i, '')
                    .trim();
                let keywords = [];
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        keywords = parsed.map(k => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 5);
                    }
                } catch (_) {}
                sendResponse({ keywords });
            } catch (err) {
                console.error('AI 搜索失败:', err);
                sendResponse({ keywords: [] });
            }
        })();
        return true;
    }

});
