#!/usr/bin/env node
/**
 * 读取 telemetry.log，输出统计：
 *   1. 每日基础指标（安装 / 更新 / 启动 / 面板DAU / 卸载 / 活跃）
 *   2. 累计指标（累计装机、累计卸载、当前存活估算、卸载率）
 *   3. 留存（D1 / D7 / D30，基于 startup 宽口径，经典 Day-N）
 *   4. 核心功能首次激活率（first_use 独立用户 / 累计装机）
 *   5. 每日功能点击量（feature_daily，按日期 × feature 透视）
 *   6. 平台 / 语言 分布
 *
 * 注：埋点的 event / feature 是英文标识符，仅在本脚本输出时映射成中文（见 LABELS），
 *     telemetry.log 与客户端上报的字段一律保持英文不变。
 *
 * 用法：
 *   node analyze-telemetry.js [./telemetry.log]
 */
const fs = require('fs');
const path = require('path');

const logFile = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(__dirname, 'telemetry.log');

if (!fs.existsSync(logFile)) {
    console.error(`[telemetry] 日志文件不存在: ${logFile}`);
    process.exit(1);
}

// ─── 英文埋点标识 → 中文展示名（只影响输出，不改日志/上报） ───────────────────
const LABELS = {
    // event
    install: '安装', update: '更新', startup: '启动', uninstall: '卸载',
    first_use: '首次使用', feature_daily: '每日功能', panel_open: '打开面板',
    // feature_daily 的 feature
    switcher_open: '打开面板', ai_aggregate: 'AI聚合', web_search: '网页搜索',
    undo: '后悔药', drag_reclassify: '拖拽重分类', rename_group: '重命名分组',
    pin_to_dock: '置顶', unpin_from_dock: '取消置顶',
    onboarding_shown: '引导展示', onboarding_dismissed: '引导关闭',
    onboarding_reopen: '引导重开',
    // first_use 的 feature
    first_close: '首次关闭标签', first_switcher_open: '首次打开面板',
    unknown: '未知(旧版无feature字段)',
};
const label = (k) => LABELS[k] || k;

const TODAY = new Date().toISOString().slice(0, 10);
function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const content = fs.readFileSync(logFile, 'utf-8');
const lines = content.split(/\r?\n/).filter(Boolean);

// ─── 累加结构 ────────────────────────────────────────────────────────────────
const daily = new Map();              // date -> 每日各项计数
const allInstallUuids = new Set();    // 全期累计安装过的 uuid
const allUninstallUuids = new Set();  // 全期累计卸载过的 uuid
const firstUseUuids = new Map();      // feature -> Set<uuid>，独立首次使用
const featureDaily = new Map();       // date -> Map<feature, sumCount>
const featureDailyUuids = new Map();  // date -> Map<feature, Set<uuid>>，功能使用人数
const userLifecycle = new Map();      // uuid -> { installDate, activeDates:Set }，算留存用
const platformUuids = new Map();      // platform -> Set<uuid>
const languageUuids = new Map();      // language -> Set<uuid>
const latestVersionByUuid = new Map(); // uuid -> { version, timestamp }，按最后一次上报估算当前版本

let invalidLines = 0;

function ensureDay(dateKey) {
    if (!daily.has(dateKey)) {
        daily.set(dateKey, {
            install: 0, update: 0, startup: 0, uninstall: 0,
            startupUsers: new Set(), updateUsers: new Set(),
            uninstallUsers: new Set(), panelOpenUsers: new Set(),
            allUsers: new Set(),
        });
    }
    return daily.get(dateKey);
}
function ensureLife(uuid) {
    if (!userLifecycle.has(uuid)) {
        userLifecycle.set(uuid, { installDate: '', activeDates: new Set() });
    }
    return userLifecycle.get(uuid);
}
function ensureFeatureDay(dateKey) {
    if (!featureDaily.has(dateKey)) featureDaily.set(dateKey, new Map());
    return featureDaily.get(dateKey);
}

// ─── 逐行解析 ────────────────────────────────────────────────────────────────
for (const line of lines) {
    let row;
    try {
        row = JSON.parse(line);
    } catch (_) {
        invalidLines += 1;
        continue;
    }
    const ts = String(row.timestamp || '').trim();
    const event = String(row.event || '').trim();
    const uuid = String(row.uuid || '').trim();
    const version = String(row.version || '').trim();
    if (!ts || !event) {
        invalidLines += 1;
        continue;
    }
    // timestamp 是服务端落盘时间戳，用于按日分桶
    const dateKey = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        invalidLines += 1;
        continue;
    }

    const day = ensureDay(dateKey);
    if (uuid) day.allUsers.add(uuid);
    if (uuid && version) {
        const prev = latestVersionByUuid.get(uuid);
        if (!prev || ts >= prev.timestamp) latestVersionByUuid.set(uuid, { version, timestamp: ts });
    }

    if (event === 'install') {
        day.install += 1;
        if (uuid) {
            allInstallUuids.add(uuid);
            const life = ensureLife(uuid);
            if (!life.installDate || dateKey < life.installDate) life.installDate = dateKey;
            life.activeDates.add(dateKey);
        }
    } else if (event === 'update') {
        day.update += 1;
        if (uuid) {
            day.updateUsers.add(uuid);
            ensureLife(uuid).activeDates.add(dateKey);
        }
    } else if (event === 'startup') {
        day.startup += 1;
        if (uuid) {
            day.startupUsers.add(uuid);
            ensureLife(uuid).activeDates.add(dateKey);
        }
        // startup 携带的环境字段：平台 / 语言
        const plat = String(row.platform || '').trim();
        const lang = String(row.language || '').trim();
        if (uuid && plat) {
            if (!platformUuids.has(plat)) platformUuids.set(plat, new Set());
            platformUuids.get(plat).add(uuid);
        }
        if (uuid && lang) {
            if (!languageUuids.has(lang)) languageUuids.set(lang, new Set());
            languageUuids.get(lang).add(uuid);
        }
    } else if (event === 'uninstall') {
        day.uninstall += 1;
        if (uuid) {
            day.uninstallUsers.add(uuid);
            allUninstallUuids.add(uuid);
        }
    } else if (event === 'first_use') {
        // 客户端在首次成功使用某功能时发；按 feature 累积独立用户
        const feature = String(row.feature || '').trim() || 'unknown';
        if (!firstUseUuids.has(feature)) firstUseUuids.set(feature, new Set());
        if (uuid) firstUseUuids.get(feature).add(uuid);
    } else if (event === 'feature_daily') {
        // 客户端次日 flush 的按日累计点击数：feature + count + date(=点击发生那一天)
        const feature = String(row.feature || '').trim();
        const count = Number(row.count) || 0;
        const clickDate = String(row.date || '').trim() || dateKey;
        if (!feature || count <= 0) continue;
        const clickDay = ensureDay(clickDate);
        if (uuid) {
            clickDay.allUsers.add(uuid);
            ensureLife(uuid).activeDates.add(clickDate);
        }
        const bucket = ensureFeatureDay(clickDate);
        bucket.set(feature, (bucket.get(feature) || 0) + count);
        // 同步累计独立用户：feature_daily 上报带 uuid，按 (日期, feature) 去重
        if (uuid) {
            if (!featureDailyUuids.has(clickDate)) featureDailyUuids.set(clickDate, new Map());
            const ub = featureDailyUuids.get(clickDate);
            if (!ub.has(feature)) ub.set(feature, new Set());
            ub.get(feature).add(uuid);
        }
    }
}

console.log(`Telemetry 日志: ${logFile}`);
console.log(`总行数: ${lines.length} | 异常行: ${invalidLines}`);

const sortedDates = Array.from(daily.keys()).sort((a, b) => a.localeCompare(b));
if (sortedDates.length === 0) {
    console.log('暂无可统计数据。');
    process.exit(0);
}

// ─── 输出 1：每日基础指标 ─────────────────────────────────────────────────────
const baseRows = sortedDates.map((date) => {
    const v = daily.get(date);
    // 面板用户三路兜底合并：
    //   1) panel_open 事件（按日去重，最精确）—— 客户端 trackPanelOpenDaily 走这条
    //   2) feature_daily 里的 switcher_open uuids —— 老数据/event 上报失败时的兜底
    //   3) feature_daily 里的 panel_open uuids —— 防止客户端误把 panel_open 当 feature 发
    const panelUsers = new Set(v.panelOpenUsers);
    for (const alias of ['switcher_open', 'panel_open']) {
        const uuids = featureDailyUuids.get(date)?.get(alias);
        if (uuids) for (const uuid of uuids) panelUsers.add(uuid);
    }
    return {
        日期: date,
        安装: v.install,
        更新次数: v.update,
        更新用户: v.updateUsers.size,
        启动次数: v.startup,
        '日活(启动)': v.startupUsers.size,
        面板用户: panelUsers.size,
        卸载: v.uninstall,
        活跃用户: v.allUsers.size,
    };
});
console.log('\n=== 每日基础指标 ===');
console.table(baseRows);

// ─── 输出 2：累计指标 ─────────────────────────────────────────────────────────
const survived = [...allInstallUuids].filter((u) => !allUninstallUuids.has(u)).length;
const churnRate = allInstallUuids.size
    ? ((allInstallUuids.size - survived) / allInstallUuids.size * 100).toFixed(1) + '%'
    : '—';
console.log('\n=== 累计指标 ===');
console.table([{
    累计装机: allInstallUuids.size,
    累计卸载: allUninstallUuids.size,
    当前存活估算: survived,
    卸载率: churnRate,
}]);

// ─── 输出 3：留存（经典 Day-N，基于 startup 宽口径） ──────────────────────────
// 「活跃」= 当天有 install/update/startup/panel_open 任意事件。startup 是宽口径
// （浏览器开着即上报），故留存偏乐观；面板 DAU(panel_open) 攒够数据后可换窄口径。
const RET_DAYS = [1, 7, 30];
const ret = {};
RET_DAYS.forEach((n) => { ret[n] = { hit: 0, total: 0 }; });
for (const life of userLifecycle.values()) {
    if (!life.installDate) continue; // 无 install 记录（日志轮转前安装的）不计入
    for (const n of RET_DAYS) {
        const target = addDays(life.installDate, n);
        if (target > TODAY) continue; // 第 N 天还没到，不计入分母
        ret[n].total += 1;
        if (life.activeDates.has(target)) ret[n].hit += 1;
    }
}
const retRows = RET_DAYS.map((n) => ({
    指标: `D${n} 留存`,
    样本数: ret[n].total,
    留存用户: ret[n].hit,
    留存率: ret[n].total ? (ret[n].hit / ret[n].total * 100).toFixed(1) + '%' : '—',
}));
console.log('\n=== 留存（经典 Day-N，基于 startup 宽口径） ===');
console.table(retRows);

// ─── 输出 4：核心功能首次激活率 ───────────────────────────────────────────────
if (firstUseUuids.size > 0) {
    const totalUsers = allInstallUuids.size || 1; // 防止除零
    const activationRows = Array.from(firstUseUuids.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .map(([feature, set]) => ({
            功能: label(feature),
            激活用户数: set.size,
            激活率: `${(set.size / totalUsers * 100).toFixed(1)}%`,
        }));
    console.log('\n=== 核心功能激活率（first_use 独立用户 / 累计装机） ===');
    console.table(activationRows);
}

// ─── 输出 5：每日功能点击量 ───────────────────────────────────────────────────
if (featureDaily.size > 0) {
    const allFeatures = new Set();
    featureDaily.forEach((bucket) => bucket.forEach((_, f) => {
        if (f !== 'switcher_open') allFeatures.add(f);
    }));
    const featureCols = Array.from(allFeatures).sort();

    const clickRows = Array.from(featureDaily.keys())
        .sort((a, b) => a.localeCompare(b))
        .map((date) => {
            const row = { 日期: date };
            const bucket = featureDaily.get(date);
            featureCols.forEach((f) => {
                row[label(f)] = bucket.get(f) || 0;
            });
            return row;
        })
        .filter((row) => Object.keys(row).length > 1);
    if (clickRows.length > 0) {
        console.log('\n=== 每日功能点击量（不含打开面板；打开面板看用户数） ===');
        console.table(clickRows);
    }
}

// ─── 输出 6：每日功能使用人数（feature_daily 独立用户） ──────────────────────
// 与「点击量」同源同滞后（次日 flush），区别是按 uuid 去重 → 数人头而非次数。
if (featureDailyUuids.size > 0) {
    const allFeatures = new Set();
    featureDailyUuids.forEach((bucket) => bucket.forEach((_, f) => allFeatures.add(f)));
    const featureCols = Array.from(allFeatures).sort();

    const userRows = Array.from(featureDailyUuids.keys())
        .sort((a, b) => a.localeCompare(b))
        .map((date) => {
            const row = { 日期: date };
            const bucket = featureDailyUuids.get(date);
            featureCols.forEach((f) => {
                row[label(f)] = bucket.has(f) ? bucket.get(f).size : 0;
            });
            return row;
        });
    console.log('\n=== 每日功能使用人数（独立用户） ===');
    console.table(userRows);
}

// ─── 输出 7：当前用户版本分布 ────────────────────────────────────────────────
// 每条 telemetry 都带 version；这里按每个 uuid 最后一次上报的 version 估算当前版本。
// 对不再活跃的用户无法主动探测，只能以最后一次看到的版本为准。
if (latestVersionByUuid.size > 0) {
    const versionUuids = new Map();
    for (const [uuid, meta] of latestVersionByUuid.entries()) {
        const v = meta.version || 'unknown';
        if (!versionUuids.has(v)) versionUuids.set(v, new Set());
        versionUuids.get(v).add(uuid);
    }
    const rows = Array.from(versionUuids.entries())
        .sort((a, b) => {
            const byUsers = b[1].size - a[1].size;
            return byUsers || b[0].localeCompare(a[0]);
        })
        .map(([v, s]) => ({
            版本: v,
            用户数: s.size,
            占比: `${(s.size / latestVersionByUuid.size * 100).toFixed(1)}%`,
        }));
    console.log('\n=== 当前用户版本分布（按每个 uuid 最后一次上报估算） ===');
    console.table(rows);
}

// ─── 输出 8：平台 / 语言 分布 ─────────────────────────────────────────────────
if (platformUuids.size > 0) {
    const rows = Array.from(platformUuids.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .map(([p, s]) => ({ 平台: p, 独立用户数: s.size }));
    console.log('\n=== 平台分布（按 startup 独立用户） ===');
    console.table(rows);
}
if (languageUuids.size > 0) {
    const rows = Array.from(languageUuids.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .map(([l, s]) => ({ 语言: l, 独立用户数: s.size }));
    console.log('\n=== 语言分布（按 startup 独立用户） ===');
    console.table(rows);
}
