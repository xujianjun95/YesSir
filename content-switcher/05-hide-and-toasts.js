// ─── 05 关闭面板、初始高亮、聚合进度条与通用 Toast（依赖 02 的 updateSwitcherSelection）──────

/**
 * @param {{ immediate?: boolean }} [opts]
 * immediate：立即从 DOM 移除（用于 showSwitcher 换肤/换语言等「马上建新面板」场景，避免与旧 DOM 共存的重复 id，导致 focus/Tab 绑到错误节点）
 */
function hideSwitcher(opts) {
    const immediate = !!(opts && opts.immediate);
    const wasVisible = switcherVisible;
    switcherVisible = false;
    switcherTabs    = [];
    switcherCurrentWindowId = null;
    currentSwitcherSession = null;
    window.__ysRefreshCategoryBar = null;
    window.__ysRemovePinnedTab    = null;
    // 告诉后台本 tab 不再需要 refresh_category_bar 广播
    if (wasVisible) {
        try { chrome.runtime.sendMessage({ action: 'switcher_closed' }, () => void chrome.runtime.lastError); }
        catch (_) {}
    }
    if (switcherKeydownHandler) {
        document.removeEventListener('keydown', switcherKeydownHandler, true);
        switcherKeydownHandler = null;
    }
    if (switcherMouseMoveHandler) {
        document.removeEventListener('mousemove', switcherMouseMoveHandler, true);
        switcherMouseMoveHandler = null;
    }

    const overlay = document.getElementById('ys-switcher-overlay');
    if (!overlay) return;
    const card = document.getElementById('ys-switcher-card');

    if (immediate) {
        overlay.remove();
        return;
    }

    overlay.style.opacity = '0';
    if (card) card.style.transform = 'scale(0.93) translateY(6px)';
    setTimeout(() => overlay.remove(), 160);
}

function initSwitcherHighlight() {
    requestAnimationFrame(() => {
        updateSwitcherSelection(switcherSelIdx);
    });
}

/** AI 聚合等耗时操作：Emoji 每秒轮播 + 左右挤开过渡，返回关闭函数 */
function showProcessingToast(count) {
    const existed = document.getElementById('ys-processing-toast');
    if (existed) existed.remove();

    const emojis = ['🫡', '🤔', '⏳', '🔍', '🪄', '⚙️', '🚀', '🧠', '🧩', '✨'];
    let emojiIdx = 0;
    const SLIDE_PX = 14;
    const OUT_MS = 200;
    const IN_MS = 260;

    const toast = document.createElement('div');
    toast.id = 'ys-processing-toast';
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '9px 18px',
        maxWidth: 'min(92vw, 440px)',
        background: 'var(--ys-card-bg, rgba(250, 252, 255, 0.9))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--ys-card-border, rgba(255, 255, 255, 0.52))',
        borderRadius: '10px',
        color: 'var(--ys-text-primary, rgba(40, 50, 70, 0.95))',
        fontSize: '13px',
        fontWeight: '600',
        letterSpacing: '0.01em',
        boxShadow: 'var(--ys-card-shadow, 0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8))',
        zIndex: '2147483647',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity 0.22s ease-in-out',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxSizing: 'border-box',
        lineHeight: '1.45',
    });

    const emojiSlot = document.createElement('span');
    Object.assign(emojiSlot.style, {
        overflow: 'hidden',
        width: '28px',
        height: '1.35em',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: '0',
    });

    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'ys-processing-emoji';
    Object.assign(emojiSpan.style, {
        display: 'inline-block',
        fontSize: '15px',
        lineHeight: '1.2',
        transform: 'translateX(0)',
        opacity: '1',
        transition: `transform ${OUT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${OUT_MS}ms ease`,
        willChange: 'transform, opacity',
    });
    emojiSpan.textContent = emojis[0];
    emojiSlot.appendChild(emojiSpan);

    const textSpan = document.createElement('span');
    textSpan.textContent = ysT('processingGroupingTabs', [String(count)]);

    toast.appendChild(emojiSlot);
    toast.appendChild(textSpan);
    document.body.appendChild(toast);

    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    function swapEmoji() {
        if (!emojiSpan.isConnected) return;
        emojiIdx = (emojiIdx + 1) % emojis.length;
        const next = emojis[emojiIdx];

        emojiSpan.style.transition = `transform ${OUT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${OUT_MS}ms ease`;
        emojiSpan.style.transform = `translateX(-${SLIDE_PX}px)`;
        emojiSpan.style.opacity = '0';

        setTimeout(() => {
            if (!emojiSpan.isConnected) return;
            emojiSpan.textContent = next;
            emojiSpan.style.transition = 'none';
            emojiSpan.style.transform = `translateX(${SLIDE_PX}px)`;
            emojiSpan.style.opacity = '0';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!emojiSpan.isConnected) return;
                    emojiSpan.style.transition = `transform ${IN_MS}ms cubic-bezier(0.22, 1.1, 0.36, 1), opacity ${IN_MS * 0.85}ms ease`;
                    emojiSpan.style.transform = 'translateX(0)';
                    emojiSpan.style.opacity = '1';
                });
            });
        }, OUT_MS);
    }

    const intervalId = setInterval(swapEmoji, 2000);

    return function closeProcessingToast() {
        clearInterval(intervalId);
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.isConnected) toast.remove();
        }, 220);
    };
}

/** 结果提示：与 content.js 的 showYsMessageToast 同款毛玻璃样式，避免三套视觉 */
function showCustomToast(msg, durationMs = 3000) {
    if (typeof showYsMessageToast === 'function') {
        showYsMessageToast(msg, durationMs);
    }
}
