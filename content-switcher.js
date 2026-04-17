// 与 content.js 同页共享全局；manifest 中须先于本文件加载 content.js（修饰键/API 弹窗等）。
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
        winnerByDomain[domain] = Object.entries(stats).sort((a, b) => b[1] - a[1])[0]?.[0] || '📁 其他分类';
    });

    const normalized = {};
    Object.keys(classification || {}).forEach((tabId) => {
        const tab = tabById.get(String(tabId));
        if (!tab) return;
        const domain = getTabDomainKey(tab);
        if (domain === LOCAL_DOMAIN_KEY) {
            normalized[tabId] = '📁 其他分类';
            return;
        }
        normalized[tabId] = winnerByDomain[domain] || '📁 其他分类';
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
        <span style="font-size:14px;font-weight:700;color:rgba(40,50,70,0.95);letter-spacing:0.02em;white-space:nowrap;flex-shrink:0;">「🫡 Yes Sir」标签页管理</span>
        
        <div id="ys-top-actions" style="display:flex; gap:8px; position:relative;">
            <div id="ys-regret-btn" title="重新打开最近关闭的3个标签页" style="
              display:flex; align-items:center; gap:5px; height:28px; padding:0 10px;
              background:rgba(80, 110, 220, 0.08); border:1px solid rgba(80, 110, 220, 0.15);
              border-radius:8px; cursor:pointer; transition:all 0.2s; box-sizing:border-box;
              white-space:nowrap; flex-shrink:0;
            ">
              <span style="font-size:11px; font-weight:600; color:rgba(50, 70, 160, 0.9);">💊 后悔药</span>
            </div>
            
            <div id="ys-main-settings-btn" title="设置" style="
              display:flex; align-items:center; gap:5px; height:28px; padding:0 10px;
              background:rgba(80, 110, 220, 0.08); border:1px solid rgba(80, 110, 220, 0.15);
              border-radius:8px; cursor:pointer; transition:all 0.2s; box-sizing:border-box;
              white-space:nowrap; flex-shrink:0;
            ">
              <span style="font-size:11px; font-weight:600; color:rgba(50, 70, 160, 0.9);">⚙️ 设置</span>
            </div>
        </div>

      </div>
      <div id="ys-category-filters" style="display:flex; gap:6px; align-items:center; width:100%; box-sizing:border-box; margin-top:8px;"></div>
      <div style="position:relative; margin-top:10px;">
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
        '📁 其他分类': 0,
    };
    let categoryCounts = { ...EMPTY_COUNTS };

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
                fontSize: '13px', fontWeight: '500', color: 'rgba(50, 60, 80, 0.9)',
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
        { label: '其他分类', emoji: '📁' },
    ];

    function initCategoryButtons(counts = categoryCounts) {
        const filterContainer = document.getElementById('ys-category-filters');
        if (!filterContainer) return;

        filterContainer.innerHTML = '';
        CATEGORY_FILTERS.forEach((cat) => {
            const fullText = `${cat.emoji} ${cat.label}`;
            const count = counts[fullText] || 0;
            const isActive = activeCategoryFilter === fullText;
            const btn = document.createElement('div');
            btn.className = 'ys-cat-btn';
            btn.title = fullText;
            Object.assign(btn.style, {
                height: '28px',
                padding: '0 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                flex: '1',
                borderRadius: '8px',
                cursor: 'pointer',
                background: isActive ? 'rgba(80, 110, 220, 0.16)' : 'rgba(0, 0, 0, 0.04)',
                border: `1px solid ${isActive ? 'rgba(80, 110, 220, 0.32)' : 'rgba(0, 0, 0, 0.05)'}`,
                color: isActive ? 'rgba(50, 70, 160, 0.95)' : 'rgba(50, 60, 80, 0.8)',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
                userSelect: 'none',
                lineHeight: '1',
                transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            });

            btn.innerHTML = `
              <span style="flex-shrink:0;">${cat.emoji}</span>
              <span style="font-weight:600;">${cat.label} · ${count}</span>`;

            btn.addEventListener('mouseenter', () => {
                if (activeCategoryFilter !== fullText) {
                    btn.style.background = 'rgba(80, 110, 220, 0.08)';
                    btn.style.borderColor = 'rgba(80, 110, 220, 0.2)';
                }
            });

            btn.addEventListener('mouseleave', () => {
                if (activeCategoryFilter !== fullText) {
                    btn.style.background = 'rgba(0, 0, 0, 0.04)';
                    btn.style.borderColor = 'rgba(0, 0, 0, 0.05)';
                }
            });

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                activeCategoryFilter = activeCategoryFilter === fullText ? null : fullText;
                const si = document.getElementById('ys-search-input');
                renderList(si ? si.value : '', { restoreScroll: false, preferActive: true, animate: true });
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

    const topActionsEl = header.querySelector('#ys-top-actions');
    const regretBtnAnchor = document.getElementById('ys-regret-btn');
    if (topActionsEl && regretBtnAnchor) {
        const aiGroupBtn = document.createElement('div');
        aiGroupBtn.id = 'ys-ai-group-btn';
        aiGroupBtn.title = 'AI 智能聚类：仅在当前窗口内按子主题创建标签组';
        Object.assign(aiGroupBtn.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            height: '28px',
            padding: '0 10px',
            background: 'rgba(50, 200, 150, 0.08)',
            border: '1px solid rgba(50, 200, 150, 0.22)',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            boxSizing: 'border-box',
            whiteSpace: 'nowrap',
            flexShrink: '0',
        });
        aiGroupBtn.innerHTML = '<span style="font-size:11px;font-weight:600;color:rgba(30,130,100,0.9);">✨ AI 聚合</span>';
        topActionsEl.insertBefore(aiGroupBtn, regretBtnAnchor);
        aiGroupBtn.addEventListener('mouseenter', () => {
            aiGroupBtn.style.background = 'rgba(50, 200, 150, 0.14)';
        });
        aiGroupBtn.addEventListener('mouseleave', () => {
            aiGroupBtn.style.background = 'rgba(50, 200, 150, 0.08)';
        });
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
            chrome.runtime.sendMessage({
                action: 'ai_batch_group',
                tabs: tabsToProcess,
                windowId: switcherCurrentWindowId,
            }, (res) => {
                finishProcessing();

                if (chrome.runtime.lastError) {
                    showCustomToast('聚合失败：' + chrome.runtime.lastError.message, 4000);
                    return;
                }
                if (res && res.success) {
                    showCustomToast(`✅ 整理完毕，已为您创建 ${res.groupCount} 个标签组`, 3200);
                    setTimeout(() => hideSwitcher(), 1500);
                } else {
                    let hint = '聚合未完成';
                    if (res && res.error === 'no_api_key') hint = '请先在设置中配置 DeepSeek API Key';
                    else if (res && res.message) {
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

    // 设置按钮下拉菜单逻辑
    const settingsBtn = document.getElementById('ys-main-settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.background = 'rgba(80, 110, 220, 0.15)');
        settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.background = 'rgba(80, 110, 220, 0.08)');
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let menu = document.getElementById('ys-settings-dropdown');
            if (menu) {
                menu.remove();
                return;
            }
            menu = document.createElement('div');
            menu.id = 'ys-settings-dropdown';
            Object.assign(menu.style, {
                position: 'absolute',
                top: '36px',
                right: '0',
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'saturate(180%) blur(20px)',
                WebkitBackdropFilter: 'saturate(180%) blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.8)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)',
                borderRadius: '10px',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                zIndex: '100',
                minWidth: '130px'
            });

            const createItem = (icon, text, onClick) => {
                const item = document.createElement('div');
                item.innerHTML = `<span style="margin-right:8px;font-size:13px;">${icon}</span><span style="font-size:12px;font-weight:600;color:rgba(50,60,80,0.9);">${text}</span>`;
                Object.assign(item.style, {
                    padding: '8px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'background 0.15s'
                });
                item.addEventListener('mouseenter', () => item.style.background = 'rgba(80, 110, 220, 0.08)');
                item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                item.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    menu.remove();
                    onClick();
                });
                return item;
            };

            menu.appendChild(createItem('⌨️', '修饰键设置', showModifierSettingsModal));
            menu.appendChild(createItem('🔑', 'API Key 设置', showApiKeyModal));

            document.getElementById('ys-top-actions').appendChild(menu);

            const closeMenu = (ev) => {
                if (!menu.contains(ev.target) && ev.target.closest('#ys-main-settings-btn') === null) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
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
                    categoryCounts['📁 其他分类'] += 1;
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
    item.dataset.activeInSourceWindow = 'false';

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
            updateSwitcherSelection(globalIdx);
        }
    });
    item.addEventListener('mouseleave', () => {
        closeBtn.style.opacity = '0';
        closeBtn.style.pointerEvents = 'none';
        if (item.dataset.selected !== 'true') {
            item.style.background = getUnselectedItemBackground(item);
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

function isSourceWindowActiveTabItem(item) {
    return !!(item && item.dataset.activeInSourceWindow === 'true');
}

function getUnselectedItemBackground(item) {
    if (isSourceWindowActiveTabItem(item)) return 'rgba(80, 110, 220, 0.12)';
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
            ? 'rgba(80, 110, 220, 0.12)'
            : 'rgba(130, 140, 160, 0.12)';
        const title = newItem.querySelector('.ys-tab-title');
        if (title) {
            title.style.color = title.dataset.isActive === 'true'
                ? 'rgba(50, 70, 160, 0.95)'
                : 'rgba(50, 60, 80, 0.9)';
        }

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
    if (activeCategoryFilter) return false;
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
