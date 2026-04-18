/**
 * YesSir AI 中转服务
 *
 * 功能：
 *  - 代替用户持有 DeepSeek API Key，新用户无需自己申请即可体验 AI 功能
 *  - 按设备 UUID + IP 双重限流，防止单人刷光额度
 *  - 透明转发请求到 DeepSeek，不修改任何 prompt / 响应内容
 *
 * 环境变量（在服务器上配置，不要写进代码）：
 *  DEEPSEEK_API_KEY=sk-xxxx          你的 DeepSeek API Key
 *  PORT=3001                          监听端口（Nginx 反代过来）
 *  DAILY_LIMIT_PER_UUID=10           每个设备每天最多调用次数（默认 10）
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PORT = parseInt(process.env.PORT || '3001', 10);
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT_PER_UUID || '10', 10);

if (!DEEPSEEK_API_KEY) {
    console.error('[YesSir Proxy] 错误：未配置 DEEPSEEK_API_KEY 环境变量，服务无法启动');
    process.exit(1);
}

// ── 限流存储（内存）──
// 结构：Map<uuid, { date: 'YYYY-MM-DD', count: number }>
// 服务器重启后计数清零——对小规模用量够用，不需要 Redis
const usageMap = new Map();

function getTodayStr() {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'，UTC 日期
}

/**
 * 检查并递增限流计数
 * @returns {{ allowed: boolean, remaining: number }}
 */
function checkRateLimit(uuid) {
    const today = getTodayStr();
    let entry = usageMap.get(uuid);

    if (!entry || entry.date !== today) {
        entry = { date: today, count: 0 };
        usageMap.set(uuid, entry);
    }

    if (entry.count >= DAILY_LIMIT) {
        return { allowed: false, remaining: 0 };
    }

    entry.count += 1;
    return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}

// ── 辅助：读取请求 body ──
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

// ── 辅助：向 DeepSeek 发请求 ──
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

// ── 主服务器 ──
const server = http.createServer(async (req, res) => {
    // CORS（Chrome 扩展的 fetch 需要）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-UUID');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

    // 健康检查
    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
        return;
    }

    // 只接受 POST /yessir/ai
    if (req.method !== 'POST' || parsedUrl.pathname !== '/yessir/ai') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
    }

    // 读取设备 UUID
    const uuid = (req.headers['x-device-uuid'] || '').trim().slice(0, 64);
    if (!uuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_uuid', message: '缺少 X-Device-UUID 请求头' }));
        return;
    }

    // 限流检查
    const { allowed, remaining } = checkRateLimit(uuid);
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (!allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'rate_limit_exceeded',
            message: `很抱歉，今日 AI 相关功能的额度已用完（${DAILY_LIMIT} 次/天），您可在设置>API key 设置中填入自己的 API Key 继续使用 AI 相关功能。`,
            remaining: 0,
        }));
        return;
    }

    // 读取并转发请求体
    let body;
    try {
        body = await readBody(req);
        // 基础校验：确保是合法的 JSON
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
    console.log(`[YesSir Proxy] 每设备每日限额：${DAILY_LIMIT} 次`);
});
