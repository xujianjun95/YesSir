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
        background:     'var(--ys-overlay-bg)',
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
        background:     'var(--ys-card-bg)',
        backdropFilter: 'saturate(180%) blur(32px)',
        WebkitBackdropFilter: 'saturate(180%) blur(32px)',
        border:         '1px solid var(--ys-card-border)',
        borderRadius:   '20px',
        boxShadow:      'var(--ys-card-shadow)',
        width:          '580px',
        maxHeight:      '65vh',
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        transform:      'scale(0.93) translateY(6px)',
        transition:     'transform 0.18s cubic-bezier(0.34,1.3,0.64,1), background 0.3s ease',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
        padding:        '16px 20px',
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
        transition:all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
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
        let tabsToProcess = switcherTabs.filter((t) => t.url && /^https?:\/\//i.test(t.url));
        if (switcherCurrentWindowId !== null && switcherCurrentWindowId !== undefined) {
            const wid = Number(switcherCurrentWindowId);
            tabsToProcess = tabsToProcess.filter((t) => Number(t.windowId) === wid);
        }
        if (tabsToProcess.length === 0) {
            showYsMessageToast(ysT('toastNoHttpTabs'), 2800);
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
            backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)',
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

        const showLanguageModeModal = () => {
            if (typeof openYsModal !== 'function') {
                showCustomToast(ysT('themeModalNotReady'), 2200);
                return;
            }
            openYsModal(ysT('languageModalTitle'), (container) => {
                chrome.storage.local.get({ uiLanguage: 'auto' }, (resLang) => {
                    const modes = [
                        { val: 'zh_CN', icon: '🇨🇳', title: ysT('languageChinese') },
                        { val: 'en', icon: '🇬🇧', title: ysT('languageEnglish') },
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
                        display: 'flex',
                        background: 'var(--ys-btn-bg)',
                        borderRadius: '10px',
                        padding: '4px',
                        gap: '6px',
                    });

                    const renderSegmentState = () => {
                        // auto 时高亮浏览器语言对应的按钮；手动选择后直接高亮选中项
                        const activeLang = currentLang === 'auto' ? resolved : currentLang;
                        Array.from(segmentCtrl.children).forEach((c, idx) => {
                            const active = activeLang === modes[idx].val;
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
                            if (currentLang !== m.val) btn.style.background = 'var(--ys-btn-hover)';
                        });
                        btn.addEventListener('mouseleave', () => {
                            if (currentLang !== m.val) btn.style.background = 'transparent';
                        });
                        btn.addEventListener('click', () => {
                            currentLang = m.val;
                            chrome.storage.local.set({ uiLanguage: currentLang }, () => {
                                ysRefreshI18nFromStorage(() => {
                                    // 关闭设置菜单和所有 openYsModal 模态框，整体刷新面板
                                    const oldMenu = document.getElementById('ys-settings-dropdown');
                                    if (oldMenu) oldMenu.remove();
                                    // openYsModal 创建的 overlay 挂在 document.body 上
                                    document.querySelectorAll('body > div').forEach((el) => {
                                        if (el.style.zIndex === '2147483648') el.remove();
                                    });
                                    showSwitcher(switcherTabs, true, switcherCurrentWindowId);
                                });
                            });
                            renderSegmentState();
                        });
                        segmentCtrl.appendChild(btn);
                    });
                    renderSegmentState();

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
            // 1. 修饰键设置
            menu.appendChild(createItem('⌨️', ysT('menuModifierKeys'), showModifierSettingsModal));

            // 2. API Key 设置
            menu.appendChild(createItem('🔑', ysT('menuApiKey'), showApiKeyModal));

            // 3. 主题模式（弹窗内三段式）
            menu.appendChild(createItem('🎨', ysT('menuTheme'), showThemeModeModal));

            // 4. 界面语言
            menu.appendChild(createItem('🌐', ysT('menuLanguage'), showLanguageModeModal));

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

            // 6. 主动呼出好评/反馈弹窗（放到统计浮窗下面）
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
    overlay.appendChild(card);
    document.body.appendChild(overlay);

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
                        renderList(searchInput.value, { restoreScroll: false, preferActive: false, animate: true });
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
                        renderList(searchInput.value, { restoreScroll: false, preferActive: false, animate: true });
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
    ysSendToBg({ action: 'get_ai_snapshot', tabs: tabsForAi }, {}, (res, err) => {
        if (err) return;
        applyAiSnapshotToView(res);
    });
    ysSendToBg({ action: 'prewarm_ai_snapshot', tabs: tabsForAi }, {}, (res, err) => {
        if (err) return;
        applyAiSnapshotToView(res);
    });
}
