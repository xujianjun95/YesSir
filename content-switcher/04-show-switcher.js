// ─── 04 面板主体：壳、顶栏、委托；列表渲染与网页建议见 04b ───────────────────────────────

function showSwitcher(tabs, isRefresh = false, currentWindowId = null) {
    chrome.storage.local.get({ themeMode: 'system' }, (res) => {
        if (typeof ysApplyDataThemeAttr === 'function') ysApplyDataThemeAttr(res.themeMode);
        else document.documentElement.setAttribute('data-ys-theme', res.themeMode || 'system');
    });
    ensureYsThemeStylesInjected();

    const mode = { isWebSearchMode: false, isTabAnimating: false };
    let savedScrollTop = 0;
    const oldList = document.getElementById('ys-switcher-list');
    const oldSearch = document.getElementById('ys-search-input');
    const preservedKeyword = isRefresh && oldSearch ? oldSearch.value : '';
    if (isRefresh && oldList) {
        savedScrollTop = oldList.scrollTop;
    }

    hideSwitcher({ immediate: true });
    // 接管成本地可变数组：后续关闭单个标签时可直接 splice + 重绘，无需整块重建面板
    tabs = tabs.slice();
    switcherCurrentWindowId = currentWindowId;
    switcherTabs = tabs.slice();
    switcherSelIdx = 0;
    switcherKeyboardNavActive = false;
    switcherVisible = true;
    // 注册到后台广播白名单：后续 refresh_category_bar 只会发给打开了面板的标签
    try { chrome.runtime.sendMessage({ action: 'switcher_opened' }, () => void chrome.runtime.lastError); }
    catch (_) {}
    if (!isRefresh) {
        tabPageLabelMap = {};
        // 每次用户主动打开面板计一次（isRefresh = 换肤/换语言等内部重建，不重复计）
        ysSendToBg({ action: 'track_event', feature: 'switcher_open' }, { maxRetries: 1 }, () => {});
    }

    const overlay = document.createElement('div');
    overlay.id = 'ys-switcher-overlay';
    Object.assign(overlay.style, {
        position:       'fixed',
        inset:          '0',
        zIndex:         '2147483646',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        boxSizing:      'border-box',
        background:     'var(--ys-overlay-bg)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        opacity:        '0',
        transition:     'opacity 0.34s cubic-bezier(0.16,1,0.3,1)',
        pointerEvents:  'auto',
        fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        gap:            '28px',
    });

    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hideSwitcher();
    });
    
    overlay.addEventListener('wheel', (e) => {
        const listContainer = document.getElementById('ys-switcher-list');
        const catBar = document.getElementById('ys-category-bar');
        if ((!listContainer || !listContainer.contains(e.target)) &&
            (!catBar || !catBar.contains(e.target))) {
            e.preventDefault();
        }
    }, { passive: false });

    const card = document.createElement('div');
    card.id = 'ys-switcher-card';
    Object.assign(card.style, {
        background:     'var(--ys-card-bg)',
        backdropFilter: 'saturate(180%) blur(30px)',
        WebkitBackdropFilter: 'saturate(180%) blur(30px)',
        border:         '1px solid var(--ys-card-border)',
        borderRadius:   '20px',
        boxShadow:      'var(--ys-card-shadow)',
        width:          '700px',
        maxHeight:      '80vh',
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        opacity:        '0',
        transform:      'translateY(10px)',
        transition:     'transform 0.26s cubic-bezier(0.16,1,0.3,1), opacity 0.34s cubic-bezier(0.16,1,0.3,1), background 0.3s ease, box-shadow 0.3s ease',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
        padding:        '16px 20px 14px',
        display:        'flex',
        flexDirection:  'column',
        gap:            '14px',
        borderBottom:   '1px solid var(--ys-divider)',
        flexShrink:     '0',
    });

    header.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; min-height:28px;">
        <span style="font-size:14px;font-weight:700;color:var(--ys-text-title);letter-spacing:0.02em;white-space:nowrap;flex-shrink:0;user-select:none;-webkit-user-select:none;">${ysT('panelTitle')}</span>
        
        <div id="ys-top-actions" style="display:flex; gap:8px; position:relative; align-items:center;"></div>
      </div>

      <div id="ys-search-bar-wrapper" style="
        position:relative; width:100%; border-radius:10px;
        border:1px solid var(--ys-search-border); background:var(--ys-search-bg);
        box-shadow:var(--ys-search-shadow);
        transition:border-color 0.22s ease, box-shadow 0.22s ease;
        box-sizing:border-box; overflow:hidden;
      ">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);z-index:2;">
          <circle cx="7" cy="7" r="5" stroke="var(--ys-search-icon)" stroke-width="1.5"/>
          <path d="M11 11L14 14" stroke="var(--ys-search-icon)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input id="ys-search-input" type="text" placeholder="${ysSwitcherPlaceholderDefault()}" style="
          width:100%; padding:9px 12px 9px 34px;
          border:none; background:transparent;
          font-size:13px; color:var(--ys-text-primary); outline:none;
          box-sizing:border-box; position:relative; z-index:1;
          transition:transform 0.12s ease-in, opacity 0.12s ease-in;
        ">
        <div id="ys-web-search-hint" style="
          position:absolute; right:14px; top:50%; transform:translateY(-50%);
          z-index:2; color:var(--ys-text-secondary); font-size:12px;
          pointer-events:none; white-space:nowrap;
          transition:opacity 0.2s ease; opacity:1;
        "><span>(</span><span>${ysT('webSearchModeTabSwitch')} </span><span id="ys-web-mode-word" style="display:inline-flex;"><span id="ys-web-mode-highlight" style="color:var(--ys-accent);font-weight:700;text-shadow:0 0 6px var(--ys-accent-glow);">${ysT('webSearchModeWordWeb')}</span><span style="color:var(--ys-text-secondary);font-weight:400;"> ${ysT('webSearchModeWordMode')}</span></span><span>)</span></div>
        <button id="ys-web-search-enter-btn" type="button" title="${ysT('webSearchEnterTitle')}" style="
          position:absolute; right:6px; top:50%;
          transform:translateY(-50%) scale(0.5) translateX(10px);
          opacity:0; pointer-events:none;
          display:flex; align-items:center; justify-content:center; gap:4px;
          border:none; border-radius:5px; padding:4px 8px;
          background:var(--ys-accent-bg); color:var(--ys-accent);
          font-size:11px; font-weight:600; line-height:1;
          cursor:pointer; white-space:nowrap;
          box-shadow:inset 0 0 0 1px var(--ys-accent-hover);
          transition:all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          z-index:3;
        "><span style="font-size:12px;">↵</span><span>Enter</span></button>
      </div>`;

    const categoryBar = document.createElement('div');
    categoryBar.id = 'ys-category-bar';
    Object.assign(categoryBar.style, {
        display:        'none',
        gap:            '6px',
        overflowX:      'auto',
        scrollbarWidth: 'none',
        flexShrink:     '0',
        alignItems:     'center',
    });
    categoryBar.addEventListener('wheel', (e) => {
        e.stopPropagation();
        const isHorizontal = Math.abs(e.deltaX) >= Math.abs(e.deltaY);
        if (isHorizontal) return; // 横向手势交给浏览器原生处理，保留惯性
        e.preventDefault();
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 40;
        else if (e.deltaMode === 2) delta *= categoryBar.offsetWidth;
        categoryBar.scrollLeft += delta;
    }, { passive: false });
    header.appendChild(categoryBar);

    const topActions = header.querySelector('#ys-top-actions');

    function createFluidButton(id, emoji, label, colors, titleAttr, opts = {}) {
        const resolveFluidColor = (value) => (
            typeof value === 'string' && value.startsWith('--') ? `var(${value})` : value
        );
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
            el.style.background = resolveFluidColor(c.defaultBg);
            const t = el.querySelector('.ys-btn-text');
            if (t) t.style.opacity = '0';
        }

        function applyFluidExpanded() {
            btn.style.maxWidth = '100px';
            btn.style.padding = '0 10px';
            btn.style.background = resolveFluidColor(colors.hoverBg);
            const t = btn.querySelector('.ys-btn-text');
            if (t) t.style.opacity = '1';
        }

        Object.assign(btn.style, {
            display: 'flex',
            alignItems: 'center',
            height: '28px',
            padding: '0 6px',
            background: resolveFluidColor(colors.defaultBg),
            border: `1px solid ${resolveFluidColor(colors.border)}`,
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
            <span class="ys-btn-text" style="font-size:11px; font-weight:600; color:${resolveFluidColor(colors.text)}; margin-left:6px; opacity:0; transition:opacity 0.48s ease; white-space:nowrap; pointer-events:none;">${label}</span>
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
    const aiGroupBtn = createFluidButton('ys-ai-group-btn', '🤖', ysT('btnAiGroup'), {
        defaultBg: '--ys-ai-bg',
        hoverBg: '--ys-ai-hover',
        border: '--ys-ai-border',
        text: '--ys-ai-text',
    }, ysT('btnAiGroupTitle'), { lockExpanded: true });

    const regretBtn = createFluidButton('ys-regret-btn', '💊', ysT('btnUndo'), {
        defaultBg: '--ys-btn-bg',
        hoverBg: '--ys-btn-hover',
        border: '--ys-btn-border',
        text: '--ys-btn-text',
    }, ysT('btnUndoTitle'));

    const settingsBtn = createFluidButton('ys-main-settings-btn', '⚙️', ysT('btnSettings'), {
        defaultBg: '--ys-btn-bg',
        hoverBg: '--ys-btn-hover',
        border: '--ys-btn-border',
        text: '--ys-btn-text',
    }, ysT('btnSettingsTitle'));

    topActions.appendChild(aiGroupBtn);
    topActions.appendChild(regretBtn);
    topActions.appendChild(settingsBtn);

    // AI 聚合按钮做一层更深的 hover 态，增强“可操作”感
    const AI_GROUP_HOVER_DEEP_BG = 'var(--ys-ai-hover-deep-bg)';
    const AI_GROUP_HOVER_DEEP_BORDER = 'var(--ys-ai-hover-deep-border)';
    aiGroupBtn.addEventListener('mouseenter', () => {
        aiGroupBtn.style.background = AI_GROUP_HOVER_DEEP_BG;
        aiGroupBtn.style.borderColor = AI_GROUP_HOVER_DEEP_BORDER;
    });
    aiGroupBtn.addEventListener('mouseleave', () => {
        aiGroupBtn.style.background = 'var(--ys-ai-hover)';
        aiGroupBtn.style.borderColor = 'var(--ys-ai-border)';
    });

    aiGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabsToProcess = switcherTabs.filter((t) => t.url && /^https?:\/\//i.test(t.url));
        if (tabsToProcess.length === 0) {
            showYsMessageToast(ysT('toastNoHttpTabs'), 2800);
            return;
        }

        // 埋点：AI 聚合按钮点击数（按日累计，次日上报）
        ysSendToBg({ action: 'track_event', feature: 'ai_aggregate' }, { maxRetries: 1 }, () => {});

        const finishProcessing = showProcessingToast(tabsToProcess.length);
        ysSendToBg({
            action: 'ai_batch_group',
            tabs: tabsToProcess,
            windowId: null,
        }, { maxRetries: 2 }, (res, err) => {
            finishProcessing();

            if (err) {
                showCustomToast(ysT('toastGroupFailed', [err]), 4000);
                return;
            }
            if (res && res.success) {
                showCustomToast(ysT('toastGroupSuccess', [String(res.groupCount)]), 3200);
                setTimeout(() => hideSwitcher(), 1500);
            } else {
                let hint = ysT('toastGroupIncomplete');
                if (res && res.error === 'no_api_key') hint = ysT('toastNeedApiKey');
                else if (res && res.error === 'rate_limit' && res.message) {
                    showCustomToast(res.message, 5200);
                    return;
                } else if (res && res.message) {
                    hint = res.message;
                    if (/failed to fetch|networkerror|load failed/i.test(hint)) {
                        hint = ysT('toastNetworkDeepSeek');
                    }
                } else if (res && res.error === 'parse_failed') hint = ysT('toastAiParseError');
                else if (res && res.error === 'no_http_tabs') hint = ysT('toastNoGroupableTabs');
                showCustomToast('⚠️ ' + hint, 5500);
            }
        });
    });

    regretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 埋点：后悔药按钮点击数（按日累计，次日上报）
        ysSendToBg({ action: 'track_event', feature: 'undo' }, { maxRetries: 1 }, () => {});
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
            position: 'absolute', top: '36px', right: '0', background: 'var(--ys-settings-bg)',
            backdropFilter: 'saturate(180%) blur(30px)', WebkitBackdropFilter: 'saturate(180%) blur(30px)',
            border: '1px solid var(--ys-settings-border)', boxShadow: 'var(--ys-settings-shadow)',
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
            item.innerHTML = `<span style="margin-right:8px;font-size:13px;flex-shrink:0;">${icon}</span><span style="font-size:12px;font-weight:600;color:var(--ys-text-title);white-space:nowrap;">${text}</span>`;

            item.addEventListener('mouseenter', () => item.style.background = 'var(--ys-settings-item-hover)');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!isToggle) menu.remove();
                onClick(item);
            });
            return item;
        };

        const showThemeModeModal = () => {
            if (typeof openYsModal !== 'function') {
                showCustomToast(ysT('themeModalNotReady'), 2200);
                return;
            }
            openYsModal(ysT('themeModalTitle'), (container) => {
                chrome.storage.local.get({ themeMode: 'system' }, (resTheme) => {
                    const modes = [
                        { val: 'light', icon: '☀️', title: ysT('themeLight') },
                        { val: 'system', icon: '💻', title: ysT('themeSystem') },
                        { val: 'dark', icon: '🌙', title: ysT('themeDark') },
                    ];
                    let currentThemeMode = resTheme.themeMode;

                    const root = document.createElement('div');
                    Object.assign(root.style, {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                    });

                    const segmentWrap = document.createElement('div');
                    Object.assign(segmentWrap.style, {
                        display: 'flex',
                        justifyContent: 'center',
                    });

                    const segmentCtrl = document.createElement('div');
                    Object.assign(segmentCtrl.style, {
                        display: 'flex',
                        background: 'var(--ys-btn-bg)',
                        borderRadius: '10px',
                        padding: '4px',
                        gap: '6px',
                    });

                    const renderSegmentState = () => {
                        Array.from(segmentCtrl.children).forEach((c, idx) => {
                            const active = currentThemeMode === modes[idx].val;
                            c.style.background = active ? 'var(--ys-accent-bg)' : 'transparent';
                            c.style.border = active ? '1px solid var(--ys-accent-hover)' : '1px solid transparent';
                            c.style.boxShadow = active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none';
                            c.style.opacity = active ? '1' : '0.65';
                        });
                    };

                    modes.forEach((m) => {
                        const btn = document.createElement('div');
                        btn.textContent = m.icon;
                        btn.title = m.title;
                        Object.assign(btn.style, {
                            minWidth: '52px',
                            height: '34px',
                            padding: '0 14px',
                            fontSize: '18px',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            border: '1px solid transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.2s, box-shadow 0.2s, opacity 0.2s',
                        });
                        btn.addEventListener('mouseenter', () => {
                            if (currentThemeMode !== m.val) btn.style.background = 'var(--ys-btn-hover)';
                        });
                        btn.addEventListener('mouseleave', () => {
                            if (currentThemeMode !== m.val) btn.style.background = 'transparent';
                        });
                        btn.addEventListener('click', () => {
                            currentThemeMode = m.val;
                            chrome.storage.local.set({ themeMode: currentThemeMode });
                            if (typeof ysApplyDataThemeAttr === 'function') ysApplyDataThemeAttr(currentThemeMode);
                            else document.documentElement.setAttribute('data-ys-theme', currentThemeMode);
                            renderSegmentState();
                        });
                        segmentCtrl.appendChild(btn);
                    });
                    renderSegmentState();

                    const caption = document.createElement('div');
                    caption.textContent = ysT('themeCaption');
                    Object.assign(caption.style, {
                        marginTop: '2px',
                        paddingTop: '2px',
                        textAlign: 'center',
                        fontSize: '11px',
                        color: 'var(--ys-text-muted)',
                        letterSpacing: '0.03em',
                        lineHeight: '1.6',
                    });

                    segmentWrap.appendChild(segmentCtrl);
                    root.appendChild(segmentWrap);
                    root.appendChild(caption);
                    container.replaceChildren(root);
                });
            });
        };

        let langHoverReady = true;

        const showLanguageModeModal = () => {
            langHoverReady = false;
            if (typeof openYsModal !== 'function') {
                showCustomToast(ysT('themeModalNotReady'), 2200);
                return;
            }
            openYsModal(ysT('languageModalTitle'), (container) => {
                chrome.storage.local.get({ uiLanguage: 'auto' }, (resLang) => {
                    const modes = [
                        { val: 'zh_CN', label: '中文' },
                        { val: 'en', label: 'English' },
                    ];
                    let currentLang = resLang.uiLanguage || 'auto';
                    if (currentLang === 'system') currentLang = 'auto';
                    // auto 视为浏览器语言对应的那一个
                    const resolved = (typeof ysGetResolvedLanguage === 'function') ? ysGetResolvedLanguage() : 'zh_CN';

                    const root = document.createElement('div');
                    Object.assign(root.style, {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                    });

                    const segmentWrap = document.createElement('div');
                    Object.assign(segmentWrap.style, {
                        display: 'flex',
                        justifyContent: 'center',
                    });

                    const segmentCtrl = document.createElement('div');
                    Object.assign(segmentCtrl.style, {
                        position: 'relative',
                        display: 'flex',
                        background: 'var(--ys-btn-bg)',
                        borderRadius: '10px',
                        padding: '4px',
                        gap: '6px',
                    });

                    const segmentHighlight = document.createElement('div');
                    Object.assign(segmentHighlight.style, {
                        position: 'absolute',
                        top: '4px',
                        bottom: '4px',
                        left: '0',
                        width: '72px',
                        borderRadius: '8px',
                        background: 'var(--ys-accent-bg)',
                        border: '1px solid var(--ys-accent-hover)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.04)',
                        transition: 'transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        pointerEvents: 'none',
                        zIndex: '0',
                        willChange: 'transform',
                    });
                    segmentCtrl.appendChild(segmentHighlight);

                    const syncLangSegment = () => {
                        // auto 时高亮浏览器语言对应的按钮；手动选择后直接高亮选中项
                        const activeLang = currentLang === 'auto' ? resolved : currentLang;
                        const idx = Math.max(0, modes.findIndex((x) => x.val === activeLang));
                        const btn = segmentCtrl.children[idx + 1];
                        if (btn && btn !== segmentHighlight) {
                            segmentHighlight.style.width = btn.offsetWidth + 'px';
                            segmentHighlight.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
                        }
                        Array.from(segmentCtrl.children).forEach((c, i) => {
                            if (i === 0) return;
                            const modeIdx = i - 1;
                            const active = activeLang === modes[modeIdx].val;
                            c.style.opacity = active ? '1' : '0.6';
                            c.style.fontWeight = active ? '700' : '500';
                            c.style.transform = active ? 'scale(1.05)' : 'scale(1)';
                        });
                    };

                    modes.forEach((m) => {
                        const btn = document.createElement('div');
                        btn.textContent = m.label;
                        Object.assign(btn.style, {
                            position: 'relative',
                            zIndex: '1',
                            minWidth: '72px',
                            height: '34px',
                            padding: '0 14px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: 'var(--ys-text-primary)',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            border: '1px solid transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'opacity 0.3s ease, background 0.2s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), font-weight 0.15s ease',
                            background: 'transparent',
                            willChange: 'transform, opacity',
                        });
                        btn.addEventListener('mouseenter', () => {
                            if (!langHoverReady) return;
                            const on = currentLang === 'auto' ? resolved : currentLang;
                            if (on !== m.val) btn.style.background = 'var(--ys-btn-hover)';
                        });
                        btn.addEventListener('mouseleave', () => {
                            const on = currentLang === 'auto' ? resolved : currentLang;
                            if (on !== m.val) btn.style.background = 'transparent';
                        });
                        btn.addEventListener('click', () => {
                            currentLang = m.val;
                            langHoverReady = false;
                            chrome.storage.local.set({ uiLanguage: currentLang }, () => {
                                // 平滑过渡：先淡出模态框，再重建面板
                                const modalOverlay = Array.from(document.querySelectorAll('body > div')).find(
                                    (el) => el.style.zIndex === '2147483648'
                                );
                                const switcherOverlay = document.getElementById('ys-switcher-overlay');

                                const rebuild = () => {
                                    ysRefreshI18nFromStorage(() => {
                                        const oldMenu = document.getElementById('ys-settings-dropdown');
                                        if (oldMenu) oldMenu.remove();
                                        showSwitcher(switcherTabs, true, switcherCurrentWindowId);
                                    });
                                };

                                if (modalOverlay) {
                                    modalOverlay.style.transition = 'opacity 0.2s ease';
                                    modalOverlay.style.opacity = '0';
                                    setTimeout(() => {
                                        modalOverlay.remove();
                                        rebuild();
                                    }, 200);
                                } else {
                                    rebuild();
                                }
                            });
                            syncLangSegment();
                        });
                        segmentCtrl.appendChild(btn);
                    });
                    segmentCtrl.addEventListener('mousemove', () => {
                        langHoverReady = true;
                    }, { once: true });
                    requestAnimationFrame(() => {
                        requestAnimationFrame(syncLangSegment);
                    });

                    const caption = document.createElement('div');
                    caption.textContent = ysT('languageCaption');
                    Object.assign(caption.style, {
                        marginTop: '2px',
                        paddingTop: '2px',
                        textAlign: 'center',
                        fontSize: '11px',
                        color: 'var(--ys-text-muted)',
                        letterSpacing: '0.03em',
                        lineHeight: '1.6',
                    });

                    segmentWrap.appendChild(segmentCtrl);
                    root.appendChild(segmentWrap);
                    root.appendChild(caption);
                    container.replaceChildren(root);
                });
            });
        };

        chrome.storage.local.get({ showFloatingWidget: true }, (res) => {
            // 1. 界面语言
            menu.appendChild(createItem('🌐', ysT('menuLanguage'), showLanguageModeModal));

            // 2. 修饰键设置
            menu.appendChild(createItem('⌨️', ysT('menuModifierKeys'), showModifierSettingsModal));

            // 3. 主题模式（弹窗内三段式）
            menu.appendChild(createItem('🎨', ysT('menuTheme'), showThemeModeModal));

            // 4. API Key 设置
            menu.appendChild(createItem('🔑', ysT('menuApiKey'), showApiKeyModal));

            // 5. 统计浮窗开关
            const isEnabled = res.showFloatingWidget !== false;
            const floatToggle = createItem(
                isEnabled ? '🟢' : '⚪',
                isEnabled ? ysT('menuFloatingStatsOn') : ysT('menuFloatingStatsOff'),
                (itemEl) => {
                    chrome.storage.local.get({ showFloatingWidget: true }, (r) => {
                        const nextState = r.showFloatingWidget === false;
                        chrome.storage.local.set({ showFloatingWidget: nextState }, () => {
                            itemEl.querySelector('span:first-child').innerText = nextState ? '🟢' : '⚪';
                            itemEl.querySelector('span:last-child').innerText = nextState
                                ? ysT('menuFloatingStatsOn')
                                : ysT('menuFloatingStatsOff');
                        });
                    });
                },
                true
            );
            menu.appendChild(floatToggle);

            // 6. 使用指引（手动呼出，不写永久消除标记）
            menu.appendChild(createItem('📖', ysT('menuOnboarding'), () => {
                if (document.getElementById('ys-onboarding')) return;
                if (typeof showYsOnboarding !== 'function') return;
                const mk = typeof modifierKey !== 'undefined' ? modifierKey : 'meta';
                const ml = (typeof MOD_LABELS !== 'undefined' && MOD_LABELS[mk]) || mk;
                // 埋点：用户从设置菜单手动再次打开使用指引
                ysSendToBg({ action: 'track_event', feature: 'onboarding_reopen' }, { maxRetries: 1 }, () => {});
                showYsOnboarding(ml, null);
            }));

            // 7. 主动呼出好评/反馈弹窗
            menu.appendChild(createItem('👏', ysT('menuRateExtension'), () => {
                const flyoutId = 'ys-feedback-flyout';
                if (typeof renderFeedbackFlyout === 'function') {
                    if (document.getElementById(flyoutId)) return;
                    renderFeedbackFlyout(flyoutId, 'ysFeedbackDismissed');
                } else {
                    showCustomToast(ysT('feedbackFlyoutNotReady'), 2200);
                }
            }));

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
        overflowX:  'hidden',
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
        item.style.opacity = '1';
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
        if (item.dataset.selected !== 'true' && item.dataset.activeInSourceWindow !== 'true') {
            item.style.opacity = '0.8';
        }
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
        if (dragJustEnded) return;
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
        const switchPayload = { action: 'switch_tab', tabId };
        if (winIdRaw) {
            const windowId = Number(winIdRaw);
            if (Number.isFinite(windowId)) {
                switchPayload.action = 'switch_tab_global';
                switchPayload.windowId = windowId;
            }
        }
        hideSwitcher();
        ysSendToBg(switchPayload, { maxRetries: 3 }, (res, err) => {
            if (err || !res || !res.success) {
                const msg = err || (res && res.error) || ysT('toastPrevTabUnknown');
                showYsMessageToast(ysT('toastSwitchFailed', [String(msg)]), 2800);
            }
        });
    });


    const submitWebSearchSlot = { submitWebSearch: null };
    const listApi = ysSwitcherAttachListRenderBundle(mode, listContainer, card, submitWebSearchSlot, tabs);
    const {
        renderList,
        renderWebSuggestions,
        requestWebSuggestions,
        moveWebSuggestionSelection,
        getSelectedWebSuggestion,
        isWebSuggestionKeyboardNavActive,
        clearWebSuggestionKeyboardNavActive,
        invalidateAiSearch,
        invalidateWebSuggestions,
    } = listApi;

    // ── 分类 Bar ────────────────────────────────────────────────────────────────
    let catBarTopics = [];
    let catBarHasOther = false;

    function renderCategoryPills() {
        categoryBar.innerHTML = '';
        const allCats = ['全部', ...catBarTopics, ...(catBarHasOther ? ['其他'] : [])];
        allCats.forEach((cat) => {
            const isActive = cat === '全部' ? switcherActiveCategory === null : switcherActiveCategory === cat;
            let count;
            if (cat === '全部') {
                count = tabs.length;
            } else if (cat === '其他') {
                count = tabs.filter((t) => !switcherAiTopicMap[String(t.id)]).length;
            } else {
                count = tabs.filter((t) => switcherAiTopicMap[String(t.id)] === cat).length;
            }
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.dataset.cat = cat;
            pill.textContent = `${cat}·${count}`;
            Object.assign(pill.style, {
                flexShrink:   '0',
                padding:      '3px 10px',
                borderRadius: '20px',
                fontSize:     '12px',
                fontWeight:   isActive ? '600' : '400',
                cursor:       'pointer',
                border:       `1px solid ${isActive ? 'var(--ys-accent-hover)' : 'var(--ys-card-border)'}`,
                background:   isActive ? 'var(--ys-accent-bg)' : 'var(--ys-search-bg)',
                color:        isActive ? 'var(--ys-accent)' : 'var(--ys-text-secondary)',
                transition:   'all 0.22s cubic-bezier(0.16,1,0.3,1)',
                outline:      'none',
                whiteSpace:   'nowrap',
                lineHeight:   '1.6',
                userSelect:   'none',
                WebkitUserSelect: 'none',
            });
            pill.addEventListener('click', () => {
                const nextCat = cat === '全部' ? null : cat;
                switcherActiveCategory = nextCat;
                const si = document.getElementById('ys-search-input');
                if (si) si.value = '';
                renderCategoryPills();
                const currentRows = listContainer.querySelectorAll('.ys-group-row');
                if (currentRows.length > 0) {
                    currentRows.forEach((row) => {
                        row.style.transition = 'opacity 0.1s ease, transform 0.1s ease';
                        row.style.opacity = '0';
                        row.style.transform = 'translateY(6px)';
                    });
                    setTimeout(() => {
                        renderList('', { restoreScroll: false, preferActive: true, animate: false, stagger: true });
                    }, 100);
                } else {
                    renderList('', { restoreScroll: false, preferActive: true, animate: false, stagger: true });
                }
            });
            categoryBar.appendChild(pill);
        });
    }

    if (!isRefresh) switcherActiveCategory = null;

    // ── 分类 pill 公共函数 ──────────────────────────────────────────────────────
    function _applyCategoryBar(topics, animate) {
        if (topics.length === 0) {
            categoryBar.style.display = 'none';
            if (switcherActiveCategory !== null) {
                switcherActiveCategory = null;
                renderList('', { restoreScroll: false, preferActive: true, animate });
            }
            return;
        }
        catBarTopics = topics;
        catBarHasOther = tabs.some((t) => !switcherAiTopicMap[String(t.id)]);
        if (switcherActiveCategory !== null
            && switcherActiveCategory !== '其他'
            && !topics.includes(switcherActiveCategory)) {
            switcherActiveCategory = null;
            renderCategoryPills();
            renderList('', { restoreScroll: false, preferActive: true, animate });
        } else {
            renderCategoryPills();
        }
        categoryBar.style.display = 'flex';
    }

    function _collectTopics() {
        const seen = new Set();
        const topics = [];
        tabs.forEach((t) => {
            const topic = switcherAiTopicMap[String(t.id)];
            if (topic && !seen.has(topic)) { seen.add(topic); topics.push(topic); }
        });
        return topics;
    }

    function _syncCategoryBar(topics, animate) {
        if (topics.length === 0) { _applyCategoryBar(topics, animate); return; }
        ysSendToBg({ action: 'get_tab_group_titles' }, {}, (res) => {
            const groupTitles = res && res.titles ? new Set(res.titles) : null;
            _applyCategoryBar(groupTitles ? topics.filter((t) => groupTitles.has(t)) : topics, animate);
        });
    }

    function _buildTopicMap(raw) {
        switcherAiTopicMap = {};
        if (!raw || !raw.entries) return;
        const tabIds = new Set(tabs.map((t) => String(t.id)));
        const _isEn = ysGetResolvedLanguage() === 'en';
        for (const [tabId, entry] of Object.entries(raw.entries)) {
            const topic = _isEn ? (entry.topic_en || '') : (entry.topic || '');
            if (tabIds.has(tabId) && topic) switcherAiTopicMap[tabId] = topic;
        }
    }

    // ── 初次渲染分类 pill ─────────────────────────────────────────────────────
    chrome.storage.local.get('aiSnapshotV1', (storageRes) => {
        _buildTopicMap(storageRes && storageRes.aiSnapshotV1);
        _syncCategoryBar(_collectTopics(), false);
    });

    // 供 background 推送 refresh_category_bar 消息时实时重建 pills
    window.__ysRefreshCategoryBar = () => {
        if (!switcherVisible) return;
        chrome.storage.local.get('aiSnapshotV1', (storageRes) => {
            _buildTopicMap(storageRes && storageRes.aiSnapshotV1);
            _syncCategoryBar(_collectTopics(), true);
        });
    };

    // ── 拖拽到分类 ──────────────────────────────────────────────────────────────
    // 上次面板可能留下残影，先清掉
    document.getElementById('ys-drag-thumbnail')?.remove();

    let dragState = null;    // { tabId, tab, floatEl, originEl, started }
    let dragPending = null;  // { tabId, tab, originEl, startX, startY }
    let dragJustEnded = false;

    // ── 置顶槽 ──────────────────────────────────────────────────────────────────
    const YS_PINNED_KEY   = 'ysPinnedTabs';
    const YS_PINNED_COUNT = 3;
    let pinnedSlots  = [null, null, null];  // 单列 3 槽
    let pinnedSide   = 'left';              // 当前列在哪侧
    let pinnedCol    = null;                // 单列 DOM 元素
    let isDragShowingPinnedCol = false;     // 是否因拖拽而强制显示列

    function isInsideCard(x, y) {
        const r = card.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function getPinnedSlotAt(x, y) {
        if (!pinnedCol || pinnedCol.style.display === 'none') return null;
        for (const el of pinnedCol.children) {
            const r = el.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return { idx: parseInt(el.dataset.pinnedIdx, 10), el };
            }
        }
        return null;
    }

    function highlightPinnedTarget(slot) {
        if (!pinnedCol) return;
        for (const wrapper of pinnedCol.children) {
            const slotEl = wrapper.firstElementChild;
            if (!slotEl) continue;
            const matched = slot && parseInt(wrapper.dataset.pinnedIdx, 10) === slot.idx;
            const isEmpty = !wrapper.dataset.pinnedData;
            if (isEmpty) {
                // 空槽：在 slot 上叠加 hover 色，不会触发合成（slot 永不 transform）
                const iconEl = slotEl.children[0];
                if (matched) {
                    slotEl.style.background = 'rgba(120,180,255,0.16)';
                    slotEl.style.boxShadow  = 'inset 0 0 0 1px rgba(120,180,255,0.30), 0 8px 30px rgba(120,180,255,0.08)';
                    if (iconEl) iconEl.style.opacity = '0.85';
                } else {
                    slotEl.style.background = 'var(--ys-search-bg)';
                    slotEl.style.boxShadow  = 'inset 0 0 0 1px rgba(255,255,255,0.16)';
                    if (iconEl) iconEl.style.opacity = '0.28';
                }
            } else {
                // 填充槽：描边层在 wrapper 内、slot 同级；切换 borderColor 即贴边描边
                const outlineEl = wrapper.querySelector('.ys-slot-outline');
                if (outlineEl) outlineEl.style.borderColor = matched ? 'rgba(120,180,255,0.55)' : 'transparent';
                slotEl.style.boxShadow = '0 4px 20px rgba(0,0,0,0.16), 0 1px 5px rgba(0,0,0,0.08)';
            }
        }
    }

    function setPinnedSlot(idx, data) {
        pinnedSlots[idx] = data;
        renderPinnedCol();
        chrome.storage.local.set({ [YS_PINNED_KEY]: { slots: pinnedSlots, side: pinnedSide } });
        ysSendToBg({ action: 'track_event', feature: data ? 'pin_to_dock' : 'unpin_from_dock' }, { maxRetries: 1 }, () => {});
    }

    function renderPinnedCol() {
        if (!pinnedCol) return;
        pinnedCol.replaceChildren();
        for (let i = 0; i < YS_PINNED_COUNT; i++) {
            pinnedCol.appendChild(buildPinnedSlotEl(pinnedSlots[i], i));
        }
    }

    window.__ysRemovePinnedTab = (tabId) => {
        let changed = false;
        for (let i = 0; i < YS_PINNED_COUNT; i++) {
            if (pinnedSlots[i] && pinnedSlots[i].tabId === tabId) { pinnedSlots[i] = null; changed = true; }
        }
        if (changed) {
            renderPinnedCol();
            if (!pinnedSlots.some(s => s) && !isDragShowingPinnedCol) hidePinnedCol();
            chrome.storage.local.set({ [YS_PINNED_KEY]: { slots: pinnedSlots, side: pinnedSide } });
        }
    };

    function buildPinnedSlotEl(data, idx) {
        // 外层 wrapper：只承载 transform / opacity 动画（staggerSlotsIn、磁吸归位等）
        // 与 backdrop-filter 物理隔离，杜绝同一元素同时持有 transform + backdrop-filter
        // 导致的 GPU 合成 artifact（红绿灯高度抖动、变白、黑边等）
        const wrapper = document.createElement('div');
        wrapper.dataset.pinnedIdx = String(idx);
        if (data) wrapper.dataset.pinnedData = '1';
        Object.assign(wrapper.style, {
            width:       '225px',
            height:      '170px',
            flexShrink:  '0',
            position:    'relative',
            transformOrigin: 'center center',
        });

        const slot = document.createElement('div');
        slot.dataset.pinnedIdx  = String(idx);
        if (data) slot.dataset.pinnedData = '1';
        slot.classList.add('ys-pinned-slot');
        Object.assign(slot.style, {
            width:        '100%',
            height:       '100%',
            borderRadius: '14px',
            boxSizing:    'border-box',
            overflow:     'hidden',
            userSelect:   'none',
            position:     'relative',
            outline:      'none',
            WebkitTapHighlightColor: 'transparent',
            transition:   'background 0.22s cubic-bezier(0.16,1,0.3,1), box-shadow 0.22s cubic-bezier(0.16,1,0.3,1)',
        });

        if (!data) {
            Object.assign(slot.style, {
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            '8px',
                cursor:         'default',
                background:     'var(--ys-search-bg)',
                boxShadow:      'inset 0 0 0 1px rgba(255,255,255,0.16)',
            });
            const icon = document.createElement('div');
            icon.textContent = '📌';
            icon.style.cssText = 'font-size:20px;opacity:0.28;line-height:1;flex-shrink:0;transition:opacity 0.22s cubic-bezier(0.16,1,0.3,1);';
            const hint = document.createElement('div');
            hint.textContent = ysT('pinnedSlotHint') || 'Drop to Pin';
            Object.assign(hint.style, {
                fontSize:   '10px',
                color:      'var(--ys-text-secondary)',
                opacity:    '0.85',
                textAlign:  'center',
                lineHeight: '1.5',
                padding:    '0 16px',
            });
            slot.appendChild(icon);
            slot.appendChild(hint);
        } else {
            Object.assign(slot.style, {
                display:              'flex',
                flexDirection:        'column',
                cursor:               'pointer',
                border:               '1px solid rgba(255,255,255,0.18)',
                background:           'var(--ys-card-bg)',
                backdropFilter:       'saturate(180%) blur(30px)',
                WebkitBackdropFilter: 'saturate(180%) blur(30px)',
                boxShadow:            '0 4px 20px rgba(0,0,0,0.16), 0 1px 5px rgba(0,0,0,0.08)',
            });

            // ── 顶栏：仿浏览器 ──
            const topBar = document.createElement('div');
            Object.assign(topBar.style, {
                padding:      '7px 11px',
                background:   'var(--ys-search-bg)',
                borderBottom: '1px solid var(--ys-divider)',
                display:      'flex',
                alignItems:   'center',
                gap:          '6px',
                flexShrink:   '0',
            });
            const dots = document.createElement('div');
            dots.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';
            ['#ff5f57', '#febc2e', '#28c840'].forEach((c) => {
                const d = document.createElement('div');
                d.style.cssText = `width:6px;height:6px;border-radius:50%;background:${c};`;
                dots.appendChild(d);
            });
            topBar.appendChild(dots);
            const domainEl = document.createElement('span');
            domainEl.textContent = data.siteName || '';
            Object.assign(domainEl.style, {
                fontSize:     '10px',
                color:        'var(--ys-text-secondary)',
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
                flex:         '1',
                minWidth:     '0',
            });
            topBar.appendChild(domainEl);
            slot.appendChild(topBar);

            // ── 内容区：favicon 居中 + 下方网页名 ──
            const body = document.createElement('div');
            Object.assign(body.style, {
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            '8px',
                padding:        '10px 12px',
                flex:           '1',
                minHeight:      '0',
            });

            // Favicon（大）
            const favWrap = document.createElement('div');
            Object.assign(favWrap.style, {
                width:          '36px',
                height:         '36px',
                borderRadius:   '10px',
                background:     'var(--ys-search-bg)',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                flexShrink:     '0',
                overflow:       'hidden',
            });
            if (data.favicon) {
                const imgBody = document.createElement('img');
                imgBody.src = data.favicon;
                imgBody.draggable = false;
                Object.assign(imgBody.style, { width: '22px', height: '22px', borderRadius: '4px', pointerEvents: 'none' });
                imgBody.onerror = () => {
                    imgBody.remove();
                    const ltr = document.createElement('span');
                    ltr.textContent = (data.siteName || data.title || '?')[0].toUpperCase();
                    Object.assign(ltr.style, { fontSize: '16px', fontWeight: '700', color: 'var(--ys-text-primary)' });
                    favWrap.appendChild(ltr);
                };
                favWrap.appendChild(imgBody);
            } else {
                const ltr = document.createElement('span');
                ltr.textContent = (data.siteName || data.title || '?')[0].toUpperCase();
                Object.assign(ltr.style, { fontSize: '16px', fontWeight: '700', color: 'var(--ys-text-primary)' });
                favWrap.appendChild(ltr);
            }
            body.appendChild(favWrap);

            // 网站名 + 页面标题
            const textCol = document.createElement('div');
            Object.assign(textCol.style, {
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           '3px',
                width:         '100%',
            });
            const titleEl = document.createElement('div');
            titleEl.textContent = data.title || '';
            Object.assign(titleEl.style, {
                fontSize:     '11px',
                fontWeight:   '600',
                color:        'var(--ys-text-primary)',
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
                width:        '100%',
                textAlign:    'center',
            });
            textCol.appendChild(titleEl);
            const _resolvedLabel = data.pageLabel ? ysResolveDisplayedPageLabel(data.pageLabel) : '';
            if (_resolvedLabel) {
                const topicTag = document.createElement('div');
                topicTag.textContent = _resolvedLabel;
                Object.assign(topicTag.style, {
                    marginTop:    '5px',
                    padding:      '2px 8px',
                    borderRadius: '20px',
                    fontSize:     '9px',
                    fontWeight:   '500',
                    color:        'var(--ys-ai-text)',
                    background:   'var(--ys-ai-bg)',
                    border:       '1px solid var(--ys-ai-border)',
                    whiteSpace:   'nowrap',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth:     '100%',
                });
                textCol.appendChild(topicTag);
            }
            body.appendChild(textCol);
            slot.appendChild(body);

        }

        // 数字角标：左列 1-3，右列 4-6
        const numBadge = document.createElement('div');
        numBadge.textContent = String(idx + 1);
        Object.assign(numBadge.style, {
            position:     'absolute',
            top:          '7px',
            right:        '8px',
            width:        '16px',
            height:       '16px',
            borderRadius: '50%',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            fontSize:     '9px',
            fontWeight:   '700',
            lineHeight:   '1',
            background:   data ? 'rgba(0,0,0,0.18)' : 'rgba(128,128,128,0.14)',
            color:        data ? 'rgba(255,255,255,0.7)' : 'var(--ys-text-muted)',
            pointerEvents:'none',
            userSelect:   'none',
        });
        slot.appendChild(numBadge);

        if (data) {
            slot.addEventListener('mouseenter', () => {
                slot.style.boxShadow  = '0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1)';
            });
            slot.addEventListener('mouseleave', () => {
                slot.style.boxShadow  = '0 4px 20px rgba(0,0,0,0.16), 0 1px 5px rgba(0,0,0,0.08)';
            });

            // 从槽拖拽：拖出删除 / 拖到其他槽互换
            slot.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                let isDragging = false;
                const startX = e.clientX;
                const startY = e.clientY;
                let floatEl  = null;

                const onSlotMove = (me) => {
                    const dx = me.clientX - startX;
                    const dy = me.clientY - startY;
                    if (dx * dx + dy * dy >= 64) isDragging = true;
                    if (!isDragging) return;
                    // 首次创建浮动缩略图（与列表拖拽样式一致）
                    if (!floatEl) {
                        const pseudoTab = { url: data.url || '', title: data.title || '', favIconUrl: data.favicon || '' };
                        floatEl = createDragThumbnail(pseudoTab);
                        floatEl.id = '';  // 避免与列表拖拽冲突
                        floatEl.style.transform = 'rotate(-1.5deg) scale(1.04)';
                        document.body.appendChild(floatEl);
                        requestAnimationFrame(() => { if (floatEl) floatEl.style.opacity = '1'; });
                        wrapper.style.opacity = '0.4';
                    }
                    floatEl.style.left = `${me.clientX - 90}px`;
                    floatEl.style.top  = `${me.clientY - 30}px`;
                    highlightPinnedTarget(getPinnedSlotAt(me.clientX, me.clientY));
                };

                const onSlotUp = (ue) => {
                    document.removeEventListener('mousemove', onSlotMove);
                    document.removeEventListener('mouseup',   onSlotUp);
                    highlightPinnedTarget(null);

                    if (!isDragging) {
                        wrapper.style.opacity = '';
                        if (floatEl) { floatEl.remove(); floatEl = null; }
                        if (data.tabId) {
                            hideSwitcher();
                            ysSendToBg({ action: 'switch_tab_global', tabId: data.tabId, windowId: data.windowId }, { maxRetries: 3 }, () => {});
                        }
                        return;
                    }

                    const targetInfo = getPinnedSlotAt(ue.clientX, ue.clientY);
                    if (targetInfo && targetInfo.idx !== idx) {
                        // ── 互换：floatEl 飞入目标槽，槽位本身不动 ──
                        const sourceIdx     = idx;
                        const swapTargetIdx = targetInfo.idx;
                        const targetWrapper = targetInfo.el;
                        const slotRect      = targetWrapper.getBoundingClientRect();

                        if (floatEl) {
                            const thumbLeft = parseFloat(floatEl.style.left) || 0;
                            const thumbTop  = parseFloat(floatEl.style.top)  || 0;
                            const dx = (slotRect.left + slotRect.width  / 2) - (thumbLeft + 90);
                            const dy = (slotRect.top  + slotRect.height / 2) - (thumbTop  + 50);
                            floatEl.style.transition = 'transform 360ms cubic-bezier(0.16,1,0.3,1), opacity 160ms cubic-bezier(0.4,0,1,1) 200ms';
                            floatEl.style.transform  = `translate(${dx}px, ${dy}px) scale(0.94)`;
                            floatEl.style.opacity    = '0';
                        }
                        const _f = floatEl; floatEl = null;

                        // 目标槽微光响应：描边层贴边亮一下再恢复
                        const targetOutlineEl = targetWrapper.querySelector('.ys-slot-outline');
                        if (targetOutlineEl) {
                            targetOutlineEl.style.borderColor = 'rgba(120,180,255,0.55)';
                            setTimeout(() => { targetOutlineEl.style.borderColor = 'transparent'; }, 260);
                        }

                        setTimeout(() => {
                            if (_f && _f.parentNode) _f.remove();

                            // ── FLIP Step 1: 记录旧位置 ──
                            wrapper.style.opacity = '';
                            const oldRects = [];
                            for (let i = 0; i < pinnedCol.children.length; i++) {
                                oldRects.push(pinnedCol.children[i].getBoundingClientRect());
                            }

                            // ── 执行 swap + 重建 DOM ──
                            const targetData = pinnedSlots[swapTargetIdx] || null;
                            pinnedSlots[sourceIdx]     = targetData;
                            pinnedSlots[swapTargetIdx] = data;
                            renderPinnedCol();
                            chrome.storage.local.set({ [YS_PINNED_KEY]: { slots: pinnedSlots, side: pinnedSide } });

                            // ── FLIP Step 2+3: Invert → Play ──
                            const newWrappers = pinnedCol.children;
                            for (let i = 0; i < newWrappers.length; i++) {
                                const w = newWrappers[i];
                                const newRect = w.getBoundingClientRect();
                                const dx = oldRects[i].left - newRect.left;
                                const dy = oldRects[i].top  - newRect.top;
                                if (dx === 0 && dy === 0) continue;
                                w.style.transition = 'none';
                                w.style.transform  = `translate(${dx}px, ${dy}px) scale(0.98)`;
                                w.getBoundingClientRect();
                                requestAnimationFrame(() => {
                                    w.style.transition = 'transform 300ms cubic-bezier(0.16,1,0.3,1)';
                                    w.style.transform  = '';
                                });
                            }
                        }, 380);
                    } else if (!targetInfo) {
                        // 拖出删除：垃圾桶动画——缩小旋转后消失
                        wrapper.style.opacity = '';
                        if (floatEl) {
                            floatEl.style.transition = 'transform 0.3s cubic-bezier(0.55, 0, 1, 1), opacity 0.22s ease 0.08s';
                            floatEl.style.transform  = 'translate(0, 28px) scale(0.05) rotate(8deg)';
                            floatEl.style.opacity    = '0';
                            const _f = floatEl; floatEl = null;
                            setTimeout(() => _f.remove(), 340);
                        }
                        setPinnedSlot(idx, null);
                        if (!pinnedSlots.some(s => s) && !isDragShowingPinnedCol) hidePinnedCol();
                    } else {
                        // 放回原位：普通淡出
                        wrapper.style.opacity = '';
                        if (floatEl) {
                            floatEl.style.opacity = '0';
                            const _f = floatEl; floatEl = null;
                            setTimeout(() => _f.remove(), 150);
                        }
                    }
                };

                document.addEventListener('mousemove', onSlotMove);
                document.addEventListener('mouseup',   onSlotUp);
            });
        }

        wrapper.appendChild(slot);

        // 贴边描边层：放在 wrapper 内、slot 同级。inset:0 对齐 wrapper（= slot 外缘），
        // 完整覆盖 slot 自己的 1px 半透明 border，2px 蓝色描边能严丝合缝沿圆角贴边。
        const outlineLayer = document.createElement('div');
        outlineLayer.className = 'ys-slot-outline';
        Object.assign(outlineLayer.style, {
            position:      'absolute',
            inset:         '0',
            borderRadius:  '14px',
            border:        '2px solid transparent',
            pointerEvents: 'none',
            boxSizing:     'border-box',
            zIndex:        '10',
            transition:    'border-color 0.22s cubic-bezier(0.16,1,0.3,1)',
        });
        wrapper.appendChild(outlineLayer);

        return wrapper;
    }

    function createDragThumbnail(tab) {
        const el = document.createElement('div');
        el.id = 'ys-drag-thumbnail';
        Object.assign(el.style, {
            position:           'fixed',
            zIndex:             '2147483647',
            width:              '180px',
            borderRadius:       '10px',
            overflow:           'hidden',
            boxShadow:          '0 12px 40px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.14)',
            border:             '1px solid var(--ys-card-border)',
            background:         'var(--ys-card-bg)',
            backdropFilter:     'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            transform:          'rotate(2deg) scale(1.03)',
            pointerEvents:      'none',
            userSelect:         'none',
            opacity:            '0',
            transition:         'opacity 0.12s ease, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
        });

        // 仿浏览器顶栏
        const topBar = document.createElement('div');
        Object.assign(topBar.style, {
            padding:         '6px 8px',
            background:      'var(--ys-search-bg)',
            borderBottom:    '1px solid var(--ys-divider)',
            display:         'flex',
            alignItems:      'center',
            gap:             '5px',
        });
        const dots = document.createElement('div');
        dots.style.cssText = 'display:flex;gap:3px;flex-shrink:0;';
        ['#ff5f57', '#febc2e', '#28c840'].forEach((c) => {
            const d = document.createElement('div');
            d.style.cssText = `width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;`;
            dots.appendChild(d);
        });
        topBar.appendChild(dots);

        const iconUrl = typeof resolveTabIconUrl === 'function' ? resolveTabIconUrl(tab, 32) : '';
        if (iconUrl) {
            const img = document.createElement('img');
            img.src = iconUrl;
            Object.assign(img.style, { width: '12px', height: '12px', flexShrink: '0', borderRadius: '2px' });
            img.onerror = () => img.remove();
            topBar.appendChild(img);
        }
        const domain = document.createElement('span');
        try { domain.textContent = new URL(tab.url || '').hostname.replace(/^www\./, ''); }
        catch { domain.textContent = ''; }
        Object.assign(domain.style, {
            fontSize: '9px', color: 'var(--ys-text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: '1', minWidth: '0',
        });
        topBar.appendChild(domain);
        el.appendChild(topBar);

        // 内容区
        const body = document.createElement('div');
        Object.assign(body.style, { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '5px' });

        const titleEl = document.createElement('div');
        titleEl.textContent = tab.title || '';
        Object.assign(titleEl.style, {
            fontSize: '10px', fontWeight: '600', color: 'var(--ys-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: '1.3', marginBottom: '3px',
        });
        body.appendChild(titleEl);

        [72, 52, 84, 44].forEach((w) => {
            const line = document.createElement('div');
            Object.assign(line.style, {
                height: '4px', width: `${w}%`, borderRadius: '3px',
                background: 'var(--ys-text-secondary)', opacity: '0.15',
            });
            body.appendChild(line);
        });
        el.appendChild(body);
        return el;
    }

    function getDragOverPill(x, y) {
        // 先限定在 categoryBar 可视区内，避免 overflowX:auto 滚出去的 pill 误命中
        const barRect = categoryBar.getBoundingClientRect();
        if (x < barRect.left || x > barRect.right || y < barRect.top || y > barRect.bottom) return null;
        for (const pill of categoryBar.querySelectorAll('button')) {
            const r = pill.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pill;
        }
        return null;
    }

    function applyDragPillHighlight(hoveredPill, overSlot) {
        // 缩略图：悬停 pill 时缩到极小；悬停置顶槽时略微缩小；其他时正常
        if (dragState && dragState.floatEl) {
            dragState.floatEl.style.transform = hoveredPill
                ? 'scale(0.12)'
                : overSlot
                    ? 'scale(0.72) rotate(-2deg)'
                    : 'rotate(2deg) scale(1.03)';
        }
        categoryBar.querySelectorAll('button').forEach((pill) => {
            if (pill === hoveredPill) {
                Object.assign(pill.style, {
                    background: 'var(--ys-accent)',
                    color:      '#fff',
                    border:     '1px solid var(--ys-accent)',
                    fontWeight: '600',
                });
            } else {
                const cat = pill.dataset.cat || pill.textContent.trim();
                const isActive = cat === '全部' ? switcherActiveCategory === null : switcherActiveCategory === cat;
                Object.assign(pill.style, {
                    background: isActive ? 'var(--ys-accent-bg)' : 'transparent',
                    color:      isActive ? 'var(--ys-accent)' : 'var(--ys-text-secondary)',
                    border:     `1px solid ${isActive ? 'var(--ys-accent-hover)' : 'var(--ys-divider)'}`,
                    fontWeight: isActive ? '600' : '400',
                });
            }
        });
    }

    function flashDropPill(pill) {
        pill.style.transition = 'all 0.1s ease';
        Object.assign(pill.style, { background: 'var(--ys-accent)', color: '#fff', transform: 'scale(1.14)' });
        setTimeout(() => {
            pill.style.transform = 'scale(1.0)';
            setTimeout(() => renderCategoryPills(), 150);
        }, 120);
    }

    function persistTopicChange(tabId, tab, newTopic) {
        const _lang = ysGetResolvedLanguage() === 'en' ? 'en' : 'zh';
        // 让 background 更新内存缓存 + storage + 移动 Chrome 原生标签组
        ysSendToBg({ action: 'update_tab_topic', tabId, topic: newTopic, lang: _lang }, {}, () => {});

        // domain 级偏好按语言分别存储，互不干扰
        if (newTopic && tab && tab.url) {
            try {
                const { hostname } = new URL(tab.url);
                const parts = hostname.split('.');
                const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
                const prefsKey = _lang === 'en' ? 'ysUserTopicPrefs_en' : 'ysUserTopicPrefs';
                if (domain) {
                    chrome.storage.local.get(prefsKey, (res) => {
                        const prefs = (res && res[prefsKey]) || {};
                        prefs[domain] = newTopic;
                        chrome.storage.local.set({ [prefsKey]: prefs });
                    });
                }
            } catch {}
        }

        // 埋点
        ysSendToBg({ action: 'track_event', feature: 'drag_reclassify' }, { maxRetries: 1 }, () => {});

        // toast 提示用户偏好已记忆
        showCustomToast(ysT('toastTopicLearned'), 2500);
    }

    const onDragMouseMove = (e) => {
        if (!dragState) {
            if (!dragPending) return;
            const dx = e.clientX - dragPending.startX;
            const dy = e.clientY - dragPending.startY;
            if (dx * dx + dy * dy < 25) return; // 5px 阈值

            // 达到阈值，正式开始拖拽
            const { tab, originEl } = dragPending;
            const floatEl = createDragThumbnail(tab);
            floatEl.style.left = `${e.clientX - 90}px`;
            floatEl.style.top  = `${e.clientY - 30}px`;
            document.body.appendChild(floatEl);
            requestAnimationFrame(() => { floatEl.style.opacity = '1'; });

            originEl.style.pointerEvents = 'none';

            dragState  = { ...dragPending, floatEl, started: true };
            dragPending = null;

            // 拖拽开始，置顶列暂不显示，等鼠标移出面板再出现
            isDragShowingPinnedCol = true;
            return;
        }

        // 移动缩略图
        dragState.floatEl.style.left = `${e.clientX - 90}px`;
        dragState.floatEl.style.top  = `${e.clientY - 30}px`;

        // Stage 1：靠近边缘时主面板边缘渐显发光（「系统感知用户意图」）
        // Stage 2/3：鼠标越过边界才显示置顶列（dock 浮现）
        const _cardR = card.getBoundingClientRect();
        if (e.clientX < _cardR.left || e.clientX > _cardR.right) {
            setEdgeGlow(null); // dock 接管，取消感知光
            showPinnedColOnSide(e.clientX < _cardR.left ? 'left' : 'right');
        } else {
            const distLeft  = e.clientX - _cardR.left;
            const distRight = _cardR.right - e.clientX;
            if (distLeft < EDGE_SENSE_DIST && distLeft <= distRight) {
                setEdgeGlow('left');
            } else if (distRight < EDGE_SENSE_DIST) {
                setEdgeGlow('right');
            } else {
                setEdgeGlow(null);
            }
        }

        const _inCard  = isInsideCard(e.clientX, e.clientY);
        const _overPill = _inCard ? getDragOverPill(e.clientX, e.clientY) : null;
        const _overSlot = !_inCard ? getPinnedSlotAt(e.clientX, e.clientY) : null;
        applyDragPillHighlight(_overPill, _overSlot);
        highlightPinnedTarget(_overSlot);
    };

    const onDragMouseUp = (e) => {
        document.removeEventListener('mousemove', onDragMouseMove);
        document.removeEventListener('mouseup',   onDragMouseUp);

        if (!dragState || !dragState.started) {
            dragPending = null;
            dragState   = null;
            return;
        }

        dragJustEnded = true;
        setTimeout(() => { dragJustEnded = false; }, 0);
        setEdgeGlow(null); // 拖拽结束统一清除「感知」发光

        const { tabId, tab: dragTab, floatEl, originEl } = dragState;
        dragState   = null;
        dragPending = null;

        const _upInCard  = isInsideCard(e.clientX, e.clientY);
        const targetPill = _upInCard ? getDragOverPill(e.clientX, e.clientY) : null;
        if (targetPill) {
            // 飞入 pill 动画：计算缩略图中心到 pill 中心的位移，animate 过去再消失
            const pillRect  = targetPill.getBoundingClientRect();
            const thumbLeft = parseFloat(floatEl.style.left) || 0;
            const thumbTop  = parseFloat(floatEl.style.top)  || 0;
            const dx = (pillRect.left + pillRect.width  / 2) - (thumbLeft + 90);
            const dy = (pillRect.top  + pillRect.height / 2) - (thumbTop  + 50);

            floatEl.style.transition = 'transform 360ms cubic-bezier(0.16,1,0.3,1), opacity 160ms cubic-bezier(0.4,0,1,1) 200ms';
            floatEl.style.transform  = `translate(${dx}px, ${dy}px) scale(0.05)`;
            floatEl.style.opacity    = '0';
            setTimeout(() => floatEl.remove(), 320);

            const cat = targetPill.dataset.cat || targetPill.textContent.trim();
            const newTopic = (cat === '全部' || cat === '其他') ? null : cat;
            const tabIdStr = String(tabId);

            if (newTopic === null) delete switcherAiTopicMap[tabIdStr];
            else switcherAiTopicMap[tabIdStr] = newTopic;

            persistTopicChange(tabIdStr, dragTab, newTopic);
            flashDropPill(targetPill);

            if (switcherActiveCategory !== null) {
                renderList('', { restoreScroll: false, preferActive: false, animate: true });
            } else {
                originEl.style.pointerEvents = '';
                renderCategoryPills();
            }
            isDragShowingPinnedCol = false;
            if (!pinnedSlots.some(s => s)) hidePinnedCol();
        } else {
            const targetPinnedSlot = !_upInCard ? getPinnedSlotAt(e.clientX, e.clientY) : null;
            if (targetPinnedSlot) {
                // ── 磁吸归位：floatEl 飞入，槽位稳定不动 ──
                const targetWrapper = targetPinnedSlot.el;
                const targetIdx     = targetPinnedSlot.idx;
                const slotRect  = targetWrapper.getBoundingClientRect();
                const thumbLeft = parseFloat(floatEl.style.left) || 0;
                const thumbTop  = parseFloat(floatEl.style.top)  || 0;
                const dx = (slotRect.left + slotRect.width  / 2) - (thumbLeft + 90);
                const dy = (slotRect.top  + slotRect.height / 2) - (thumbTop  + 50);

                // floatEl 飞入：260ms apple-ease，末段缩小+淡出
                floatEl.style.transition = 'transform 360ms cubic-bezier(0.16,1,0.3,1), opacity 160ms cubic-bezier(0.4,0,1,1) 200ms';
                floatEl.style.transform  = `translate(${dx}px, ${dy}px) scale(0.94)`;
                floatEl.style.opacity    = '0';

                originEl.style.pointerEvents = '';
                highlightPinnedTarget(null);
                applyDragPillHighlight(null, null);

                let hostname = '';
                try { hostname = new URL(dragTab.url || '').hostname.replace(/^www\./, ''); } catch {}
                const pinnedData = {
                    tabId:    parseInt(tabId, 10),
                    title:    dragTab.title    || '',
                    url:      dragTab.url      || '',
                    favicon:  dragTab.favIconUrl || '',
                    siteName: hostname,
                    windowId: dragTab.windowId || null,
                    pageLabel: tabPageLabelMap[parseInt(tabId, 10)] ?? tabPageLabelMap[String(tabId)] ?? null,
                };
                isDragShowingPinnedCol = false;

                // 目标槽微光响应
                const targetSlotEl = targetWrapper.firstElementChild;
                if (targetSlotEl) {
                    targetSlotEl.style.boxShadow = 'inset 0 0 0 2px rgba(120,180,255,0.40), 0 8px 30px rgba(120,180,255,0.10)';
                    setTimeout(() => { targetSlotEl.style.boxShadow = ''; }, 260);
                }

                // floatEl 消失后渲染 pinned card，新内容淡入
                const _floatRef = floatEl;
                setTimeout(() => {
                    if (_floatRef && _floatRef.parentNode) _floatRef.remove();
                    setPinnedSlot(targetIdx, pinnedData);
                    renderCategoryPills();

                    // 新 pinned card 淡入：opacity 0→1, translateY 4px→0
                    requestAnimationFrame(() => {
                        const newWrapper = pinnedCol.children[targetIdx];
                        if (!newWrapper) return;
                        const newSlot = newWrapper.firstElementChild;
                        if (!newSlot) return;
                        newSlot.style.transition = 'none';
                        newSlot.style.opacity     = '0';
                        newSlot.style.transform   = 'translateY(4px)';
                        newSlot.getBoundingClientRect();
                        newSlot.style.transition = `transform 220ms ${APPLE_EASE}, opacity 260ms ${APPLE_EASE}`;
                        newSlot.style.opacity     = '1';
                        newSlot.style.transform   = 'translateY(0)';
                    });
                }, 260);
                // 落入置顶槽后保持显示，让用户看到结果
            } else {
                // 取消：缩略图淡出，恢复行
                floatEl.style.opacity = '0';
                setTimeout(() => floatEl.remove(), 150);
                originEl.style.opacity       = '';
                originEl.style.pointerEvents = '';
                highlightPinnedTarget(null);
                renderCategoryPills();
                isDragShowingPinnedCol = false;
                if (!pinnedSlots.some(s => s)) hidePinnedCol();
            }
        }
    };

    listContainer.addEventListener('mousedown', (e) => {
        const item = e.target.closest('[data-tab-id]');
        if (!item) return;

        const tabId = item.dataset.tabId;
        const tab   = tabs.find((t) => String(t.id) === tabId);
        if (!tab) return;

        dragPending = { tabId, tab, originEl: item, startX: e.clientX, startY: e.clientY };
        dragState   = null;
        document.addEventListener('mousemove', onDragMouseMove);
        document.addEventListener('mouseup',   onDragMouseUp);
    });

    card.appendChild(header);
    card.appendChild(listContainer);

    const footer = document.createElement('div');
    Object.assign(footer.style, {
        padding: '12px 20px',
        background: 'var(--ys-footer-bg)',
        borderTop: '1px solid var(--ys-divider)',
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
            lab.textContent = ysT('footerPrevTab');
            Object.assign(lab.style, {
                fontSize: '11px',
                color: 'var(--ys-text-muted)',
                flexShrink: '0',
                whiteSpace: 'nowrap',
            });
            left.appendChild(lab);

            const lastTabIcon = resolveTabIconUrl(lt, 64);
            if (lastTabIcon) {
                const img = document.createElement('img');
                img.src = lastTabIcon;
                img.width = 14;
                img.height = 14;
                Object.assign(img.style, {
                    width: '14px',
                    height: '14px',
                    objectFit: 'contain',
                    flexShrink: '0',
                    borderRadius: '2px',
                    display: 'block',
                });
                img.onerror = () => { img.style.display = 'none'; };
                left.appendChild(img);
            }

            const titleEl = document.createElement('span');
            titleEl.textContent = lt.title || ysT('footerUntitled');
            Object.assign(titleEl.style, {
                fontSize: '12px',
                color: 'var(--ys-text-secondary)',
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
            hint.textContent = ysT('footerQuickSwitch', [modLabel]);
            Object.assign(hint.style, {
                fontSize: '11px',
                color: 'var(--ys-accent)',
                fontWeight: '600',
                paddingLeft: '8px',
                whiteSpace: 'nowrap',
                flexShrink: '0',
            });

            footer.appendChild(left);
            footer.appendChild(hint);
        } else {
            const empty = document.createElement('div');
            empty.textContent = ysT('footerEmptyPrevTab');
            Object.assign(empty.style, { fontSize: '11px', color: 'var(--ys-text-muted)' });
            footer.appendChild(empty);
        }
    });

    card.appendChild(footer);

    // 单列置顶槽（默认隐藏，拖拽时出现）
    // ── 置顶列：绝对定位，紧贴主面板，淡入 + 解模糊 + 微滑 ───────────────────────
    pinnedCol = document.createElement('div');
    Object.assign(pinnedCol.style, {
        position:        'absolute',
        top:             '50%',
        display:         'none',
        flexDirection:   'column',
        justifyContent:  'space-between',
        flexShrink:      '0',
        padding:         '0 6px',
        boxSizing:       'border-box',
        opacity:         '0',
        filter:          'blur(12px)',
        transform:       'translateY(-50%)',
        willChange:      'opacity, filter, transform',
        pointerEvents:   'none',
    });

    const APPLE_EASE      = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const SHOW_DURATION   = 320;
    const HIDE_DURATION   = 260;
    const DOCK_DELAY      = 40;  // dock 比主面板晚出现的毫秒数
    const DOCK_GAP            = 28;  // dock 到主面板的间距
    const DOCK_WIDTH          = 237; // dock 宽度（slot 225 + padding 12）
    const CARD_WIDTH_BASE     = 700; // 主面板默认宽度
    const CARD_WIDTH_EXPANDED = 740; // 主面板「让出空间」时的扩张宽度
    // 主面板让出 (dock宽 + gap)/2，确保 pair 整体在 viewport 居中
    const CARD_SHIFT          = (DOCK_WIDTH + DOCK_GAP) / 2;
    const DOCK_SLIDE          = 8;   // dock 入场时从外侧滑入的距离
    const EDGE_SENSE_DIST     = 80;  // 光标到主面板边距 < 此值时，触发「感知」发光
    const BASE_SHADOW         = 'var(--ys-card-shadow)';
    let   _currentGlowSide    = null;

    function setEdgeGlow(side) {
        if (side === _currentGlowSide) return;
        _currentGlowSide = side;
        if (side === 'left') {
            card.style.boxShadow = `${BASE_SHADOW}, -28px 0 64px -12px var(--ys-accent-glow)`;
        } else if (side === 'right') {
            card.style.boxShadow = `${BASE_SHADOW}, 28px 0 64px -12px var(--ys-accent-glow)`;
        } else {
            card.style.boxShadow = BASE_SHADOW;
        }
    }
    let _pinnedHideTimer  = null;

    function setPinnedColPosition(side) {
        // dock 紧贴扩张后的主面板边缘
        const off = CARD_WIDTH_EXPANDED / 2 - CARD_SHIFT + DOCK_GAP;
        if (side === 'left') {
            pinnedCol.style.right = `calc(50% + ${off}px)`;
            pinnedCol.style.left  = '';
        } else {
            pinnedCol.style.left  = `calc(50% + ${off}px)`;
            pinnedCol.style.right = '';
        }
    }

    function staggerSlotsIn() {
        const slots = Array.from(pinnedCol.children);
        slots.forEach((slot, i) => {
            const delay = 30 + i * 20;
            slot.style.transition = 'none';
            slot.style.opacity    = '0';
            slot.style.transform  = 'translateY(6px)';
            slot.style.filter     = 'blur(4px)';
            slot.getBoundingClientRect();
            slot.style.transition = `transform 220ms ${APPLE_EASE} ${delay}ms, opacity 280ms ${APPLE_EASE} ${delay}ms, filter 320ms ${APPLE_EASE} ${delay}ms`;
            slot.style.opacity    = '1';
            slot.style.transform  = 'translateY(0)';
            slot.style.filter     = 'blur(0)';
        });
    }

    function showPinnedColOnSide(side, animate = true) {
        if (_pinnedHideTimer) { clearTimeout(_pinnedHideTimer); _pinnedHideTimer = null; }

        const wasHidden   = pinnedCol.style.display === 'none';
        const sideChanged = side !== pinnedSide;
        pinnedSide = side;
        setPinnedColPosition(side);

        // 主面板：朝远离 dock 的方向轻移 + 扩张宽度（让出空间，而不是被推开）
        const cardX = side === 'left' ? CARD_SHIFT : -CARD_SHIFT;
        if (animate) {
            card.style.transition = `transform 260ms ${APPLE_EASE}, opacity 340ms ${APPLE_EASE}, width ${SHOW_DURATION}ms ${APPLE_EASE}, background 0.3s ease, box-shadow 0.3s ease`;
        }
        card.style.opacity   = '1';
        card.style.transform = `translate(${cardX}px, 0)`;
        card.style.width     = CARD_WIDTH_EXPANDED + 'px';

        if (!animate) {
            // 即时到位，无入场动画
            pinnedCol.style.display       = 'flex';
            pinnedCol.style.transition    = 'none';
            pinnedCol.style.opacity       = '1';
            pinnedCol.style.filter        = 'blur(0)';
            pinnedCol.style.transform     = 'translateY(-50%) translate(0, 0)';
            pinnedCol.style.pointerEvents = 'auto';
            return;
        }

        // dock 入场：opacity + translateX + blur，比主面板晚 DOCK_DELAY
        if (wasHidden || sideChanged) {
            const slideFrom = side === 'left' ? -DOCK_SLIDE : DOCK_SLIDE;
            pinnedCol.style.display    = 'flex';
            pinnedCol.style.transition = 'none';
            pinnedCol.style.opacity    = '0';
            pinnedCol.style.filter     = 'blur(6px)';
            pinnedCol.style.transform  = `translateY(-50%) translate(${slideFrom}px, 0)`;
            pinnedCol.getBoundingClientRect();
        }

        setTimeout(() => {
            pinnedCol.style.transition    = `transform 260ms ${APPLE_EASE}, opacity 340ms ${APPLE_EASE}, filter 380ms ${APPLE_EASE}`;
            pinnedCol.style.opacity       = '1';
            pinnedCol.style.filter        = 'blur(0)';
            pinnedCol.style.transform     = 'translateY(-50%) translate(0, 0)';
            pinnedCol.style.pointerEvents = 'auto';
        }, wasHidden || sideChanged ? DOCK_DELAY : 0);

        if (wasHidden || sideChanged) staggerSlotsIn();
    }

    function hidePinnedCol() {
        if (_pinnedHideTimer) { clearTimeout(_pinnedHideTimer); _pinnedHideTimer = null; }

        // dock 和主面板一起退场（分速：transform 最快，opacity 中间，blur 最慢）
        const slideTo = pinnedSide === 'left' ? -DOCK_SLIDE : DOCK_SLIDE;
        pinnedCol.style.transition    = `transform 220ms ${APPLE_EASE}, opacity 280ms ${APPLE_EASE}, filter 320ms ${APPLE_EASE}`;
        pinnedCol.style.opacity       = '0';
        pinnedCol.style.filter        = 'blur(6px)';
        pinnedCol.style.transform     = `translateY(-50%) translate(${slideTo}px, 0)`;
        pinnedCol.style.pointerEvents = 'none';

        card.style.transition = `transform 220ms ${APPLE_EASE}, opacity 280ms ${APPLE_EASE}, width ${HIDE_DURATION}ms ${APPLE_EASE}, background 0.3s ease, box-shadow 0.3s ease`;
        card.style.opacity   = '1';
        card.style.transform = 'translate(0, 0)';
        card.style.width     = CARD_WIDTH_BASE + 'px';

        _pinnedHideTimer = setTimeout(() => {
            pinnedCol.style.display = 'none';
            _pinnedHideTimer = null;
        }, HIDE_DURATION);
    }

    overlay.appendChild(card);
    overlay.appendChild(pinnedCol);   // dock 绝对定位，作为 overlay 子节点（与 card 同层）
    document.body.appendChild(overlay);

    // 立即渲染空槽，保证拖拽触发显示时已有内容（不依赖 storage 回调）
    renderPinnedCol();

    // 列高度跟卡片高度同步：3 个 170 槽的自然总高作为保底，避免 card 太矮时槽位被压扁
    const syncPinnedColHeight = () => {
        const h = card.offsetHeight;
        const minH = YS_PINNED_COUNT * 170;
        if (h > 0) pinnedCol.style.height = Math.max(h, minH) + 'px';
    };
    // pinnedColRO 提到 01 模块作用域，hideSwitcher 里统一 disconnect
    if (pinnedColRO) { try { pinnedColRO.disconnect(); } catch (_) {} }
    pinnedColRO = new ResizeObserver(syncPinnedColHeight);
    pinnedColRO.observe(card);
    requestAnimationFrame(syncPinnedColHeight);

    // 从 storage 加载置顶数据（兼容旧格式 {left,right}）
    chrome.storage.local.get(YS_PINNED_KEY, (res) => {
        if (res && res[YS_PINNED_KEY]) {
            const saved = res[YS_PINNED_KEY];
            if (Array.isArray(saved.slots)) {
                pinnedSlots = saved.slots.slice(0, YS_PINNED_COUNT).map((v) => v || null);
            } else if (saved.left || saved.right) {
                const l = Array.isArray(saved.left)  ? saved.left  : [];
                const r = Array.isArray(saved.right) ? saved.right : [];
                for (let i = 0; i < YS_PINNED_COUNT; i++) {
                    pinnedSlots[i] = l[i] || r[i] || null;
                }
            }
            if (saved.side === 'right') pinnedSide = 'right';
        }
        renderPinnedCol();
        // 有任意置顶数据则一直展示；无数据保持隐藏，仅拖拽时临时出现
        if (pinnedSlots.some(s => s)) showPinnedColOnSide(pinnedSide, false);
    });

    let lockedCardMinHeight = '';
    const searchInput = document.getElementById('ys-search-input');
    const webSearchEnterBtn = document.getElementById('ys-web-search-enter-btn');
    const searchBarWrapper = document.getElementById('ys-search-bar-wrapper');
    const webSearchHint = document.getElementById('ys-web-search-hint');
    const webModeWord = document.getElementById('ys-web-mode-word');
    const webModeHighlight = document.getElementById('ys-web-mode-highlight');
    let webModeWordPulseAnim = null;
    const ensureWebModeWordPulse = () => {
        if (!webModeHighlight || webModeWordPulseAnim) return;
        webModeWordPulseAnim = webModeHighlight.animate(
            [
                { opacity: 0.78 },
                { opacity: 0.95 },
            ],
            {
                duration: 2400,
                iterations: Infinity,
                direction: 'alternate',
                easing: 'ease-in-out',
            }
        );
    };
    ensureWebModeWordPulse();
    const applyListModeUi = () => {
        const listContainerEl = document.getElementById('ys-switcher-list');
        if (!listContainerEl) return;
        listContainerEl.style.transition = 'opacity 0.3s ease, filter 0.3s ease';
        listContainerEl.style.opacity = '1';
        listContainerEl.style.filter = 'none';
        listContainerEl.style.pointerEvents = 'auto';
    };
    const submitWebSearch = () => {
        const keyword = searchInput ? String(searchInput.value || '').trim() : '';
        if (!keyword) return;
        // 埋点：网页搜索点击数（按日累计，次日上报）
        ysSendToBg({ action: 'track_event', feature: 'web_search' }, { maxRetries: 1 }, () => {});
        ysSendToBg({ action: 'search_web', keyword }, {}, (res, err) => {
            if (err || !res || !res.success) {
                const errMsg = (res && res.error) ? String(res.error) : (err || ysT('errorWebSearchFailed'));
                showCustomToast(`⚠️ ${errMsg}`, 2600);
                return;
            }
            hideSwitcher();
        });
    };
    submitWebSearchSlot.submitWebSearch = submitWebSearch;

    const applySearchModeUi = () => {
        if (!searchInput) return;
        if (mode.isWebSearchMode) {
            // 锁住当前高度，防止切换时列表清空导致面板缩小
            card.style.minHeight = card.offsetHeight + 'px';
            categoryBar.style.display = 'none';
            invalidateAiSearch();
            // 先清场，避免上一模式结果残留；再按当前输入拉建议
            renderWebSuggestions([], '', { animate: true });
            searchInput.placeholder = ysSwitcherPlaceholderWeb();
            searchInput.style.paddingRight = '88px';
            if (webSearchEnterBtn) {
                webSearchEnterBtn.style.opacity = '1';
                webSearchEnterBtn.style.transform = 'translateY(-50%) scale(1) translateX(0)';
                webSearchEnterBtn.style.pointerEvents = 'auto';
            }
            if (webSearchHint) {
                webSearchHint.style.display = 'none';
                webSearchHint.style.opacity = '0';
            }
            requestWebSuggestions(searchInput.value, true);
        } else {
            // 切回标签模式时恢复初始高度锁
            card.style.minHeight = lockedCardMinHeight;
            if (catBarTopics.length > 0 || catBarHasOther) categoryBar.style.display = 'flex';
            invalidateWebSuggestions();
            searchInput.placeholder = ysSwitcherPlaceholderDefault();
            searchInput.style.paddingRight = '12px';
            if (webSearchEnterBtn) {
                webSearchEnterBtn.style.opacity = '0';
                webSearchEnterBtn.style.transform = 'translateY(-50%) scale(0.5) translateX(10px)';
                webSearchEnterBtn.style.pointerEvents = 'none';
            }
            if (webSearchHint) {
                webSearchHint.style.display = 'block';
                webSearchHint.style.opacity = String(searchInput.value || '').trim() ? '0' : '1';
            }
        }
        applyListModeUi();
    };

    if (webSearchEnterBtn) {
        webSearchEnterBtn.addEventListener('mouseenter', () => {
            webSearchEnterBtn.style.background = 'var(--ys-accent-hover)';
            webSearchEnterBtn.style.color = 'var(--ys-accent)';
        });
        webSearchEnterBtn.addEventListener('mouseleave', () => {
            webSearchEnterBtn.style.background = 'var(--ys-accent-bg)';
            webSearchEnterBtn.style.color = 'var(--ys-accent)';
        });
        webSearchEnterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!mode.isWebSearchMode) return;
            submitWebSearch();
        });
    }

    if (searchInput) {
        searchInput.value = preservedKeyword;
        applySearchModeUi();
        searchInput.addEventListener('input', (e) => {
            if (webSearchHint && !mode.isWebSearchMode) {
                webSearchHint.style.opacity = String(e.target.value || '').trim() ? '0' : '1';
            }
            if (mode.isWebSearchMode) {
                requestWebSuggestions(e.target.value, false);
                return;
            }
            if (switcherActiveCategory !== null) {
                switcherActiveCategory = null;
                renderCategoryPills();
            }
            invalidateAiSearch();
            switcherSelIdx = 0;
            renderList(e.target.value, { restoreScroll: false, preferActive: false, animate: true });
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                if (mode.isTabAnimating) return;
                mode.isTabAnimating = true;

                if (!searchBarWrapper) {
                    mode.isWebSearchMode = !mode.isWebSearchMode;
                    applySearchModeUi();
                    if (!mode.isWebSearchMode) {
                        invalidateAiSearch();
                        switcherSelIdx = 0;
                        renderList(searchInput.value, { restoreScroll: false, preferActive: false, animate: false, stagger: true });
                    }
                    mode.isTabAnimating = false;
                    return;
                }

                searchInput.style.transition = 'transform 0.12s ease-in, opacity 0.12s ease-in';
                searchInput.style.transform = 'translateX(-15px)';
                searchInput.style.opacity = '0';
                if (webSearchHint) webSearchHint.style.opacity = '0';

                setTimeout(() => {
                    if (!switcherVisible || !searchInput.isConnected) {
                        mode.isTabAnimating = false;
                        return;
                    }
                    mode.isWebSearchMode = !mode.isWebSearchMode;
                    applySearchModeUi();
                    if (!mode.isWebSearchMode) {
                        invalidateAiSearch();
                        switcherSelIdx = 0;
                        renderList(searchInput.value, { restoreScroll: false, preferActive: false, animate: false, stagger: true });
                    }

                    searchInput.style.transition = 'none';
                    searchInput.style.transform = 'translateX(15px)';
                    void searchInput.offsetHeight;

                    searchInput.style.transition = 'transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.15s ease-out';
                    searchInput.style.transform = 'translateX(0)';
                    searchInput.style.opacity = '1';

                    setTimeout(() => {
                        mode.isTabAnimating = false;
                    }, 150);
                }, 120);
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (mode.isWebSearchMode) {
                    moveWebSuggestionSelection(e.key === 'ArrowDown' ? 1 : -1);
                    return;
                }
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (mode.isWebSearchMode) {
                    const selectedSuggestion = getSelectedWebSuggestion();
                    if (selectedSuggestion) {
                        searchInput.value = selectedSuggestion;
                    }
                    submitWebSearch();
                    return;
                }
                const activeItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
                if (activeItem) activeItem.click();
            }
        });
        searchInput.addEventListener('focus', () => {
            if (!searchBarWrapper) return;
            searchBarWrapper.style.background = 'var(--ys-search-focus-bg)';
            searchBarWrapper.style.borderColor = 'var(--ys-search-focus-border)';
            searchBarWrapper.style.boxShadow = 'var(--ys-search-focus-shadow)';
        });
        searchInput.addEventListener('blur', () => {
            if (!searchBarWrapper) return;
            searchBarWrapper.style.background = 'var(--ys-search-bg)';
            searchBarWrapper.style.borderColor = 'var(--ys-search-border)';
            searchBarWrapper.style.boxShadow = 'var(--ys-search-shadow)';
        });
    }

    switcherKeydownHandler = (e) => {
        if (!switcherVisible) return;
        const focusedEl = document.activeElement;
        const inputFocused = !!focusedEl && focusedEl.id === 'ys-search-input';
        if (mode.isWebSearchMode && !inputFocused) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveWebSuggestionSelection(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (e.key === 'Enter') {
                if (e.isComposing) return;
                e.preventDefault();
                const selectedSuggestion = getSelectedWebSuggestion();
                if (selectedSuggestion && searchInput) {
                    searchInput.value = selectedSuggestion;
                }
                submitWebSearch();
                return;
            }
        }
        if (mode.isWebSearchMode && inputFocused) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') return;
        }
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
        if (mode.isWebSearchMode && isWebSuggestionKeyboardNavActive()) {
            clearWebSuggestionKeyboardNavActive();
        }
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

    // 双 rAF：第一帧让浏览器绘制初始态（opacity:0, blur, translateY），
    // 第二帧才触发 transition，保证动画一定生效
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            const hasDockData = pinnedSlots.some(s => s);
            const initialShiftX = hasDockData
                ? (pinnedSide === 'left' ? CARD_SHIFT : -CARD_SHIFT)
                : 0;
            card.style.opacity   = '1';
            card.style.transform = `translate(${initialShiftX}px, 0)`;
            if (hasDockData) card.style.width = CARD_WIDTH_EXPANDED + 'px';
            lockedCardMinHeight = card.offsetHeight + 'px';
            card.style.minHeight = lockedCardMinHeight;
            setTimeout(() => {
                if (searchInput) searchInput.focus();
            }, 50);
        });
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
                if (!label || (typeof label !== 'object' && typeof label !== 'string')) return;
                const prev = tabPageLabelMap[tabId];
                const changed = JSON.stringify(prev) !== JSON.stringify(label);
                if (changed) {
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
    ysSendToBg({ action: 'get_ai_snapshot', tabs: tabsForAi, lang: ysGetResolvedLanguage() === 'en' ? 'en' : 'zh' }, {}, (res, err) => {
        if (err) return;
        applyAiSnapshotToView(res);
    });
    ysSendToBg({ action: 'prewarm_ai_snapshot', tabs: tabsForAi }, {}, (res, err) => {
        if (err) return;
        applyAiSnapshotToView(res);
    });
}
