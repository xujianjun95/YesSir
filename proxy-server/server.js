/**
 * YesSir AI 中转服务
 *
 * 功能：
 *  - 代替用户持有 DeepSeek API Key，新用户无需自己申请即可体验 AI 功能
 *  - 按设备 UUID + 功能分桶限流（聚合 / 搜索）；页面标签与分类、站点名等不占每日额度
 *  - 限流维度同时认请求头 X-YesSir-Feature 与 JSON body._yessir_quota（防止网关丢弃自定义头导致误计为 general）
 *  - 透明转发请求到 DeepSeek，不修改任何 prompt / 响应内容
 *  - 429 / 部分 400 文案随 Accept-Language（首语言为 en 时用英文，否则中文）
 *
 * 环境变量（在服务器上配置，不要写进代码）：
 *  DEEPSEEK_API_KEY=sk-xxxx          你的 DeepSeek API Key
 *  PORT=3001                          监听端口（Nginx 反代过来）
 *  DAILY_LIMIT_AGGREGATE=10           AI 聚合：每设备每天最多次数（默认 10）
 *  DAILY_LIMIT_SEARCH=10             AI 搜索：每设备每天最多次数（默认 10）
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PORT = parseInt(process.env.PORT || '3001', 10);
const LIMIT_AGGREGATE = parseInt(process.env.DAILY_LIMIT_AGGREGATE || '10', 10);
const LIMIT_SEARCH = parseInt(process.env.DAILY_LIMIT_SEARCH || '10', 10);

// 卸载落地页：用户卸载扩展时 Chrome 会打开 /yessir/uninstall，回这个极简感谢页
const UNINSTALL_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YesSir</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
    background:#f5f5f3;color:#2d374e}
  .card{text-align:center;padding:48px 40px;max-width:380px}
  .logo{font-size:40px;margin-bottom:16px}
  h1{font-size:20px;font-weight:700;margin:0 0 10px}
  p{font-size:14px;line-height:1.8;color:#6a7286;margin:0}
  @media(prefers-color-scheme:dark){
    body{background:#1e1e1e;color:#e8e8e8}p{color:#9a9a9a}
  }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">&#128075;</div>
    <h1>YesSir &#24050;&#21368;&#36733;</h1>
    <p>&#24863;&#35874;&#20320;&#26366;&#32463;&#30340;&#20351;&#29992;&#12290;<br>&#26399;&#24453;&#19979;&#27425;&#20877;&#35265;&#12290;</p>
  </div>
</body>
</html>`;

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
 * @param {number} units - page_labels 时为本批标签页数量；当前仅计数，不限额
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
        entry.pageLabelTabs += u;
        return { allowed: true, remaining: -1 };
    }

    return { allowed: true, remaining: -1 };
}

/** @param {'en'|'zh'} lang */
function quotaExceededMessage(limit, lang = 'zh') {
    if (lang === 'en') {
        return `Sorry, your daily quota for AI features has been exhausted (${limit} times/day). It will reset tomorrow. You can unlock unlimited AI access by entering your own API Key in Settings > API Key.`;
    }
    return `很抱歉，您今日 AI 相关功能额度已用尽（${limit} 次/天），次日会自动恢复，您可在设置>API key 设置中填入自己的 API Key 来彻底解锁 AI 相关功能。`;
}

/** 取 Accept-Language 首选项：en* → en，否则 zh */
function getRequestLang(req) {
    const raw = String(req.headers['accept-language'] || 'zh-CN').toLowerCase();
    const first = raw.split(',')[0].trim().split(';')[0].trim();
    return first.startsWith('en') ? 'en' : 'zh';
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

function getClientIp(req) {
    const xff = String(req.headers['x-forwarded-for'] || '').trim();
    if (xff) {
        const first = xff.split(',')[0].trim();
        if (first) return first;
    }
    return (req.socket && req.socket.remoteAddress) || '';
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
        'Content-Type, Accept-Language, X-Device-UUID, X-YesSir-Feature, X-YesSir-Units',
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

    if (req.method === 'POST' && (parsedUrl.pathname === '/yessir/telemetry' || parsedUrl.pathname === '/api/telemetry')) {
        let bodyStr;
        let parsed;
        try {
            bodyStr = await readBody(req);
            parsed = JSON.parse(bodyStr);
        } catch (_) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_body' }));
            return;
        }

        const uuid = String((parsed && parsed.uuid) || '').trim().slice(0, 64);
        const event = String((parsed && parsed.event) || '').trim().slice(0, 32);
        const version = String((parsed && parsed.version) || '').trim().slice(0, 32);
        if (!uuid || !event) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'missing_parameters' }));
            return;
        }

        // 透传 first_use / feature_daily 等事件的扩展字段，确保 analyze 脚本能区分 feature
        const feature = String((parsed && parsed.feature) || '').trim().slice(0, 64);
        const countRaw = Number(parsed && parsed.count);
        const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 0;
        const dateRaw = String((parsed && parsed.date) || '').trim();
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : '';
        // 透传 startup 事件的环境字段，用于分群与流失归因
        const platform = String((parsed && parsed.platform) || '').trim().slice(0, 16);
        const language = String((parsed && parsed.language) || '').trim().slice(0, 8);

        const logEntry = JSON.stringify({
            timestamp: new Date().toISOString(),
            uuid,
            event,
            version,
            ...(feature ? { feature } : {}),
            ...(count > 0 ? { count } : {}),
            ...(date ? { date } : {}),
            ...(platform ? { platform } : {}),
            ...(language ? { language } : {}),
            ip: getClientIp(req),
        }) + '\n';
        const logFile = path.join(__dirname, 'telemetry.log');
        fs.appendFile(logFile, logEntry, (err) => {
            if (err) console.error('[YesSir Proxy] 写入 telemetry 日志失败:', err.message);
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // ─── 卸载埋点：用户卸载扩展时 Chrome 打开此 URL（chrome.runtime.setUninstallURL）───
    // 记一条 uninstall 日志（写入同一个 telemetry.log），并回一个极简感谢页。
    if (req.method === 'GET' && parsedUrl.pathname === '/yessir/uninstall') {
        const uuid = String(parsedUrl.searchParams.get('uuid') || '').trim().slice(0, 64);
        const version = String(parsedUrl.searchParams.get('v') || '').trim().slice(0, 32);
        if (uuid) {
            const logEntry = JSON.stringify({
                timestamp: new Date().toISOString(),
                uuid,
                event: 'uninstall',
                version,
                ip: getClientIp(req),
            }) + '\n';
            fs.appendFile(path.join(__dirname, 'telemetry.log'), logEntry, (err) => {
                if (err) console.error('[YesSir Proxy] 写入 uninstall 日志失败:', err.message);
            });
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(UNINSTALL_PAGE_HTML);
        return;
    }

    if (req.method !== 'POST' || parsedUrl.pathname !== '/yessir/ai') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
    }

    const lang = getRequestLang(req);

    const uuid = (req.headers['x-device-uuid'] || '').trim().slice(0, 64);
    if (!uuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'missing_uuid',
            message: lang === 'en'
                ? 'Missing X-Device-UUID request header'
                : '缺少 X-Device-UUID 请求头',
        }));
        return;
    }

    let bodyStr;
    let parsed;
    try {
        bodyStr = await readBody(req);
        parsed = JSON.parse(bodyStr);
    } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_body' }));
        return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_body' }));
        return;
    }

    const q = parsed._yessir_quota && typeof parsed._yessir_quota === 'object'
        ? parsed._yessir_quota
        : null;
    if (parsed && typeof parsed === 'object' && '_yessir_quota' in parsed) {
        delete parsed._yessir_quota;
    }

    const headerFeature = String(req.headers['x-yessir-feature'] || '').trim().slice(0, 32);
    const bodyFeature = q && q.feature != null ? String(q.feature).trim().slice(0, 32) : '';
    if (headerFeature && bodyFeature && headerFeature.toLowerCase() !== bodyFeature.toLowerCase()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'feature_mismatch',
            message: lang === 'en'
                ? 'Mismatch between X-YesSir-Feature header and body._yessir_quota'
                : 'X-YesSir-Feature 与 body._yessir_quota 不一致',
        }));
        return;
    }
    const feature = (bodyFeature || headerFeature || 'general').trim().slice(0, 32) || 'general';

    const headerUnits = parseInt(req.headers['x-yessir-units'] || '1', 10) || 1;
    const bodyUnits = q && q.units != null ? Math.max(1, parseInt(q.units, 10) || 1) : null;
    const units = bodyUnits != null ? bodyUnits : headerUnits;

    const { allowed, remaining, limit, silent } = checkQuota(uuid, feature, units);
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (!allowed) {
        const lim = limit != null ? limit : LIMIT_AGGREGATE;
        const msg = silent ? '' : quotaExceededMessage(lim, lang);
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

    bodyStr = JSON.stringify(parsed);

    try {
        const { statusCode, body: dsBody } = await forwardToDeepSeek(bodyStr);
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
        `[YesSir Proxy] 限额：聚合 ${LIMIT_AGGREGATE}/天 · 搜索 ${LIMIT_SEARCH}/天 · 页面标签不设上限 · general 不占额`,
    );
});

// 清理非当日 UUID 记录，避免 usageMap 随用户量无限增长
setInterval(() => {
    const today = getTodayStr();
    for (const [uuid, entry] of usageMap.entries()) {
        if (entry.date !== today) usageMap.delete(uuid);
    }
}, 12 * 60 * 60 * 1000);
