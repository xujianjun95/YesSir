// 与 content.js 同页共享全局；manifest 中须先于本文件加载 content.js（修饰键/API 弹窗等）。
// ─── Tab Switcher Overlay (Kanban View) ───────────────────────────────────────

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

/** 键盘/鼠标共用的「选中行」背景（与当前页蓝底区分） */
const TAB_ROW_SELECTED_BG = 'rgba(130, 140, 160, 0.14)';
/** 当前窗口内正在浏览的标签行（未处于键盘选中态时） */
const TAB_ROW_ACTIVE_BG = 'rgba(80, 110, 220, 0.12)';

/** 行内 favicon：键盘选中、鼠标悬停（未进入纯键盘模式时），或当前窗口当前页时显示 */
function refreshTabRowIconVis(itemEl) {
    if (!itemEl) return;
    const slot = itemEl.querySelector('.ys-tab-icon-slot');
    if (!slot || !slot.childNodes.length) return;
    const hoverShows = !switcherKeyboardNavActive && itemEl.matches(':hover');
    const show = itemEl.dataset.selected === 'true'
        || hoverShows
        || itemEl.dataset.activeInSourceWindow === 'true';
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
                icon: brand?.iconUrl || tab.favIconUrl || '',
                displayNameOverride: brand?.displayName || null,
                tabs: [],
            };
            domainMap.set(domain, newGroup);
            groups.push(newGroup);
        }

        const group = domainMap.get(domain);
        if (!brand && !group.icon && tab.favIconUrl) group.icon = tab.favIconUrl;

        group.tabs.push({ ...tab, originalIndex: i });
    });
    return groups;
}

function showSwitcher(tabs, isRefresh = false, currentWindowId = null) {
    let savedScrollTop = 0;
    const oldList = document.getElementById('ys-switcher-list');
    const oldSearch = document.getElementById('ys-search-input');
    const preservedKeyword = isRefresh && oldSearch ? oldSearch.value : '';
    if (isRefresh && oldList) {
        savedScrollTop = oldList.scrollTop;
    }

    hideSwitcher();
    // 接管成本地可变数组：后续关闭单个标签时可直接 splice + 重绘，无需整块重建面板
    tabs = tabs.slice();
    switcherCurrentWindowId = currentWindowId;
    switcherTabs = tabs.slice();
    switcherSelIdx = 0;
    switcherKeyboardNavActive = false;
    switcherVisible = true;
    if (!isRefresh) {
        tabPageLabelMap = {};
    }

    const overlay = document.createElement('div');
    overlay.id = 'ys-switcher-overlay';
    Object.assign(overlay.style, {
        position:       'fixed',
        inset:          '0',
        zIndex:         '2147483646',
        display:        'flex',
        alignItems:     'flex-start',
        justifyContent: 'center',
        paddingTop:     'max(8vh, 56px)',
        boxSizing:      'border-box',
        background:     'rgba(160, 175, 200, 0.16)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        opacity:        '0',
        transition:     'opacity 0.15s ease',
        pointerEvents:  'auto',
        fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hideSwitcher();
    });
    
    overlay.addEventListener('wheel', (e) => {
        const listContainer = document.getElementById('ys-switcher-list');
        if (!listContainer || !listContainer.contains(e.target)) {
            e.preventDefault();
        }
    }, { passive: false });

    const card = document.createElement('div');
    card.id = 'ys-switcher-card';
    Object.assign(card.style, {
        background:     'rgba(248, 248, 246, 0.46)',
        backdropFilter: 'saturate(180%) blur(32px)',
        WebkitBackdropFilter: 'saturate(180%) blur(32px)',
        border:         '1px solid rgba(255, 255, 255, 0.52)',
        borderRadius:   '20px',
        boxShadow:      '0 24px 64px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.6)',
        width:          '580px',
        maxHeight:      '65vh',
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        transform:      'scale(0.93) translateY(6px)',
        transition:     'transform 0.18s cubic-bezier(0.34,1.3,0.64,1)',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
        padding:        '16px 20px',
        display:        'flex',
        flexDirection:  'column',
        gap:            '14px',
        borderBottom:   '1px solid rgba(0, 0, 0, 0.05)',
        flexShrink:     '0',
    });

    header.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; min-height:28px;">
        <span style="font-size:14px;font-weight:700;color:rgba(40,50,70,0.95);letter-spacing:0.02em;white-space:nowrap;flex-shrink:0;">「🫡 Yes Sir」标签页管理</span>
        
        <div id="ys-top-actions" style="display:flex; gap:8px; position:relative; align-items:center;"></div>
      </div>

      <div style="position:relative;">
        <input id="ys-search-input" type="text" placeholder="搜索标题、URL 或域名..." style="
          width:100%; padding:9px 12px 9px 34px; border-radius:10px;
          border:1px solid rgba(255, 255, 255, 0.65); background:rgba(255, 255, 255, 0.25);
          font-size:13px; color:rgba(40, 50, 70, 0.9); outline:none;
          box-shadow:inset 0 1px 2px rgba(0,0,0,0.02), 0 1px 3px rgba(0,0,0,0.02); transition:all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
          box-sizing:border-box;
        ">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);">
          <circle cx="7" cy="7" r="5" stroke="rgba(120, 130, 150, 0.6)" stroke-width="1.5"/>
          <path d="M11 11L14 14" stroke="rgba(120, 130, 150, 0.6)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>`;

    const topActions = header.querySelector('#ys-top-actions');

    function createFluidButton(id, emoji, label, colors, titleAttr, opts = {}) {
        const btn = document.createElement('div');
        btn.id = id;
        btn.classList.add('ys-fluid-btn');
        btn.dataset.selected = 'false';
        btn.dataset.lockExpanded = opts.lockExpanded ? 'true' : 'false';
        btn.title = titleAttr || label;
        btn.fluidColors = colors;

        function collapseFluidEl(el) {
            const c = el.fluidColors;
            if (!c) return;
            el.style.maxWidth = '28px';
            el.style.padding = '0 6px';
            el.style.background = c.defaultBg;
            const t = el.querySelector('.ys-btn-text');
            if (t) t.style.opacity = '0';
        }

        function applyFluidExpanded() {
            btn.style.maxWidth = '100px';
            btn.style.padding = '0 10px';
            btn.style.background = colors.hoverBg;
            const t = btn.querySelector('.ys-btn-text');
            if (t) t.style.opacity = '1';
        }

        Object.assign(btn.style, {
            display: 'flex',
            alignItems: 'center',
            height: '28px',
            padding: '0 6px',
            background: colors.defaultBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            cursor: 'pointer',
            boxSizing: 'border-box',
            overflow: 'hidden',
            maxWidth: '28px',
            transition: 'max-width 0.62s cubic-bezier(0.25, 1, 0.5, 1), background 0.32s ease, padding 0.62s cubic-bezier(0.25, 1, 0.5, 1)',
            flexShrink: '0',
        });
        btn.innerHTML = `
            <span style="font-size:12px; flex-shrink:0; width:14px; display:flex; justify-content:center;">${emoji}</span>
            <span class="ys-btn-text" style="font-size:11px; font-weight:600; color:${colors.text}; margin-left:6px; opacity:0; transition:opacity 0.48s ease; white-space:nowrap; pointer-events:none;">${label}</span>
        `;

        btn.addEventListener('mouseenter', () => {
            applyFluidExpanded();
        });

        btn.addEventListener('mouseleave', () => {
            if (btn.dataset.lockExpanded === 'true') return;
            if (btn.dataset.selected === 'true') return;
            collapseFluidEl(btn);
        });

        // 捕获阶段：先切换「钉住展开」状态，再执行业务 click
        btn.addEventListener('click', () => {
            if (btn.dataset.lockExpanded === 'true') {
                applyFluidExpanded();
                return;
            }
            const isSelected = btn.dataset.selected === 'true';
            const next = !isSelected;
            btn.dataset.selected = next ? 'true' : 'false';

            if (next) {
                const parent = btn.parentElement;
                if (parent) {
                    parent.querySelectorAll('.ys-fluid-btn').forEach((el) => {
                        if (el !== btn && el.dataset.selected === 'true' && el.dataset.lockExpanded !== 'true') {
                            el.dataset.selected = 'false';
                            collapseFluidEl(el);
                        }
                    });
                }
                applyFluidExpanded();
            }
            // 取消选中时不立刻收缩：若仍在 hover，由 mouseenter 已保持展开；移出后由 mouseleave 收缩
        }, true);

        if (btn.dataset.lockExpanded === 'true') {
            applyFluidExpanded();
        }

        return btn;
    }

    // 1. AI 聚合 (核心功能：🤖 全息青绿)
    const aiGroupBtn = createFluidButton('ys-ai-group-btn', '🤖', 'AI 聚合', {
        defaultBg: 'rgba(0, 180, 200, 0.12)',
        hoverBg: 'rgba(0, 180, 200, 0.18)',
        border: 'rgba(0, 180, 200, 0.25)',
        text: 'rgba(10, 150, 170, 0.95)',
    }, 'AI 智能聚类：仅在当前窗口内按子主题创建标签组', { lockExpanded: true });

    const regretBtn = createFluidButton('ys-regret-btn', '💊', '后悔药', {
        defaultBg: 'rgba(0, 0, 0, 0.04)',
        hoverBg: 'rgba(0, 0, 0, 0.08)',
        border: 'rgba(0, 0, 0, 0.06)',
        text: 'rgba(80, 90, 110, 0.9)',
    }, '重新打开最近关闭的3个标签页');

    const settingsBtn = createFluidButton('ys-main-settings-btn', '⚙️', '设置', {
        defaultBg: 'rgba(0, 0, 0, 0.04)',
        hoverBg: 'rgba(0, 0, 0, 0.08)',
        border: 'rgba(0, 0, 0, 0.06)',
        text: 'rgba(80, 90, 110, 0.9)',
    }, '设置');

    topActions.appendChild(aiGroupBtn);
    topActions.appendChild(regretBtn);
    topActions.appendChild(settingsBtn);

    aiGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        let tabsToProcess = switcherTabs.filter((t) => t.url && /^https?:\/\//i.test(t.url));
        if (switcherCurrentWindowId !== null && switcherCurrentWindowId !== undefined) {
            const wid = Number(switcherCurrentWindowId);
            tabsToProcess = tabsToProcess.filter((t) => Number(t.windowId) === wid);
        }
        if (tabsToProcess.length === 0) {
            showYsMessageToast('当前窗口没有可聚合的 http(s) 标签页', 2800);
            return;
        }

        const finishProcessing = showProcessingToast(tabsToProcess.length);
        ysSendToBg({
            action: 'ai_batch_group',
            tabs: tabsToProcess,
            windowId: switcherCurrentWindowId,
        }, { maxRetries: 2 }, (res, err) => {
            finishProcessing();

            if (err) {
                showCustomToast('聚合失败：' + err, 4000);
                return;
            }
            if (res && res.success) {
                showCustomToast(`✅ 整理完毕，已为您创建 ${res.groupCount} 个标签组`, 3200);
                setTimeout(() => hideSwitcher(), 1500);
            } else {
                let hint = '聚合未完成';
                if (res && res.error === 'no_api_key') hint = '请先在设置中配置 DeepSeek API Key';
                else if (res && res.error === 'rate_limit' && res.message) {
                    showCustomToast(res.message, 5200);
                    return;
                } else if (res && res.message) {
                    hint = res.message;
                    if (/failed to fetch|networkerror|load failed/i.test(hint)) {
                        hint = '网络无法连接 DeepSeek（api.deepseek.com）。请检查网络/代理，或在扩展页重新加载本扩展后再试。';
                    }
                } else if (res && res.error === 'parse_failed') hint = 'AI 返回格式异常，请重试';
                else if (res && res.error === 'no_http_tabs') hint = '没有可聚合的页面';
                showCustomToast('⚠️ ' + hint, 5500);
            }
        });
    });

    regretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ysSendToBg({ action: 'restore_last_3_tabs' }, {}, (res, err) => {
            if (err) return;
            if (res && res.success) {
                hideSwitcher();
            } else {
                regretBtn.style.borderColor = 'rgba(255, 100, 100, 0.3)';
                setTimeout(() => {
                    regretBtn.style.borderColor = 'rgba(0, 0, 0, 0.06)';
                }, 500);
            }
        });
    });

    // 设置按钮点击事件
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        let menu = document.getElementById('ys-settings-dropdown');
        if (menu) { menu.remove(); return; }

        menu = document.createElement('div');
        menu.id = 'ys-settings-dropdown';
        Object.assign(menu.style, {
            position: 'absolute', top: '36px', right: '0', background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.8)', boxShadow: '0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)',
            borderRadius: '10px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', zIndex: '100', minWidth: '150px'
        });

        // 统一的菜单项工厂函数
        const createItem = (icon, text, onClick, isToggle = false) => {
            const item = document.createElement('div');
            Object.assign(item.style, {
                padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', transition: 'background 0.15s',
                whiteSpace: 'nowrap',
                overflow: 'hidden'
            });
            item.innerHTML = `<span style="margin-right:8px;font-size:13px;flex-shrink:0;">${icon}</span><span style="font-size:12px;font-weight:600;color:rgba(50,60,80,0.9);white-space:nowrap;">${text}</span>`;

            item.addEventListener('mouseenter', () => item.style.background = 'rgba(80, 110, 220, 0.08)');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!isToggle) menu.remove();
                onClick(item);
            });
            return item;
        };

        // 先获取浮窗状态，确保渲染顺序
        chrome.storage.local.get({ showFloatingWidget: true }, (res) => {
            // 1. 修饰键设置
            menu.appendChild(createItem('⌨️', '修饰键设置', showModifierSettingsModal));

            // 2. API Key 设置
            menu.appendChild(createItem('🔑', 'API Key 设置', showApiKeyModal));

            // 3. 统计浮窗开关 (放到最下面)
            const isEnabled = res.showFloatingWidget !== false;
            const floatToggle = createItem(
                isEnabled ? '🟢' : '⚪',
                `统计浮窗：${isEnabled ? '开启' : '关闭'}`,
                (itemEl) => {
                    chrome.storage.local.get({ showFloatingWidget: true }, (r) => {
                        const nextState = r.showFloatingWidget === false;
                        chrome.storage.local.set({ showFloatingWidget: nextState }, () => {
                            itemEl.querySelector('span:first-child').innerText = nextState ? '🟢' : '⚪';
                            itemEl.querySelector('span:last-child').innerText = `统计浮窗：${nextState ? '开启' : '关闭'}`;
                        });
                    });
                },
                true
            );
            menu.appendChild(floatToggle);
        });

        document.getElementById('ys-top-actions').appendChild(menu);

        // 点击外部关闭菜单
        const closeMenu = (ev) => {
            if (!menu.contains(ev.target) && ev.target.closest('#ys-main-settings-btn') === null) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });

    const listContainer = document.createElement('div');
    listContainer.id = 'ys-switcher-list';
    Object.assign(listContainer.style, {
        overflowY:  'auto',
        padding:    '0 20px',
        flexGrow:   '1',
        scrollbarWidth: 'none',
        overscrollBehavior: 'contain',
        display:    'flex',
        flexDirection: 'column',
        gap:        '0',
    });

    // ─── 事件委托：所有 tab 行的 hover/click/关闭，统一在 listContainer 上处理 ───
    // mouseenter/mouseleave 不冒泡，用 mouseover/mouseout + relatedTarget 模拟
    let currentHoverItem = null;

    const rowOfEventTarget = (target) => {
        if (!target || !target.closest) return null;
        const item = target.closest('[id^="ys-tab-item-"]');
        return (item && listContainer.contains(item)) ? item : null;
    };

    const setRowHoverOn = (item) => {
        const closeBtn = item.querySelector('.ys-close-btn');
        if (closeBtn) {
            const showClose = !switcherKeyboardNavActive || item.dataset.selected === 'true';
            closeBtn.style.opacity = showClose ? '1' : '0';
            closeBtn.style.pointerEvents = showClose ? 'auto' : 'none';
        }
        refreshTabRowIconVis(item);
        if (!switcherKeyboardNavActive && item.dataset.selected !== 'true') {
            const idx = Number(item.dataset.globalIdx);
            if (Number.isFinite(idx)) updateSwitcherSelection(idx);
        }
    };

    const setRowHoverOff = (item) => {
        const closeBtn = item.querySelector('.ys-close-btn');
        if (closeBtn) {
            closeBtn.style.opacity = '0';
            closeBtn.style.pointerEvents = 'none';
        }
        refreshTabRowIconVis(item);
        if (item.dataset.selected !== 'true') {
            item.style.background = getUnselectedItemBackground(item);
        }
    };

    listContainer.addEventListener('mouseover', (e) => {
        const item = rowOfEventTarget(e.target);
        if (!item || item === currentHoverItem) return;
        if (currentHoverItem) setRowHoverOff(currentHoverItem);
        currentHoverItem = item;
        setRowHoverOn(item);
    });

    listContainer.addEventListener('mouseout', (e) => {
        const item = rowOfEventTarget(e.target);
        if (!item || item !== currentHoverItem) return;
        const next = e.relatedTarget;
        if (next && item.contains(next)) return;
        setRowHoverOff(item);
        currentHoverItem = null;
    });

    listContainer.addEventListener('click', (e) => {
        const item = rowOfEventTarget(e.target);
        if (!item) return;
        const tabId = Number(item.dataset.tabId);
        if (!Number.isFinite(tabId)) return;

        const closeTarget = e.target.closest && e.target.closest('.ys-close-btn');
        if (closeTarget && item.contains(closeTarget)) {
            e.stopPropagation();
            // 先「乐观地」把当前行在面板里移除：立即视觉反馈，无闪烁、滚动位置不变
            const session = currentSwitcherSession;
            if (session) session.removeTabById(tabId);
            ysSendToBg({ action: 'close_tab_by_id', tabId }, {}, (res, err) => {
                if (err) return;
                // 真实关闭失败则回滚：重新拉一次真实 tabs 重建面板（极少见场景）
                if (!res || !res.success) {
                    ysSendToBg({ action: 'get_tabs' }, {}, (res2, err2) => {
                        if (err2) return;
                        if (res2 && res2.tabs && res2.tabs.length > 0) {
                            showSwitcher(res2.tabs, true, res2.currentWindowId);
                            initSwitcherHighlight();
                        } else {
                            hideSwitcher();
                        }
                    });
                }
            });
            return;
        }

        e.stopPropagation();
        const winIdRaw = item.dataset.windowId;
        if (winIdRaw) {
            const windowId = Number(winIdRaw);
            if (Number.isFinite(windowId)) {
                chrome.runtime.sendMessage({ action: 'switch_tab_global', tabId, windowId });
            } else {
                chrome.runtime.sendMessage({ action: 'switch_tab', tabId });
            }
        } else {
            chrome.runtime.sendMessage({ action: 'switch_tab', tabId });
        }
        hideSwitcher();
    });

    const CARD_OPEN_TRANSITION = 'transform 0.18s cubic-bezier(0.34,1.3,0.64,1)';
    const CARD_HEIGHT_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
    let cardHeightAnimToken = 0;
    let aiSearchToken = 0;          // 用于取消过时的 AI 搜索回调
    let aiSearchDebounceTimer = null; // 防止用户连续输入时发出多余请求
    let aiEmptyStateEmojiCleanup = null;
    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const stopAiEmptyStateEmojiLoop = () => {
        if (typeof aiEmptyStateEmojiCleanup === 'function') {
            aiEmptyStateEmojiCleanup();
            aiEmptyStateEmojiCleanup = null;
        }
    };
    const mountSlidingEmojiLoop = (host, emojis, intervalMs = 2000) => {
        if (!host || !Array.isArray(emojis) || emojis.length === 0) return () => {};
        const SLIDE_PX = 14;
        const OUT_MS = 200;
        const IN_MS = 260;
        let idx = 0;

        const emojiSpan = document.createElement('span');
        Object.assign(emojiSpan.style, {
            display: 'inline-block',
            fontSize: '20px',
            lineHeight: '1',
            transform: 'translateX(0)',
            opacity: '1',
            transition: `transform ${OUT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${OUT_MS}ms ease`,
            willChange: 'transform, opacity',
        });
        emojiSpan.textContent = emojis[0];
        host.appendChild(emojiSpan);

        const swapEmoji = () => {
            if (!emojiSpan.isConnected) return;
            idx = (idx + 1) % emojis.length;
            const next = emojis[idx];

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
        };

        const intervalId = setInterval(() => {
            if (!emojiSpan.isConnected) {
                clearInterval(intervalId);
                return;
            }
            swapEmoji();
        }, intervalMs);

        return () => clearInterval(intervalId);
    };
    const invalidateAiSearch = () => {
        aiSearchToken += 1;
        if (aiSearchDebounceTimer) {
            clearTimeout(aiSearchDebounceTimer);
            aiSearchDebounceTimer = null;
        }
    };
    const getDefaultSelectedIdx = (items) => {
        const activeInCurrent = items.findIndex(t => t.active && switcherCurrentWindowId !== null && t.windowId === switcherCurrentWindowId);
        if (activeInCurrent >= 0) return activeInCurrent;
        const activeAny = items.findIndex(t => t.active);
        return activeAny >= 0 ? activeAny : -1;
    };

    function renderList(filterText = '', opts = {}) {
        const shouldRestoreScroll = !!opts.restoreScroll;
        const shouldPreferActive = !!opts.preferActive;
        const shouldAnimate = !!opts.animate;
        const explicitRestoreScrollTop = Number.isFinite(opts.scrollTop) ? opts.scrollTop : null;
        const prevScrollTop = listContainer.scrollTop;
        // AI 搜索模式：由上一轮 AI 请求返回的关键词数组；存在时用多词 OR 匹配取代单一关键词匹配
        const aiKeywords = Array.isArray(opts.aiKeywords)
            ? opts.aiKeywords.map((kw) => String(kw).trim().toLowerCase()).filter(Boolean).slice(0, 5)
            : null;
        if (!aiKeywords) invalidateAiSearch();

        function rebuildListDOM() {
        stopAiEmptyStateEmojiLoop();
        listContainer.innerHTML = '';

        const keyword = filterText.trim().toLowerCase();

        // ── 过滤逻辑 ──────────────────────────────────────────────────────────
        let filteredTabs;
        if (aiKeywords) {
            // AI 模式：整条 URL 都参与匹配，尽量不漏；但英文关键词要求「词边界」命中，
            // 避免被 Google/电商 URL 尾巴里的 base64 乱码凑巧撞上。
            // 同时对 haystack 与 keyword 一起做 Unicode 附加符折叠：这样 AI 无论输出
            // "jokic" 还是 "jokić"，标题里是 "Jokić" 还是 "Jokic" 都能命中；覆盖约基奇、
            // 东契奇、哈兰德、pokémon 这类非英语系专有名词。
            const normalizedKws = aiKeywords
                .map((kw) => foldDiacritics(String(kw).toLowerCase()))
                .filter(Boolean);
            filteredTabs = tabs.filter((t) => {
                const title  = (t.title  || '').toLowerCase();
                const url    = (t.url    || '').toLowerCase();
                const domain = getTabDomainKey(t).toLowerCase();
                const siteName = (domainToSiteNameMap[domain] || '').toLowerCase();
                const searchStr = foldDiacritics(`${title} ${url} ${domain} ${siteName}`);
                return normalizedKws.some((kw) => matchesAiKeywordInString(searchStr, kw));
            });
        } else if (keyword) {
            filteredTabs = tabs.filter((t) => {
                const title  = (t.title  || '').toLowerCase();
                const url    = (t.url    || '').toLowerCase();
                const domain = getTabDomainKey(t).toLowerCase();
                const siteName = (domainToSiteNameMap[domain] || '').toLowerCase();
                return title.includes(keyword)
                    || url.includes(keyword)
                    || domain.includes(keyword)
                    || siteName.includes(keyword);
            });
        } else {
            filteredTabs = tabs.slice();
        }

        // ── 零结果处理 ────────────────────────────────────────────────────────
        if (filteredTabs.length === 0) {
            switcherTabs = [];
            switcherSelIdx = 0;

            // 本地无结果 + 有关键词 + 非 AI 结果模式 → 触发 AI 搜索
            if (keyword && !aiKeywords) {
                const myToken = ++aiSearchToken;
                const loadingWrap = document.createElement('div');
                Object.assign(loadingWrap.style, {
                    padding: '24px 20px',
                    textAlign: 'center',
                    color: 'rgba(100,110,130,0.6)',
                    fontSize: '12px',
                    lineHeight: '1.8',
                });
                const emojiSlot = document.createElement('div');
                Object.assign(emojiSlot.style, {
                    fontSize: '20px',
                    marginBottom: '8px',
                    minHeight: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                });
                const text = document.createElement('div');
                text.textContent = '💡 未找到精确匹配结果，已自动切换至 AI 模糊搜索...';
                loadingWrap.appendChild(emojiSlot);
                loadingWrap.appendChild(text);
                listContainer.appendChild(loadingWrap);
                aiEmptyStateEmojiCleanup = mountSlidingEmojiLoop(
                    emojiSlot,
                    ['✨', '🔍', '🧠', '🪄', '⚙️', '🚀', '🧩', '📡', '💫', '🌟'],
                    1000
                );

                clearTimeout(aiSearchDebounceTimer);
                aiSearchDebounceTimer = setTimeout(() => {
                    if (myToken !== aiSearchToken) return;
                    ysSendToBg({ action: 'ai_search_tabs', query: filterText }, {}, (res, err) => {
                        if (myToken !== aiSearchToken) return; // 用户已继续输入，丢弃
                        if (err || !res || !res.keywords || res.keywords.length === 0) {
                            const extra = (res && res.message)
                                ? `<div style="margin-top:10px;font-size:11px;color:rgba(180,100,60,0.92);line-height:1.55;text-align:left;max-width:280px;margin-left:auto;margin-right:auto;">${escapeHtml(res.message)}</div>`
                                : '';
                            const base = err
                                ? '无法连接扩展后台，请重试或重新加载扩展。'
                                : '未找到匹配的标签页';
                            listContainer.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(100,110,130,0.6);font-size:12px;">${base}${extra}</div>`;
                            return;
                        }
                        renderList(filterText, { restoreScroll: false, preferActive: false, animate: false, aiKeywords: res.keywords });
                    });
                }, 180);
            } else {
                if (aiKeywords) {
                    const noResultWrap = document.createElement('div');
                    Object.assign(noResultWrap.style, {
                        padding: '22px 20px',
                        textAlign: 'center',
                        color: 'rgba(100,110,130,0.6)',
                        fontSize: '12px',
                        lineHeight: '1.8',
                    });
                    const emoji = document.createElement('div');
                    emoji.textContent = '🤷‍♂️';
                    Object.assign(emoji.style, {
                        fontSize: '20px',
                        marginBottom: '8px',
                    });
                    const text = document.createElement('div');
                    text.innerHTML = `「🫡 Yes Sir」翻遍了所有角落，似乎没有关于「<b>${escapeHtml(filterText.trim())}</b>」的记录`;
                    noResultWrap.appendChild(emoji);
                    noResultWrap.appendChild(text);
                    listContainer.appendChild(noResultWrap);
                } else {
                    listContainer.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(100,110,130,0.6);font-size:12px;">未找到匹配的标签页</div>`;
                }
            }
            return;
        }

        // ── AI 搜索结果标记条 ─────────────────────────────────────────────────
        if (aiKeywords) {
            const banner = document.createElement('div');
            Object.assign(banner.style, {
                padding: '8px 6px 4px',
                fontSize: '11px',
                color: 'rgba(80, 120, 200, 0.65)',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                flexShrink: '0',
            });
            const label = document.createElement('span');
            label.textContent = '✨ AI 搜索';
            const dot = document.createElement('span');
            dot.textContent = '·';
            dot.style.opacity = '0.5';
            const terms = document.createElement('span');
            terms.style.fontWeight = '600';
            terms.textContent = aiKeywords.join(' / ');
            banner.appendChild(label);
            banner.appendChild(dot);
            banner.appendChild(terms);
            listContainer.appendChild(banner);
        }

        const groupedTabs = groupTabsByDomain(filteredTabs);
        const displayTabs = [];

        groupedTabs.forEach(group => {
            const groupRow = document.createElement('div');
            groupRow.className = 'ys-group-row';
            Object.assign(groupRow.style, {
                display: 'grid',
                gridTemplateColumns: '130px minmax(0, 1fr)',
                columnGap: '14px',
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 6px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(0, 0, 0, 0.03)',
                boxShadow: 'none',
            });

            const leftCol = document.createElement('div');
            leftCol.className = 'ys-group-left';
            Object.assign(leftCol.style, {
                minWidth: '0',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0',
                paddingTop: '9px',
                opacity: '1',
                transition: 'opacity 0.2s ease',
            });

            const domainRow = document.createElement('div');
            domainRow.className = 'ys-domain-row';
            Object.assign(domainRow.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
            });

            const iconDiv = document.createElement('div');
            Object.assign(iconDiv.style, {
                width: '18px', height: '18px', flexShrink: '0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(80, 110, 220, 0.12)', borderRadius: '4px',
                fontSize: '10px', fontWeight: 'bold', color: 'rgba(50, 70, 160, 0.9)'
            });
            if (group.icon) {
                const img = document.createElement('img');
                img.src = group.icon; img.width = 14; img.height = 14; img.style.borderRadius = '2px';
                img.onerror = () => {
                    img.remove();
                    if (group.domain === '本地网页/其他') {
                        iconDiv.textContent = '📄';
                        iconDiv.style.fontSize = '11px';
                    } else if (group.displayNameOverride) {
                        iconDiv.textContent = group.displayNameOverride.charAt(0);
                        iconDiv.style.fontSize = '11px';
                    } else {
                        iconDiv.textContent = group.domain[0].toUpperCase();
                    }
                };
                iconDiv.appendChild(img);
            } else if (group.domain === '本地网页/其他') {
                iconDiv.textContent = '📄';
                iconDiv.style.fontSize = '11px';
            } else {
                iconDiv.textContent = group.domain[0].toUpperCase();
            }

            const domainText = document.createElement('div');
            domainText.className = 'ys-domain-label';
            Object.assign(domainText.style, {
                flex: '1',
                minWidth: '0',
                fontSize: '13px', fontWeight: '500', color: 'rgba(50, 60, 80, 0.9)',
                lineHeight: '1.4',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            });
            const displayDomainName = group.displayNameOverride || domainToSiteNameMap[group.domain] || group.domain;
            domainText.textContent = displayDomainName;

            domainRow.appendChild(iconDiv);
            domainRow.appendChild(domainText);
            leftCol.appendChild(domainRow);

            const rightCol = document.createElement('div');
            Object.assign(rightCol.style, {
                minWidth: '0',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                paddingTop: '0',
                paddingBottom: '0',
            });

            group.tabs.forEach(tab => {
                const displayIdx = displayTabs.length;
                displayTabs.push(tab);
                buildTabItem(tab, displayIdx, rightCol);
            });

            groupRow.appendChild(leftCol);
            groupRow.appendChild(rightCol);
            listContainer.appendChild(groupRow);
        });

        switcherTabs = displayTabs;
        if (shouldPreferActive) {
            switcherSelIdx = getDefaultSelectedIdx(displayTabs);
        } else {
            switcherSelIdx = Math.max(0, Math.min(displayTabs.length - 1, switcherSelIdx));
        }
        initSwitcherHighlight();

        if (shouldRestoreScroll) {
            listContainer.scrollTop = explicitRestoreScrollTop !== null ? explicitRestoreScrollTop : prevScrollTop;
        } else {
            if (shouldPreferActive) {
                const pinnedToTop = scrollSelectedToTopIfNotLast();
                if (!pinnedToTop) {
                    // 当选中项无法置顶（例如它是最后一个）时，至少保证首屏可见。
                    ensureSelectedVisibleInViewport();
                    requestAnimationFrame(() => ensureSelectedVisibleInViewport());
                }
            } else {
                scrollToSelected(true);
            }
        }
        }

        const prevH = shouldAnimate ? card.offsetHeight : 0;
        rebuildListDOM();

        if (shouldAnimate) {
            const nextH = card.offsetHeight;
            if (Math.abs(prevH - nextH) > 1.5) {
                cardHeightAnimToken += 1;
                const token = cardHeightAnimToken;
                if (card._ysCardHeightOnEnd) {
                    card.removeEventListener('transitionend', card._ysCardHeightOnEnd);
                    card._ysCardHeightOnEnd = null;
                }
                card.style.transition = 'none';
                card.style.height = `${prevH}px`;
                void card.offsetHeight;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (token !== cardHeightAnimToken) return;
                        card.style.transition = `${CARD_OPEN_TRANSITION}, height 0.32s ${CARD_HEIGHT_EASE}`;
                        card.style.height = `${nextH}px`;
                    });
                });
                const onEnd = (e) => {
                    if (e.propertyName !== 'height') return;
                    if (token !== cardHeightAnimToken) return;
                    card.removeEventListener('transitionend', onEnd);
                    card._ysCardHeightOnEnd = null;
                    card.style.height = '';
                    card.style.transition = CARD_OPEN_TRANSITION;
                };
                card._ysCardHeightOnEnd = onEnd;
                card.addEventListener('transitionend', onEnd);
            }
        }
    }

    card.appendChild(header);
    card.appendChild(listContainer);

    const footer = document.createElement('div');
    Object.assign(footer.style, {
        padding: '12px 20px',
        background: 'rgba(0, 0, 0, 0.02)',
        borderTop: '1px solid rgba(0, 0, 0, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: '0',
        gap: '12px',
        minHeight: '44px',
        boxSizing: 'border-box',
    });

    ysSendToBg({ action: 'get_last_context' }, {}, (res, err) => {
        if (err) return;
        footer.replaceChildren();
        if (res && res.lastTab) {
            const lt = res.lastTab;
            const left = document.createElement('div');
            Object.assign(left.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: '0',
                flex: '1',
            });
            const lab = document.createElement('span');
            lab.textContent = '上一个标签页：';
            Object.assign(lab.style, {
                fontSize: '11px',
                color: 'rgba(100,110,130,0.6)',
                flexShrink: '0',
                whiteSpace: 'nowrap',
            });
            left.appendChild(lab);

            if (lt.favIconUrl) {
                const img = document.createElement('img');
                img.src = lt.favIconUrl;
                img.width = 14;
                img.height = 14;
                Object.assign(img.style, { borderRadius: '2px', flexShrink: '0' });
                img.onerror = () => { img.style.display = 'none'; };
                left.appendChild(img);
            }

            const titleEl = document.createElement('span');
            titleEl.textContent = lt.title || '(无标题)';
            Object.assign(titleEl.style, {
                fontSize: '12px',
                color: 'rgba(60,70,90,0.85)',
                fontWeight: '500',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: '0',
            });
            left.appendChild(titleEl);

            const hint = document.createElement('div');
            const modRaw = MOD_LABELS[modifierKey] || '';
            const modParts = String(modRaw).split(/\s+/);
            const modLabel = modParts.length > 1 ? modParts[modParts.length - 1] : modRaw;
            hint.textContent = `${modLabel} + E 快速切回`;
            Object.assign(hint.style, {
                fontSize: '11px',
                color: 'rgba(80,110,220,0.8)',
                fontWeight: '600',
                paddingLeft: '8px',
                whiteSpace: 'nowrap',
                flexShrink: '0',
            });

            footer.appendChild(left);
            footer.appendChild(hint);
        } else {
            const empty = document.createElement('div');
            empty.textContent = '随便切换个网页，这里就会记录你的上一个标签页啦 👇';
            Object.assign(empty.style, { fontSize: '11px', color: 'rgba(100,110,130,0.5)' });
            footer.appendChild(empty);
        }
    });

    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const searchInput = document.getElementById('ys-search-input');
    if (searchInput) {
        searchInput.value = preservedKeyword;
        searchInput.addEventListener('input', (e) => {
            invalidateAiSearch();
            switcherSelIdx = 0;
            renderList(e.target.value, { restoreScroll: false, preferActive: false, animate: true });
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const activeItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
                if (activeItem) activeItem.click();
            }
        });
        searchInput.addEventListener('focus', () => {
            searchInput.style.background = 'rgba(255, 255, 255, 0.45)';
            searchInput.style.borderColor = 'rgba(80, 110, 220, 0.4)';
            searchInput.style.boxShadow = '0 0 0 3px rgba(80, 110, 220, 0.12), inset 0 1px 2px rgba(0,0,0,0.01)';
        });
        searchInput.addEventListener('blur', () => {
            searchInput.style.background = 'rgba(255, 255, 255, 0.25)';
            searchInput.style.borderColor = 'rgba(255, 255, 255, 0.65)';
            searchInput.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02), 0 1px 3px rgba(0,0,0,0.02)';
        });
    }

    switcherKeydownHandler = (e) => {
        if (!switcherVisible) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            switcherKeyboardNavActive = true;
            updateSwitcherSelection(switcherSelIdx + 1);
            scrollToSelected();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            switcherKeyboardNavActive = true;
            updateSwitcherSelection(switcherSelIdx - 1);
            scrollToSelected();
        } else if (e.key === 'Enter') {
            if (e.isComposing) return;
            e.preventDefault();
            const item = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
            if (item) item.click();
        }
    };
    document.addEventListener('keydown', switcherKeydownHandler, true);

    // 键盘接管选中后，只有「真实鼠标移动」才把控制权交还给鼠标 hover，
    // 避免 DOM 变化/滚动时 :hover 误触发。mousemove 只在鼠标物理移动时派发。
    let lastMX = null, lastMY = null;
    switcherMouseMoveHandler = (e) => {
        if (lastMX === e.clientX && lastMY === e.clientY) return;
        lastMX = e.clientX; lastMY = e.clientY;
        if (!switcherKeyboardNavActive) return;
        switcherKeyboardNavActive = false;

        const overlayEl = document.getElementById('ys-switcher-overlay');
        if (!overlayEl) return;

        const hovered = e.target && e.target.closest
            ? e.target.closest('[id^="ys-tab-item-"]')
            : null;
        if (hovered && overlayEl.contains(hovered)) {
            const idx = Number(hovered.id.replace('ys-tab-item-', ''));
            if (Number.isFinite(idx) && idx !== switcherSelIdx) {
                updateSwitcherSelection(idx);
            }
            const closeBtn = hovered.querySelector('.ys-close-btn');
            if (closeBtn) {
                closeBtn.style.opacity = '1';
                closeBtn.style.pointerEvents = 'auto';
            }
        }
        refreshAllSwitcherRowsUi();
    };
    document.addEventListener('mousemove', switcherMouseMoveHandler, true);

    // 暴露给「事件委托」里 × 关闭按钮用：原地删行 + 就地重绘，避免整块重建面板导致的闪烁
    currentSwitcherSession = {
        removeTabById(tabId) {
            const idx = tabs.findIndex((t) => t.id === tabId);
            if (idx < 0) return;
            tabs.splice(idx, 1);

            if (tabs.length === 0) {
                hideSwitcher();
                return;
            }

            // 被关闭行位于当前选中行之前 → 选中索引跟随前移 1；否则保持不变
            const closedDisplayIdx = idx; // tabs 顺序即 display 顺序（renderList 只在其上做分组）
            if (closedDisplayIdx < switcherSelIdx) {
                switcherSelIdx = Math.max(0, switcherSelIdx - 1);
            }

            const si = document.getElementById('ys-search-input');
            renderList(si ? si.value : '', {
                restoreScroll: true,
                preferActive: false,
                animate: false,
            });
        },
    };

    renderList(preservedKeyword, {
        restoreScroll: isRefresh,
        preferActive: !preservedKeyword,
        animate: false,
        scrollTop: savedScrollTop,
    });

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        card.style.transform = 'scale(1) translateY(0)';
        setTimeout(() => {
            if (searchInput) searchInput.focus();
        }, 50);
    });

    const tabsForAi = tabs.map((t) => ({ id: t.id, title: t.title || '', url: t.url || '' }));
    const applyAiSnapshotToView = (res) => {
        if (!res) return;
        let shouldRerender = false;

        if (res.siteNames) {
            tabs.forEach((tab) => {
                const name = res.siteNames[tab.id] ?? res.siteNames[String(tab.id)];
                if (!name) return;
                const domain = getTabDomainKey(tab);
                if (domainToSiteNameMap[domain] !== name) {
                    domainToSiteNameMap[domain] = name;
                    shouldRerender = true;
                }
            });
        }

        if (res.labels) {
            Object.entries(res.labels).forEach(([tabId, label]) => {
                if (label && tabPageLabelMap[tabId] !== label) {
                    tabPageLabelMap[tabId] = label;
                    shouldRerender = true;
                }
            });
        }

        if (shouldRerender) {
            const si = document.getElementById('ys-search-input');
            renderList(si ? si.value : '', { restoreScroll: true, preferActive: false, animate: false });
        }
    };

    // 先读缓存快照，优先秒开；再异步补齐缺失项。
    ysSendToBg({ action: 'get_ai_snapshot', tabs: tabsForAi }, {}, (res, err) => {
        if (err) return;
        applyAiSnapshotToView(res);
    });
    ysSendToBg({ action: 'prewarm_ai_snapshot', tabs: tabsForAi }, {}, (res, err) => {
        if (err) return;
        applyAiSnapshotToView(res);
    });
}

function buildTabItem(tab, globalIdx, container) {
    const item = document.createElement('div');
    item.id    = `ys-tab-item-${globalIdx}`;

    Object.assign(item.style, {
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'flex-start',
        minHeight:      '36px',
        padding:        '8px 12px',
        borderRadius:   '8px',
        cursor:         'pointer',
        transition:     'background 0.12s ease',
        background:     'transparent',
        userSelect:     'none',
        pointerEvents:  'auto',
        position:       'relative',
        boxSizing:      'border-box',
    });
    item.dataset.selected = 'false';
    item.dataset.activeInSourceWindow = 'false';
    // 事件委托所需的行标识（由 listContainer 上的统一监听读取）
    item.dataset.tabId = String(tab.id);
    item.dataset.globalIdx = String(globalIdx);
    item.dataset.windowId = typeof tab.windowId === 'number' ? String(tab.windowId) : '';

    const leftArea = document.createElement('div');
    Object.assign(leftArea.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: '1',
        minWidth: '0',
    });

    const iconSlot = document.createElement('div');
    iconSlot.className = 'ys-tab-icon-slot';
    Object.assign(iconSlot.style, {
        width: '18px',
        height: '18px',
        flexShrink: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: '0',
        transition: 'opacity 0.15s ease',
        overflow: 'hidden',
        borderRadius: '4px',
    });
    function mountIconFallback() {
        iconSlot.textContent = '';
        const span = document.createElement('span');
        span.textContent = getTabRowIconFallback(tab);
        Object.assign(span.style, {
            fontSize: '12px',
            lineHeight: '1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        });
        iconSlot.appendChild(span);
    }
    if (tab.favIconUrl) {
        const iconImg = document.createElement('img');
        iconImg.src = tab.favIconUrl;
        iconImg.width = 16;
        iconImg.height = 16;
        iconImg.style.borderRadius = '3px';
        iconImg.style.display = 'block';
        iconImg.onerror = () => {
            iconImg.remove();
            mountIconFallback();
        };
        iconSlot.appendChild(iconImg);
    } else {
        mountIconFallback();
    }

    const title = document.createElement('div');
    title.className = 'ys-tab-title';
    Object.assign(title.style, {
        fontSize:       '13px',
        fontWeight:     '500',
        color:          'rgba(50, 60, 80, 0.9)',
        overflow:       'hidden',
        textOverflow:   'ellipsis',
        whiteSpace:     'nowrap',
        flex:           '1',
        minWidth:       '0',
        transition:     'color 0.12s ease',
    });
    const rawTitle = tab.title || '(无标题)';
    let displayTitle = /^📍\s*/u.test(rawTitle) ? rawTitle.replace(/^📍\s*/u, '').trim() : rawTitle;
    if (!displayTitle) displayTitle = '(无标题)';
    title.textContent = displayTitle;

    const closeBtn = document.createElement('div');
    closeBtn.className = 'ys-close-btn';
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
        width:           '18px',
        height:          '18px',
        borderRadius:    '50%',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        fontSize:        '14px',
        lineHeight:      '1',
        color:           'rgba(0, 0, 0, 0.35)',
        background:      'rgba(0, 0, 0, 0.06)',
        transition:      'opacity 0.12s ease',
        opacity:         '0',
        pointerEvents:   'none',
        cursor:          'pointer',
    });

    // 页面功能标签（AI；单标签分组也会请求）。严格只渲染「恰好 4 字」的结果，
    // 避免旧缓存里残留的 2/3 字标签在换了新 prompt 之后继续显示。
    const rawPageLabel = tabPageLabelMap[tab.id] ?? tabPageLabelMap[String(tab.id)];
    const pageLabel = typeof rawPageLabel === 'string'
        && Array.from(rawPageLabel.trim()).length === 4
        ? rawPageLabel.trim()
        : '';

    const showTail = tab.active || !!pageLabel;
    let tailCluster = null;
    if (showTail) {
        tailCluster = document.createElement('div');
        Object.assign(tailCluster.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: '0',
        });

        // 固定两列：📍 始终在左列，类别在右列；无标签时右列仍占位，避免仅有 📍 时整段贴右导致列不对齐
        const pinSlot = document.createElement('div');
        Object.assign(pinSlot.style, {
            width: '24px',
            minWidth: '24px',
            flexShrink: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        });

        const labelSlot = document.createElement('div');
        Object.assign(labelSlot.style, {
            width: '60px',
            minWidth: '60px',
            flexShrink: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
        });

        if (tab.active) {
            title.style.fontWeight = '600';
            title.dataset.isActive = 'true';
            const isSourceWindowActive = switcherCurrentWindowId === null || tab.windowId === switcherCurrentWindowId;
            item.dataset.activeInSourceWindow = isSourceWindowActive ? 'true' : 'false';

            const activeBadge = document.createElement('div');
            Object.assign(activeBadge.style, {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                padding: '0',
                borderRadius: '6px',
                background: 'rgba(80, 110, 220, 0.12)',
                border: '1px solid rgba(80, 110, 220, 0.25)',
                color: 'rgba(50, 70, 160, 0.95)',
                flexShrink: '0',
                boxSizing: 'border-box',
            });
            activeBadge.innerHTML = `<span style="font-size:10px;opacity:0.85;">📍</span>`;
            pinSlot.appendChild(activeBadge);
        }

        if (pageLabel) {
            const labelEl = document.createElement('span');
            labelEl.className = 'ys-page-label';
            labelEl.textContent = pageLabel;
            Object.assign(labelEl.style, {
                fontSize:       '10px',
                fontWeight:     '500',
                // 柔和靛青底 + 深蓝灰字：与面板主色呼应，比纯灰更易读、仍偏克制
                color:          'rgba(42, 52, 88, 0.88)',
                background:     '#EBEBEB',
                border:         '1px solid rgba(78, 102, 195, 0.14)',
                borderRadius:   '4px',
                padding:        '1px 5px',
                flexShrink:     '0',
                whiteSpace:     'nowrap',
                lineHeight:     '1.6',
                maxWidth:       '100%',
                overflow:       'hidden',
                textOverflow:   'ellipsis',
            });
            labelSlot.appendChild(labelEl);
        }

        tailCluster.appendChild(pinSlot);
        tailCluster.appendChild(labelSlot);
    }

    leftArea.appendChild(iconSlot);
    leftArea.appendChild(title);
    if (tailCluster) {
        leftArea.appendChild(tailCluster);
    }

    const actionArea = document.createElement('div');
    Object.assign(actionArea.style, {
        display:     'flex',
        alignItems:  'center',
        gap:         '6px',
        flexShrink:  '0',
        marginLeft:  '12px',
    });

    actionArea.appendChild(closeBtn);
    item.appendChild(leftArea);
    item.appendChild(actionArea);
    container.appendChild(item);

    // hover / click / 关闭 均由 listContainer 上的事件委托统一处理，行内不再绑定监听
    refreshTabRowIconVis(item);
}

function isSourceWindowActiveTabItem(item) {
    return !!(item && item.dataset.activeInSourceWindow === 'true');
}

function getUnselectedItemBackground(item) {
    if (isSourceWindowActiveTabItem(item)) return TAB_ROW_ACTIVE_BG;
    return 'transparent';
}

function updateSwitcherSelection(newIdx) {
    const oldItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (oldItem) {
        oldItem.dataset.selected = 'false';
        oldItem.style.background = getUnselectedItemBackground(oldItem);
        const title = oldItem.querySelector('.ys-tab-title');
        if (title) {
            title.style.color = title.dataset.isActive === 'true'
                ? 'rgba(50, 70, 160, 0.95)'
                : 'rgba(50, 60, 80, 0.9)';
        }
        const groupRow = oldItem.closest('.ys-group-row');
        if (groupRow) groupRow.querySelector('.ys-group-left').style.opacity = '1';
        refreshTabRowIconVis(oldItem);
    }

    if (newIdx === -1) {
        switcherSelIdx = -1;
        return;
    }

    switcherSelIdx = Math.max(0, Math.min(switcherTabs.length - 1, newIdx));

    const newItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (newItem) {
        newItem.dataset.selected = 'true';
        newItem.style.background = isSourceWindowActiveTabItem(newItem)
            ? TAB_ROW_ACTIVE_BG
            : TAB_ROW_SELECTED_BG;
        const title = newItem.querySelector('.ys-tab-title');
        if (title) {
            title.style.color = title.dataset.isActive === 'true'
                ? 'rgba(50, 70, 160, 0.95)'
                : 'rgba(50, 60, 80, 0.9)';
        }

        const groupRow = newItem.closest('.ys-group-row');
        if (groupRow) groupRow.querySelector('.ys-group-left').style.opacity = '1';
        refreshTabRowIconVis(newItem);
    }

    if (switcherKeyboardNavActive) {
        refreshAllSwitcherRowsUi();
    }
}

function scrollToSelected(forceCenter = false) {
    const list = document.getElementById('ys-switcher-list');
    const item = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (list && item) {
        if (forceCenter) {
            item.scrollIntoView({ block: 'center' });
        } else {
            const listRect = list.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();
            if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }
}

function setListBottomSpacerHeight(list, height) {
    if (!list) return;
    let spacer = document.getElementById('ys-scroll-spacer');
    if (!spacer) {
        spacer = document.createElement('div');
        spacer.id = 'ys-scroll-spacer';
        spacer.style.width = '100%';
        spacer.style.flexShrink = '0';
        spacer.style.pointerEvents = 'none';
        list.appendChild(spacer);
    }
    spacer.style.height = `${Math.max(0, Math.floor(height))}px`;
}

function scrollSelectedToTopIfNotLast() {
    const list = document.getElementById('ys-switcher-list');
    const item = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (!list || !item) return false;
    if (switcherTabs.length === 0) return false;
    if (switcherSelIdx >= switcherTabs.length - 1) return false;

    // 如果当前页已经处于列表尾部的最后几行，就保持原来的相对位置，
    // 只在外层兜底逻辑里保证它可见，不再强行顶到第一行。
    const trailingItemsCount = switcherTabs.length - switcherSelIdx - 1;
    if (trailingItemsCount <= 2) return false;

    // 当选中项靠近底部时，补一段不可见底部空间，确保它可以滚到“第一行”。
    const extraBottomSpace = Math.max(0, list.clientHeight - item.offsetHeight - 8);
    setListBottomSpacerHeight(list, extraBottomSpace);

    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const targetTop = list.scrollTop + (itemRect.top - listRect.top);
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.max(0, Math.min(maxScrollTop, targetTop));

    // 底部占位仅用于临时增加可滚动高度以便对齐；若保留，用户滚到底会看到大块空白（分类筛选切换后尤甚）。
    requestAnimationFrame(() => {
        setListBottomSpacerHeight(list, 0);
        const maxAfter = Math.max(0, list.scrollHeight - list.clientHeight);
        if (list.scrollTop > maxAfter) list.scrollTop = maxAfter;
    });
    return true;
}

function ensureSelectedVisibleInViewport() {
    const list = document.getElementById('ys-switcher-list');
    const item = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (!list || !item) return;

    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;

    if (itemBottom > viewBottom) {
        list.scrollTop = itemBottom - list.clientHeight;
    } else if (itemTop < viewTop) {
        list.scrollTop = itemTop;
    }
}

function hideSwitcher() {
    switcherVisible = false;
    switcherTabs    = [];
    switcherCurrentWindowId = null;
    currentSwitcherSession = null;
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
        bottom: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '9px 18px',
        maxWidth: 'min(92vw, 440px)',
        background: 'rgba(250, 252, 255, 0.9)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.9)',
        borderRadius: '10px',
        color: 'rgba(40, 50, 70, 0.95)',
        fontSize: '13px',
        fontWeight: '600',
        letterSpacing: '0.01em',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8)',
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
    textSpan.textContent = `Yes Sir，正在整理 ${count} 个标签页，请稍作等待…`;

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
