chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // ── 关闭标签并更新统计 ──────────────────────────────────────────────────────
    if (request.action === "close_and_toast") {
        const today = new Date().toISOString().slice(0, 10);

        chrome.storage.local.get({ closeCount: 0, dailyStats: {} }, function(result) {
            let newCount = result.closeCount + 1;
            let dailyStats = result.dailyStats;
            dailyStats[today] = (dailyStats[today] || 0) + 1;

            chrome.storage.local.set({ closeCount: newCount, dailyStats }, function() {
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
        });
    }

    // ── 获取近五天统计 ──────────────────────────────────────────────────────────
    if (request.action === "get_daily_stats") {
        chrome.storage.local.get({ dailyStats: {} }, function(result) {
            sendResponse({ dailyStats: result.dailyStats });
        });
        return true;
    }

    // ── 获取当前窗口所有标签页 ──────────────────────────────────────────────────
    if (request.action === "get_tabs") {
        const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
        chrome.tabs.query({ windowId }, function(tabs) {
            sendResponse({
                tabs: tabs.map(t => ({
                    id:         t.id,
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

    // ── 切换到指定标签页 ────────────────────────────────────────────────────────
    if (request.action === "switch_tab") {
        chrome.tabs.update(request.tabId, { active: true });
    }

});
