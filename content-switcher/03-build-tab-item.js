// ─── 03 单行标签 DOM（依赖 01 图标工具与 02 背景色）────────────────────────────────

/** 中英双语归纳标签中取当前界面应展示的一条（含字符串旧数据兼容） */
function ysResolveDisplayedPageLabel(raw) {
    const preferEn = typeof ysIsEnglishPageLabelsPreferred === 'function' && ysIsEnglishPageLabelsPreferred();
    let text = '';
    if (raw && typeof raw === 'object') {
        text = preferEn ? String(raw.en || '').trim() : String(raw.zh || '').trim();
        if (!text) text = preferEn ? String(raw.zh || '').trim() : String(raw.en || '').trim();
    } else if (typeof raw === 'string') {
        text = raw.trim();
    }
    if (!text) return '';

    // 英文泛指词黑名单（与后台 EN_LABEL_BLACKLIST 保持一致）
    const _enBlacklist = new Set([
        'page', 'article', 'website', 'other', 'tab', 'content', 'info',
        'online', 'web', 'site', 'link', 'home', 'default', 'unknown',
        'misc', 'general', 'new tab', 'new page', 'blank', 'empty', 'loading',
    ]);
    const isEnBlacklisted = (s) => {
        const lower = s.toLowerCase();
        if (_enBlacklist.has(lower)) return true;
        const words = lower.split(/\s+/);
        const last = words[words.length - 1];
        if (words.length <= 2 && ['page', 'article', 'website', 'tab', 'content', 'site'].includes(last)) return true;
        return false;
    };

    const latinish = (s) => /^[\x20-\x7E]+$/.test(s);
    const asciiLabelOk = (s) => {
        const t = String(s).replace(/\s+/g, ' ');
        return t.length >= 3 && t.length <= 26 && latinish(t) && !isEnBlacklisted(t);
    };
    const zhLabelOk = (s) => {
        const n = Array.from(s).length;
        return n >= 2 && n <= 5;
    };

    if (preferEn) {
        if (asciiLabelOk(text)) return text.replace(/\s+/g, ' ');
        if (zhLabelOk(text)) return text;
        return '';
    }
    if (zhLabelOk(text)) return text;
    if (asciiLabelOk(text)) return text.replace(/\s+/g, ' ');
    return '';
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
        overflow:       'visible',
    });
    item.dataset.selected = 'false';
    item.dataset.activeInSourceWindow = 'false';
    // 事件委托所需的行标识（由 listContainer 上的统一监听读取）
    item.dataset.tabId = String(tab.id);
    item.dataset.globalIdx = String(globalIdx);
    item.dataset.windowId = typeof tab.windowId === 'number' ? String(tab.windowId) : '';
    item.dataset.isActiveInItsWindow = String(!!tab.active);

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
    const resolvedIconUrl = resolveTabIconUrl(tab, 64);
    if (resolvedIconUrl) {
        const iconImg = document.createElement('img');
        iconImg.src = resolvedIconUrl;
        iconImg.width = 16;
        iconImg.height = 16;
        Object.assign(iconImg.style, {
            width: '16px',
            height: '16px',
            objectFit: 'contain',
            flexShrink: '0',
            borderRadius: '3px',
            display: 'block',
        });
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
        color:          'var(--ys-text-primary)',
        overflow:       'hidden',
        textOverflow:   'ellipsis',
        whiteSpace:     'nowrap',
        flex:           '1',
        minWidth:       '0',
        transition:     'color 0.12s ease',
    });
    const rawTitle = tab.title || (typeof ysT === 'function' ? ysT('footerUntitled') : '(Untitled)');
    let displayTitle = /^📍\s*/u.test(rawTitle) ? rawTitle.replace(/^📍\s*/u, '').trim() : rawTitle;
    if (!displayTitle) displayTitle = (typeof ysT === 'function' ? ysT('footerUntitled') : '(Untitled)');
    title.textContent = displayTitle;

    const closeBtn = document.createElement('div');
    closeBtn.className = 'ys-close-btn';
    const closeGlyph = document.createElement('span');
    closeGlyph.textContent = '✕';
    Object.assign(closeGlyph.style, {
        display: 'block',
        fontSize: '11px',
        lineHeight: '1',
        fontWeight: '600',
        transform: 'translateY(-0.5px)',
    });
    closeBtn.appendChild(closeGlyph);
    Object.assign(closeBtn.style, {
        width:           '18px',
        height:          '18px',
        borderRadius:    '50%',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        color:           'rgba(0, 0, 0, 0.35)',
        background:      'rgba(0, 0, 0, 0.06)',
        transition:      'opacity 0.12s ease',
        opacity:         '0',
        pointerEvents:   'none',
        cursor:          'pointer',
    });

    // 页面归纳标签（中英双语 + 旧版纯字符串）
    const rawPageLabel = tabPageLabelMap[tab.id] ?? tabPageLabelMap[String(tab.id)];
    const pageLabel = ysResolveDisplayedPageLabel(rawPageLabel);

    if (tab.active) {
        const isSourceWindowActive = switcherCurrentWindowId === null || tab.windowId === switcherCurrentWindowId;
        title.style.fontWeight = '600';
        title.style.color = isSourceWindowActive
            ? 'var(--ys-accent-text)'
            : TAB_ROW_OTHER_ACTIVE_TITLE_COLOR;
        title.dataset.isActive = 'true';
        item.dataset.activeInSourceWindow = isSourceWindowActive ? 'true' : 'false';
    }

    const showTail = !!pageLabel;
    let tailCluster = null;
    if (showTail) {
        tailCluster = document.createElement('div');
        Object.assign(tailCluster.style, {
            display: 'flex',
            alignItems: 'center',
            flexShrink: '0',
        });

        const labelSlot = document.createElement('div');
        Object.assign(labelSlot.style, {
            width: '100px',
            minWidth: '100px',
            flexShrink: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
        });

        if (pageLabel) {
            const labelEl = document.createElement('span');
            labelEl.className = 'ys-page-label';
            labelEl.textContent = pageLabel;
            Object.assign(labelEl.style, {
                fontSize:       '11px',
                fontWeight:     '600',
                color:          'var(--ys-text-muted)',
                background:     'var(--ys-btn-bg)',
                border:         '1px solid var(--ys-divider)',
                borderRadius:   '4px',
                padding:        '2px 6px',
                flexShrink:     '0',
                whiteSpace:     'nowrap',
                lineHeight:     '1.5',
                letterSpacing:  '0.02em',
                maxWidth:       '100%',
                overflow:       'hidden',
                textOverflow:   'ellipsis',
            });
            labelSlot.appendChild(labelEl);
        }

        tailCluster.appendChild(labelSlot);
    }

    if (tab.active) {
        const isSourceActive = item.dataset.activeInSourceWindow === 'true';
        const activeDot = document.createElement('div');
        activeDot.className = 'ys-active-dot';
        Object.assign(activeDot.style, {
            position: 'absolute',
            left: '-10px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: isSourceActive ? 'var(--ys-accent)' : 'var(--ys-text-secondary)',
            boxShadow: isSourceActive
                ? '0 0 6px var(--ys-accent-bg)'
                : '0 0 4px var(--ys-divider)',
            pointerEvents: 'none',
        });
        item.appendChild(activeDot);
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
    // 首次渲染即应用未选中态背景，避免必须 hover 后才出现活跃行样式
    item.style.background = getUnselectedItemBackground(item);
    container.appendChild(item);

    // hover / click / 关闭 均由 listContainer 上的事件委托统一处理，行内不再绑定监听
    refreshTabRowIconVis(item);
}
