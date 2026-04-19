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

// ─── 设备 UUID（中转限流用，首次生成后持久化） ───
const DEVICE_UUID_KEY = 'ysDeviceUUID';
let _deviceUUID = null;
async function getDeviceUUID() {
    if (_deviceUUID) return _deviceUUID;
    const stored = await chrome.storage.local.get(DEVICE_UUID_KEY);
    if (stored[DEVICE_UUID_KEY]) {
        _deviceUUID = stored[DEVICE_UUID_KEY];
        return _deviceUUID;
    }
    // 生成 UUID v4
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
    _deviceUUID = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    await chrome.storage.local.set({ [DEVICE_UUID_KEY]: _deviceUUID });
    return _deviceUUID;
}

// ─── DeepSeek 调用入口（双轨：有用户 Key 走直连，否则走中转）───
//
//  直连：插件直接携带用户自己的 Key 访问 api.deepseek.com（无限制，速度快）
//  中转：请求发到 api.pmtools.com.cn/yessir/ai，服务器持有 Key 并做限流
//        新用户无需申请 Key 即可体验，每天 10 次免费额度（可在设置里填 Key 解除）
const PROXY_BASE_URL = 'https://api.pmtools.com.cn/yessir/ai';

/** 中转 API 按 Accept-Language 返回中英文错误文案（与 chrome.i18n 界面语言一致） */
function getAcceptLanguageForProxy() {
    try {
        if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
            return chrome.i18n.getUILanguage().replace(/_/g, '-');
        }
    } catch (_) { /* ignore */ }
    if (typeof navigator !== 'undefined' && navigator.language) {
        return navigator.language;
    }
    return 'zh-CN';
}

async function getDeepSeekApiKey() {
    const { deepseekApiKey } = await chrome.storage.local.get('deepseekApiKey');
    return (deepseekApiKey && String(deepseekApiKey).trim()) || '';
}

/**
 * 统一的 DeepSeek 请求函数。
 * @param {object} payload  - 直接传给 /chat/completions 的 body（无需含 Authorization）
 * @param {string} [apiKey] - 可选，若已知可直接传入避免重复读 storage
 * @param {{ feature?: string, units?: number }} [quotaOpts] - 中转限流：aggregate / search / page_labels / general（默认 general 不占三档额度）
 * @returns {Promise<Response>}
 */
async function callDeepSeekApi(payload, apiKey, quotaOpts = {}) {
    const key = apiKey !== undefined ? apiKey : await getDeepSeekApiKey();
    const feature = quotaOpts.feature != null ? String(quotaOpts.feature) : 'general';
    const units = quotaOpts.units != null ? Math.max(1, Number(quotaOpts.units) || 1) : 1;

    if (key) {
        // 直连模式：用户自己的 Key
        return fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(payload),
        });
    }

    // 中转模式：走服务器代理（body 内带 _yessir_quota，避免部分网关丢弃自定义头导致误计为 general）
    const uuid = await getDeviceUUID();
    const bodyObj = { ...payload, _yessir_quota: { feature, units } };
    return fetch(PROXY_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept-Language': getAcceptLanguageForProxy(),
            'X-Device-UUID': uuid,
            'X-YesSir-Feature': feature,
            'X-YesSir-Units': String(units),
        },
        body: JSON.stringify(bodyObj),
    });
}

const CATEGORY_CACHE_VERSION = 'v3';
const SITE_NAME_CACHE_VERSION = 'v2';
const PAGE_LABEL_CACHE_VERSION = 'v2';

/** 面板右侧功能标签统一为「恰好 4 字」。用 Array.from 而非 .length，兼容代理对。 */
function isFourCharLabel(raw) {
    const s = String(raw || '').trim();
    return s.length > 0 && Array.from(s).length === 4;
}
const AI_SNAPSHOT_STORAGE_KEY = 'aiSnapshotV1';
const AI_SNAPSHOT_MAX_ENTRIES = 600;
const AI_SNAPSHOT_CLEANUP_KEEP = 450;

// ── AI 自然语言搜索：进程内 LRU 缓存，避免同一查询反复打 LLM ──
const AI_SEARCH_KEYWORD_CACHE_MAX = 50;
/** @type {Map<string, string[]>} Map 保留插入顺序，天然可做 LRU */
const aiSearchKeywordCache = new Map();

function writeAiSearchKeywordCache(key, keywords) {
    if (!key || !Array.isArray(keywords) || keywords.length === 0) return;
    if (aiSearchKeywordCache.has(key)) aiSearchKeywordCache.delete(key);
    aiSearchKeywordCache.set(key, keywords.slice());
    while (aiSearchKeywordCache.size > AI_SEARCH_KEYWORD_CACHE_MAX) {
        const oldest = aiSearchKeywordCache.keys().next().value;
        if (oldest === undefined) break;
        aiSearchKeywordCache.delete(oldest);
    }
}

/**
 * 判断关键词是否"过短的纯 ASCII"：例如 hd / 4k / ui / ai / js。
 * 这类词容易在 URL 的 base64 追踪串里误伤，解析阶段直接丢弃。
 * 中文/混合词不受此规则限制（中文 2 字通常已有足够区分度）。
 */
function isTooShortAsciiKeyword(s) {
    return /^[a-z0-9-]+$/i.test(s) && Array.from(s).length < 3;
}

/** 一批常见的停用词 / 过于泛化的缩写，LLM 偶尔会吐；在解析阶段兜底丢弃。 */
const AI_SEARCH_STOPWORDS = new Set([
    'hd', '4k', '8k', 'ui', 'ux', 'ai', 'js', 'ts', 'css', 'go', 'rs',
    'the', 'and', 'for', 'with', 'from', 'about', 'how', 'what', 'why',
    '的', '了', '是', '在', '和', '与', '我', '你',
]);

/**
 * 解析 LLM 输出的关键词文本。为了生成速度，默认走纯逗号分隔路径；
 * 若 LLM 偶发回落到 JSON 数组或带 Markdown fence，也能兼容。
 */
function parseAiSearchKeywords(raw) {
    let s = String(raw || '').trim();
    if (!s) return [];
    s = s
        .replace(/^```[a-zA-Z0-9]*\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

    let arr = [];
    if (s.startsWith('[')) {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) arr = parsed.map((x) => String(x));
        } catch (_) {}
    }
    if (arr.length === 0) {
        arr = s.split(/[,，、\n；;]+/);
    }
    const seen = new Set();
    const out = [];
    for (const item of arr) {
        const cleaned = String(item)
            .trim()
            .replace(/^["'「『]+|["'」』]+$/g, '')
            .toLowerCase();
        if (!cleaned || seen.has(cleaned)) continue;
        if (isTooShortAsciiKeyword(cleaned)) continue;
        if (AI_SEARCH_STOPWORDS.has(cleaned)) continue;
        seen.add(cleaned);
        out.push(cleaned);
        if (out.length >= 5) break;
    }
    return out;
}

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

// 签名用于判定"这个标签页自上次 AI 处理以来有没有实质变化"。
// 刻意不把 title 计入：现代网页的 title 会被未读计数 / 保存状态 / 广告轮播
// 等噪声频繁改写（"(3) WhatsApp"、"• Edited"…），若把 title 入签名会让
// 缓存大规模失效，每次重新聚合都得重跑 LLM。URL 才是真正代表"这是哪一页"
// 的稳定键；URL 变了（含 SPA 路由切换）就让它重跑，是合理的失效条件。
// hash 片段（#xxx）通常只是页内锚点，这里一并忽略以进一步提高命中率。
function buildTabSignature(tab) {
    const raw = String(tab.url || '');
    try {
        const u = new URL(raw);
        u.hash = '';
        return u.toString();
    } catch (_) {
        return raw;
    }
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
    if (!Array.isArray(tabList) || tabList.length === 0) return {};
    const tabDescriptions = tabList.map((t) => {
        const path = (() => {
            try { return new URL(t.url).pathname; } catch (_) { return ''; }
        })();
        return `ID:${t.id} 标题:${t.title || '(无)'} PATH:${path}`;
    }).join('\n');

    try {
        const response = await callDeepSeekApi({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `你是标签页功能提取助手。给你一组来自同一网站的标签页，为每个页面生成一个中文功能标签，描述这个页面是用来做什么的。

【硬性要求】
- 标签必须**恰好 4 个中文汉字**，不多一字、不少一字。
- 禁止使用英文、数字、标点、空格、emoji、符号。
- 优先选择常见的双 2+2 组合或四字词，例如：项目列表、代码审查、问题详情、个人主页、设置中心、新建标签、应用商店、会话详情、文件目录、通知消息、资源下载。
- 当语义不足 4 字时，用通用后缀补齐（如"页面"、"中心"、"列表"、"详情"、"操作"）；当超过 4 字时，抽取最核心的 4 字主名词。
- 同一网站的多个页面，标签应尽量有区分度，但仍各自 4 字。

返回纯 JSON，格式：{"tabId": "四字标签"}，不要任何解释。`,
                    },
                    { role: 'user', content: tabDescriptions },
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' },
            }, apiKey, { feature: 'page_labels', units: tabList.length });
        if (!response.ok) {
            if (response.status === 429) return {};
            return {};
        }
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content?.trim() || '{}';
        let parsed = {};
        try { parsed = JSON.parse(raw); } catch (_) {}

        const labels = {};
        Object.entries(parsed).forEach(([k, v]) => {
            const clean = String(v || '').trim();
            // 严格只接受恰好 4 字的输出；不合规则直接丢弃，渲染端就不会显示这条 badge
            if (isFourCharLabel(clean)) labels[String(k)] = clean;
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

        const cachedLabel = isSigMatch && isFourCharLabel(cached.pageLabel) ? cached.pageLabel : '';
        updates[id] = {
            ...(cached || {}),
            sig,
            category: category || '',
            siteName: siteName || '',
            pageLabel: cachedLabel,
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
            if (isFourCharLabel(fromStorage)) {
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
            if (isFourCharLabel(existing)) {
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
                const label = fetched[id] ? String(fetched[id]).trim() : '';
                if (!isFourCharLabel(label)) continue;
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

    const cacheKey = titleCacheKey(title, url);
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) return normalizeCategory(cached[cacheKey]);

    try {
        const domain = getDomainFromUrl(url);
        const response = await callDeepSeekApi({
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
            }, apiKey, { feature: 'general' });

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

    try {
        const domain = getDomainFromUrl(url);
        if (!domain) return null;

        const response = await callDeepSeekApi({
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
            }, apiKey, { feature: 'general' });

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
 * 批量聚类输出的 category 编码表。让 LLM 只写单字母（省 token → 省时间），后端再映射回完整值。
 * 生成侧省约 5~7 token/行，37 条 × 0.03s/token ≈ 快 6~8 秒。
 */
const BATCH_CATEGORY_CODE_MAP = {
    A: '📖 信息资讯',
    B: '🛠️ 效率办公',
    C: '💬 社交互动',
    D: '🎡 生活娱乐',
    E: '📁 其他分类',
};
const BATCH_CATEGORY_DEFAULT = '📁 其他分类';

function decodeBatchCategory(raw) {
    const s = String(raw || '').trim();
    if (!s) return BATCH_CATEGORY_DEFAULT;
    // 主路径：单字母代号
    const upper = s.toUpperCase();
    if (BATCH_CATEGORY_CODE_MAP[upper]) return BATCH_CATEGORY_CODE_MAP[upper];
    // 兜底：LLM 偶发退回旧格式，直接返回完整字符串（避免正常聚类信息被丢）
    return s;
}

/**
 * 解析批量聚类的 CSV 输出：每行 `id|category|topic`。
 * 比 JSON 输出快 ~30%+（少写大量引号/括号/字段名），且容错更强。
 */
function parseBatchCsvContent(raw) {
    let s = String(raw || '').trim();
    if (s.startsWith('```')) {
        s = s.replace(/^```[a-zA-Z0-9]*\s*/i, '').replace(/\s*```\s*$/i, '');
    }
    const out = [];
    const seen = new Set();
    for (const line of s.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split('|').map((p) => p.trim());
        if (parts.length < 3) continue;
        const id = Number(parts[0]);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        const category = parts[1];
        // topic 允许自带空格，若被多个 | 误切，则把后续段合并回去
        const topic = parts.slice(2).join(' | ').trim();
        if (!topic) continue;
        seen.add(id);
        out.push({ id, category, topic });
    }
    return out;
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

    // —— 缓存分流：签名匹配且已写过 topic 的跳过 LLM，其余走 LLM ——
    const entries = aiSnapshotCache.entries || {};
    const results = []; // 最终参与分组的 { id, category, topic }
    const toQuery = []; // 未命中缓存、需要送 LLM 的原始 tab
    for (const t of httpTabs) {
        const idStr = String(t.id);
        const sig = buildTabSignature(t);
        const cached = entries[idStr];
        if (cached && cached.sig === sig && cached.topic) {
            results.push({
                id: t.id,
                category: cached.category || '📁 其他分类',
                topic: cached.topic,
            });
        } else {
            toQuery.push(t);
        }
    }

    // 把缓存命中的 topic 透给 LLM，鼓励跨请求复用完全一致的字符串
    const existingTopics = Array.from(new Set(results.map((x) => x.topic).filter(Boolean)));

    try {
        if (toQuery.length > 0) {
            const tabLines = toQuery.map((t) => {
                const title = String(t.title || '').replace(/[|\n\r]/g, ' ').slice(0, 120);
                const url = String(t.url || '').slice(0, 200);
                return `${t.id}|${title}|${url}`;
            }).join('\n');

            const existingSection = existingTopics.length > 0
                ? `\n\n【已有 topic（新标签若语义相同请复用完全一致的字符串）】\n${existingTopics.map((s) => `- ${s}`).join('\n')}`
                : '';

            const systemPrompt = `你是一个追求极致极简的浏览器管家。任务不是逐页「精准描述」，而是高维度「抽象归纳」：合并同类项，减少用户认知负担。

用户会以「每行一条标签页」的格式提供输入，格式为：id|title|url（title 中原有的 "|" 已被替换为空格，因此分隔符只出现 2 个）。你必须为每个 id 返回一行结果。

【输出格式 — 严格遵守】
- 每行一条，格式：<id>|<cat>|<topic>
- <cat> 只能是单个大写字母 A / B / C / D / E，对应五大类（禁止输出完整名称或 emoji）：
  A = 📖 信息资讯（新闻/资讯/百科/财经行情）
  B = 🛠️ 效率办公（文档/代码/AI 工具/云服务/开发者平台）
  C = 💬 社交互动（社区/聊天/问答/评论/朋友圈）
  D = 🎡 生活娱乐（视频/音乐/游戏/直播/外卖/旅游/购物）
  E = 📁 其他分类（个人站点/工具/404 等兜底）
- <topic>：4～6 个汉字左右的子主题场景，并带一个 Emoji 前缀，例如 "💻 研发工具"、"📈 投资调研"、"🛒 购物消费"。
- 不要表头、不要解释、不要 Markdown 代码块、不要空行；每个输入 id 都必须有对应输出行。

【正确示例】
891723|B|💻 研发工具
891724|A|📈 投资调研
891725|D|🎬 影视追剧

【强制聚合规则】
- 首要目标是合并同类项：尽最大努力发现网页之间的共性，把尽可能多的页面归入**相同**的 topic 字符串。
- 模型默认倾向于发散描述；你必须主动做收敛归纳（Convergence），禁止「一页一个冷门 topic」。
- 绝不允许「一页一类」。例如：关于「华夏银行分红」「紫金矿业财报」「东方财富」的页面必须统一归入 "📈 投资调研"；关于 Cursor、GitHub、Claude 的页面应统一归入 "💻 研发工具"。
- 同一批标签里，不同 topic 的种数尽量控制在 3～5 个以内；能共用同一个 topic 就不要拆。${existingSection}`;

            const response = await callDeepSeekApi({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: tabLines },
                    ],
                    temperature: 0.3,
                }, apiKey, { feature: 'aggregate' });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                // 中转服务额度耗尽（429）时，给出明确引导而非通用错误
                if (response.status === 429) {
                    return {
                        groupCount: 0,
                        error: 'rate_limit',
                        message: data?.message
                            || '很抱歉，您今日 AI 相关功能额度已用尽（10 次/天），次日会自动恢复，您可在设置>API key 设置中填入自己的 API Key 来彻底解锁 AI 相关功能。',
                    };
                }
                const msg = data?.error?.message || response.statusText || '请求失败';
                return { groupCount: 0, error: 'api_error', message: msg };
            }

            const raw = data.choices?.[0]?.message?.content?.trim() || '';
            const llmResults = parseBatchCsvContent(raw);
            if (llmResults.length === 0) {
                console.error('批量聚类 CSV 解析失败，原始内容:', raw);
                // 全为缓存命中时即便 LLM 解析为空也可以继续;否则视为失败
                if (results.length === 0) return { groupCount: 0, error: 'parse_failed' };
            }

            const nowTs = Date.now();
            const queryIdSet = new Set(toQuery.map((t) => t.id));
            const sigById = new Map(toQuery.map((t) => [t.id, buildTabSignature(t)]));
            const cacheUpdates = {};
            for (const r of llmResults) {
                if (!queryIdSet.has(r.id)) continue;
                // LLM 只写 A/B/C/D/E，这里还原为完整 "📖 信息资讯" 等字符串
                const fullCategory = decodeBatchCategory(r.category);
                results.push({
                    id: r.id,
                    category: fullCategory,
                    topic: r.topic,
                });
                const idStr = String(r.id);
                cacheUpdates[idStr] = {
                    ...(entries[idStr] || {}),
                    sig: sigById.get(r.id) || '',
                    category: fullCategory || (entries[idStr]?.category || ''),
                    topic: r.topic,
                    updatedAt: nowTs,
                };
            }
            if (Object.keys(cacheUpdates).length > 0) {
                Object.assign(aiSnapshotCache.entries, cacheUpdates);
                // 不 await：持久化失败不影响本次分组；后续调用可继续读内存缓存
                persistAiSnapshotCache();
            }
        }

        /** topic -> Map<windowId, number[]> */
        const topicWindowTabs = new Map();
        for (const item of results) {
            const id = Number(item.id);
            if (!Number.isFinite(id) || !tabIdSet.has(id)) continue;
            const topic = String(item.topic || '').trim() || '📁 未分组';
            const meta = metaById.get(id);
            if (!meta) continue;
            const wId = meta.windowId;
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
            message = '网络连接失败。请检查本机网络；若使用代理服务，请确认中转服务可访问。';
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

    // 供 content script 在睡眠唤醒后轻量唤醒 SW，降低首条业务消息失败率
    if (request.action === 'ping') {
        sendResponse({ ok: true });
        return false;
    }

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

            const tabList = Array.isArray(request.tabs) ? request.tabs : [];
            if (tabList.length === 0) { sendResponse({ labels: {} }); return; }
            const labels = await fetchPageLabelsForTabs(tabList, apiKey);
            Object.entries(labels).forEach(([id, label]) => {
                if (!isFourCharLabel(label)) return;
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
            const query = String(request.query || '').trim();
            if (!query) { sendResponse({ keywords: [] }); return; }

            const cacheKey = query.toLowerCase();
            const cachedHit = aiSearchKeywordCache.get(cacheKey);
            if (cachedHit) {
                // LRU：命中时搬到尾部
                aiSearchKeywordCache.delete(cacheKey);
                aiSearchKeywordCache.set(cacheKey, cachedHit);
                sendResponse({ keywords: cachedHit.slice(), cached: true });
                return;
            }

            try {
                const response = await callDeepSeekApi({
                        model: 'deepseek-chat',
                        messages: [
                            {
                                role: 'system',
                                content: `你从用户一句话描述里提取 2~4 个最适合匹配网页**标题/URL**的关键词。用户可能用中文描述，但目标网页可能是中文也可能是英文，所以关键词要覆盖双语写法。

【输出原则】
- **专有名词同时给中英双写**：人名、球队、品牌、产品、作品、公司、技术词等，都要把「原文 + 常见英文对应」都列出。
  · 例：穆雷 → 穆雷, murray
  · 例：丁真 → 丁真
  · 例：马刺队 → 马刺, spurs
  · 例：掘金队 → 掘金, nuggets
  · 例：哈利波特 → 哈利波特, harry potter
  · 例：苹果财报 → 苹果, apple, 财报
- **概念/通用词**：若有常见的英文对应，也一起给出（如 壁纸/wallpaper、股票/stock、简历/resume）；纯中国语境的词（如"值得买""懂车帝"）不用硬翻。
- 每个关键词：英文至少 3 个字符；中文至少 2 个字符。
- 不要输出过短或泛化的缩写：hd、4k、8k、ui、ux、ai、js、ts、css、the、for、and 等。
- 不要编造用户没提的形容词/同义词（如"高清""免费""下载"），除非用户显式说了。
- 关键词必须具体、有辨识度。

用英文逗号分隔直接输出，例如「穆雷, murray」或「壁纸, wallpaper」。禁止解释、引号、括号、Markdown、JSON。`,
                            },
                            { role: 'user', content: query },
                        ],
                        temperature: 0.2,
                        max_tokens: 48,
                    }, apiKey, { feature: 'search' });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    if (response.status === 429) {
                        sendResponse({
                            keywords: [],
                            error: 'rate_limit',
                            message: data?.message
                                || '很抱歉，您今日 AI 相关功能额度已用尽（10 次/天），次日会自动恢复，您可在设置>API key 设置中填入自己的 API Key 来彻底解锁 AI 相关功能。',
                        });
                        return;
                    }
                    const msg = typeof data?.message === 'string' ? data.message
                        : (typeof data?.error === 'string' ? data.error : response.statusText || '请求失败');
                    sendResponse({ keywords: [], error: 'api_error', message: msg });
                    return;
                }
                const raw = String(data.choices?.[0]?.message?.content || '').trim();
                const keywords = parseAiSearchKeywords(raw);
                writeAiSearchKeywordCache(cacheKey, keywords);
                sendResponse({ keywords });
            } catch (err) {
                console.error('AI 搜索失败:', err);
                let message = String(err && err.message ? err.message : err);
                if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
                    message = '网络无法连接 AI 服务。未配置 Key 时需访问中转 api.pmtools.com.cn；请检查网络、在 chrome://extensions 重新加载本扩展（以应用中转域名权限），或直接在设置中填入 DeepSeek API Key。';
                }
                sendResponse({ keywords: [], error: 'exception', message });
            }
        })();
        return true;
    }

});
