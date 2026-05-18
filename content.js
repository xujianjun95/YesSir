// ─── Config & State ───────────────────────────────────────────────────────────

const isMac = (navigator.userAgentData && navigator.userAgentData.platform === 'macOS')
    || /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);

const MOD_EVENT_KEY = { meta: 'Meta', alt: 'Alt', ctrl: 'Control', shift: 'Shift' };
/** Mac：带符号；Windows/Linux：仅文字（无 ⌘⌥ 等） */
const MOD_LABELS = isMac
    ? {
        meta: '⌘ Command',
        alt: '⌥ Option',
        ctrl: '⌃ Control',
        shift: '⇧ Shift',
    }
    : {
        ctrl: 'Ctrl',
        alt: 'Alt',
        shift: 'Shift',
    };

function modifierKeysForPlatform() {
    return isMac ? ['meta', 'alt', 'ctrl', 'shift'] : ['ctrl', 'alt', 'shift'];
}

function defaultModifierKeyForPlatform() {
    return isMac ? 'meta' : 'ctrl';
}

function normalizeStoredModifierKey(stored) {
    const allowed = new Set(modifierKeysForPlatform());
    if (stored && allowed.has(stored)) return stored;
    return defaultModifierKeyForPlatform();
}

/** 与标签面板共用：浮动统计等未打开面板时也能使用 --ys-text-* / --ys-accent */
function ensureYsThemeStylesInjected() {
    if (document.getElementById('ys-theme-vars')) return;
    const style = document.createElement('style');
    style.id = 'ys-theme-vars';
    const darkVars = `
          --ys-overlay-bg: rgba(0, 0, 0, 0.4);
          --ys-card-bg: rgba(30, 30, 30, 0.65);
          --ys-card-border: rgba(255, 255, 255, 0.12);
          --ys-card-shadow: 0 24px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
          --ys-divider: rgba(255, 255, 255, 0.08);
          --ys-text-title: rgba(255, 255, 255, 0.9);
          --ys-text-primary: rgba(255, 255, 255, 0.85);
          --ys-text-secondary: rgba(255, 255, 255, 0.55);
          --ys-text-muted: rgba(255, 255, 255, 0.4);
          --ys-search-bg: rgba(0, 0, 0, 0.2);
          --ys-search-border: rgba(255, 255, 255, 0.15);
          --ys-search-icon: rgba(255, 255, 255, 0.4);
          --ys-search-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
          --ys-search-focus-bg: rgba(0, 0, 0, 0.4);
          --ys-search-focus-border: #FBBF24;
          --ys-search-focus-shadow: 0 0 0 3px rgba(251, 191, 36, 0.24), inset 0 1px 2px rgba(0,0,0,0.2);
          --ys-accent: #FBBF24;
          --ys-accent-text: #FFFFFF;
          --ys-accent-bg: rgba(251, 191, 36, 0.16);
          --ys-accent-hover: rgba(251, 191, 36, 0.15);
          --ys-accent-glow: rgba(251, 191, 36, 0.35);
          --ys-btn-bg: rgba(255, 255, 255, 0.06);
          --ys-btn-hover: rgba(255, 255, 255, 0.08);
          --ys-btn-border: rgba(255, 255, 255, 0.08);
          --ys-btn-text: rgba(255, 255, 255, 0.75);
          --ys-footer-bg: rgba(255, 255, 255, 0.03);
          --ys-settings-bg: rgba(40, 40, 40, 0.85);
          --ys-settings-border: rgba(255, 255, 255, 0.12);
          --ys-settings-shadow: 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
          --ys-settings-item-hover: rgba(255, 255, 255, 0.08);
          --ys-ai-bg: rgba(94, 156, 255, 0.16);
          --ys-ai-hover: rgba(94, 156, 255, 0.24);
          --ys-ai-border: rgba(94, 156, 255, 0.36);
          --ys-ai-text: rgba(142, 196, 255, 0.96);
          --ys-ai-hover-deep-bg: rgba(94, 156, 255, 0.3);
          --ys-ai-hover-deep-border: rgba(94, 156, 255, 0.46);
        `;
    style.textContent = `
        :root {
          --ys-overlay-bg: rgba(160, 175, 200, 0.16);
          --ys-card-bg: rgba(248, 248, 246, 0.38);
          --ys-card-border: rgba(255, 255, 255, 0.52);
          --ys-card-shadow: 0 24px 64px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.6);
          --ys-divider: rgba(0, 0, 0, 0.05);
          --ys-text-title: rgba(40, 50, 70, 0.95);
          --ys-text-primary: rgba(40, 50, 70, 0.9);
          --ys-text-secondary: rgba(80, 92, 120, 0.72);
          --ys-text-muted: rgba(100, 110, 130, 0.6);
          --ys-search-bg: rgba(255, 255, 255, 0.25);
          --ys-search-border: rgba(255, 255, 255, 0.65);
          --ys-search-icon: rgba(120, 130, 150, 0.6);
          --ys-search-shadow: inset 0 1px 2px rgba(0,0,0,0.02), 0 1px 3px rgba(0,0,0,0.02);
          --ys-search-focus-bg: rgba(255, 255, 255, 0.45);
          --ys-search-focus-border: rgba(80, 110, 220, 0.4);
          --ys-search-focus-shadow: 0 0 0 3px rgba(80, 110, 220, 0.12), inset 0 1px 2px rgba(0,0,0,0.01);
          --ys-accent: rgba(80, 110, 220, 0.9);
          --ys-accent-text: rgba(50, 70, 160, 0.95);
          --ys-accent-bg: rgba(80, 110, 220, 0.16);
          --ys-accent-hover: rgba(80, 110, 220, 0.15);
          --ys-accent-glow: rgba(80, 110, 220, 0.16);
          --ys-footer-bg: rgba(0, 0, 0, 0.02);
          --ys-btn-bg: rgba(0, 0, 0, 0.04);
          --ys-btn-hover: rgba(0, 0, 0, 0.08);
          --ys-btn-border: rgba(0, 0, 0, 0.06);
          --ys-btn-text: rgba(80, 90, 110, 0.9);
          --ys-settings-bg: rgba(255, 255, 255, 0.85);
          --ys-settings-border: rgba(255, 255, 255, 0.8);
          --ys-settings-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5);
          --ys-settings-item-hover: rgba(80, 110, 220, 0.08);
          --ys-ai-bg: rgba(0, 180, 200, 0.12);
          --ys-ai-hover: rgba(0, 180, 200, 0.18);
          --ys-ai-border: rgba(0, 180, 200, 0.25);
          --ys-ai-text: rgba(10, 150, 170, 0.95);
          --ys-ai-hover-deep-bg: rgba(0, 180, 200, 0.24);
          --ys-ai-hover-deep-border: rgba(0, 180, 200, 0.35);
        }

        :root[data-ys-theme="dark"] {
          ${darkVars}
        }

        @media (prefers-color-scheme: dark) {
          :root:not([data-ys-theme="light"]) {
            ${darkVars}
          }
        }
        `;
    document.head.appendChild(style);
    ysEnsureSystemThemeMediaListener();
}

/**
 * Storage 中为 system 时在 DOM 上映射成 dark/light。
 * :root[data-ys-theme=dark] 不依赖宿主页的 @media，避免站点 color-scheme: light 导致系统深色下仍误判为浅色。
 */
function ysResolvedThemeFromStored(mode) {
    const m = mode || 'system';
    if (m === 'dark' || m === 'light') return m;
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
        return 'light';
    }
}

function ysApplyDataThemeAttr(storedThemeMode) {
    document.documentElement.setAttribute(
        'data-ys-theme',
        ysResolvedThemeFromStored(storedThemeMode != null ? storedThemeMode : 'system'),
    );
}

function ysEnsureSystemThemeMediaListener() {
    if (window.__ysSysThemeMqBound || !window.matchMedia) return;
    window.__ysSysThemeMqBound = true;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
        chrome.storage.local.get({ themeMode: 'system' }, (res) => {
            if ((res.themeMode || 'system') !== 'system') return;
            ysApplyDataThemeAttr('system');
        });
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
}

let modifierKey = defaultModifierKeyForPlatform();

function isModHeld(e) {
    return e[modifierKey + 'Key'];
}

// 启动时从 storage 读取用户配置的修饰键（跨平台迁移：Win 上不应保留 meta）
chrome.storage.local.get({ modifierKey: null }, (res) => {
    const next = normalizeStoredModifierKey(res.modifierKey);
    modifierKey = next;
    if (res.modifierKey !== next) {
        chrome.storage.local.set({ modifierKey: next });
    }
});


// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(count) {
    const existing = document.getElementById('my-geek-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'my-geek-toast';
    toast.innerText = typeof ysT === 'function' ? ysT('toastUsageRecorded', [String(count)]) : `🫡 YesSir，已记录本次使用，累计 ${count} 次`;

    Object.assign(toast.style, {
        position:           'fixed',
        bottom:             '24px',
        left:               '50%',
        transform:          'translateX(-50%)',
        padding:            '9px 18px',
        background:         'var(--ys-card-bg, rgba(250, 252, 255, 0.9))',
        backdropFilter:     'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:             '1px solid var(--ys-card-border, rgba(255, 255, 255, 0.52))',
        borderRadius:       '10px',
        color:              'var(--ys-text-primary, rgba(40, 50, 70, 0.95))',
        fontSize:           '13px',
        fontWeight:         '600',
        letterSpacing:      '0.01em',
        boxShadow:          'var(--ys-card-shadow, 0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8))',
        zIndex:             '2147483647',
        pointerEvents:      'none',
        opacity:            '0',
        transition:         'opacity 0.22s ease-in-out',
        fontFamily:         '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        whiteSpace:         'nowrap',
    });

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 220);
    }, 2000);
}

/** 自定义文案 Toast（与 showToast 视觉一致），供看板等复用 */
function showYsMessageToast(message, durationMs = 3200) {
    const existing = document.getElementById('ys-message-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ys-message-toast';
    toast.innerText = message;

    Object.assign(toast.style, {
        position:           'fixed',
        bottom:             '24px',
        left:               '50%',
        transform:          'translateX(-50%)',
        padding:            '9px 18px',
        maxWidth:           'min(92vw, 420px)',
        background:         'var(--ys-card-bg, rgba(250, 252, 255, 0.9))',
        backdropFilter:     'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:             '1px solid var(--ys-card-border, rgba(255, 255, 255, 0.52))',
        borderRadius:       '10px',
        color:              'var(--ys-text-primary, rgba(40, 50, 70, 0.95))',
        fontSize:           '13px',
        fontWeight:         '600',
        letterSpacing:      '0.01em',
        boxShadow:          'var(--ys-card-shadow, 0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8))',
        zIndex:             '2147483647',
        pointerEvents:      'none',
        opacity:            '0',
        transition:         'opacity 0.22s ease-in-out',
        fontFamily:         '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        whiteSpace:         'normal',
        lineHeight:         '1.45',
        textAlign:          'center',
        boxSizing:          'border-box',
    });

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 220);
    }, durationMs);
}

// ─── Extension runtime（MV3）──────────────────────────────────────────────────
// background 为 service worker，闲置/睡眠后会被终止；唤醒后首条 sendMessage 偶发失败，
// 且原逻辑未读 lastError 时会「完全无反应」。以下：重试 + 可见时 ping 预热 SW。

/**
 * @param {object} payload
 * @param {{ maxRetries?: number }|function} [opts]
 * @param {function(any, string|null): void} [cb]  (result, errorMessage)
 */
function ysRuntimeSendMessageRetry(payload, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    const max = opts && opts.maxRetries != null ? opts.maxRetries : 4;
    let attempt = 0;
    function run() {
        chrome.runtime.sendMessage(payload, (res) => {
            const err = chrome.runtime.lastError;
            if (err && attempt < max - 1) {
                attempt++;
                const delay = [50, 120, 280, 400][attempt - 1] || 500;
                setTimeout(run, delay);
                return;
            }
            if (err) {
                if (cb) cb(null, err.message || 'Extension not responding');
                return;
            }
            if (cb) cb(res, null);
        });
    }
    run();
}
window.__ysRuntimeSendMessageRetry = ysRuntimeSendMessageRetry;

(function setupExtensionWakePing() {
    let lastPing = 0;
    const ping = () => {
        const now = Date.now();
        if (now - lastPing < 1800) return;
        lastPing = now;
        chrome.runtime.sendMessage({ action: 'ping' }, () => {
            void chrome.runtime.lastError;
        });
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ping();
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) ping();
    });
})();


// ─── Settings Modals ──────────────────────────────────────────────────────────

// 统一的弹窗工厂函数，保持毛玻璃 UI 风格一致
function openYsModal(title, renderContent) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483648',
        display: 'block',
        background: 'var(--ys-overlay-bg, rgba(0, 0, 0, 0.15))', backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        opacity: '0', transition: 'opacity 0.2s ease'
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
        background: 'var(--ys-card-bg, rgba(252, 252, 254, 0.85))', backdropFilter: 'saturate(180%) blur(32px)',
        WebkitBackdropFilter: 'saturate(180%) blur(32px)',
        border: '1px solid var(--ys-card-border, rgba(255, 255, 255, 0.8))', borderRadius: '16px',
        boxShadow: 'var(--ys-card-shadow, 0 24px 48px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8))',
        position: 'absolute',
        width: '320px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px',
        transform: 'scale(0.95) translateY(10px)', transition: 'all 0.25s cubic-bezier(0.34,1.3,0.64,1)'
    });

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.innerHTML = `
        <span style="font-size:15px;font-weight:600;color:var(--ys-text-title, rgba(40,50,70,0.95));">${title}</span>
        <div class="ys-modal-close" style="cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--ys-btn-bg, rgba(0,0,0,0.04));color:var(--ys-text-secondary, rgba(100,110,130,0.8));font-size:16px;line-height:1;transition:background 0.15s;">×</div>`;

    modal.appendChild(header);

    const contentBody = document.createElement('div');
    renderContent(contentBody, close);
    modal.appendChild(contentBody);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const positionModal = () => {
        const margin = 16;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const modalRect = modal.getBoundingClientRect();
        const switcherCard = document.getElementById('ys-switcher-card');
        let centerX = vw / 2;
        let centerY = vh / 2;

        if (switcherCard && switcherCard.isConnected) {
            const cardRect = switcherCard.getBoundingClientRect();
            centerX = cardRect.left + (cardRect.width / 2);
            centerY = cardRect.top + (cardRect.height / 2);
        }

        const left = Math.max(margin, Math.min(vw - margin - modalRect.width, centerX - (modalRect.width / 2)));
        const top = Math.max(margin, Math.min(vh - margin - modalRect.height, centerY - (modalRect.height / 2)));
        modal.style.left = `${left}px`;
        modal.style.top = `${top}px`;
    };
    positionModal();
    window.addEventListener('resize', positionModal);

    const closeBtn = header.querySelector('.ys-modal-close');
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'var(--ys-btn-hover, rgba(0,0,0,0.08))');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'var(--ys-btn-bg, rgba(0,0,0,0.04))');
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1) translateY(0)';
    });

    function close() {
        window.removeEventListener('resize', positionModal);
        modal.style.transform = 'scale(0.95) translateY(10px)';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
    }
}

// 1. 修饰键设置弹窗
function showModifierSettingsModal() {
    openYsModal(ysT('modifierModalTitle'), (container) => {
        const render = () => {
            const keys = modifierKeysForPlatform();
            let html = `
                <div style="font-size:12px;color:var(--ys-text-secondary, rgba(100,110,130,0.85));margin-bottom:12px;line-height:1.5;">
                    ${ysT('modifierModalDesc')}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
            `;
            keys.forEach((k) => {
                const isSel = k === modifierKey;
                html += `
                    <div data-key="${k}" class="ys-key-opt-modal" style="
                        display:flex;align-items:center;gap:10px; padding:10px 14px; border-radius:10px; cursor:pointer;
                        background:${isSel ? 'var(--ys-accent-bg)' : 'var(--ys-btn-bg)'};
                        border:1px solid ${isSel ? 'var(--ys-accent-hover)' : 'transparent'};
                        transition:all 0.15s;
                    ">
                        <div style="width:16px;height:16px;border-radius:50%;border:1.5px solid ${isSel ? 'var(--ys-accent)' : 'var(--ys-text-muted)'}; background:${isSel ? 'var(--ys-accent)' : 'transparent'}; display:flex;align-items:center;justify-content:center;">
                            ${isSel ? '<div style="width:6px;height:6px;border-radius:50%;background:#fff;"></div>' : ''}
                        </div>
                        <span style="font-size:13px; color:${isSel ? 'var(--ys-accent-text)' : 'var(--ys-text-primary)'}; font-weight:${isSel ? '600' : '500'}">${MOD_LABELS[k]}</span>
                    </div>
                `;
            });
            html += `</div>`;
            container.innerHTML = html;

            container.querySelectorAll('.ys-key-opt-modal').forEach((el) => {
                el.addEventListener('mouseenter', () => {
                    if (el.dataset.key !== modifierKey) el.style.background = 'var(--ys-btn-hover)';
                });
                el.addEventListener('mouseleave', () => {
                    if (el.dataset.key !== modifierKey) el.style.background = 'var(--ys-btn-bg)';
                });
                el.addEventListener('click', () => {
                    modifierKey = el.dataset.key;
                    chrome.storage.local.set({ modifierKey });
                    render();
                });
            });
        };
        render();
    });
}

// 2. API Key 设置弹窗
function showApiKeyModal() {
    openYsModal(ysT('apiKeyModalTitle'), (container, close) => {
        container.innerHTML = `
            <div style="font-size:12px;color:var(--ys-text-secondary, rgba(100,110,130,0.85));line-height:1.5;margin-bottom:12px;">
                ${ysT('apiKeyModalBody')}
            </div>
            <div style="position:relative;margin-bottom:16px;">
                <input type="password" id="ys-apikey-input" placeholder="sk-..." autocomplete="off" style="
                    width:100%; padding:10px 44px 10px 14px; border-radius:8px;
                    border:1px solid var(--ys-search-border, rgba(0,0,0,0.15)); background:var(--ys-search-bg, rgba(255,255,255,0.6));
                    color:var(--ys-text-primary, rgba(40,50,70,0.9)); font-size:13px; outline:none; box-sizing:border-box;
                    box-shadow:inset 0 1px 2px rgba(0,0,0,0.02); transition:border-color 0.2s;
                ">
                <button id="ys-apikey-visibility-toggle" type="button" title="${ysT('apiKeyShowTitle')}" style="
                    position:absolute; right:8px; top:50%; transform:translateY(-50%);
                    width:28px; height:28px; border:none; border-radius:7px;
                    background:var(--ys-btn-bg, rgba(0,0,0,0.04)); cursor:pointer;
                    display:flex; align-items:center; justify-content:center;
                    font-size:14px; line-height:1; transition:background 0.15s;
                ">😎</button>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button id="ys-apikey-cancel" style="padding:7px 16px; border-radius:8px; border:1px solid var(--ys-btn-border, rgba(0,0,0,0.1)); background:var(--ys-btn-bg, rgba(255,255,255,0.5)); cursor:pointer; font-size:13px; color:var(--ys-text-primary, rgba(60,70,80,0.9)); font-weight:500; transition:background 0.15s;">${ysT('btnCancel')}</button>
                <button id="ys-apikey-save" style="padding:7px 16px; border-radius:8px; border:1px solid var(--ys-accent-hover); background:var(--ys-accent); color:#ffffff; cursor:pointer; font-size:13px; font-weight:600; transition:background 0.15s, box-shadow 0.15s; box-shadow:0 2px 6px var(--ys-accent-bg);">${ysT('btnSave')}</button>
            </div>
        `;

        const input = container.querySelector('#ys-apikey-input');
        const visibilityBtn = container.querySelector('#ys-apikey-visibility-toggle');

        input.addEventListener('focus', () => {
            input.style.borderColor = 'var(--ys-search-focus-border, rgba(80,110,220,0.5))';
            input.style.boxShadow = 'var(--ys-search-focus-shadow, inset 0 1px 2px rgba(0,0,0,0.02))';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = 'var(--ys-search-border, rgba(0,0,0,0.15))';
            input.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)';
        });

        visibilityBtn.addEventListener('mouseenter', () => visibilityBtn.style.background = 'var(--ys-btn-hover, rgba(0,0,0,0.08))');
        visibilityBtn.addEventListener('mouseleave', () => visibilityBtn.style.background = 'var(--ys-btn-bg, rgba(0,0,0,0.04))');
        visibilityBtn.addEventListener('click', () => {
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            visibilityBtn.textContent = showing ? '😎' : '🙂';
            visibilityBtn.title = showing ? ysT('apiKeyShowTitle') : ysT('apiKeyHideTitle');
        });

        chrome.storage.local.get(['deepseekApiKey'], (res) => {
            if (res.deepseekApiKey) input.value = res.deepseekApiKey;
        });

        const cancelBtn = container.querySelector('#ys-apikey-cancel');
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = 'var(--ys-btn-hover, rgba(0,0,0,0.05))');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'var(--ys-btn-bg, rgba(255,255,255,0.5))');
        cancelBtn.addEventListener('click', close);

        const saveBtn = container.querySelector('#ys-apikey-save');
        saveBtn.addEventListener('mouseenter', () => {
            saveBtn.style.background = 'var(--ys-accent)';
            saveBtn.style.color = '#ffffff';
            saveBtn.style.boxShadow = '0 4px 12px var(--ys-accent-bg)';
        });
        saveBtn.addEventListener('mouseleave', () => {
            saveBtn.style.background = 'var(--ys-accent)';
            saveBtn.style.color = '#ffffff';
            saveBtn.style.boxShadow = '0 2px 6px var(--ys-accent-bg)';
        });
        saveBtn.addEventListener('click', () => {
            const val = input.value.trim();
            chrome.storage.local.set({ deepseekApiKey: val }, () => {
                close();
            });
        });
    });
}

// ─── Floating Widget ──────────────────────────────────────────────────────────

let _ysFloatWidgetStorageHooked = false;

function initFloatingWidget() {
    ensureYsThemeStylesInjected();
    chrome.storage.local.get({ themeMode: 'system' }, (res) => {
        ysApplyDataThemeAttr(res.themeMode);
    });
    if (!_ysFloatWidgetStorageHooked) {
        _ysFloatWidgetStorageHooked = true;
        chrome.storage.onChanged.addListener((changes) => {
            if (changes.showFloatingWidget) {
                const show = changes.showFloatingWidget.newValue !== false;
                const btn = document.getElementById('geek-float-btn');
                const panel = document.getElementById('geek-float-panel');
                if (btn) btn.style.display = show ? 'flex' : 'none';
                if (!show && panel) panel.style.display = 'none';
            }
            if (changes.themeMode) {
                ysApplyDataThemeAttr(changes.themeMode.newValue);
            }
        });
    }

    if (document.getElementById('geek-float-btn')) return;

    let snapEdge  = 'right';
    let posY      = Math.min(window.innerHeight * 0.45, window.innerHeight - 60);
    let panelOpen = false;
    let panelView = 'chart'; 

    const glass = (extra = {}) => Object.assign({
        background:     'var(--ys-card-bg, rgba(245, 245, 248, 0.18))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:         '1px solid var(--ys-card-border, rgba(255, 255, 255, 0.38))',
        boxShadow:      'var(--ys-card-shadow, 0 6px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5))',
    }, extra);

    const btn = document.createElement('div');
    btn.id = 'geek-float-btn';
    const floatChromeBorder = '1px solid var(--ys-accent-hover, rgba(110, 150, 235, 0.48))';
    Object.assign(btn.style, glass({
        position:       'fixed',
        width:          '38px',
        height:         '38px',
        borderRadius:   '11px',
        zIndex:         '2147483645',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        cursor:         'grab',
        userSelect:     'none',
        transition:     'box-shadow 0.2s, opacity 0.2s',
        opacity:        '0.72',
        border:         floatChromeBorder,
    }));

    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="1,14 5,8 9,11 13,4 17,7"
          stroke="var(--ys-accent, rgba(80,110,200,0.85))" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <circle cx="5" cy="8" r="1.5" fill="var(--ys-accent, rgba(80,110,200,0.7))"/>
        <circle cx="9" cy="11" r="1.5" fill="var(--ys-accent, rgba(80,110,200,0.7))"/>
        <circle cx="13" cy="4" r="1.5" fill="var(--ys-accent, rgba(80,110,200,0.7))"/>
      </svg>`;

    btn.addEventListener('mouseenter', () => {
        if (!isDragging) { btn.style.opacity = '1'; btn.style.boxShadow = '0 8px 28px var(--ys-accent-bg, rgba(80,110,200,0.22)), inset 0 1px 0 rgba(255,255,255,0.5)'; }
    });
    btn.addEventListener('mouseleave', () => {
        if (!isDragging) { btn.style.opacity = '0.72'; btn.style.boxShadow = glass().boxShadow; }
    });

    const panel = document.createElement('div');
    panel.id = 'geek-float-panel';
    Object.assign(panel.style, glass({
        position:       'fixed',
        width:          '210px',
        borderRadius:   '14px',
        zIndex:         '2147483644',
        padding:        '14px 14px 10px',
        display:        'none',
        flexDirection:  'column',
        gap:            '6px',
        opacity:        '0',
        transform:      'scale(0.94)',
        transition:     'opacity 0.18s ease, transform 0.18s cubic-bezier(0.34,1.4,0.64,1)',
        fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        pointerEvents:  'auto',
        /* 比毛玻璃 card 更不透明，避免浅色主题叠在深色网页上时正文与背景糊成一团 */
        background:     'var(--ys-settings-bg, var(--ys-card-bg))',
        boxShadow:      'var(--ys-settings-shadow, var(--ys-card-shadow))',
        border:         '1px solid var(--ys-accent-hover, rgba(110, 150, 235, 0.4))',
    }));

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    function applyPosition(animate) {
        btn.style.transition = animate
            ? 'right 0.25s cubic-bezier(0.34,1.4,0.64,1), left 0.25s cubic-bezier(0.34,1.4,0.64,1), top 0.25s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.2s, opacity 0.2s'
            : 'box-shadow 0.2s, opacity 0.2s';
        if (snapEdge === 'right') { btn.style.right = '12px'; btn.style.left = 'auto'; }
        else                      { btn.style.left  = '12px'; btn.style.right = 'auto'; }
        btn.style.top = posY + 'px';
        repositionPanel();
    }

    function repositionPanel() {
        if (!panelOpen) return;
        const panelH = panel.offsetHeight || 200;
        const clampedY = Math.max(8, Math.min(window.innerHeight - panelH - 8, posY));
        panel.style.top = clampedY + 'px';
        if (snapEdge === 'right') { panel.style.right = '58px'; panel.style.left = 'auto'; }
        else                      { panel.style.left  = '58px'; panel.style.right = 'auto'; }
    }

    applyPosition(false);

    chrome.storage.local.get(
        { showFloatingWidget: false, widgetPosY: null, widgetSnapEdge: null },
        (res) => {
            const isShow = res.showFloatingWidget !== false;
            btn.style.display = isShow ? 'flex' : 'none';
            if (!isShow) panel.style.display = 'none';

            if (res.widgetPosY != null) {
                posY = Math.max(8, Math.min(window.innerHeight - 46, res.widgetPosY));
            }
            if (res.widgetSnapEdge != null) {
                snapEdge = res.widgetSnapEdge;
            }
            applyPosition(false);
        }
    );

    let isDragging = false, moved = false, dragStartClientY = 0, dragStartPosY = 0;

    // mousemove / mouseup 之前全程挂在 document 上，鼠标随便动就跑回调。
    // 现在改成「按下时挂载，松开时摘除」，没拖动时浏览器零开销。
    const onDocMouseMove = (e) => {
        if (!isDragging) return;
        const dy = e.clientY - dragStartClientY;
        if (Math.abs(dy) > 3) moved = true;
        posY = Math.max(8, Math.min(window.innerHeight - 46, dragStartPosY + dy));
        if (e.clientX < window.innerWidth / 2) { snapEdge = 'left'; btn.style.left = Math.max(8, e.clientX - 19) + 'px'; btn.style.right = 'auto'; }
        else                                    { snapEdge = 'right'; btn.style.right = Math.max(8, window.innerWidth - e.clientX - 19) + 'px'; btn.style.left = 'auto'; }
        btn.style.top = posY + 'px';
        repositionPanel();
    };
    const onDocMouseUp = (e) => {
        if (!isDragging) return;
        isDragging = false; btn.style.cursor = 'grab';
        snapEdge = (e.clientX < window.innerWidth / 2) ? 'left' : 'right';
        applyPosition(true);
        chrome.storage.local.set({
            widgetPosY: posY,
            widgetSnapEdge: snapEdge,
        });
        document.removeEventListener('mousemove', onDocMouseMove);
        document.removeEventListener('mouseup', onDocMouseUp);
    };

    btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true; moved = false;
        dragStartClientY = e.clientY; dragStartPosY = posY;
        btn.style.cursor = 'grabbing'; btn.style.transition = 'none'; btn.style.opacity = '1';
        document.addEventListener('mousemove', onDocMouseMove);
        document.addEventListener('mouseup', onDocMouseUp);
        e.preventDefault();
    });

    btn.addEventListener('click', () => {
        if (moved) { moved = false; return; }
        panelOpen ? closePanel() : openPanel();
    });

    // 关闭浮窗的 outside-click：之前在捕获阶段常驻全局监听，每次 mousedown 都进。
    // 现在只在 panel 实际打开后才绑定，关闭时立刻摘掉。
    // 监听器本体定义在下面 openPanel / closePanel 中使用。

    const onOutsidePanelMouseDown = (e) => {
        if (panelOpen && !panel.contains(e.target) && e.target !== btn) closePanel();
    };

    function openPanel() {
        panelOpen = true;
        panelView = 'chart';
        renderChartView();
        panel.style.display = 'flex';
        repositionPanel();
        requestAnimationFrame(() => {
            panel.style.opacity = '1';
            panel.style.transform = 'scale(1)';
        });
        document.addEventListener('mousedown', onOutsidePanelMouseDown, true);
    }

    function closePanel() {
        panelOpen = false;
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.94)';
        setTimeout(() => { if (!panelOpen) panel.style.display = 'none'; }, 180);
        document.removeEventListener('mousedown', onOutsidePanelMouseDown, true);
    }

    function renderChartView() {
        panel.innerHTML = `<div style="font-size:11px;color:var(--ys-text-muted);text-align:center;padding:12px 0;">${ysT('statsLoading')}</div>`;
        ysRuntimeSendMessageRetry({ action: 'get_daily_stats' }, {}, (response, err) => {
            const dailyStats = (!err && response && response.dailyStats) ? response.dailyStats : {};
            buildChartContent(dailyStats);
            repositionPanel();
        });
    }

    function buildChartContent(dailyStats) {
        const days = [];
        for (let i = 4; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key   = d.toISOString().slice(0, 10);
            const label = `${d.getMonth() + 1}/${d.getDate()}`;
            days.push({ key, label, count: dailyStats[key] || 0, isToday: i === 0 });
        }
        const total5     = days.reduce((s, d) => s + d.count, 0);
        const todayCount = days[4].count;

        const modRaw = MOD_LABELS[modifierKey] || '';
        const modParts = String(modRaw).split(/\s+/);
        const modShort = modParts.length > 1 ? modParts[modParts.length - 1] : modRaw;

        panel.innerHTML = `
          <div style="display:flex;justify-content:center;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:var(--ys-text-title);letter-spacing:0.01em;">${ysT('statsTitle5d')}</span>
          </div>
          <div style="text-align:center;font-size:10px;color:var(--ys-text-secondary);line-height:1.45;margin-bottom:8px;padding:0 4px;word-break:keep-all;">
            ${ysT('statsDoubleTapPanel', [modShort])}
          </div>
          <div style="display:flex;justify-content:center;align-items:center;width:100%;">
            ${buildSVGChart(days)}
          </div>
          <div style="display:flex;justify-content:center;align-items:center;gap:14px;margin-top:4px;">
            <span style="font-size:10px;color:var(--ys-text-secondary);">${ysT('statsToday')} <b style="font-size:13px;font-weight:700;color:var(--ys-accent)">${todayCount}</b> ${ysT('statsTimes')}</span>
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-size:10px;color:var(--ys-text-secondary);">${ysT('statsFiveDaySum')}</span>
              <span style="font-size:13px;font-weight:700;color:var(--ys-accent);">${total5}</span>
              <span style="font-size:10px;color:var(--ys-text-secondary);">${ysT('statsTimes')}</span>
            </div>
          </div>`;
    }

    function renderSettingsView() {
        panelView = 'settings';
        const keys = modifierKeysForPlatform();

        panel.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
            <button id="ys-back-btn" style="
              background:none;border:none;cursor:pointer;padding:2px 4px 2px 0;
              display:flex;align-items:center;opacity:0.55;transition:opacity 0.15s;
            ">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 3L5 7L9 11" stroke="rgba(60,80,160,0.9)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span style="font-size:12px;font-weight:600;color:rgba(60,70,110,0.85);">${ysT('floatSettingsTitle')}</span>
          </div>
          <div style="font-size:10px;color:rgba(120,130,160,0.6);margin-bottom:8px;line-height:1.5;">
            ${ysT('floatSettingsDesc')}
          </div>
          <div id="ys-key-options" style="display:flex;flex-direction:column;gap:5px;">
            ${keys.map(k => `
              <div data-key="${k}" class="ys-key-opt" style="
                display:flex;align-items:center;gap:8px;
                padding:7px 10px;border-radius:8px;cursor:pointer;
                transition:background 0.12s;
                background:${k === modifierKey ? 'rgba(80,110,200,0.15)' : 'rgba(0,0,0,0.0)'};
                border:1px solid ${k === modifierKey ? 'rgba(80,110,200,0.35)' : 'rgba(0,0,0,0)'};
              ">
                <div style="
                  width:14px;height:14px;border-radius:50%;
                  border:1.5px solid rgba(80,110,200,0.6);
                  background:${k === modifierKey ? 'rgba(80,110,200,0.8)' : 'transparent'};
                  flex-shrink:0;display:flex;align-items:center;justify-content:center;
                ">
                  ${k === modifierKey ? '<div style="width:5px;height:5px;border-radius:50%;background:white"></div>' : ''}
                </div>
                <span style="font-size:12px;color:rgba(60,75,120,0.85);font-weight:${k === modifierKey ? '600' : '400'};">
                  ${MOD_LABELS[k]}
                </span>
              </div>`).join('')}
          </div>`;

        repositionPanel();

        panel.querySelector('#ys-back-btn').addEventListener('mouseenter', e => e.currentTarget.style.opacity = '1');
        panel.querySelector('#ys-back-btn').addEventListener('mouseleave', e => e.currentTarget.style.opacity = '0.55');
        panel.querySelector('#ys-back-btn').addEventListener('click', (e) => { e.stopPropagation(); renderChartView(); });

        panel.querySelectorAll('.ys-key-opt').forEach(el => {
            el.addEventListener('mouseenter', () => {
                if (el.dataset.key !== modifierKey) el.style.background = 'rgba(80,110,200,0.06)';
            });
            el.addEventListener('mouseleave', () => {
                if (el.dataset.key !== modifierKey) el.style.background = 'transparent';
            });
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                modifierKey = el.dataset.key;
                chrome.storage.local.set({ modifierKey });
                renderSettingsView(); 
            });
        });
    }

    function buildSVGChart(days) {
        if (!Array.isArray(days) || days.length === 0) return '';
        const W = 182, H = 92, padL = 14, padR = 14, padT = 10, padB = 22;
        const cW = W - padL - padR, cH = H - padT - padB;
        const counts = days.map(d => d.count);
        const maxVal = Math.max(...counts, 1);
        const divisor = days.length > 1 ? (days.length - 1) : 1;
        const pts = days.map((d, i) => ({
            x: padL + (i / divisor) * cW,
            y: padT + (1 - d.count / maxVal) * cH, ...d
        }));

        function smooth(points) {
            let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
            for (let i = 1; i < points.length; i++) {
                const p = points[i - 1], c = points[i], cpx = (p.x + c.x) / 2;
                path += ` C${cpx.toFixed(1)},${p.y.toFixed(1)} ${cpx.toFixed(1)},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`;
            }
            return path;
        }

        const linePath = smooth(pts);
        const fp = pts[0], lp = pts[pts.length - 1];
        const areaPath = linePath + ` L${lp.x.toFixed(1)},${(padT + cH).toFixed(1)} L${fp.x.toFixed(1)},${(padT + cH).toFixed(1)} Z`;
        const maxCount = Math.max(...counts);

        const dots = pts.map((p, i) => {
            const today = i === pts.length - 1;
            return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${today ? 3.5 : 2.5}"
              fill="var(--ys-accent)" opacity="${today ? '0.95' : '0.65'}"
              stroke="var(--ys-settings-bg, var(--ys-card-bg))" stroke-width="1.5"/>`;
        }).join('');

        const labels = pts.map((p, i) => {
            const today = i === pts.length - 1;
            const isMax = p.count === maxCount && maxCount > 0;
            if (!today && !isMax) return '';
            return `<text x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}" text-anchor="middle"
              font-size="8.5" font-weight="600" fill="var(--ys-text-primary)">${p.count}</text>`;
        }).join('');

        const xLabels = pts.map((p, i) => {
            const today = i === pts.length - 1;
            return `<text x="${p.x.toFixed(1)}" y="${H - 4}" text-anchor="middle"
              font-size="9" fill="${today ? 'var(--ys-accent)' : 'var(--ys-text-secondary)'}"
              font-weight="${today ? '600' : '400'}">${p.label}</text>`;
        }).join('');

        const yTicks = [0, 0.5, 1].map(t => {
            const y = padT + (1 - t) * cH;
            return `<line x1="${padL - 3}" y1="${y.toFixed(1)}" x2="${padL}" y2="${y.toFixed(1)}" stroke="var(--ys-divider)" stroke-width="1"/>
                    <text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="var(--ys-text-muted)">${Math.round(t * maxVal)}</text>`;
        }).join('');

        return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block;margin:0 auto;max-width:100%;">
          <defs>
            <linearGradient id="gkAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--ys-accent)" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="var(--ys-accent)" stop-opacity="0"/>
            </linearGradient>
            <filter id="gkGlow"><feGaussianBlur stdDeviation="1.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" stroke="var(--ys-divider)" stroke-width="1"/>
          <line x1="${padL}" y1="${padT + cH}" x2="${W - padR}" y2="${padT + cH}" stroke="var(--ys-divider)" stroke-width="1"/>
          <line x1="${padL}" y1="${(padT + cH * 0.5).toFixed(1)}" x2="${W - padR}" y2="${(padT + cH * 0.5).toFixed(1)}"
            stroke="var(--ys-divider)" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>
          ${yTicks}
          <path d="${areaPath}" fill="url(#gkAreaGrad)"/>
          <path d="${linePath}" fill="none" stroke="var(--ys-accent)" stroke-opacity="0.9" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round" filter="url(#gkGlow)"/>
          ${labels}${dots}${xLabels}
        </svg>`;
    }

    chrome.storage.onChanged.addListener((changes) => {
        if (!changes.modifierKey) return;
        if (!panelOpen || panelView !== 'chart') return;
        renderChartView();
    });
}


// ─── 全局事件监听 ─────────────────────────────────────────────────────────────

// 双击关闭标签
document.addEventListener('dblclick', function(event) {
    if (isModHeld(event)) {
        event.preventDefault();
        chrome.runtime.sendMessage({ action: "close_and_toast" });
        // 埋点：用户首次成功触发「修饰键 + 双击关闭」手势 → 只上报一次，用于算激活率
        ysRuntimeSendMessageRetry(
            { action: 'track_event', feature: 'first_close', kind: 'first_use' },
            { maxRetries: 1 },
            () => {},
        );
    }
});

// 双击修饰键呼出切换面板
let lastModPressTime = 0;
const DOUBLE_PRESS_DELAY = 300;

// 节流逻辑在 background 全局做（按 windowId 跨标签共享 45s 冷却 + in-flight 复用）。
// content 侧只管发；后台决定是否真的去打 AI。
function trySilentAiPrewarm() {
    ysRuntimeSendMessageRetry({ action: 'prewarm_ai_current_window' }, { maxRetries: 2 }, () => {});
}

/** ✨ 呼出面板累计 30 次后弹出一次好评/反馈引导（关闭后永久不再打扰） */
function checkAndShowFeedbackFlyout() {
    if (window.top !== window.self) return;
    const FLYOUT_ID = 'ys-feedback-flyout';
    if (document.getElementById(FLYOUT_ID)) return;

    const STORAGE_KEY_COUNT = 'ysCallCountForFeedback';
    const STORAGE_KEY_DISMISSED = 'ysFeedbackDismissed';
    const TRIGGER_COUNT = 30;

    chrome.storage.local.get([STORAGE_KEY_COUNT, STORAGE_KEY_DISMISSED], (res) => {
        if (res && res[STORAGE_KEY_DISMISSED]) return;
        const nextCount = (Number(res && res[STORAGE_KEY_COUNT]) || 0) + 1;
        chrome.storage.local.set({ [STORAGE_KEY_COUNT]: nextCount }, () => {
            if (nextCount === TRIGGER_COUNT) {
                renderFeedbackFlyout(FLYOUT_ID, STORAGE_KEY_DISMISSED);
            }
        });
    });
}

function renderFeedbackFlyout(id, dismissedKey) {
    if (window.top !== window.self) return;
    const flyout = document.createElement('div');
    flyout.id = id;
    Object.assign(flyout.style, {
        position: 'fixed',
        right: '24px',
        bottom: '24px',
        zIndex: '2147483647',
        width: '292px',
        padding: '14px 14px 12px',
        borderRadius: '14px',
        background: 'var(--ys-card-bg, rgba(252, 252, 254, 0.82))',
        backdropFilter: 'saturate(180%) blur(24px)',
        WebkitBackdropFilter: 'saturate(180%) blur(24px)',
        border: '1px solid var(--ys-card-border, rgba(110, 150, 235, 0.35))',
        boxShadow: 'var(--ys-card-shadow, 0 12px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.52))',
        color: 'var(--ys-text-primary, rgba(45, 55, 78, 0.92))',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        opacity: '0',
        transform: 'translateY(14px)',
        transition: 'opacity 0.28s ease, transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)',
        boxSizing: 'border-box',
    });

    flyout.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:0.01em;color:var(--ys-text-title, rgba(35,45,70,0.95));">${ysT('feedbackFlyoutTitle')}</div>
        <button id="ys-feedback-close" type="button" style="
          border:none;background:var(--ys-btn-bg, transparent);cursor:pointer;
          width:20px;height:20px;border-radius:6px;line-height:1;
          color:var(--ys-text-muted, rgba(95,105,125,0.55));font-size:16px;padding:0;flex-shrink:0;
          transition:background 0.15s ease;
        ">×</button>
      </div>
      <div style="margin-top:8px;font-size:12px;line-height:1.62;color:var(--ys-text-secondary, rgba(58,68,90,0.86));">
        ${ysT('feedbackFlyoutBody1')}
        <div style="margin-top:8px;">${ysT('feedbackFlyoutBody2')}</div>
        <a href="mailto:xujianjun1995@gmail.com" style="margin-top:3px;display:inline-block;color:var(--ys-accent, rgba(80,110,220,0.95));text-decoration:none;font-weight:600;">xujianjun1995@gmail.com</a>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="ys-feedback-review" type="button" style="
          flex:1;border:none;border-radius:9px;padding:7px 8px;cursor:pointer;
          background:var(--ys-accent, rgba(80,110,220,0.9));color:#ffffff;font-size:12px;font-weight:600;
          box-shadow:0 3px 10px var(--ys-accent-bg, rgba(80,110,220,0.22));
          transition:background 0.15s ease;
        ">${ysT('feedbackReviewBtn')}</button>
      </div>
    `;

    document.body.appendChild(flyout);
    requestAnimationFrame(() => {
        flyout.style.opacity = '1';
        flyout.style.transform = 'translateY(0)';
    });

    const closeFlyout = () => {
        chrome.storage.local.set({ [dismissedKey]: true });
        flyout.style.opacity = '0';
        flyout.style.transform = 'translateY(14px)';
        setTimeout(() => {
            if (flyout.isConnected) flyout.remove();
        }, 360);
    };

    const closeBtn = flyout.querySelector('#ys-feedback-close');
    if (closeBtn) {
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--ys-btn-hover, rgba(0,0,0,0.08))'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'var(--ys-btn-bg, transparent)'; });
        closeBtn.addEventListener('click', closeFlyout);
    }

    const reviewBtn = flyout.querySelector('#ys-feedback-review');
    if (reviewBtn) {
        reviewBtn.addEventListener('mouseenter', () => {
            reviewBtn.style.background = 'var(--ys-accent)';
            reviewBtn.style.color = '#ffffff';
        });
        reviewBtn.addEventListener('mouseleave', () => {
            reviewBtn.style.background = 'var(--ys-accent, rgba(80,110,220,0.9))';
            reviewBtn.style.color = '#ffffff';
        });
        reviewBtn.addEventListener('click', () => {
            const storeUrl =
                'https://chromewebstore.google.com/detail/%E6%A0%87%E7%AD%BE%E9%A1%B5ai%E8%87%AA%E5%8A%A8%E5%88%86%E7%BB%84%E8%B7%A8%E7%AA%97%E5%8F%A3%E7%AE%A1%E7%90%86%E5%BF%AB%E9%80%9F%E5%88%87%E6%8D%A2%E5%8F%8C%E5%87%BB%E5%85%B3%E9%97%AD%E6%99%BA%E8%83%BD%E8%AF%AD/ggdplmigmgopdecjadbgakofifnonacb';
            window.open(storeUrl, '_blank');
            closeFlyout();
        });
    }
}

document.addEventListener('keydown', function(event) {
    if (event.repeat) return;
    const SWITCH_TOAST_MS = 2800;

    // 修饰键 + E：捕获阶段优先拦截，避免被搜索框等吃掉（事件吞噬）
    if (isModHeld(event) && event.code === 'KeyE') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof hideSwitcher === 'function' && typeof switcherVisible !== 'undefined' && switcherVisible) {
            hideSwitcher();
        }
        ysRuntimeSendMessageRetry({ action: 'switch_to_last_tab' }, { maxRetries: 3 }, (res, err) => {
            if (err) {
                showYsMessageToast(ysT('toastSwitchFailed', [err]), SWITCH_TOAST_MS);
                return;
            }
            if (res && res.success) {
                // 成功提示已改为在目标标签页弹出（background -> show_message_toast）
            } else if (res && res.reason === 'no_last') {
                showYsMessageToast(ysT('toastNoPrevTab'), SWITCH_TOAST_MS);
            } else if (res && res.reason === 'gone') {
                showYsMessageToast(ysT('toastPrevTabClosed'), SWITCH_TOAST_MS);
            } else {
                showYsMessageToast(ysT('toastPrevTabUnknown'), SWITCH_TOAST_MS);
            }
        });
        return;
    }

    if (event.key === 'Escape' && typeof switcherVisible !== 'undefined' && switcherVisible) {
        if (typeof hideSwitcher === 'function') hideSwitcher();
        return;
    }

    if (event.key === MOD_EVENT_KEY[modifierKey]) {
        const now = Date.now();
        if (now - lastModPressTime < DOUBLE_PRESS_DELAY) {
            // 触发双击
            event.preventDefault();

            if (typeof switcherVisible === 'undefined' || !switcherVisible) {
                // 双击确认后再预热：避免单按 Cmd+S/C/V 等组合键时被误触发，
                // 进而把免费 AI 配额（10 次/天）偷偷烧掉。
                trySilentAiPrewarm();
                ysRuntimeSendMessageRetry({ action: 'get_tabs' }, {}, (res, err) => {
                    if (err) {
                        showYsMessageToast(
                            ysT('toastExtensionBusy'),
                            4200,
                        );
                        return;
                    }
                    if (!res || !res.tabs || res.tabs.length === 0) return;
                    showSwitcher(res.tabs, false, res.currentWindowId);
                    if (typeof initSwitcherHighlight === 'function') initSwitcherHighlight();
                    checkAndShowFeedbackFlyout();
                    // 埋点：用户首次成功双击修饰键唤出面板 → 只上报一次，用于算激活率
                    ysRuntimeSendMessageRetry(
                        { action: 'track_event', feature: 'first_switcher_open', kind: 'first_use' },
                        { maxRetries: 1 },
                        () => {},
                    );
                });
            } else {
                if (typeof hideSwitcher === 'function') hideSwitcher();
            }
            lastModPressTime = 0;
        } else {
            lastModPressTime = now;
        }
    }
}, true);

// 来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'show_toast') {
        showToast(request.count);
    } else if (request.action === 'show_message_toast') {
        showYsMessageToast(request.message || '🫡 YesSir', Number(request.durationMs) || 2800);
    } else if (request.action === 'refresh_category_bar') {
        if (typeof window.__ysRefreshCategoryBar === 'function') {
            window.__ysRefreshCategoryBar();
        }
    } else if (request.action === 'pinned_tab_removed') {
        if (typeof window.__ysRemovePinnedTab === 'function') {
            window.__ysRemovePinnedTab(request.tabId);
        }
    } else if (request.action === 'force_hide_switcher') {
        if (typeof hideSwitcher === 'function' && typeof switcherVisible !== 'undefined' && switcherVisible) {
            hideSwitcher();
        }
    } else if (request.action === 'toggle_switcher') {
        if (typeof switcherVisible !== 'undefined' && switcherVisible) {
            if (typeof hideSwitcher === 'function') hideSwitcher();
        } else if (request.tabs && request.tabs.length > 0) {
            showSwitcher(request.tabs, false, request.currentWindowId);
            if (typeof initSwitcherHighlight === 'function') initSwitcherHighlight();
        }
    } else if (request.action === 'get_page_meta') {
        // 仅在 AI 分组遇到「模糊标题」时被调用，返回 meta 描述辅助 LLM 判断
        const pick = (sel) => {
            const el = document.querySelector(sel);
            return el && el.content ? String(el.content).trim() : '';
        };
        const description = pick('meta[name="description"]')
            || pick('meta[property="og:description"]')
            || pick('meta[name="twitter:description"]')
            || '';
        const ogTitle = pick('meta[property="og:title"]') || '';
        sendResponse({
            description: description.slice(0, 280),
            ogTitle: ogTitle.slice(0, 120),
        });
        return false;
    }
});


// ─── 新手引导 ──────────────────────────────────────────────────────────────────

/**
 * 安装后首次访问 http 页面时触发引导；background 在 install 事件里写入 ysOnboardingPending。
 * 永久消除：用户点击 × 或成功触发任意手势（storage onChanged 监听 ysFirstUseReported）。
 */
function checkAndShowOnboarding() {
    if (window.top !== window.self) return;
    if (!/^https?:$/.test(location.protocol)) return;
    const PENDING_KEY = 'ysOnboardingPending';
    const DISMISSED_KEY = 'ysOnboardingDismissed';
    chrome.storage.local.get([PENDING_KEY, DISMISSED_KEY, 'modifierKey'], (res) => {
        if (!res[PENDING_KEY] || res[DISMISSED_KEY]) return;
        // 消费待展示标记（只展示一次）
        chrome.storage.local.set({ [PENDING_KEY]: false });
        const modKey = normalizeStoredModifierKey(res.modifierKey);
        const modLabel = MOD_LABELS[modKey] || modKey;
        showYsOnboarding(modLabel, DISMISSED_KEY);
    });
}

function showYsOnboarding(modLabel, dismissedKey) {
    if (document.getElementById('ys-onboarding')) return;
    ensureYsThemeStylesInjected();

    const widget = document.createElement('div');
    widget.id = 'ys-onboarding';
    Object.assign(widget.style, {
        position:             'fixed',
        right:                '24px',
        bottom:               '24px',
        zIndex:               '2147483647',
        width:                '292px',
        padding:              '14px 14px 12px',
        borderRadius:         '14px',
        background:           'var(--ys-card-bg, rgba(252, 252, 254, 0.82))',
        backdropFilter:       'saturate(180%) blur(24px)',
        WebkitBackdropFilter: 'saturate(180%) blur(24px)',
        border:               '1px solid var(--ys-card-border, rgba(110, 150, 235, 0.35))',
        boxShadow:            'var(--ys-card-shadow, 0 12px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.52))',
        color:                'var(--ys-text-primary, rgba(45, 55, 78, 0.92))',
        fontFamily:           '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        opacity:              '0',
        transform:            'translateY(14px)',
        transition:           'opacity 0.28s ease, transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)',
        boxSizing:            'border-box',
    });

    widget.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">
            <div style="font-size:13px;font-weight:700;letter-spacing:0.01em;color:var(--ys-text-title,rgba(35,45,70,0.95));">${ysT('onboardingTitle')}</div>
            <button id="ys-ob-x" type="button" style="border:none;background:var(--ys-btn-bg,rgba(0,0,0,0.04));cursor:pointer;width:20px;height:20px;border-radius:6px;line-height:1;color:var(--ys-text-muted,rgba(95,105,125,0.55));font-size:16px;padding:0;flex-shrink:0;transition:background 0.15s;">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;">
            <div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;background:var(--ys-btn-bg,rgba(0,0,0,0.04));">
                <span style="font-size:16px;flex-shrink:0;">⌨️</span>
                <div style="font-size:12px;color:var(--ys-text-primary);line-height:1.5;">${ysT('onboardingOpen', [modLabel])}</div>
            </div>
            <div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;background:var(--ys-btn-bg,rgba(0,0,0,0.04));">
                <span style="font-size:16px;flex-shrink:0;">🖱️</span>
                <div style="font-size:12px;color:var(--ys-text-primary);line-height:1.5;">${ysT('onboardingClose', [modLabel])}</div>
            </div>
            <div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;background:var(--ys-btn-bg,rgba(0,0,0,0.04));">
                <span style="font-size:16px;flex-shrink:0;">🗂️</span>
                <div style="font-size:12px;color:var(--ys-text-primary);line-height:1.5;">${ysT('onboardingDrag')}</div>
            </div>
        </div>
        <div style="margin-top:9px;font-size:11px;color:var(--ys-text-muted,rgba(100,110,130,0.6));text-align:center;line-height:1.4;">${ysT('onboardingHint')}</div>
    `;

    document.body.appendChild(widget);
    requestAnimationFrame(() => {
        widget.style.opacity = '1';
        widget.style.transform = 'translateY(0)';
    });

    const dismiss = () => {
        if (dismissedKey) chrome.storage.local.set({ [dismissedKey]: true });
        widget.style.opacity = '0';
        widget.style.transform = 'translateY(14px)';
        setTimeout(() => { if (widget.isConnected) widget.remove(); }, 360);
    };

    const closeBtn = widget.querySelector('#ys-ob-x');
    if (closeBtn) {
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--ys-btn-hover,rgba(0,0,0,0.08))'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'var(--ys-btn-bg,rgba(0,0,0,0.04))'; });
        closeBtn.addEventListener('click', dismiss);
    }

    // 任意手势首次成功触发后自动消除
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function bootstrap() {
    initFloatingWidget();
    // 不在页面加载时预热 AI：每开一个新标签都触发会把免费配额（10 次/天）瞬间打光。
    // 预热移到用户双击修饰键、确认要呼出面板的那一刻（见 keydown 监听）。
    checkAndShowOnboarding();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    // 其余 content script（含 00-i18n）在同一次注入序列中稍后执行，推迟到下一 macrotask
    setTimeout(bootstrap, 0);
}