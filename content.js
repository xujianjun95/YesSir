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
    toast.innerText = `🫡 Yes Sir，已记录本次使用，累计 ${count} 次`;

    Object.assign(toast.style, {
        position:           'fixed',
        bottom:             '15%',
        left:               '50%',
        transform:          'translateX(-50%)',
        padding:            '9px 18px',
        background:         'rgba(250, 252, 255, 0.9)',
        backdropFilter:     'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:             '1px solid rgba(255, 255, 255, 0.9)',
        borderRadius:       '10px',
        color:              'rgba(40, 50, 70, 0.95)',
        fontSize:           '13px',
        fontWeight:         '600',
        letterSpacing:      '0.01em',
        boxShadow:          '0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8)',
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
        bottom:             '15%',
        left:               '50%',
        transform:          'translateX(-50%)',
        padding:            '9px 18px',
        maxWidth:           'min(92vw, 420px)',
        background:         'rgba(250, 252, 255, 0.9)',
        backdropFilter:     'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:             '1px solid rgba(255, 255, 255, 0.9)',
        borderRadius:       '10px',
        color:              'rgba(40, 50, 70, 0.95)',
        fontSize:           '13px',
        fontWeight:         '600',
        letterSpacing:      '0.01em',
        boxShadow:          '0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8)',
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
    openYsModal('⌨️ 修饰键设置', (container) => {
        const render = () => {
            const keys = modifierKeysForPlatform();
            let html = `
                <div style="font-size:12px;color:var(--ys-text-secondary, rgba(100,110,130,0.85));margin-bottom:12px;line-height:1.5;">
                    按住修饰键双击空白处关闭当前标签页 & 双击修饰键呼出标签页管理看板。
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
    openYsModal('🔑 API Key 设置', (container, close) => {
        container.innerHTML = `
            <div style="font-size:12px;color:var(--ys-text-secondary, rgba(100,110,130,0.85));line-height:1.5;margin-bottom:12px;">
                「🫡 Yes Sir」标签页管理的 AI 功能依托于大模型处理，当前版本仅支持配置 DeepSeek 提供的 API key。
            </div>
            <div style="position:relative;margin-bottom:16px;">
                <input type="password" id="ys-apikey-input" placeholder="sk-..." autocomplete="off" style="
                    width:100%; padding:10px 44px 10px 14px; border-radius:8px;
                    border:1px solid var(--ys-search-border, rgba(0,0,0,0.15)); background:var(--ys-search-bg, rgba(255,255,255,0.6));
                    color:var(--ys-text-primary, rgba(40,50,70,0.9)); font-size:13px; outline:none; box-sizing:border-box;
                    box-shadow:inset 0 1px 2px rgba(0,0,0,0.02); transition:border-color 0.2s;
                ">
                <button id="ys-apikey-visibility-toggle" type="button" title="显示/隐藏 API key" style="
                    position:absolute; right:8px; top:50%; transform:translateY(-50%);
                    width:28px; height:28px; border:none; border-radius:7px;
                    background:var(--ys-btn-bg, rgba(0,0,0,0.04)); cursor:pointer;
                    display:flex; align-items:center; justify-content:center;
                    font-size:14px; line-height:1; transition:background 0.15s;
                ">😎</button>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button id="ys-apikey-cancel" style="padding:7px 16px; border-radius:8px; border:1px solid var(--ys-btn-border, rgba(0,0,0,0.1)); background:var(--ys-btn-bg, rgba(255,255,255,0.5)); cursor:pointer; font-size:13px; color:var(--ys-text-primary, rgba(60,70,80,0.9)); font-weight:500; transition:background 0.15s;">取消</button>
                <button id="ys-apikey-save" style="padding:7px 16px; border-radius:8px; border:1px solid var(--ys-accent-hover); background:var(--ys-accent); color:var(--ys-accent-text, #fff); cursor:pointer; font-size:13px; font-weight:600; transition:background 0.15s, box-shadow 0.15s; box-shadow:0 2px 6px var(--ys-accent-bg);">确定</button>
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
            visibilityBtn.title = showing ? '显示 API key' : '隐藏 API key';
        });

        chrome.storage.local.get(['deepseekApiKey'], (res) => {
            if (res.deepseekApiKey) input.value = res.deepseekApiKey;
        });

        const cancelBtn = container.querySelector('#ys-apikey-cancel');
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = 'var(--ys-btn-hover, rgba(0,0,0,0.05))');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'var(--ys-btn-bg, rgba(255,255,255,0.5))');
        cancelBtn.addEventListener('click', close);

        const saveBtn = container.querySelector('#ys-apikey-save');
        saveBtn.addEventListener('mouseenter', () => saveBtn.style.boxShadow = '0 4px 12px var(--ys-accent-bg)');
        saveBtn.addEventListener('mouseleave', () => saveBtn.style.boxShadow = '0 2px 6px var(--ys-accent-bg)');
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
        { showFloatingWidget: true, widgetPosY: null, widgetSnapEdge: null },
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

    btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true; moved = false;
        dragStartClientY = e.clientY; dragStartPosY = posY;
        btn.style.cursor = 'grabbing'; btn.style.transition = 'none'; btn.style.opacity = '1';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dy = e.clientY - dragStartClientY;
        if (Math.abs(dy) > 3) moved = true;
        posY = Math.max(8, Math.min(window.innerHeight - 46, dragStartPosY + dy));
        if (e.clientX < window.innerWidth / 2) { snapEdge = 'left'; btn.style.left = Math.max(8, e.clientX - 19) + 'px'; btn.style.right = 'auto'; }
        else                                    { snapEdge = 'right'; btn.style.right = Math.max(8, window.innerWidth - e.clientX - 19) + 'px'; btn.style.left = 'auto'; }
        btn.style.top = posY + 'px';
        repositionPanel();
    });

    document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false; btn.style.cursor = 'grab';
        snapEdge = (e.clientX < window.innerWidth / 2) ? 'left' : 'right';
        applyPosition(true);
        chrome.storage.local.set({
            widgetPosY: posY,
            widgetSnapEdge: snapEdge,
        });
    });

    btn.addEventListener('click', () => {
        if (moved) { moved = false; return; }
        panelOpen ? closePanel() : openPanel();
    });

    document.addEventListener('mousedown', (e) => {
        if (panelOpen && !panel.contains(e.target) && e.target !== btn) closePanel();
    }, true);

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
    }

    function closePanel() {
        panelOpen = false;
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.94)';
        setTimeout(() => { if (!panelOpen) panel.style.display = 'none'; }, 180);
    }

    function renderChartView() {
        panel.innerHTML = `<div style="font-size:11px;color:rgba(100,100,120,0.7);text-align:center;padding:12px 0;">加载中…</div>`;
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
            <span style="font-size:12px;font-weight:600;color:rgba(60,70,110,0.85);letter-spacing:0.01em;">「🫡 Yes Sir」近 5 天使用统计</span>
          </div>
          <div style="text-align:center;font-size:10px;color:rgba(100,110,130,0.78);line-height:1.45;margin-bottom:8px;padding:0 4px;word-break:keep-all;">
            双击 ${modShort} 呼出面板
          </div>
          <div style="display:flex;justify-content:center;align-items:center;width:100%;">
            ${buildSVGChart(days)}
          </div>
          <div style="display:flex;justify-content:center;align-items:center;gap:14px;margin-top:4px;">
            <span style="font-size:10px;color:rgba(120,130,160,0.7);">今日 <b style="font-size:13px;font-weight:700;color:rgba(80,110,200,0.85)">${todayCount}</b> 次</span>
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-size:10px;color:rgba(120,130,160,0.7);">五日合计</span>
              <span style="font-size:13px;font-weight:700;color:rgba(80,110,200,0.85);">${total5}</span>
              <span style="font-size:10px;color:rgba(120,130,160,0.7);">次</span>
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
            <span style="font-size:12px;font-weight:600;color:rgba(60,70,110,0.85);">修饰键设置</span>
          </div>
          <div style="font-size:10px;color:rgba(120,130,160,0.6);margin-bottom:8px;line-height:1.5;">
            双击关闭 & 双击修饰键切换<br>均使用此快捷键触发
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
              fill="${today ? 'rgba(80,110,220,0.9)' : 'rgba(100,130,220,0.65)'}"
              stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>`;
        }).join('');

        const labels = pts.map((p, i) => {
            const today = i === pts.length - 1;
            const isMax = p.count === maxCount && maxCount > 0;
            if (!today && !isMax) return '';
            return `<text x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}" text-anchor="middle"
              font-size="8.5" font-weight="600" fill="rgba(70,100,200,0.8)">${p.count}</text>`;
        }).join('');

        const xLabels = pts.map((p, i) => {
            const today = i === pts.length - 1;
            return `<text x="${p.x.toFixed(1)}" y="${H - 4}" text-anchor="middle"
              font-size="9" fill="${today ? 'rgba(80,110,200,0.85)' : 'rgba(130,140,160,0.75)'}"
              font-weight="${today ? '600' : '400'}">${p.label}</text>`;
        }).join('');

        const yTicks = [0, 0.5, 1].map(t => {
            const y = padT + (1 - t) * cH;
            return `<line x1="${padL - 3}" y1="${y.toFixed(1)}" x2="${padL}" y2="${y.toFixed(1)}" stroke="rgba(150,160,180,0.3)" stroke-width="1"/>
                    <text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="rgba(140,150,170,0.6)">${Math.round(t * maxVal)}</text>`;
        }).join('');

        return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block;margin:0 auto;max-width:100%;">
          <defs>
            <linearGradient id="gkAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(90,120,230,0.28)"/>
              <stop offset="100%" stop-color="rgba(90,120,230,0.0)"/>
            </linearGradient>
            <filter id="gkGlow"><feGaussianBlur stdDeviation="1.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" stroke="rgba(150,160,190,0.2)" stroke-width="1"/>
          <line x1="${padL}" y1="${padT + cH}" x2="${W - padR}" y2="${padT + cH}" stroke="rgba(150,160,190,0.2)" stroke-width="1"/>
          <line x1="${padL}" y1="${(padT + cH * 0.5).toFixed(1)}" x2="${W - padR}" y2="${(padT + cH * 0.5).toFixed(1)}"
            stroke="rgba(150,160,190,0.1)" stroke-width="1" stroke-dasharray="3,3"/>
          ${yTicks}
          <path d="${areaPath}" fill="url(#gkAreaGrad)"/>
          <path d="${linePath}" fill="none" stroke="rgba(85,115,225,0.75)" stroke-width="1.8"
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
    }
});

// 双击修饰键呼出切换面板
let lastModPressTime = 0;
const DOUBLE_PRESS_DELAY = 300; 
let lastAiPrewarmAt = 0;
const AI_PREWARM_INTERVAL_MS = 45000;

function trySilentAiPrewarm() {
    const now = Date.now();
    if (now - lastAiPrewarmAt < AI_PREWARM_INTERVAL_MS) return;
    lastAiPrewarmAt = now;
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
        <div style="font-size:14px;font-weight:700;letter-spacing:0.01em;color:var(--ys-text-title, rgba(35,45,70,0.95));">🫡 报告长官！</div>
        <button id="ys-feedback-close" type="button" style="
          border:none;background:var(--ys-btn-bg, transparent);cursor:pointer;
          width:20px;height:20px;border-radius:6px;line-height:1;
          color:var(--ys-text-muted, rgba(95,105,125,0.55));font-size:16px;padding:0;flex-shrink:0;
          transition:background 0.15s ease;
        ">×</button>
      </div>
      <div style="margin-top:8px;font-size:12px;line-height:1.62;color:var(--ys-text-secondary, rgba(58,68,90,0.86));">
        看到您高频使用「🫡 Yes Sir」，希望它有帮到您。若觉得顺手，欢迎在商店赐予好评 ✨
        <div style="margin-top:8px;">若有建议也欢迎直接反馈：</div>
        <a href="mailto:xujianjun1995@gmail.com" style="margin-top:3px;display:inline-block;color:var(--ys-accent, rgba(80,110,220,0.95));text-decoration:none;font-weight:600;">xujianjun1995@gmail.com</a>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="ys-feedback-review" type="button" style="
          flex:1;border:none;border-radius:9px;padding:7px 8px;cursor:pointer;
          background:var(--ys-accent, rgba(80,110,220,0.9));color:var(--ys-accent-text, #fff);font-size:12px;font-weight:600;
          box-shadow:0 3px 10px var(--ys-accent-bg, rgba(80,110,220,0.22));
          transition:background 0.15s ease;
        ">去商店好评</button>
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
        reviewBtn.addEventListener('mouseenter', () => { reviewBtn.style.background = 'var(--ys-accent-hover, rgba(60,90,200,0.95))'; });
        reviewBtn.addEventListener('mouseleave', () => { reviewBtn.style.background = 'var(--ys-accent, rgba(80,110,220,0.9))'; });
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
                showYsMessageToast('切换失败：' + err, SWITCH_TOAST_MS);
                return;
            }
            if (res && res.success) {
                // 成功提示已改为在目标标签页弹出（background -> show_message_toast）
            } else if (res && res.reason === 'no_last') {
                showYsMessageToast('暂无上一个标签页可切换', SWITCH_TOAST_MS);
            } else if (res && res.reason === 'gone') {
                showYsMessageToast('上一个标签页已关闭或不存在', SWITCH_TOAST_MS);
            } else {
                showYsMessageToast('😅 上一个标签页似乎已关闭或无记录', SWITCH_TOAST_MS);
            }
        });
        return;
    }

    if (event.key === 'Escape' && typeof switcherVisible !== 'undefined' && switcherVisible) {
        if (typeof hideSwitcher === 'function') hideSwitcher();
        return;
    }

    if (event.key === MOD_EVENT_KEY[modifierKey]) {
        trySilentAiPrewarm();
        const now = Date.now();
        if (now - lastModPressTime < DOUBLE_PRESS_DELAY) {
            // 触发双击
            event.preventDefault();

            if (typeof switcherVisible === 'undefined' || !switcherVisible) {
                ysRuntimeSendMessageRetry({ action: 'get_tabs' }, {}, (res, err) => {
                    if (err) {
                        showYsMessageToast(
                            '扩展暂时未响应，请轻点页面后再试或刷新本页（睡眠唤醒后较常见）。',
                            4200,
                        );
                        return;
                    }
                    if (!res || !res.tabs || res.tabs.length === 0) return;
                    showSwitcher(res.tabs, false, res.currentWindowId);
                    if (typeof initSwitcherHighlight === 'function') initSwitcherHighlight();
                    checkAndShowFeedbackFlyout();
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
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'show_toast') {
        showToast(request.count);
    } else if (request.action === 'show_message_toast') {
        showYsMessageToast(request.message || '🫡 Yes Sir', Number(request.durationMs) || 2800);
    } else if (request.action === 'force_hide_switcher') {
        if (typeof hideSwitcher === 'function' && typeof switcherVisible !== 'undefined' && switcherVisible) {
            hideSwitcher();
        }
    }
});


// ─── Bootstrap ────────────────────────────────────────────────────────────────

function bootstrap() {
    initFloatingWidget();
    setTimeout(trySilentAiPrewarm, 1200);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}