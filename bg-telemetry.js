// bg-telemetry.js — 安装/更新/日活上报 + 功能使用埋点（由 background.js importScripts 加载）
//
// ─── 上报策略说明 ───────────────────────────────────────────────────────────────
//  事件类型分两类：
//   1. 实时类（install / update / startup / first_use）
//      → 触发即上报。这类事件低频且时效重要（如 first_use 用于算激活率）。
//   2. 累计类（click 类按钮点击）
//      → 本地按日累计，次日 startup 时一次性 flush 上报。避免高频按钮（如网页搜索）
//         每点一次发一次请求，省网络也对服务端友好。代价是统计延迟 1 天，但每日总量
//         的统计场景完全可接受。
//
//  上报字段：
//    { uuid, event, version, feature?, count?, date? }
//      - feature: 配合 click / first_use 事件，标识哪个功能（如 ai_aggregate）
//      - count:   配合 click 事件，表示当日点击总数
//      - date:    配合 click 事件，表示统计的日期（YYYY-MM-DD）
// ─────────────────────────────────────────────────────────────────────────────

const TELEMETRY_ENDPOINT = 'https://api.pmtools.com.cn/yessir/telemetry';
const TELEMETRY_STARTUP_DATE_KEY = 'ysLastTelemetryStartupDate';
// 本地每日按钮点击计数，结构：{ "2026-05-17": { ai_aggregate: 3, web_search: 8, undo: 1 } }
const DAILY_COUNTERS_KEY = 'ysDailyCounters';
// "首次使用"类事件已上报标记，结构：{ first_close: 1716000000000, first_switcher_open: ... }
const FIRST_USE_REPORTED_KEY = 'ysFirstUseReported';

function getLocalDateKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 统一的遥测上报入口。
 * @param {string} eventType - 事件类型：install / update / startup / first_use / feature_daily
 * @param {object} [extra]   - 附加字段（feature / count / date 等）
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
        await fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        // 遥测上报失败不影响主功能；仅打日志便于排查
        console.log('[telemetry] send failed:', error && error.message ? error.message : error);
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
 * 上报成功后从本地清掉对应日期；上报失败则保留下次再试。
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
                if (n <= 0) continue;
                // 顺序上报（不并发，避免短时打爆中转端）
                await sendTelemetry('feature_daily', { feature, count: n, date });
            }
            delete counters[date];
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
        reported[f] = Date.now();
        await chrome.storage.local.set({ [FIRST_USE_REPORTED_KEY]: reported });
        await sendTelemetry('first_use', { feature: f });
    } catch (error) {
        console.log('[telemetry] trackFirstUse failed:', error && error.message ? error.message : error);
    }
}

// ─── 安装/更新事件：Chrome 触发，全生命周期各一次 ───────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        void sendTelemetry('install');
    } else if (details.reason === 'update') {
        void sendTelemetry('update');
    }
});

// ─── 启动事件：浏览器/SW 启动后第一次激活，按本地日期去重每天最多一次 ─────────
// 同时顺带 flush 昨天/更早的累计点击事件。
void (async () => {
    try {
        const today = getLocalDateKey();
        const stored = await chrome.storage.local.get(TELEMETRY_STARTUP_DATE_KEY);
        if (stored[TELEMETRY_STARTUP_DATE_KEY] !== today) {
            await sendTelemetry('startup');
            await chrome.storage.local.set({ [TELEMETRY_STARTUP_DATE_KEY]: today });
        }
        // 不管今天是否已经上报过 startup，都尝试 flush 一次未上报的历史计数
        // （应对：当日内多次 SW 唤醒、或上次 startup 时 flush 失败的情况）
        await flushPendingDailyCounters();
    } catch (error) {
        console.log('[telemetry] startup check failed:', error && error.message ? error.message : error);
    }
})();
