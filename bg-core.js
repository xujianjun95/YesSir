// bg-core.js — 标签轨迹、favicon 缓存、设备 UUID（由 background.js importScripts 加载）
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

// ─── 图标缓存：兜底睡眠/恢复标签页缺失的 favIconUrl ─────────────────────────────
const FAVICON_CACHE_KEY = 'ysFaviconCacheV1';
const FAVICON_CACHE_MAX_ENTRIES = 1200;
const FAVICON_CACHE_TRIM_TO = 900;
let faviconCache = {};
let faviconCacheWriteTimer = null;

async function restoreFaviconCache() {
    try {
        const stored = await chrome.storage.local.get(FAVICON_CACHE_KEY);
        const raw = stored[FAVICON_CACHE_KEY];
        if (raw && typeof raw === 'object') faviconCache = raw;
    } catch (error) {
        console.warn('恢复 favicon 缓存失败:', error);
    }
}

function queuePersistFaviconCache() {
    if (faviconCacheWriteTimer) return;
    faviconCacheWriteTimer = setTimeout(async () => {
        faviconCacheWriteTimer = null;
        try {
            const entries = Object.entries(faviconCache);
            if (entries.length > FAVICON_CACHE_MAX_ENTRIES) {
                // 软裁剪：保留最后写入的一段，避免缓存无限增长
                faviconCache = Object.fromEntries(entries.slice(-FAVICON_CACHE_TRIM_TO));
            }
            await chrome.storage.local.set({ [FAVICON_CACHE_KEY]: faviconCache });
        } catch (error) {
            console.warn('持久化 favicon 缓存失败:', error);
        }
    }, 200);
}

function isUsableFaviconUrl(iconUrl) {
    const s = String(iconUrl || '').trim();
    if (!s) return false;
    if (/^chrome(-extension)?:\/\//i.test(s)) return false;
    return /^https?:\/\//i.test(s);
}

function saveFaviconToCache(url, iconUrl) {
    if (!isUsableFaviconUrl(iconUrl)) return;
    const domain = getDomainFromUrl(url);
    if (!domain) return;
    if (faviconCache[domain] === iconUrl) return;
    faviconCache[domain] = iconUrl;
    queuePersistFaviconCache();
}

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
