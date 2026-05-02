// 与 content.js 同页共享全局；manifest 中须先于 content-switcher/* 加载 content.js（修饰键/API 弹窗等）。
// ─── Tab Switcher Overlay — 01 状态、工具函数、域名分组与行内图标 ───────────────────

/** MV3 background 休眠/唤醒后 sendMessage 可能失败；走 content.js 的重试封装 */
function ysSendToBg(payload, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (typeof window.__ysRuntimeSendMessageRetry === 'function') {
        window.__ysRuntimeSendMessageRetry(payload, opts || {}, cb);
    } else {
        chrome.runtime.sendMessage(payload, (res) => {
            const err = chrome.runtime.lastError;
            cb(res, err ? err.message : null);
        });
    }
}

let switcherVisible  = false;
let switcherTabs     = [];
let switcherSelIdx   = 0;
let switcherCurrentWindowId = null;
let switcherKeydownHandler = null;
let switcherMouseMoveHandler = null;
/** 使用方向键导航后，忽略鼠标 hover 对行高亮/favicon/关闭钮的影响，仅随键盘选中行变化 */
let switcherKeyboardNavActive = false;
/** 当前面板会话：暴露给委托事件用来「原地删行」，避免关一个标签就整块重建面板 */
let currentSwitcherSession = null;
/** tabId -> AI 分类文案 */
/** domain -> AI 提取的网站名称 */
let domainToSiteNameMap = {};
/** tabId -> AI 生成的页面功能标签 */
let tabPageLabelMap = {};

/** 同一二级域名下多子品牌（如 music.163.com / news.163.com）时，左侧分组统一用母品牌名与 favicon */
const GROUP_DOMAIN_BRANDING = {
    '163.com': {
        displayName: '网易',
        iconUrl: 'https://www.163.com/favicon.ico',
    },
};

function getTabDomainKey(tab) {
    let domain = '本地网页/其他';
    try {
        if (tab.url && tab.url.startsWith('http')) {
            const url = new URL(tab.url);
            const parts = url.hostname.split('.');
            domain = parts.length >= 2 ? parts.slice(-2).join('.') : url.hostname;
        }
    } catch (e) {}
    return domain;
}

/**
 * Unicode 附加符折叠：把 ć→c、å→a、é→e、ñ→n 等带变音符的拉丁字母拍平成基础字母。
 * 原理：NFD 先把 "ć" 拆成 "c" + U+0301（组合锐音符），再用正则删掉所有组合符号区间 U+0300–U+036F。
 * 用途：让 AI 输出的 "jokic" 也能匹到标题里的 "Jokić"；同理 håland/haland、dončić/doncic、pokémon/pokemon。
 */
function foldDiacritics(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * AI 搜索用的"带词边界"子串命中判断。
 * - 含中日韩等非 ASCII 字符 → 走普通 includes（中文字之间没有 \b，再强边界会误杀）。
 * - 纯 ASCII 关键词 → 要求命中处前后两侧都不是 [a-z0-9]，这样才能过滤掉 base64 尾巴里偶然撞到的短词。
 * 注：调用方需提前对 haystack / kw 统一做过 foldDiacritics + toLowerCase，这里不再重复处理。
 */
function matchesAiKeywordInString(haystack, kw) {
    if (!kw) return false;
    if (/[^\x00-\x7f]/.test(kw)) return haystack.indexOf(kw) >= 0;
    const len = kw.length;
    let from = 0;
    for (;;) {
        const idx = haystack.indexOf(kw, from);
        if (idx < 0) return false;
        const left = idx === 0 ? '' : haystack[idx - 1];
        const rightPos = idx + len;
        const right = rightPos >= haystack.length ? '' : haystack[rightPos];
        const leftOk = !left || !/[a-z0-9]/i.test(left);
        const rightOk = !right || !/[a-z0-9]/i.test(right);
        if (leftOk && rightOk) return true;
        from = idx + 1;
    }
}

const TAB_ROW_ICON_VISIBLE_OPACITY = '0.7';

/** 需在 00-i18n 加载后调用（面板打开时） */
function ysSwitcherPlaceholderDefault() {
    return typeof ysT === 'function' ? ysT('searchPlaceholder') : 'Search titles, URLs, or domains...';
}
function ysSwitcherPlaceholderWeb() {
    return typeof ysT === 'function' ? ysT('webSearchPlaceholder') : '';
}
const WEB_SUGGESTION_SELECTED_BG = 'rgba(80, 110, 220, 0.1)';

/** 键盘/鼠标共用的「选中行」背景（与当前页蓝底区分） */
const TAB_ROW_SELECTED_BG = 'var(--ys-btn-hover)';
/** 当前窗口内正在浏览的标签行（未处于键盘选中态时） */
const TAB_ROW_ACTIVE_BG = 'var(--ys-accent-bg)';
/** 其他窗口内正在浏览的标签行（非选中态） */
const TAB_ROW_OTHER_ACTIVE_BG = 'var(--ys-btn-bg)';
/** 其他窗口当前页标题色（弱化，不与主窗口争抢视觉） */
const TAB_ROW_OTHER_ACTIVE_TITLE_COLOR = 'var(--ys-text-secondary)';

/** 行内 favicon：键盘选中、鼠标悬停（未进入纯键盘模式时），或当前窗口当前页时显示 */
function refreshTabRowIconVis(itemEl) {
    if (!itemEl) return;
    const slot = itemEl.querySelector('.ys-tab-icon-slot');
    if (!slot || !slot.childNodes.length) return;
    const hoverShows = !switcherKeyboardNavActive && itemEl.matches(':hover');
    const show = itemEl.dataset.selected === 'true'
        || hoverShows
        || itemEl.dataset.activeInSourceWindow === 'true'
        || itemEl.dataset.isActiveInItsWindow === 'true';
    slot.style.opacity = show ? TAB_ROW_ICON_VISIBLE_OPACITY : '0';
}

/** 方向键切换后刷新所有行，清除仍停留在鼠标下的 hover 态（favicon/关闭钮） */
function refreshAllSwitcherRowsUi() {
    document.querySelectorAll('[id^="ys-tab-item-"]').forEach((item) => {
        refreshTabRowIconVis(item);
        const closeBtn = item.querySelector('.ys-close-btn');
        if (!closeBtn) return;
        if (switcherKeyboardNavActive) {
            const sel = item.dataset.selected === 'true';
            if (sel && item.matches(':hover')) {
                closeBtn.style.opacity = '1';
                closeBtn.style.pointerEvents = 'auto';
            } else {
                closeBtn.style.opacity = '0';
                closeBtn.style.pointerEvents = 'none';
            }
        }
    });
}

/** Chrome 内置页等常不提供 favIconUrl；悬停时用 emoji 兜底，避免「有 hover 无图标」 */
function getTabRowIconFallback(tab) {
    const u = String(tab.url || '');
    if (u.startsWith('chrome://extensions')) return '🧩';
    if (/^chrome:\/\/newtab/i.test(u)) return '📄';
    if (u.startsWith('chrome://downloads')) return '⬇️';
    if (u.startsWith('chrome://settings')) return '⚙️';
    if (u.startsWith('chrome://')) return '🔧';
    if (u.startsWith('edge://')) return '🔧';
    if (u.startsWith('about:')) return '📄';
    if (u.startsWith('chrome-extension://')) return '🧩';
    return '🌐';
}

/** 使用扩展内置 _favicon API 绕过站点 CSP 对跨域 favicon 的拦截。 */
function buildExtensionFaviconUrl(pageUrl, size = 64) {
    const u = String(pageUrl || '');
    if (!/^https?:\/\//i.test(u)) return '';
    try {
        return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(u)}&size=${size}`;
    } catch (_) {
        return '';
    }
}

function resolveTabIconUrl(tab, size = 64) {
    // Retina 屏优先请求大图，再由 CSS 压到展示尺寸，避免 14/16px 低分辨率源图发糊。
    const requestedSize = Math.max(64, Number(size) || 0);
    const extFavicon = buildExtensionFaviconUrl(tab && tab.url, requestedSize);
    if (extFavicon) return extFavicon;
    return String((tab && tab.favIconUrl) || '');
}

// 工具函数：按域名对 Tab 进行分组
function groupTabsByDomain(tabs) {
    const groups = [];
    const domainMap = new Map();

    tabs.forEach((tab, i) => {
        const domain = getTabDomainKey(tab);
        const brand = GROUP_DOMAIN_BRANDING[domain];

        if (!domainMap.has(domain)) {
            const newGroup = {
                domain,
                icon: brand?.iconUrl || resolveTabIconUrl(tab, 64) || '',
                displayNameOverride: brand?.displayName || null,
                tabs: [],
            };
            domainMap.set(domain, newGroup);
            groups.push(newGroup);
        }

        const group = domainMap.get(domain);
        const fallbackIcon = resolveTabIconUrl(tab, 64);
        if (!brand && !group.icon && fallbackIcon) group.icon = fallbackIcon;

        group.tabs.push({ ...tab, originalIndex: i });
    });
    return groups;
}

