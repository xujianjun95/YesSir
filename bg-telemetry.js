// bg-telemetry.js — 安装/更新/日活上报 + 功能使用埋点（由 background.js importScripts 加载）
//
// ─── 上报策略说明 ───────────────────────────────────────────────────────────────
//  事件类型分三类：
//   1. 实时类（install / update / startup / first_use）
//      → 触发即上报。这类事件低频且时效重要（如 first_use 用于算激活率）。
//   2. 每日去重类（panel_open）
//      → 当天首次发生时实时上报一次，按本地日期去重。直接数人头 → 精确 DAU，
//         不滞后、不累计次数。
//   3. 累计类（click 类按钮点击 → feature_daily）
//      → 本地按日累计，次日 startup 时一次性 flush 上报。避免高频按钮（如网页搜索）
//         每点一次发一次请求，省网络也对服务端友好。代价是统计延迟 1 天，但每日总量
//         的统计场景完全可接受。
//
//  上报字段：
//    { uuid, event, version, feature?, count?, date?, platform?, language? }
//      - feature:  配合 click / first_use 事件，标识哪个功能（如 ai_aggregate）
//      - count:    配合 click 事件，表示当日点击总数
//      - date:     配合 click 事件，表示统计的日期（YYYY-MM-DD）
//      - platform: 配合 startup 事件，设备平台（mac / win / linux …），用于分群
//      - language: 配合 startup 事件，界面语言（zh / en），用于分群
//
//  卸载埋点：通过 chrome.runtime.setUninstallURL 注册，用户卸载时 Chrome 打开该
//    URL，服务端据此记一条 uninstall 日志（见 proxy-server/server.js）。
// ─────────────────────────────────────────────────────────────────────────────

const TELEMETRY_ENDPOINT = 'https://api.pmtools.com.cn/yessir/telemetry';
const TELEMETRY_UNINSTALL_URL = 'https://api.pmtools.com.cn/yessir/uninstall';
const TELEMETRY_STARTUP_DATE_KEY = 'ysLastTelemetryStartupDate';
// 本地每日按钮点击计数，结构：{ "2026-05-17": { ai_aggregate: 3, web_search: 8, undo: 1 } }
const DAILY_COUNTERS_KEY = 'ysDailyCounters';
// "首次使用"类事件已上报标记，结构：{ first_close: 1716000000000, first_switcher_open: ... }
const FIRST_USE_REPORTED_KEY = 'ysFirstUseReported';
// "面板打开"每日去重上报的最后日期（YYYY-MM-DD），同一天只上报一次 panel_open
const PANEL_OPEN_DATE_KEY = 'ysLastPanelOpenDate';

function getLocalDateKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 采集设备环境（平台 + 界面语言），用于分群与流失归因。
 * platform: mac / win / linux / cros …（chrome.runtime.getPlatformInfo 的 os）
 * language: zh / en（用户设置的 uiLanguage；auto 时回退浏览器 UI 语言）
 */
async function getEnvInfo() {
    let platform = '';
    let language = '';
    try {
        const info = await chrome.runtime.getPlatformInfo();
        platform = (info && info.os) || '';
    } catch (_) { /* 拿不到就留空 */ }
    try {
        const stored = await chrome.storage.local.get({ uiLanguage: 'auto' });
        const ui = stored && stored.uiLanguage ? String(stored.uiLanguage) : 'auto';
        if (ui === 'zh_CN') language = 'zh';
        else if (ui === 'en') language = 'en';
        else language = /^zh\b/i.test(String(chrome.i18n.getUILanguage() || '')) ? 'zh' : 'en';
    } catch (_) { /* 拿不到就留空 */ }
    return { platform, language };
}

/**
 * 统一的遥测上报入口。
 * @param {string} eventType - 事件类型：install / update / startup / first_use / panel_open / feature_daily
 * @param {object} [extra]   - 附加字段（feature / count / date / platform / language 等）
 * @returns {Promise<boolean>} 上报是否成功（网络失败 / 超时 / 异常均返回 false）
 */
async function sendTelemetry(eventType, extra = {}) {
    try {
        const uuid = await getDeviceUUID();
        const manifest = chrome.runtime.getManifest();
        const payload = {
            uuid,
            event: String(eventType || ''),
            version: manifest && manifest.version ? manifest.version : '',
            ...extra,
        };
        // 用 bg-ai-network.js 里的 fetchWithTimeout，避免上报服务慢/挂时把 SW 撑活
        const res = await fetchWithTimeout(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }, 6000);
        // fetch 对 HTTP 错误状态码不会 reject，必须显式检查 res.ok：
        // 服务端 5xx / nginx 502 也算上报失败，否则 flush 会误判成功而删掉本地数据
        if (!res || !res.ok) {
            console.log('[telemetry] send failed: HTTP', res && res.status);
            return false;
        }
        return true;
    } catch (error) {
        // 网络层错误（超时 / 连接断）会走到这里；返回 false 让调用方决定是否重试
        console.log('[telemetry] send failed:', error && error.message ? error.message : error);
        return false;
    }
}

/**
 * 累计类事件：把今天的某 feature 计数 +1，本地暂存，次日 startup 时统一上报。
 * 调用方（如 track_event handler）只需 fire-and-forget。
 */
async function incrementDailyCounter(feature) {
    const f = String(feature || '').trim();
    if (!f) return;
    try {
        const today = getLocalDateKey();
        const stored = await chrome.storage.local.get(DAILY_COUNTERS_KEY);
        const counters = (stored && stored[DAILY_COUNTERS_KEY]) || {};
        if (!counters[today] || typeof counters[today] !== 'object') counters[today] = {};
        counters[today][f] = (Number(counters[today][f]) || 0) + 1;
        await chrome.storage.local.set({ [DAILY_COUNTERS_KEY]: counters });
    } catch (error) {
        console.log('[telemetry] incrementDailyCounter failed:', error && error.message ? error.message : error);
    }
}

/**
 * 把"早于今天"的累计计数 flush 上报，每条 (date, feature) 对应一条 telemetry。
 * 上报成功才从本地清掉对应 feature；上报失败则保留，下次 flush 再试（不丢数）。
 * 仅在 startup 流程里调用。
 */
async function flushPendingDailyCounters() {
    try {
        const today = getLocalDateKey();
        const stored = await chrome.storage.local.get(DAILY_COUNTERS_KEY);
        const counters = (stored && stored[DAILY_COUNTERS_KEY]) || {};
        const pendingDates = Object.keys(counters).filter((d) => d && d < today);
        if (pendingDates.length === 0) return;

        for (const date of pendingDates) {
            const dayCounters = counters[date] || {};
            for (const [feature, count] of Object.entries(dayCounters)) {
                const n = Number(count) || 0;
                if (n <= 0) { delete dayCounters[feature]; continue; }
                // 顺序上报（不并发，避免短时打爆中转端）
                const ok = await sendTelemetry('feature_daily', { feature, count: n, date });
                // 关键：只清除上报成功的 feature；失败的留在本地，下次 flush 重试。
                // 旧实现无条件 delete，上报失败即永久丢数。
                if (ok) delete dayCounters[feature];
            }
            // 一整天的 feature 都成功上报清空后，才删除该日期
            if (Object.keys(dayCounters).length === 0) delete counters[date];
        }
        await chrome.storage.local.set({ [DAILY_COUNTERS_KEY]: counters });
    } catch (error) {
        console.log('[telemetry] flush failed:', error && error.message ? error.message : error);
    }
}

/**
 * 首次使用类事件：仅在第一次发生时上报一次，之后永远不再上报。
 * 用于算新用户激活率：装机用户中有多少人真正触发过核心手势。
 */
async function trackFirstUse(feature) {
    const f = String(feature || '').trim();
    if (!f) return;
    try {
        const stored = await chrome.storage.local.get(FIRST_USE_REPORTED_KEY);
        const reported = (stored && stored[FIRST_USE_REPORTED_KEY]) || {};
        if (reported[f]) return; // 已上报过，跳过
        const ok = await sendTelemetry('first_use', { feature: f });
        // 上报成功才落标记；失败则不标记，下次触发会重试
        if (ok) {
            reported[f] = Date.now();
            await chrome.storage.local.set({ [FIRST_USE_REPORTED_KEY]: reported });
        }
    } catch (error) {
        console.log('[telemetry] trackFirstUse failed:', error && error.message ? error.message : error);
    }
}

/**
 * 每日去重类事件：当天首次打开面板时实时上报一次 panel_open，按本地日期去重。
 * 与 feature_daily 的区别：不累计次数、不滞后到次日 → analyze 端直接 count uuid
 * 即得精确的「面板打开 DAU」。
 */
async function trackPanelOpenDaily() {
    try {
        const today = getLocalDateKey();
        const stored = await chrome.storage.local.get(PANEL_OPEN_DATE_KEY);
        if (stored[PANEL_OPEN_DATE_KEY] === today) return; // 今天已上报过
        const ok = await sendTelemetry('panel_open');
        // 上报成功才记日期；失败则今天下次开面板会重试
        if (ok) await chrome.storage.local.set({ [PANEL_OPEN_DATE_KEY]: today });
    } catch (error) {
        console.log('[telemetry] trackPanelOpenDaily failed:', error && error.message ? error.message : error);
    }
}

// ─── 安装/更新事件：Chrome 触发，全生命周期各一次 ───────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        void sendTelemetry('install');
        // 标记「待展示新手引导」，content script 在下次 http 页访问时读取并展示
        chrome.storage.local.set({ ysOnboardingPending: true });
    } else if (details.reason === 'update') {
        void sendTelemetry('update');
        chrome.storage.local.set({ ysPostUpdateOnboarding: 'pending' });
    }
});

// ─── 卸载埋点：用户卸载扩展时 Chrome 打开此 URL，服务端据此记一条 uninstall ─────
// SW 每次启动都重设一次，确保 uuid/version 始终最新。
void (async () => {
    try {
        const uuid = await getDeviceUUID();
        const manifest = chrome.runtime.getManifest();
        const version = (manifest && manifest.version) || '';
        const url = `${TELEMETRY_UNINSTALL_URL}?uuid=${encodeURIComponent(uuid)}&v=${encodeURIComponent(version)}`;
        await chrome.runtime.setUninstallURL(url);
    } catch (error) {
        console.log('[telemetry] setUninstallURL failed:', error && error.message ? error.message : error);
    }
})();

// ─── 启动事件：浏览器/SW 启动后第一次激活，按本地日期去重每天最多一次 ─────────
// 同时顺带 flush 昨天/更早的累计点击事件。
void (async () => {
    try {
        const today = getLocalDateKey();
        const stored = await chrome.storage.local.get(TELEMETRY_STARTUP_DATE_KEY);
        if (stored[TELEMETRY_STARTUP_DATE_KEY] !== today) {
            const env = await getEnvInfo();
            const ok = await sendTelemetry('startup', env);
            // 上报成功才记日期；失败则今天下次 SW 激活会重试（旧实现失败也记 → 漏报）
            if (ok) await chrome.storage.local.set({ [TELEMETRY_STARTUP_DATE_KEY]: today });
        }
        // 不管今天是否已经上报过 startup，都尝试 flush 一次未上报的历史计数
        // （应对：当日内多次 SW 唤醒、或上次 startup 时 flush 失败的情况）
        await flushPendingDailyCounters();
    } catch (error) {
        console.log('[telemetry] startup check failed:', error && error.message ? error.message : error);
    }
})();
