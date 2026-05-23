// bg-messages.js — chrome.runtime.onMessage 路由（由 background.js importScripts 加载）

// ─── AI 预热全局节流 ──────────────────────────────────────────────────────────
// 之前的实现把节流变量放在 content.js 的 per-page 全局里，每打开一个新标签都从 0
// 计时，等于没节流。免费用户 10 次/天的额度因此可能被预热请求悄悄烧光。
// 现在按 windowId 在 SW 内统一节流，并发请求复用同一 Promise。
const PREWARM_INTERVAL_MS = 45000;
/** windowId(string) → lastSuccessTimestamp */
const _prewarmLastAt = new Map();
/** windowId(string) → in-flight Promise */
const _prewarmInflight = new Map();

/** 并发抓「标题模糊」http 标签的 meta description；带超时，失败静默忽略 */
async function collectAmbiguousTabMeta(tabs) {
    const candidates = (Array.isArray(tabs) ? tabs : []).filter((t) =>
        t && t.id != null
        && /^https?:\/\//i.test(String(t.url || ''))
        && typeof titleIsAmbiguous === 'function'
        && titleIsAmbiguous(t.title)
    );
    if (candidates.length === 0) return {};

    const TIMEOUT_MS = 500;
    const fetchOne = (tabId) => new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            resolve(null);
        }, TIMEOUT_MS);
        try {
            chrome.tabs.sendMessage(tabId, { action: 'get_page_meta' }, (res) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }
                resolve(res || null);
            });
        } catch (_) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(null);
        }
    });

    const metaMap = {};
    await Promise.all(candidates.map(async (t) => {
        const res = await fetchOne(t.id);
        if (res && res.description) {
            metaMap[t.id] = String(res.description).trim();
        } else if (res && res.ogTitle) {
            metaMap[t.id] = String(res.ogTitle).trim();
        }
    }));
    return metaMap;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // 供 content script 在睡眠唤醒后轻量唤醒 SW，降低首条业务消息失败率
    if (request.action === 'ping') {
        sendResponse({ ok: true });
        return false;
    }

    // 面板生命周期：让广播 refresh_category_bar 时只命中真正打开了面板的标签
    if (request.action === 'switcher_opened') {
        if (sender.tab && sender.tab.id != null) _activeSwitcherTabs.add(sender.tab.id);
        sendResponse({ ok: true });
        return false;
    }
    if (request.action === 'switcher_closed') {
        if (sender.tab && sender.tab.id != null) _activeSwitcherTabs.delete(sender.tab.id);
        sendResponse({ ok: true });
        return false;
    }

    // ── 通用埋点入口：content script 触发的功能使用统计 ──
    // 用法：
    //   ysSendToBg({ action: 'track_event', feature: 'ai_aggregate' })            // 点击类，本地累计次日上报
    //   ysSendToBg({ action: 'track_event', feature: 'first_close', kind: 'first_use' })  // 首次触发，立即上报一次
    if (request.action === 'track_event') {
        const feature = String(request.feature || '').trim();
        const kind = String(request.kind || 'click').trim();
        if (!feature) {
            sendResponse({ ok: false });
            return false;
        }
        (async () => {
            try {
                if (kind === 'first_use') {
                    await trackFirstUse(feature);
                } else {
                    await incrementDailyCounter(feature);
                }
                sendResponse({ ok: true });
            } catch (_) {
                sendResponse({ ok: false });
            }
        })();
        return true;
    }

    // ── 统一记录函数：记录一次“使用” (关闭或切换) ──
    function recordUsage(callback) {
        // 与遥测埋点统一用本地日期（getLocalDateKey 见 bg-telemetry.js）。
        // 旧实现用 UTC，东八区凌晨 0~8 点会和 ysDailyCounters 错位一天
        const today = getLocalDateKey();
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
        chrome.tabs.update(request.tabId, { active: true }, () => {
            const err = chrome.runtime.lastError;
            sendResponse({ success: !err, error: err ? err.message : undefined });
        });
        return true;
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
                sendResponse({ success: false, message: bgT('bgNothingToRestore') });
                return;
            }
            const toRestore = sessions.filter((s) => s.tab || s.window);
            if (toRestore.length === 0) {
                sendResponse({ success: false, message: bgT('bgNothingToRestore') });
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
                    windowMap[id] = bgT('windowLabelCurrent');
                } else {
                    windowMap[id] = bgT('windowLabelOther');
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
                        title:      t.title || bgT('footerUntitled'),
                        url:        t.url   || '',
                        active:     t.active,
                        favIconUrl: t.favIconUrl || fallbackIcon,
                    };
                })
            });
        });
        return true;
    }

    // ── 获取所有 Chrome 标签组标题（用于校验 pill 同步） ──
    else if (request.action === 'get_tab_group_titles') {
        (async () => {
            try {
                const windows = await chrome.windows.getAll();
                const titles = new Set();
                for (const w of windows) {
                    const groups = await chrome.tabGroups.query({ windowId: w.id });
                    for (const g of groups) {
                        if (g.title) titles.add(g.title);
                    }
                }
                sendResponse({ titles: [...titles] });
            } catch {
                sendResponse({ titles: [] });
            }
        })();
        return true;
    }

    // ── 读取 AI 快照缓存（仅返回已命中结果，不阻塞） ──
    else if (request.action === 'get_ai_snapshot') {
        const tabList = Array.isArray(request.tabs) ? request.tabs : [];
        sendResponse(buildAiSnapshotFromCache(tabList));
        return true;
    }

    // ── 用户手动改变某 tab 的 topic（拖拽分类）──
    else if (request.action === 'update_tab_topic') {
        const tabIdNum = Number(request.tabId);
        const tabIdStr = String(request.tabId);
        const newTopic = request.topic || null;
        // content 侧按当前语言传 lang；缺省兜底用 'topic'
        const topicField = request.lang === 'en' ? 'topic_en' : 'topic';

        // 更新内存缓存并持久化，防止下次 AI 分组覆盖
        const existing = (aiSnapshotCache.entries || {})[tabIdStr] || {};
        if (newTopic) {
            aiSnapshotCache.entries[tabIdStr] = { ...existing, [topicField]: newTopic };
        } else {
            delete aiSnapshotCache.entries[tabIdStr];
        }
        persistAiSnapshotCache();

        // 移动 Chrome 原生标签组（sendResponse 在 IIFE 内部调用，保持 SW 存活直到完成）
        (async () => {
            try {
                const tab = await chrome.tabs.get(tabIdNum).catch(() => null);
                if (tab) {
                    if (!newTopic) {
                        await chrome.tabs.ungroup([tabIdNum]).catch(() => {});
                    } else {
                        const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
                        const target = groups.find((g) => g.title === newTopic);
                        if (target) {
                            await chrome.tabs.group({ tabIds: [tabIdNum], groupId: target.id });
                        } else {
                            const newGroupId = await chrome.tabs.group({ tabIds: [tabIdNum] });
                            await updateTabGroupProgrammatically(newGroupId, {
                                title: newTopic,
                                color: TAB_GROUP_COLORS[Math.floor(Math.random() * TAB_GROUP_COLORS.length)],
                            });
                        }
                    }
                }
            } catch (err) {
                console.error('update_tab_topic: 移动标签组失败', err);
            }
            _broadcastCategoryBarRefresh();
            sendResponse({ ok: true });
        })();
        return true;
    }

    // ── 对指定 tabs 做 AI 预热并返回结果 ──
    else if (request.action === 'prewarm_ai_snapshot') {
        (async () => {
            try {
                const tabList = Array.isArray(request.tabs) ? request.tabs : [];
                if (tabList.length === 0) {
                    sendResponse({ siteNames: {}, labels: {} });
                    return;
                }
                const snapshot = await computeAiSnapshotForTabs(tabList);
                sendResponse(snapshot);
            } catch (err) {
                console.error('prewarm_ai_snapshot:', err);
                sendResponse({
                    siteNames: {}, labels: {},
                    error: err && err.message ? String(err.message) : String(err),
                });
            }
        })();
        return true;
    }

    // ── 静默预热当前窗口，供面板秒开（无需等待结果） ──
    // 全局节流：同一窗口 45s 内只跑一次（跨标签共享，避免每个 tab 各自计时形同虚设）。
    // in-flight 复用：同一窗口已有请求进行中时，新调用直接挂到旧 Promise 上，不重复打 LLM。
    else if (request.action === 'prewarm_ai_current_window') {
        (async () => {
            const sourceWindowId = sender.tab && Number.isFinite(Number(sender.tab.windowId))
                ? Number(sender.tab.windowId)
                : null;
            const windowKey = sourceWindowId === null ? 'all' : String(sourceWindowId);
            const nowTs = Date.now();
            const lastTs = _prewarmLastAt.get(windowKey) || 0;
            if (nowTs - lastTs < PREWARM_INTERVAL_MS) {
                sendResponse({ success: true, skipped: true, reason: 'throttled' });
                return;
            }
            const inflight = _prewarmInflight.get(windowKey);
            if (inflight) {
                try { await inflight; sendResponse({ success: true, skipped: true, reason: 'inflight' }); }
                catch (_) { sendResponse({ success: false, error: 'inflight_failed' }); }
                return;
            }

            const query = sourceWindowId === null ? {} : { windowId: sourceWindowId };
            const job = (async () => {
                const tabs = await new Promise((resolve) => chrome.tabs.query(query, resolve));
                if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
                const tabList = (tabs || []).map((t) => ({
                    id: t.id, title: t.title || '', url: t.url || '',
                }));
                if (tabList.length === 0) return { skipped: true };
                await computeAiSnapshotForTabs(tabList);
                return {};
            })();
            _prewarmInflight.set(windowKey, job);

            try {
                const result = await job;
                _prewarmLastAt.set(windowKey, Date.now());
                sendResponse({ success: true, ...(result || {}) });
            } catch (err) {
                console.error('prewarm_ai_current_window:', err);
                sendResponse({
                    success: false,
                    error: err && err.message ? String(err.message) : String(err),
                });
            } finally {
                _prewarmInflight.delete(windowKey);
            }
        })();
        return true;
    }

    else if (request.action === 'get_tab_page_labels') {
        (async () => {
            try {
                const apiKey = await getDeepSeekApiKey();

                const tabList = Array.isArray(request.tabs) ? request.tabs : [];
                if (tabList.length === 0) {
                    sendResponse({ labels: {} });
                    return;
                }
                const fetchedLabels = await fetchPageLabelsForTabs(tabList, apiKey);
                const labels = {};
                Object.entries(fetchedLabels).forEach(([id, labelPair]) => {
                    const tab = tabList.find((t) => String(t.id) === String(id));
                    if (!tab) return;
                    const safePair = coerceAndFinalizePageLabel(labelPair, tab);
                    labels[id] = safePair;
                    aiSnapshotCache.entries[String(id)] = {
                        ...(aiSnapshotCache.entries[String(id)] || {}),
                        sig: buildTabSignature(tab),
                        pageLabel: safePair,
                        updatedAt: Date.now(),
                    };
                });
                await persistAiSnapshotCache();
                sendResponse({ labels });
            } catch (err) {
                console.error('get_tab_page_labels:', err);
                sendResponse({ labels: {}, error: err && err.message ? String(err.message) : String(err) });
            }
        })();
        return true;
    }

    // ── 批量 AI 聚类并创建 Chrome 标签组（需 tabGroups 权限） ──
    else if (request.action === 'ai_batch_group') {
        (async () => {
            try {
                const apiKey = await getDeepSeekApiKey();
                const tabs = Array.isArray(request.tabs) ? request.tabs : [];
                const restrictWindowId = (request.windowId !== null && request.windowId !== undefined)
                    ? request.windowId
                    : null;
                const activeTabId = sender.tab && sender.tab.id !== undefined ? sender.tab.id : null;

                // 标题模糊的 http 标签 → 并发抓 page meta 作为补充判据（隐私权衡：仅对真正需要的标签发起）
                const tabMetaMap = await collectAmbiguousTabMeta(tabs);

                const result = await performBatchAutoGrouping(tabs, apiKey, restrictWindowId, activeTabId, tabMetaMap);
                sendResponse({
                    success: !result.error,
                    groupCount: result.groupCount,
                    error: result.error,
                    message: result.message,
                });
            } catch (err) {
                console.error('ai_batch_group:', err);
                sendResponse({
                    success: false,
                    error: 'exception',
                    message: err && err.message ? String(err.message) : String(err),
                });
            }
        })();
        return true;
    }

    // ── 切回全局「上一个看过的」标签页（先聚焦窗口再激活标签，需 windows 权限） ──
    else if (request.action === 'switch_to_last_tab') {
        (async () => {
            try {
                await tabHistoryReady;
            } catch (err) {
                console.error('switch_to_last_tab (tabHistoryReady):', err);
                sendResponse({ success: false, reason: 'history_error', error: String(err && err.message || err) });
                return;
            }
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
                            message: bgT('bgSwitchSuccess'),
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
            try {
                await tabHistoryReady;
                sendResponse({ lastTab: globalTabHistory.last });
            } catch (err) {
                console.error('get_last_context:', err);
                sendResponse({ lastTab: null, error: err && err.message ? String(err.message) : String(err) });
            }
        })();
        return true;
    }

    else if (request.action === 'get_search_suggestions') {
        (async () => {
            try {
                const suggestions = await fetchSearchSuggestions(request.query);
                sendResponse({ suggestions });
            } catch (err) {
                console.error('get_search_suggestions:', err);
                sendResponse({ suggestions: [], error: err && err.message ? String(err.message) : String(err) });
            }
        })();
        return true;
    }

    // ── 使用浏览器默认搜索引擎在新标签页执行搜索 ──
    else if (request.action === 'search_web') {
        const keyword = String(request.keyword || '').trim();
        if (!keyword) {
            sendResponse({ success: false, error: bgT('bgSearchNeedKeyword') });
            return false;
        }
        chrome.search.query({ text: keyword, disposition: 'NEW_TAB' }, () => {
            const err = chrome.runtime.lastError;
            if (err) {
                sendResponse({ success: false, error: err.message || bgT('bgSearchFailed') });
                return;
            }
            sendResponse({ success: true });
        });
        return true;
    }

    // ── AI 自然语言搜索：将用户输入转为匹配关键词 ──
    else if (request.action === 'ai_search_tabs') {
        (async () => {
            try {
            const apiKey = await getDeepSeekApiKey();
            const query = String(request.query || '').trim();
            if (!query) {
                sendResponse({ keywords: [] });
                return;
            }

            const cacheKey = query.toLowerCase();
            const cachedHit = aiSearchKeywordCache.get(cacheKey);
            if (cachedHit) {
                /* LRU：命中时搬到尾部 */
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
            } catch (outerErr) {
                console.error('ai_search_tabs:', outerErr);
                let message = String(outerErr && outerErr.message ? outerErr.message : outerErr);
                if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
                    message = '网络无法连接 AI 服务。未配置 Key 时需访问中转 api.pmtools.com.cn；请检查网络、在 chrome://extensions 重新加载本扩展（以应用中转域名权限），或直接在设置中填入 DeepSeek API Key。';
                }
                sendResponse({ keywords: [], error: 'exception', message });
            }
        })();
        return true;
    }

});

// ── 点击扩展栏图标 → 在当前标签页呼出/关闭切换面板 ──────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.id) return;
    try {
        const allTabs = await chrome.tabs.query({});
        const currentWindowId = tab.windowId;
        allTabs.forEach((t) => saveFaviconToCache(t.url, t.favIconUrl));
        const sortedTabs = allTabs.slice().sort((a, b) => {
            if (a.windowId !== b.windowId) return a.windowId - b.windowId;
            return a.index - b.index;
        });
        const uniqueWindowIds = [...new Set(sortedTabs.map((t) => t.windowId))];
        const windowMap = {};
        uniqueWindowIds.forEach((id) => {
            windowMap[id] = id === currentWindowId ? bgT('windowLabelCurrent') : bgT('windowLabelOther');
        });
        const tabs = sortedTabs.map((t) => {
            const domain = getDomainFromUrl(t.url);
            const fallbackIcon = domain ? String(faviconCache[domain] || '') : '';
            return {
                id: t.id, windowId: t.windowId, windowName: windowMap[t.windowId] || '',
                index: t.index, title: t.title || bgT('footerUntitled'),
                url: t.url || '', active: t.active, favIconUrl: t.favIconUrl || fallbackIcon,
            };
        });
        await chrome.tabs.sendMessage(tab.id, { action: 'toggle_switcher', tabs, currentWindowId });
    } catch (_) {}
});
