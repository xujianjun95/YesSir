#!/usr/bin/env node
/**
 * 读取 telemetry.log，输出四类统计：
 *   1. 每日基础指标（install / update / DAU）
 *   2. 累计用户数（去重历史 install 的 uuid 数）
 *   3. 功能首次激活率（first_use 类事件的累计独立用户数 / 累计用户数）
 *   4. 每日功能点击量（feature_daily 类事件，按日期 × feature 汇总）
 *
 * 用法：
 *   node analyze-telemetry.js
 *   node analyze-telemetry.js ./telemetry.log
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

const content = fs.readFileSync(logFile, 'utf-8');
const lines = content.split(/\r?\n/).filter(Boolean);

// ─── 累加结构 ────────────────────────────────────────────────────────────────
const daily = new Map();                    // date -> { install, update, startup, startupUsers, allUsers }
const allInstallUuids = new Set();          // 全期：累计安装过的 uuid（≈ 累计用户）
const firstUseUuids = new Map();            // feature -> Set<uuid>，全期独立首次使用过该功能的用户
const featureDaily = new Map();             // date -> Map<feature, sumClicks>，feature_daily 上报的按日点击数

let invalidLines = 0;

function ensureDay(dateKey) {
    if (!daily.has(dateKey)) {
        daily.set(dateKey, {
            install: 0,
            update: 0,
            startup: 0,
            startupUsers: new Set(),
            allUsers: new Set(),
        });
    }
    return daily.get(dateKey);
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

    if (event === 'install') {
        day.install += 1;
        if (uuid) allInstallUuids.add(uuid);
    } else if (event === 'update') {
        day.update += 1;
    } else if (event === 'startup') {
        day.startup += 1;
        if (uuid) day.startupUsers.add(uuid);
    } else if (event === 'first_use') {
        // 客户端在首次成功使用某功能时发；按 feature 累积独立用户
        const feature = String(row.feature || '').trim() || 'unknown';
        if (!firstUseUuids.has(feature)) firstUseUuids.set(feature, new Set());
        if (uuid) firstUseUuids.get(feature).add(uuid);
    } else if (event === 'feature_daily') {
        // 客户端次日 flush 的按日累计点击数：feature + count + date(=点击发生那一天)
        const feature = String(row.feature || '').trim();
        const count = Number(row.count) || 0;
        // row.date 是客户端记录的"点击发生日"；优先用它而不是上报时间
        const clickDate = String(row.date || '').trim() || dateKey;
        if (!feature || count <= 0) continue;
        const bucket = ensureFeatureDay(clickDate);
        bucket.set(feature, (bucket.get(feature) || 0) + count);
    }
}

// ─── 输出 1：每日基础指标 ─────────────────────────────────────────────────────
const baseRows = Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
        date,
        install: v.install,
        update: v.update,
        startup_events: v.startup,
        dau_startup_uuids: v.startupUsers.size,
        active_uuids_all_events: v.allUsers.size,
    }));

console.log(`Telemetry 日志: ${logFile}`);
console.log(`总行数: ${lines.length} | 异常行: ${invalidLines}`);

if (baseRows.length === 0) {
    console.log('暂无可统计数据。');
    process.exit(0);
}

console.log('\n=== 每日基础指标 ===');
console.table(baseRows);

// ─── 输出 2：累计用户数 ───────────────────────────────────────────────────────
console.log('\n=== 累计指标 ===');
console.table([{
    total_install_uuids: allInstallUuids.size,
    note: '历史 install 事件去重后的 uuid 数；近似等于累计装机用户',
}]);

// ─── 输出 3：核心功能首次激活率 ───────────────────────────────────────────────
// 激活率定义：用过该手势的独立用户 / 累计安装用户。反映新用户找到并用上核心功能的比例。
if (firstUseUuids.size > 0) {
    const totalUsers = allInstallUuids.size || 1; // 防止除零
    const activationRows = Array.from(firstUseUuids.entries()).map(([feature, set]) => ({
        feature,
        activated_users: set.size,
        activation_rate: `${(set.size / totalUsers * 100).toFixed(1)}%`,
    }));
    console.log('\n=== 核心功能激活率（first_use 独立用户 / 累计装机用户） ===');
    console.table(activationRows);
}

// ─── 输出 4：每日功能点击量 ───────────────────────────────────────────────────
// feature_daily 是客户端"次日上报昨天"的累计；这里按日期 × feature 透视
if (featureDaily.size > 0) {
    const allFeatures = new Set();
    featureDaily.forEach((bucket) => bucket.forEach((_, f) => allFeatures.add(f)));
    const featureCols = Array.from(allFeatures).sort();

    const clickRows = Array.from(featureDaily.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, bucket]) => {
            const row = { date };
            featureCols.forEach((f) => {
                row[f] = bucket.get(f) || 0;
            });
            return row;
        });
    console.log('\n=== 每日功能点击量 ===');
    console.table(clickRows);
}
