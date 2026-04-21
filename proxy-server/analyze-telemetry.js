#!/usr/bin/env node
/**
 * 读取 telemetry.log，输出每日安装数与 DAU（startup 去重 uuid）。
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
const daily = new Map(); // date -> { install, update, startup, startupUsers:Set, allUsers:Set }
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
    const dateKey = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        invalidLines += 1;
        continue;
    }

    const day = ensureDay(dateKey);
    if (uuid) day.allUsers.add(uuid);
    if (event === 'install') day.install += 1;
    else if (event === 'update') day.update += 1;
    else if (event === 'startup') {
        day.startup += 1;
        if (uuid) day.startupUsers.add(uuid);
    }
}

const rows = Array.from(daily.entries())
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
console.log(`总行数: ${lines.length} | 可解析: ${rows.length ? lines.length - invalidLines : 0} | 异常行: ${invalidLines}`);
if (rows.length === 0) {
    console.log('暂无可统计数据。');
    process.exit(0);
}

console.table(rows);

