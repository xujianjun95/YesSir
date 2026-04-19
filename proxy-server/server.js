/**
 * YesSir AI 中转服务
 *
 * 功能：
 *  - 代替用户持有 DeepSeek API Key，新用户无需自己申请即可体验 AI 功能
 *  - 按设备 UUID + 功能分桶限流（聚合 / 搜索 / 页面标签）；分类、站点名等走 general 不占三档额度
 *  - 透明转发请求到 DeepSeek，不修改任何 prompt / 响应内容
 *
 * 环境变量（在服务器上配置，不要写进代码）：
 *  DEEPSEEK_API_KEY=sk-xxxx          你的 DeepSeek API Key
 *  PORT=3001                          监听端口（Nginx 反代过来）
 *  DAILY_LIMIT_AGGREGATE=10           AI 聚合：每设备每天最多次数（默认 10）
 *  DAILY_LIMIT_SEARCH=10             AI 搜索：每设备每天最多次数（默认 10）
 *  DAILY_LIMIT_PAGE_LABEL_TABS=100    页面标签：每设备每天最多计数的标签页数（默认 100）
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PORT = parseInt(process.env.PORT || '3001', 10);
const LIMIT_AGGREGATE = parseInt(process.env.DAILY_LIMIT_AGGREGATE || '10', 10);
const LIMIT_SEARCH = parseInt(process.env.DAILY_LIMIT_SEARCH || '10', 10);
const LIMIT_PAGE_LABEL_TABS = parseInt(process.env.DAILY_LIMIT_PAGE_LABEL_TABS || '100', 10);

if (!DEEPSEEK_API_KEY) {
    console.error('[YesSir Proxy] 错误：未配置 DEEPSEEK_API_KEY 环境变量，服务无法启动');
    process.exit(1);
}

// Map<uuid, { date, aggregate, search, pageLabelTabs }>
const usageMap = new Map();

function getTodayStr() {
    return new Date().toISOString().slice(0, 10);
}

function getOrCreateEntry(uuid) {
    const today = getTodayStr();
    let entry = usageMap.get(uuid);
    if (!entry || entry.date !== today) {
        entry = { date: today, aggregate: 0, search: 0, pageLabelTabs: 0 };
        usageMap.set(uuid, entry);
    }
    return entry;
}

/**
 * @param {string} feature - aggregate | search | page_labels | general
 * @param {number} units - page_labels 时为本批标签页数量
 */
function checkQuota(uuid, feature, units) {
    const f = String(feature || 'general').toLowerCase().trim();
    if (f === 'general' || f === '') {
        return { allowed: true, remaining: -1 };
    }

    const entry = getOrCreateEntry(uuid);

    if (f === 'aggregate') {
        if (entry.aggregate >= LIMIT_AGGREGATE) {
            return { allowed: false, remaining: 0, limit: LIMIT_AGGREGATE };
        }
        entry.aggregate += 1;
        return { allowed: true, remaining: LIMIT_AGGREGATE - entry.aggregate };
    }

    if (f === 'search') {
        if (entry.search >= LIMIT_SEARCH) {
            return { allowed: false, remaining: 0, limit: LIMIT_SEARCH };
        }
        entry.search += 1;
        return { allowed: true, remaining: LIMIT_SEARCH - entry.search };
    }

    if (f === 'page_labels') {
        const u = Math.min(500, Math.max(1, parseInt(units, 10) || 1));
        if (entry.pageLabelTabs + u > LIMIT_PAGE_LABEL_TABS) {
            return {
                allowed: false,
                remaining: Math.max(0, LIMIT_PAGE_LABEL_TABS - entry.pageLabelTabs),
                limit: LIMIT_PAGE_LABEL_TABS,
                silent: true,
            };
        }
        entry.pageLabelTabs += u;
        return { allowed: true, remaining: LIMIT_PAGE_LABEL_TABS - entry.pageLabelTabs };
    }

    return { allowed: true, remaining: -1 };
}

function quotaExceededMessage(limit) {
    return `很抱歉，您今日 AI 相关功能额度已用尽（${limit} 次/天），次日会自动恢复，您可在设置>API key 设置中填入自己的 API Key 来彻底解锁 AI 相关功能。`;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

function forwardToDeepSeek(bodyStr) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.deepseek.com',
            path: '/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        };

        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });

        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Device-UUID, X-YesSir-Feature, X-YesSir-Units',
    );

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
        return;
    }

    if (req.method !== 'POST' || parsedUrl.pathname !== '/yessir/ai') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
    }

    const uuid = (req.headers['x-device-uuid'] || '').trim().slice(0, 64);
    if (!uuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_uuid', message: '缺少 X-Device-UUID 请求头' }));
        return;
    }

    const feature = (req.headers['x-yesir-feature'] || 'general').trim().slice(0, 32);
    const units = parseInt(req.headers['x-yesir-units'] || '1', 10) || 1;

    const { allowed, remaining, limit, silent } = checkQuota(uuid, feature, units);
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (!allowed) {
        const lim = limit != null ? limit : LIMIT_AGGREGATE;
        const msg = silent ? '' : quotaExceededMessage(lim);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'rate_limit_exceeded',
            feature,
            message: msg,
            silent: !!silent,
            remaining: 0,
            limit: lim,
        }));
        return;
    }

    let body;
    try {
        body = await readBody(req);
        JSON.parse(body);
    } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_body' }));
        return;
    }

    try {
        const { statusCode, body: dsBody } = await forwardToDeepSeek(body);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(dsBody);
    } catch (err) {
        console.error('[YesSir Proxy] 转发失败:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream_error', message: err.message }));
    }
});

server.listen(PORT, () => {
    console.log(`[YesSir Proxy] 服务已启动，监听端口 ${PORT}`);
    console.log(
        `[YesSir Proxy] 限额：聚合 ${LIMIT_AGGREGATE}/天 · 搜索 ${LIMIT_SEARCH}/天 · 页面标签 ${LIMIT_PAGE_LABEL_TABS} tab/天 · general 不占额`,
    );
});
