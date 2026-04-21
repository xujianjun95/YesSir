// bg-messages.js — chrome.runtime.onMessage 路由（由 background.js importScripts 加载）
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
            tabs.forEach((t) => saveFaviconToCache(t.url, t.favIconUrl));
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
                tabs: sortedTabs.map(t => {
                    const domain = getDomainFromUrl(t.url);
                    const fallbackIcon = domain ? String(faviconCache[domain] || '') : '';
                    return {
                        id:         t.id,
                        windowId:   t.windowId,
                        windowName: windowMap[t.windowId] || '',
                        index:      t.index,
                        title:      t.title || '(无标题)',
                        url:        t.url   || '',
                        active:     t.active,
                        favIconUrl: t.favIconUrl || fallbackIcon,
                    };
                })
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
                const tab = tabList.find((t) => String(t.id) === String(id));
                if (!tab) return;
                const safeLabel = toStablePageLabel(label, tab);
                aiSnapshotCache.entries[String(id)] = {
                    ...(aiSnapshotCache.entries[String(id)] || {}),
                    sig: buildTabSignature(tab),
                    pageLabel: safeLabel,
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

    else if (request.action === 'get_search_suggestions') {
        (async () => {
            const suggestions = await fetchSearchSuggestions(request.query);
            sendResponse({ suggestions });
        })();
        return true;
    }

    // ── 使用浏览器默认搜索引擎在新标签页执行搜索 ──
    else if (request.action === 'search_web') {
        const keyword = String(request.keyword || '').trim();
        if (!keyword) {
            sendResponse({ success: false, error: '请输入搜索关键词' });
            return false;
        }
        chrome.search.query({ text: keyword, disposition: 'NEW_TAB' }, () => {
            const err = chrome.runtime.lastError;
            if (err) {
                sendResponse({ success: false, error: err.message || '搜索失败' });
                return;
            }
            sendResponse({ success: true });
        });
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
