// ─── Config & State ───────────────────────────────────────────────────────────

const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform) || navigator.userAgent.includes("Mac");
let modifierKey = isMac ? 'meta' : 'alt';

const MOD_EVENT_KEY = { meta: 'Meta', alt: 'Alt', ctrl: 'Control', shift: 'Shift' };
const MOD_LABELS    = {
    meta:  isMac ? '⌘ Command' : '⊞ Meta',
    alt:   isMac ? '⌥ Option'  : 'Alt',
    ctrl:  '⌃ Control',
    shift: '⇧ Shift',
};

function isModHeld(e) {
    return e[modifierKey + 'Key'];
}

// 启动时从 storage 读取用户配置的修饰键
chrome.storage.local.get({ modifierKey: null }, (res) => {
    if (res.modifierKey) modifierKey = res.modifierKey;
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


// ─── Tab Switcher Overlay (Kanban View) ───────────────────────────────────────

let switcherVisible  = false;
let switcherTabs     = [];
let switcherSelIdx   = 0;
let switcherCurrentWindowId = null;
let switcherKeydownHandler = null;
/** tabId -> AI 分类文案 */
let tabCategoryMap = {};
/** domain -> AI 提取的网站名称 */
let domainToSiteNameMap = {};
/** 当前选中的顶部分类筛选，null 表示不过滤 */
let activeCategoryFilter = null;

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

// 工具函数：按域名对 Tab 进行分组
function groupTabsByDomain(tabs) {
    const groups = [];
    const domainMap = new Map();

    tabs.forEach((tab, i) => {
        const domain = getTabDomainKey(tab);

        if (!domainMap.has(domain)) {
            const newGroup = { domain, icon: tab.favIconUrl, tabs: [] };
            domainMap.set(domain, newGroup);
            groups.push(newGroup);
        }

        const group = domainMap.get(domain);
        if (!group.icon && tab.favIconUrl) group.icon = tab.favIconUrl;
        
        group.tabs.push({ ...tab, originalIndex: i });
    });
    return groups;
}

function normalizeCategoryByDomain(classification, tabs) {
    const byDomain = {};
    const tabById = new Map(tabs.map((t) => [String(t.id), t]));
    const LOCAL_DOMAIN_KEY = '本地网页/其他';

    Object.entries(classification || {}).forEach(([tabId, cat]) => {
        const tab = tabById.get(String(tabId));
        if (!tab) return;
        const domain = getTabDomainKey(tab);
        if (domain === LOCAL_DOMAIN_KEY) return;
        if (!byDomain[domain]) byDomain[domain] = {};
        byDomain[domain][cat] = (byDomain[domain][cat] || 0) + 1;
    });

    const winnerByDomain = {};
    Object.entries(byDomain).forEach(([domain, stats]) => {
        winnerByDomain[domain] = Object.entries(stats).sort((a, b) => b[1] - a[1])[0]?.[0] || '🔍 其他';
    });

    const normalized = {};
    Object.keys(classification || {}).forEach((tabId) => {
        const tab = tabById.get(String(tabId));
        if (!tab) return;
        const domain = getTabDomainKey(tab);
        if (domain === LOCAL_DOMAIN_KEY) {
            normalized[tabId] = '🔍 其他';
            return;
        }
        normalized[tabId] = winnerByDomain[domain] || '🔍 其他';
    });

    return normalized;
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
    switcherCurrentWindowId = currentWindowId;
    switcherTabs = tabs.slice();
    switcherSelIdx = 0;
    switcherVisible = true;
    if (!isRefresh) {
        activeCategoryFilter = null;
        tabCategoryMap = {};
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
        padding:        '14px 20px 10px',
        display:        'flex',
        flexDirection:  'column',
        gap:            '12px',
        borderBottom:   '1px solid rgba(0, 0, 0, 0.05)',
        flexShrink:     '0',
    });
    header.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:14px;font-weight:700;color:rgba(40,50,70,0.95);letter-spacing:0.02em;">🫡 Yes Sir 标签页管理</span>
        <div style="display:flex; align-items:center; gap:10px;">
          <div id="ys-category-filters" style="display:flex; gap:6px; align-items:center;"></div>

          <div style="width:1px; height:16px; background:rgba(0,0,0,0.08); margin:0 2px;"></div>

          <div id="ys-regret-btn" title="重新打开最近关闭的3个标签页" style="
            display:flex; align-items:center; gap:5px; height:28px; padding:0 10px;
            background:rgba(80, 110, 220, 0.08); border:1px solid rgba(80, 110, 220, 0.15);
            border-radius:8px; cursor:pointer; transition:all 0.2s; box-sizing:border-box;
          ">
            <span style="font-size:11px; font-weight:600; color:rgba(50, 70, 160, 0.9);">💊 后悔药</span>
          </div>
        </div>
      </div>
      <div style="position:relative;">
        <input id="ys-search-input" type="text" placeholder="搜索标题、URL 或域名 (支持拼音/英文)..." style="
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

    const CARD_OPEN_TRANSITION = 'transform 0.18s cubic-bezier(0.34,1.3,0.64,1)';
    const CARD_HEIGHT_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
    let cardHeightAnimToken = 0;
    const EMPTY_COUNTS = {
        '📖 信息资讯': 0,
        '🛠️ 效率办公': 0,
        '💬 社交互动': 0,
        '🎡 生活娱乐': 0,
        '🔍 其他': 0,
    };
    let categoryCounts = { ...EMPTY_COUNTS };

    const getDefaultSelectedIdx = (items) => {
        const activeInCurrent = items.findIndex(t => t.active && switcherCurrentWindowId !== null && t.windowId === switcherCurrentWindowId);
        if (activeInCurrent >= 0) return activeInCurrent;
        const activeAny = items.findIndex(t => t.active);
        return activeAny >= 0 ? activeAny : 0;
    };

    function renderList(filterText = '', opts = {}) {
        const shouldRestoreScroll = !!opts.restoreScroll;
        const shouldPreferActive = !!opts.preferActive;
        const shouldAnimate = !!opts.animate;
        const explicitRestoreScrollTop = Number.isFinite(opts.scrollTop) ? opts.scrollTop : null;
        const prevScrollTop = listContainer.scrollTop;

        function rebuildListDOM() {
        listContainer.innerHTML = '';

        const keyword = filterText.trim().toLowerCase();
        let filteredTabs = keyword
            ? tabs.filter((t) => {
                const title = (t.title || '').toLowerCase();
                const url = (t.url || '').toLowerCase();
                const domain = getTabDomainKey(t).toLowerCase();
                const siteName = (domainToSiteNameMap[domain] || '').toLowerCase();
                return title.includes(keyword)
                    || url.includes(keyword)
                    || domain.includes(keyword)
                    || siteName.includes(keyword);
            })
            : tabs.slice();

        if (activeCategoryFilter) {
            filteredTabs = filteredTabs.filter((t) => {
                const cat = tabCategoryMap[t.id] ?? tabCategoryMap[String(t.id)];
                return cat === activeCategoryFilter;
            });
        }
        if (filteredTabs.length === 0) {
            switcherTabs = [];
            switcherSelIdx = 0;
            listContainer.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(100,110,130,0.6);font-size:12px;">未找到匹配的标签页</div>`;
            return;
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
                opacity: '0.65',
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
                img.onerror = () => { img.remove(); iconDiv.textContent = group.domain[0].toUpperCase(); };
                iconDiv.appendChild(img);
            } else {
                iconDiv.textContent = group.domain[0].toUpperCase();
            }

            const domainText = document.createElement('div');
            domainText.className = 'ys-domain-label';
            Object.assign(domainText.style, {
                flex: '1',
                minWidth: '0',
                fontSize: '12px', fontWeight: '600', color: 'rgba(45, 55, 75, 0.92)',
                wordBreak: 'break-all', lineHeight: '1.4',
            });
            const displayDomainName = domainToSiteNameMap[group.domain] || group.domain;
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

    const CATEGORY_FILTERS = [
        { label: '信息资讯', emoji: '📖' },
        { label: '效率办公', emoji: '🛠️' },
        { label: '社交互动', emoji: '💬' },
        { label: '生活娱乐', emoji: '🎡' },
        { label: '其他', emoji: '🔍' },
    ];

    function initCategoryButtons(counts = categoryCounts) {
        const filterContainer = document.getElementById('ys-category-filters');
        if (!filterContainer) return;

        filterContainer.innerHTML = '';
        CATEGORY_FILTERS.forEach((cat) => {
            const fullText = `${cat.emoji} ${cat.label}`;
            const count = counts[fullText] || 0;
            const isActive = activeCategoryFilter === fullText;
            const isExpanded = isActive;
            const btn = document.createElement('div');
            btn.className = 'ys-cat-btn';
            btn.title = fullText;
            Object.assign(btn.style, {
                height: '28px',
                minWidth: '28px',
                maxWidth: isExpanded ? '140px' : '28px',
                padding: '0 7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                background: isActive ? 'rgba(80, 110, 220, 0.16)' : 'rgba(0, 0, 0, 0.04)',
                border: `1px solid ${isActive ? 'rgba(80, 110, 220, 0.32)' : 'rgba(0, 0, 0, 0.05)'}`,
                color: isActive ? 'rgba(50, 70, 160, 0.95)' : 'rgba(50, 60, 80, 0.8)',
                fontSize: '12px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
                userSelect: 'none',
                lineHeight: '1',
            });

            btn.innerHTML = `
              <span class="btn-emoji" style="flex-shrink:0;">${cat.emoji}</span>
              <span class="btn-text" style="
                display:inline-block;
                max-width:${isExpanded ? '120px' : '0'};
                margin-left:${isExpanded ? '6px' : '0'};
                opacity:${isExpanded ? '1' : '0'};
                overflow:hidden;
                transition:max-width 0.25s ease, margin-left 0.2s ease, opacity 0.2s;
                font-weight:600;
              ">${cat.label} · ${count}</span>`;

            btn.addEventListener('mouseenter', () => {
                btn.style.maxWidth = '140px';
                btn.style.background = 'rgba(80, 110, 220, 0.08)';
                btn.style.borderColor = 'rgba(80, 110, 220, 0.2)';
                const textEl = btn.querySelector('.btn-text');
                if (textEl) {
                    textEl.style.maxWidth = '120px';
                    textEl.style.marginLeft = '6px';
                    textEl.style.opacity = '1';
                }
            });

            btn.addEventListener('mouseleave', () => {
                if (activeCategoryFilter === fullText) {
                    btn.style.maxWidth = '140px';
                    btn.style.background = 'rgba(80, 110, 220, 0.16)';
                    btn.style.borderColor = 'rgba(80, 110, 220, 0.32)';
                } else {
                    btn.style.maxWidth = '28px';
                    btn.style.background = 'rgba(0, 0, 0, 0.04)';
                    btn.style.borderColor = 'rgba(0, 0, 0, 0.05)';
                }
                const textEl = btn.querySelector('.btn-text');
                if (textEl) {
                    const shouldExpand = activeCategoryFilter === fullText;
                    textEl.style.maxWidth = shouldExpand ? '120px' : '0';
                    textEl.style.marginLeft = shouldExpand ? '6px' : '0';
                    textEl.style.opacity = shouldExpand ? '1' : '0';
                }
            });

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                activeCategoryFilter = activeCategoryFilter === fullText ? null : fullText;
                const si = document.getElementById('ys-search-input');
                renderList(si ? si.value : '', { restoreScroll: false, preferActive: false, animate: true });
                initCategoryButtons(counts);
            });

            filterContainer.appendChild(btn);
        });
    }

    card.appendChild(header);
    card.appendChild(listContainer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const searchInput = document.getElementById('ys-search-input');
    if (searchInput) {
        searchInput.value = preservedKeyword;
        searchInput.addEventListener('input', (e) => {
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

    const regretBtn = document.getElementById('ys-regret-btn');
    if (regretBtn) {
        regretBtn.addEventListener('mouseenter', () => {
            regretBtn.style.background = 'rgba(80, 110, 220, 0.15)';
        });
        regretBtn.addEventListener('mouseleave', () => {
            regretBtn.style.background = 'rgba(80, 110, 220, 0.08)';
        });
        regretBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: 'restore_last_3_tabs' }, (res) => {
                if (chrome.runtime.lastError) return;
                if (res && res.success) {
                    hideSwitcher();
                } else {
                    regretBtn.style.borderColor = 'rgba(255, 100, 100, 0.3)';
                    setTimeout(() => {
                        regretBtn.style.borderColor = 'rgba(80, 110, 220, 0.15)';
                    }, 500);
                }
            });
        });
    }

    initCategoryButtons();

    switcherKeydownHandler = (e) => {
        if (!switcherVisible) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateSwitcherSelection(switcherSelIdx + 1);
            scrollToSelected();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
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

    const tabsForClassify = tabs.map((t) => ({ id: t.id, title: t.title || '', url: t.url || '' }));
    chrome.runtime.sendMessage({ action: 'classify_tabs', tabs: tabsForClassify }, (res) => {
        if (chrome.runtime.lastError) return;
        let shouldRerender = false;

        if (res && res.classification) {
            const normalizedClassification = normalizeCategoryByDomain(res.classification, tabs);
            Object.assign(tabCategoryMap, normalizedClassification);
            categoryCounts = { ...EMPTY_COUNTS };
            Object.values(normalizedClassification).forEach((cat) => {
                if (Object.prototype.hasOwnProperty.call(categoryCounts, cat)) {
                    categoryCounts[cat] += 1;
                } else {
                    categoryCounts['🔍 其他'] += 1;
                }
            });
            initCategoryButtons(categoryCounts);
            if (activeCategoryFilter) {
                shouldRerender = true;
            }
        }

        if (res && res.siteNames) {
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

        if (shouldRerender) {
            const si = document.getElementById('ys-search-input');
            renderList(si ? si.value : '', { restoreScroll: true, preferActive: false, animate: false });
        }
    });
}

function buildTabItem(tab, globalIdx, container) {
    const item = document.createElement('div');
    item.id    = `ys-tab-item-${globalIdx}`;

    Object.assign(item.style, {
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
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

    const leftArea = document.createElement('div');
    Object.assign(leftArea.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: '1',
        minWidth: '0',
    });

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
    title.textContent = tab.title || '(无标题)';

    const statusSlot = document.createElement('div');
    Object.assign(statusSlot.style, {
        width: '20px',
        height: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: '0',
    });

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

    if (tab.active) {
        title.style.fontWeight = '600';
        title.dataset.isActive = 'true';

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
        statusSlot.appendChild(activeBadge);
    }

    leftArea.appendChild(statusSlot);
    leftArea.appendChild(title);

    const actionArea = document.createElement('div');
    Object.assign(actionArea.style, {
        display:     'flex',
        alignItems:  'center',
        gap:         '6px',
        flexShrink:  '0',
        marginLeft:  '12px',
    });

    if (tab.windowName && tab.windowName !== '当前') {
        const winBadge = document.createElement('div');
        Object.assign(winBadge.style, {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '20px',
            padding: '0 8px',
            borderRadius: '6px',
            background: 'rgba(140, 150, 170, 0.08)',
            border: '1px solid rgba(140, 150, 170, 0.2)',
            color: 'rgba(100, 110, 130, 0.9)',
            fontSize: '11px',
            fontWeight: '600',
            gap: '4px',
            boxSizing: 'border-box',
        });
        winBadge.innerHTML = `<span style="font-size:10px;opacity:0.8;">🪟</span><span>${tab.windowName}</span>`;
        actionArea.appendChild(winBadge);
    }

    actionArea.appendChild(closeBtn);
    item.appendChild(leftArea);
    item.appendChild(actionArea);
    container.appendChild(item);

    item.addEventListener('mouseenter', () => {
        closeBtn.style.opacity = '1';
        closeBtn.style.pointerEvents = 'auto';
        if (item.dataset.selected !== 'true') {
            item.style.background = 'rgba(130, 140, 160, 0.12)';
        }
    });
    item.addEventListener('mouseleave', () => {
        closeBtn.style.opacity = '0';
        closeBtn.style.pointerEvents = 'none';
        if (item.dataset.selected !== 'true') {
            item.style.background = 'transparent';
        }
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'close_tab_by_id', tabId: tab.id }, (res) => {
            if (chrome.runtime.lastError) return;
            if (!res || !res.success) return;
            chrome.runtime.sendMessage({ action: 'get_tabs' }, (res2) => {
                if (chrome.runtime.lastError) return;
                if (res2 && res2.tabs && res2.tabs.length > 0) {
                    showSwitcher(res2.tabs, true, res2.currentWindowId);
                    initSwitcherHighlight();
                } else {
                    hideSwitcher();
                }
            });
        });
    });

    item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof tab.windowId === 'number') {
            chrome.runtime.sendMessage({
                action: 'switch_tab_global',
                tabId: tab.id,
                windowId: tab.windowId,
            });
        } else {
            chrome.runtime.sendMessage({ action: 'switch_tab', tabId: tab.id });
        }
        hideSwitcher();
    });
}

function updateSwitcherSelection(newIdx) {
    const oldItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (oldItem) {
        oldItem.dataset.selected = 'false';
        oldItem.style.background = oldItem.matches(':hover')
            ? 'rgba(130, 140, 160, 0.12)'
            : 'transparent';
        const title = oldItem.querySelector('.ys-tab-title');
        if (title) {
            title.style.color = title.dataset.isActive === 'true'
                ? 'rgba(50, 70, 160, 0.95)'
                : 'rgba(50, 60, 80, 0.9)';
        }
        
        const groupRow = oldItem.closest('.ys-group-row');
        // 恢复成默认的高透明度
        if (groupRow) groupRow.querySelector('.ys-group-left').style.opacity = '0.65';
    }

    switcherSelIdx = Math.max(0, Math.min(switcherTabs.length - 1, newIdx));

    const newItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (newItem) {
        newItem.dataset.selected = 'true';
        newItem.style.background = 'rgba(80, 110, 220, 0.12)';
        const title = newItem.querySelector('.ys-tab-title');
        if (title) title.style.color = 'rgba(50, 70, 160, 1)';

        const groupRow = newItem.closest('.ys-group-row');
        if (groupRow) groupRow.querySelector('.ys-group-left').style.opacity = '1';
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

    // 当选中项靠近底部时，补一段不可见底部空间，确保它可以滚到“第一行”。
    const extraBottomSpace = Math.max(0, list.clientHeight - item.offsetHeight - 8);
    setListBottomSpacerHeight(list, extraBottomSpace);

    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const targetTop = list.scrollTop + (itemRect.top - listRect.top);
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.max(0, Math.min(maxScrollTop, targetTop));
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
    if (switcherKeydownHandler) {
        document.removeEventListener('keydown', switcherKeydownHandler, true);
        switcherKeydownHandler = null;
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


// ─── Floating Widget ──────────────────────────────────────────────────────────

function initFloatingWidget() {
    if (document.getElementById('geek-float-btn')) return;

    let snapEdge  = 'right';
    let posY      = Math.min(window.innerHeight * 0.45, window.innerHeight - 60);
    let panelOpen = false;
    let panelView = 'chart'; 

    const glass = (extra = {}) => Object.assign({
        background:     'rgba(245, 245, 248, 0.18)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:         '1px solid rgba(255, 255, 255, 0.38)',
        boxShadow:      '0 6px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)',
    }, extra);

    const btn = document.createElement('div');
    btn.id = 'geek-float-btn';
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
    }));

    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polyline points="1,14 5,8 9,11 13,4 17,7"
          stroke="rgba(80,110,200,0.85)" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <circle cx="5" cy="8" r="1.5" fill="rgba(80,110,200,0.7)"/>
        <circle cx="9" cy="11" r="1.5" fill="rgba(80,110,200,0.7)"/>
        <circle cx="13" cy="4" r="1.5" fill="rgba(80,110,200,0.7)"/>
      </svg>`;

    btn.addEventListener('mouseenter', () => {
        if (!isDragging) { btn.style.opacity = '1'; btn.style.boxShadow = '0 8px 28px rgba(80,110,200,0.22), inset 0 1px 0 rgba(255,255,255,0.5)'; }
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
        const clampedY = Math.max(8, Math.min(window.innerHeight - panelH - 8, posY - 8));
        panel.style.top = clampedY + 'px';
        if (snapEdge === 'right') { panel.style.right = '58px'; panel.style.left = 'auto'; }
        else                      { panel.style.left  = '58px'; panel.style.right = 'auto'; }
    }

    applyPosition(false);

    chrome.storage.local.get(['widgetPosY', 'widgetSnapEdge'], (res) => {
        if (res.widgetPosY !== undefined) {
            posY = Math.max(8, Math.min(window.innerHeight - 46, res.widgetPosY));
        }
        if (res.widgetSnapEdge !== undefined) {
            snapEdge = res.widgetSnapEdge;
        }
        applyPosition(false);
    });

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
        chrome.runtime.sendMessage({ action: "get_daily_stats" }, (response) => {
            const dailyStats = (response && response.dailyStats) ? response.dailyStats : {};
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

        panel.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:rgba(60,70,110,0.85);letter-spacing:0.01em;">近 5 天使用统计</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:10px;color:rgba(120,130,160,0.7);">今日 <b style="color:rgba(80,110,200,0.85)">${todayCount}</b></span>
              <button id="ys-settings-btn" style="
                background:none;border:none;cursor:pointer;padding:2px;
                display:flex;align-items:center;justify-content:center;
                opacity:0.45;transition:opacity 0.15s;border-radius:4px;
              " title="修饰键设置">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="2" stroke="rgba(80,100,160,0.9)" stroke-width="1.4"/>
                  <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1.1 1.1M10 10l1.1 1.1M10 4l1.1-1.1M2.9 11.1L4 10"
                    stroke="rgba(80,100,160,0.9)" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          ${buildSVGChart(days)}
          <div style="display:flex;justify-content:center;align-items:center;gap:4px;margin-top:4px;">
            <span style="font-size:10px;color:rgba(120,130,160,0.7);">五日合计</span>
            <span style="font-size:13px;font-weight:700;color:rgba(80,110,200,0.85);">${total5}</span>
            <span style="font-size:10px;color:rgba(120,130,160,0.7);">次</span>
          </div>`;

        const settingsBtn = panel.querySelector('#ys-settings-btn');
        settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.opacity = '1');
        settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.opacity = '0.45');
        settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); renderSettingsView(); });
    }

    function renderSettingsView() {
        panelView = 'settings';
        const keys = ['meta', 'alt', 'ctrl', 'shift'];

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
        const W = 182, H = 92, padL = 22, padR = 6, padT = 10, padB = 22;
        const cW = W - padL - padR, cH = H - padT - padB;
        const counts = days.map(d => d.count);
        const maxVal = Math.max(...counts, 1);
        const pts = days.map((d, i) => ({
            x: padL + (i / (days.length - 1)) * cW,
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

        return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block">
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

document.addEventListener('keydown', function(event) {
    if (event.repeat) return;

    if (event.key === 'Escape' && switcherVisible) {
        hideSwitcher();
        return;
    }

    if (event.key === MOD_EVENT_KEY[modifierKey]) {
        const now = Date.now();
        if (now - lastModPressTime < DOUBLE_PRESS_DELAY) {
            // 触发双击
            event.preventDefault();
            
            if (!switcherVisible) {
                chrome.runtime.sendMessage({ action: 'get_tabs' }, (res) => {
                    if (!res || !res.tabs || res.tabs.length < 2) return;
                    showSwitcher(res.tabs, false, res.currentWindowId);
                    initSwitcherHighlight();
                });
            } else {
                hideSwitcher();
            }
            lastModPressTime = 0;
        } else {
            lastModPressTime = now;
        }
    }
});

// 来自 background 的消息
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "show_toast") {
        showToast(request.count);
    }
});


// ─── Bootstrap ────────────────────────────────────────────────────────────────

function bootstrap() {
    initFloatingWidget();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}