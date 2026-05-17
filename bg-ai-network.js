// bg-ai-network.js — DeepSeek、AI 快照/聚类、搜索建议 fetch（由 background.js importScripts 加载）
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

const SITE_NAME_CACHE_VERSION = 'v2';
const PAGE_LABEL_CACHE_VERSION = 'v7';

/** 面板右侧中文主题词 2～5 字（grapheme） */
function isValidThemeWordLabel(raw) {
    const s = String(raw || '').trim();
    const len = Array.from(s).length;
    return len >= 2 && len <= 5;
}

/** 英文归纳标签：短句、尽量不撑爆右侧占位（仅 ASCII） */
function isValidEnglishPageLabel(raw) {
    const s = String(raw || '').trim().replace(/\s+/g, ' ');
    const n = s.length;
    if (n < 3 || n > 22) return false;
    return /^[\x20-\x7E]+$/.test(s);
}

function normalizeZhPageLabel(raw) {
    const s = String(raw || '').trim();
    return isValidThemeWordLabel(s) ? s : '';
}

/** 英文标签泛指黑名单：这些词单独或仅含这些词的标签无信息量，应退化为 fallback */
const EN_LABEL_BLACKLIST = new Set([
    'page', 'article', 'website', 'other', 'tab', 'content', 'info', 'online',
    'web', 'site', 'link', 'home', 'default', 'unknown', 'misc', 'general',
    'new tab', 'new page', 'blank', 'empty', 'loading',
]);

function isBlacklistedEnLabel(s) {
    const lower = String(s).trim().toLowerCase();
    if (EN_LABEL_BLACKLIST.has(lower)) return true;
    // "X Page", "X Article" 等以泛指词结尾的也拒绝
    const lastWord = lower.split(/\s+/).pop();
    if (['page', 'article', 'website', 'tab', 'content', 'site'].includes(lastWord) && lower.split(/\s+/).length <= 2) return true;
    return false;
}

function normalizeEnPageLabel(raw) {
    const s = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!isValidEnglishPageLabel(s)) return '';
    if (isBlacklistedEnLabel(s)) return '';
    return s;
}

function normalizeAllowedPageLabel(raw) {
    return normalizeZhPageLabel(raw);
}

/** inferFallback 中文与各中文标签对应的简短英文兜底（与 bilingual 补齐共用） */
const ZH_FALLBACK_LABEL_TO_EN = {
    '本地页面': 'Local',
    '报错提示': 'Error',
    '登录注册': 'Sign-in',
    '搜索结果': 'Search',
    '系统设置': 'Settings',
    '管理后台': 'Admin',
    '个人主页': 'Profile',
    '交易结算': 'Checkout',
    '在线编辑': 'Editor',
    '媒体播放': 'Media',
    '商品详情': 'Product',
    '信息瀑布': 'Feed',
    '内容列表': 'List',
    '内容详情': 'Reading',
};

function zhFallbackEnForLabel(zh) {
    const z = String(zh || '').trim();
    /* 兜底勿用 Article/Page — 会与 EN_LABEL_BLACKLIST 冲突被清空 */
    return ZH_FALLBACK_LABEL_TO_EN[z] || (z ? 'Browse' : '');
}

function inferFallbackPageLabel(title, url) {
    const text = `${String(title || '')} ${String(url || '')}`.toLowerCase();
    const safeUrl = String(url || '');
    if (!/^https?:\/\//i.test(safeUrl)) return '本地页面';
    if (/404|not[\s-]?found|error|出错|错误|异常|无法访问|net::/i.test(text)) return '报错提示';
    if (/login|signin|sign-in|signup|sign-up|register|auth|登录|注册|验证码|找回密码/i.test(text)) return '登录注册';
    if (/search|q=|query=|wd=|keyword=|关键词|搜索/i.test(text)) return '搜索结果';
    if (/setting|preference|profile\/settings|设置|偏好|账号安全/i.test(text)) return '系统设置';
    if (/admin|dashboard|console|后台|控制台|管理/i.test(text)) return '管理后台';
    if (/profile|user\/|member\/|me\/|个人主页|主页/i.test(text)) return '个人主页';
    if (/checkout|cart|order|pay|payment|结算|支付|订单|购物车/i.test(text)) return '交易结算';
    if (/edit|editor|compose|写作|编辑|设计|画布|notion|doc/i.test(text)) return '在线编辑';
    if (/video|watch|player|music|audio|播放|视频|直播|播客|电影/i.test(text)) return '媒体播放';
    if (/product|item|sku|商品|购买|详情页/i.test(text)) return '商品详情';
    if (/feed|timeline|stream|推荐|瀑布流|动态|首页推荐/i.test(text)) return '信息瀑布';
    if (/list|category|tag|archive|目录|列表|合集|分类/i.test(text)) return '内容列表';
    return '内容详情';
}

/** 兼容旧快照 / storage（纯字符串 zh 或 { zh, en }），统一成中英对 */
function coerceRawPageLabelPair(raw) {
    if (raw == null || raw === '') return { zh: '', en: '' };
    if (typeof raw === 'object') {
        return {
            zh: normalizeZhPageLabel(raw.zh),
            en: normalizeEnPageLabel(raw.en),
        };
    }
    if (typeof raw === 'string') {
        const zs = normalizeZhPageLabel(raw);
        if (zs) return { zh: zs, en: '' };
        const en = normalizeEnPageLabel(raw);
        return { zh: '', en: en };
    }
    return { zh: '', en: '' };
}

/** 规整并保证英文侧可读：缺一边时用规则或兜底补上 */
function finalizePageLabelPair(pair, tab) {
    let zh = normalizeZhPageLabel(pair && pair.zh);
    let en = normalizeEnPageLabel(pair && pair.en);
    const fb = inferFallbackPageLabelsBilingual(tab);
    if (!zh && !en) return fb;
    if (zh && !en) en = zhFallbackEnForLabel(zh);
    if (!zh && en) zh = fb.zh;
    return { zh, en };
}

function inferFallbackPageLabelsBilingual(tab) {
    const zh = inferFallbackPageLabel(tab && tab.title, tab && tab.url);
    return { zh, en: zhFallbackEnForLabel(zh) };
}

function coerceAndFinalizePageLabel(raw, tab) {
    return finalizePageLabelPair(coerceRawPageLabelPair(raw), tab);
}

async function runWithConcurrency(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    const max = Math.max(1, Number(limit) || 1);
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(max, list.length) }, async () => {
        for (;;) {
            const idx = nextIndex++;
            if (idx >= list.length) return;
            await worker(list[idx], idx);
        }
    });
    await Promise.all(runners);
}

/** @deprecated 仅遗留调用；返回值取中文侧 */
function toStablePageLabel(raw, tab) {
    const p = coerceAndFinalizePageLabel(raw, tab);
    return p.zh || p.en || inferFallbackPageLabel(tab && tab.title, tab && tab.url);
}

function pairFromLlmValue(v, tab) {
    if (v === null || v === undefined) return inferFallbackPageLabelsBilingual(tab);
    if (typeof v === 'string') {
        const s = String(v).trim();
        const zh = normalizeZhPageLabel(s);
        if (zh) return finalizePageLabelPair({ zh, en: '' }, tab);
        const enOnly = normalizeEnPageLabel(s);
        return finalizePageLabelPair({ zh: '', en: enOnly }, tab);
    }
    if (typeof v === 'object') {
        return finalizePageLabelPair({ zh: v.zh, en: v.en }, tab);
    }
    return inferFallbackPageLabelsBilingual(tab);
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
    const siteNames = {};
    const labels = {};
    const entries = aiSnapshotCache.entries || {};
    (tabs || []).forEach((tab) => {
        const id = String(tab.id);
        const cached = entries[id];
        if (!cached) return;
        if (cached.sig !== buildTabSignature(tab)) return;
        if (cached.siteName) siteNames[id] = cached.siteName;
        /* 尚无 pageLabel 字段的旧条目不强行兜底，等与 prewarm/recompute */
        if (cached.pageLabel === undefined || cached.pageLabel === null) return;
        labels[id] = coerceAndFinalizePageLabel(cached.pageLabel, tab);
    });
    return { siteNames, labels };
}

async function fetchPageLabelsForTabs(tabList, apiKey) {
    if (!Array.isArray(tabList) || tabList.length === 0) return {};
    const tabDescriptions = tabList.map((t) => {
        let host = '';
        let path = '';
        try {
            const u = new URL(t.url);
            host = u.hostname;
            path = u.pathname;
        } catch (_) {}
        return `ID:${t.id} 标题:${t.title || '(无)'} HOST:${host} PATH:${path}`;
    }).join('\n');

    try {
        const response = await callDeepSeekApi({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `你是网页归纳标签提取专家。给你一组同一网站下的标签页，请为每个页面同时给出「中文」「英文」两个侧边展示用短标签。

【中文 zh】精准概括页面意图，2～5 个汉字，禁止超过 5 字。

【英文 en】总结页面核心功能，生成高度具体的 1～2 个英文词的名词短语（Title Case）。
严格规则：
1. 只用 ASCII 字母、空格、数字与常见标点；长度 3～22 字符。
2. 禁止使用 Page、Article、Website、Other、Tab、Content、Info、Online、Web、Site 等无信息量的泛指词。
3. 优先聚焦页面的功能或内容的精确形态。如：AI Chat、API Docs、Design Tool、Code Editor、Dashboard、Search Engine、Video Player、Shopping Cart、News Feed、Settings。
4. 若是知名 SaaS / 平台 / 产品页，直接输出它的垂直领域或核心功能类别。如：Notion → Notes、Figma → Design Tool、GitHub → Code Repo、YouTube → Video、Gmail → Email、Slack → Team Chat。
5. 不要以冠词（A/An/The）开头。
6. 禁止直接照搬页面标题中的专有名词或产品名作为标签，必须抽象到功能/领域类别。例如：标题含"Liquid Ether"不要输出"Liquid Ether"，应输出"Component"或"Design Tool"；标题含"Linear"不要输出"Linear"，应输出"Project Mgmt"。

必须为每个传入的 ID 都返回一条，禁止缺失。
只返回合法 JSON；禁止 Markdown、注释或多余文字。

示例格式（键为真实 Tab ID）：{"8842":{"zh":"投资调研","en":"Equity Research"},"9171":{"zh":"接口文档","en":"API Docs"},"1002":{"zh":"在线协作","en":"Team Chat"}}`,
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
        try { parsed = parseDeepSeekJsonContent(raw); } catch (_) {}

        const labels = {};
        const validIds = new Set(tabList.map((t) => String(t.id)));
        const tabById = new Map(tabList.map((t) => [String(t.id), t]));
        Object.entries(parsed).forEach(([k, v]) => {
            const idKey = String(k);
            if (!validIds.has(idKey)) return;
            const tabRef = tabById.get(idKey);
            labels[idKey] = pairFromLlmValue(v, tabRef);
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
    const siteNames = {};
    const labels = {};
    const updates = {};
    const entries = aiSnapshotCache.entries || {};
    const domainNameMemo = new Map();

    await runWithConcurrency(tabList, 4, async (tab) => {
        const id = String(tab.id);
        const sig = buildTabSignature(tab);
        const cached = entries[id];
        const isSigMatch = !!(cached && cached.sig === sig);

        let siteName = isSigMatch ? cached.siteName : '';
        if (siteName === undefined || siteName === null) siteName = '';
        if (!siteName) {
            const domain = getDomainFromUrl(tab.url);
            if (domain) {
                let pendingSiteName = domainNameMemo.get(domain);
                if (!pendingSiteName) {
                    pendingSiteName = getSmartSiteName(tab.title, tab.url, apiKey)
                        .then((name) => name || '')
                        .catch(() => '');
                    domainNameMemo.set(domain, pendingSiteName);
                }
                siteName = await pendingSiteName;
            }
        }
        if (siteName) siteNames[id] = siteName;

        updates[id] = {
            ...(cached || {}),
            sig,
            siteName: siteName || '',
            updatedAt: Date.now(),
        };
    });

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
            const labelRow = await chrome.storage.local.get(cacheKey);
            const rawStored = labelRow[cacheKey];
            if (rawStored !== undefined && rawStored !== null) {
                const pair = coerceAndFinalizePageLabel(rawStored, tab);
                labels[id] = pair;
                const current = updates[id] || {};
                updates[id] = {
                    ...current,
                    sig: buildTabSignature(tab),
                    pageLabel: pair,
                    updatedAt: Date.now(),
                };
                continue;
            }
            const snapRaw = updates[id] && updates[id].pageLabel;
            if (snapRaw !== undefined && snapRaw !== null) {
                const pair = coerceAndFinalizePageLabel(snapRaw, tab);
                labels[id] = pair;
                const current = updates[id] || {};
                updates[id] = {
                    ...current,
                    sig: buildTabSignature(tab),
                    pageLabel: pair,
                    updatedAt: Date.now(),
                };
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
                const pair = coerceAndFinalizePageLabel(fetched[id], tab);
                labels[id] = pair;
                const cacheKey = pageLabelCacheKey(tab.title, tab.url);
                await chrome.storage.local.set({ [cacheKey]: pair });
                const current = updates[id] || {};
                updates[id] = {
                    ...current,
                    sig: buildTabSignature(tab),
                    pageLabel: pair,
                    updatedAt: Date.now(),
                };
            }
        }
    }

    Object.entries(updates).forEach(([id, entry]) => {
        aiSnapshotCache.entries[id] = entry;
    });
    await persistAiSnapshotCache();
    return { siteNames, labels };
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
 * 解析批量聚类的 CSV 输出：每行 `id|topic`。
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
        if (parts.length < 2) continue;
        const id = Number(parts[0]);
        if (!Number.isFinite(id) || seen.has(id)) continue;
        // topic 允许自带空格，若被多个 | 误切，则把后续段合并回去
        const topic = parts.slice(1).join(' | ').trim();
        if (!topic) continue;
        seen.add(id);
        out.push({ id, topic });
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
 * 标题信息量不足 → 单靠 title+url 难以分类，需要补 meta 描述。
 * 仅在 ai_batch_group 流程里用，决定哪些标签去抓 page meta。
 */
function titleIsAmbiguous(title) {
    const t = String(title || '').trim();
    if (!t || t.length < 4) return true;
    if (/^\(\d+\)/.test(t)) return true;                          // "(3) WhatsApp"
    if (/^(Dashboard|Untitled|Home|Loading|New Tab|无标题|加载中)/i.test(t)) return true;
    if (/^\d+\s*[-·]\s*\w+$/.test(t)) return true;                // "404 - Not Found" 之类
    return false;
}

/**
 * 批量聚类：一次请求拿到各标签的 topic，再按窗口分别 chrome.tabs.group（跨窗口不可同组）。
 * @param {number|undefined} restrictWindowId 若传入，仅处理该窗口内的标签（避免与其它窗口混组、或误搬移标签）。
 * @param {number|null|undefined} activeTabId 发起聚合操作时的标签 id；其所在组展开，其余折叠。
 * @param {Object<number,string>} [tabMetaMap] 标题模糊的标签的 meta description；仅对存在该字段的标签拼入 desc:
 */
async function performBatchAutoGrouping(tabs, apiKey, restrictWindowId, activeTabId, tabMetaMap) {
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
    const results = []; // 最终参与分组的 { id, topic }
    let toQuery = []; // 未命中缓存、需要送 LLM 的原始 tab
    for (const t of httpTabs) {
        const idStr = String(t.id);
        const sig = buildTabSignature(t);
        const cached = entries[idStr];
        if (cached && cached.sig === sig && cached.topic) {
            results.push({ id: t.id, topic: cached.topic });
        } else {
            toQuery.push(t);
        }
    }

    // —— 用户偏好预分配：domain 命中用户手动设置的分类，直接赋值跳过 LLM ——
    const userPrefs = await new Promise((resolve) => {
        chrome.storage.local.get('ysUserTopicPrefs', (res) => {
            resolve((res && res.ysUserTopicPrefs) || {});
        });
    });
    const nowTs = Date.now();
    const prefFiltered = [];
    for (const t of toQuery) {
        const domain = getDomainFromUrl(t.url);
        const prefTopic = domain && userPrefs[domain];
        if (prefTopic) {
            results.push({ id: t.id, topic: prefTopic });
            const idStr = String(t.id);
            aiSnapshotCache.entries[idStr] = {
                ...(aiSnapshotCache.entries[idStr] || {}),
                sig: buildTabSignature(t),
                topic: prefTopic,
                updatedAt: nowTs,
            };
        } else {
            prefFiltered.push(t);
        }
    }
    if (prefFiltered.length < toQuery.length) persistAiSnapshotCache();
    toQuery = prefFiltered;

    // 把缓存命中 + 用户偏好的全量 topic 透给 LLM，强制复用一致字符串
    const existingTopics = Array.from(new Set([
        ...results.map((x) => x.topic).filter(Boolean),
        ...Object.values(userPrefs).filter(Boolean),
    ]));

    try {
        if (toQuery.length > 0) {
            const tabLines = toQuery.map((t) => {
                const title = String(t.title || '').replace(/[|\n\r]/g, ' ').slice(0, 120);
                const url = String(t.url || '').slice(0, 200);
                const rawDesc = tabMetaMap && tabMetaMap[t.id];
                const descPart = rawDesc
                    ? `|desc:${String(rawDesc).replace(/[|\n\r]/g, ' ').slice(0, 160)}`
                    : '';
                return `${t.id}|${title}|${url}${descPart}`;
            }).join('\n');

            const existingSection = existingTopics.length > 0
                ? `\n\n【已有 topic — 必须优先复用，禁止改字】\n${existingTopics.map((s) => `- ${s}`).join('\n')}\n新标签能归入以上任意一条就直接用，字符串完全一致（含 Emoji）；仅在确实无法归类时才创造新 topic。`
                : '';
            const userPrefSection = Object.keys(userPrefs).length > 0
                ? `\n\n【用户手动设定的网站分类 — 必须严格遵守】\n${Object.entries(userPrefs).map(([d, t]) => `- ${d} → ${t}`).join('\n')}`
                : '';

            const systemPrompt = `你是一个追求极致极简的浏览器管家。任务不是逐页「精准描述」，而是高维度「抽象归纳」：合并同类项，减少用户认知负担。

用户会以「每行一条标签页」的格式提供输入，格式为：id|title|url 或 id|title|url|desc:<页面描述>（title/desc 中原有的 "|" 已被替换为空格）。\`desc:\` 是可选字段，仅在标题信息量不足时附带，是该页面 meta description 的截断，作为补充判据；存在时请优先据其判断页面内容。你必须为每个 id 返回一行结果。

【输出格式 — 严格遵守】
- 每行一条，格式：<id>|<topic>
- <topic>：4～6 个汉字左右的子主题场景，并带一个 Emoji 前缀，例如 "💻 研发工具"、"📈 投资调研"、"🛒 购物消费"。
- 不要表头、不要解释、不要 Markdown 代码块、不要空行；每个输入 id 都必须有对应输出行。

【正确示例】
891723|💻 研发工具
891724|📈 投资调研
891725|🎬 影视追剧

【强制聚合规则】
- 首要目标是合并同类项：尽最大努力发现网页之间的共性，把尽可能多的页面归入**相同**的 topic 字符串。
- 模型默认倾向于发散描述；你必须主动做收敛归纳（Convergence），禁止「一页一个冷门 topic」。
- 绝不允许「一页一类」。例如：关于「华夏银行分红」「紫金矿业财报」「东方财富」的页面必须统一归入 "📈 投资调研"；关于 Cursor、GitHub、Claude 的页面应统一归入 "💻 研发工具"。
- 同一批标签里，不同 topic 的种数尽量控制在 3～5 个以内；能共用同一个 topic 就不要拆。${existingSection}${userPrefSection}`;

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
                results.push({ id: r.id, topic: r.topic });
                const idStr = String(r.id);
                cacheUpdates[idStr] = {
                    ...(entries[idStr] || {}),
                    sig: sigById.get(r.id) || '',
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

async function fetchSearchSuggestions(query) {
    const keyword = String(query || '').trim();
    if (!keyword) return [];
    try {
        const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}`;
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) return [];
        const data = await response.json().catch(() => null);
        if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
        return data[1]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 8);
    } catch (error) {
        console.error('获取搜索建议失败:', error);
        return [];
    }
}

// ─── Chrome 标签组删除时同步清除 AI topic ────────────────────────────────────
// groupId → Set<tabId>：事件触发时 Chrome 已无法查询组内成员，须提前维护
const _groupTabsMap = new Map();

function _groupMapAdd(tabId, groupId) {
    if (!groupId || groupId < 0) return;
    if (!_groupTabsMap.has(groupId)) _groupTabsMap.set(groupId, new Set());
    _groupTabsMap.get(groupId).add(tabId);
}

function _groupMapRemove(tabId, groupId) {
    if (!groupId || groupId < 0) return;
    const s = _groupTabsMap.get(groupId);
    if (!s) return;
    s.delete(tabId);
    if (s.size === 0) _groupTabsMap.delete(groupId);
}

// Service Worker 每次启动重建映射
chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
    for (const t of tabs) {
        if (t.groupId && t.groupId > 0) _groupMapAdd(t.id, t.groupId);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.groupId === undefined) return;
    // 从所有组里移除旧关联
    for (const [gId, set] of _groupTabsMap) {
        if (set.has(tabId)) { set.delete(tabId); if (set.size === 0) _groupTabsMap.delete(gId); break; }
    }
    _groupMapAdd(tabId, changeInfo.groupId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [gId, set] of _groupTabsMap) {
        if (set.has(tabId)) { set.delete(tabId); if (set.size === 0) _groupTabsMap.delete(gId); break; }
    }
});

chrome.tabGroups.onRemoved.addListener((group) => {
    const tabIds = _groupTabsMap.get(group.id);
    if (!tabIds || tabIds.size === 0) { _groupTabsMap.delete(group.id); return; }
    let changed = false;
    for (const tabId of tabIds) {
        const idStr = String(tabId);
        if (aiSnapshotCache.entries && aiSnapshotCache.entries[idStr]) {
            delete aiSnapshotCache.entries[idStr];
            changed = true;
        }
    }
    _groupTabsMap.delete(group.id);
    if (changed) {
        persistAiSnapshotCache();
        chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
            for (const t of tabs) {
                chrome.tabs.sendMessage(t.id, { action: 'refresh_category_bar' }).catch(() => {});
            }
        });
    }
});
