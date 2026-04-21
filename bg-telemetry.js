// bg-telemetry.js — 安装/更新/日活上报（由 background.js importScripts 加载）
const TELEMETRY_ENDPOINT = 'https://api.pmtools.com.cn/yessir/telemetry';
const TELEMETRY_STARTUP_DATE_KEY = 'ysLastTelemetryStartupDate';

function getLocalDateKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function sendTelemetry(eventType) {
    try {
        const uuid = await getDeviceUUID();
        const manifest = chrome.runtime.getManifest();
        await fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uuid,
                event: String(eventType || ''),
                version: manifest && manifest.version ? manifest.version : '',
            }),
        });
    } catch (error) {
        // 遥测上报失败不影响主功能
        console.log('[telemetry] send failed:', error && error.message ? error.message : error);
    }
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        void sendTelemetry('install');
    } else if (details.reason === 'update') {
        void sendTelemetry('update');
    }
});

void (async () => {
    try {
        const today = getLocalDateKey();
        const stored = await chrome.storage.local.get(TELEMETRY_STARTUP_DATE_KEY);
        if (stored[TELEMETRY_STARTUP_DATE_KEY] !== today) {
            await sendTelemetry('startup');
            await chrome.storage.local.set({ [TELEMETRY_STARTUP_DATE_KEY]: today });
        }
    } catch (error) {
        console.log('[telemetry] startup check failed:', error && error.message ? error.message : error);
    }
})();

