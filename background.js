importScripts('rules.js');

// DeepSeek：优先从 chrome.storage.local.deepseekApiKey 读取，勿把密钥提交到仓库。
async function getDeepSeekApiKey() {
    const { deepseekApiKey } = await chrome.storage.local.get('deepseekApiKey');
    return (deepseekApiKey && String(deepseekApiKey).trim()) || '';
}

const CATEGORY_CACHE_VERSION = 'v3';
const SITE_NAME_CACHE_VERSION = 'v2';

function titleCacheKey(title, url = '') {
    const t = encodeURIComponent((title || '').trim().toLowerCase().slice(0, 200));
    const d = encodeURIComponent(getDomainFromUrl(url).slice(0, 120));
    return `cat_${CATEGORY_CACHE_VERSION}_${d}_${t}`;
}

function siteNameCacheKey(url = '') {
    const domain = encodeURIComponent(getDomainFromUrl(url).slice(0, 120));
    return `site_name_${SITE_NAME_CACHE_VERSION}_${domain}`;
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

});
