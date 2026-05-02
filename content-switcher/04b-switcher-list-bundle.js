// 04b：列表渲染 renderList、网页搜索建议、invalidate（由 04 showSwitcher 注入 mode / slot / tabs）
function ysSwitcherAttachListRenderBundle(mode, listContainer, card, slot, tabs) {
        const CARD_OPEN_TRANSITION = 'transform 0.18s cubic-bezier(0.34,1.3,0.64,1)';
        const CARD_HEIGHT_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
        let cardHeightAnimToken = 0;
        let aiSearchToken = 0;          // 用于取消过时的 AI 搜索回调
        let aiSearchDebounceTimer = null; // 防止用户连续输入时发出多余请求
        let webSuggestionToken = 0; // 用于取消过时的网页搜索建议回调
        let webSuggestionDebounceTimer = null;
        let currentWebSuggestions = [];
        let webSuggestionSelIdx = -1;
        let webSuggestionKeyboardNavActive = false;
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
        const invalidateWebSuggestions = () => {
            webSuggestionToken += 1;
            if (webSuggestionDebounceTimer) {
                clearTimeout(webSuggestionDebounceTimer);
                webSuggestionDebounceTimer = null;
            }
        };
        const getDefaultSelectedIdx = (items) => {
            const activeInCurrent = items.findIndex(t => t.active && switcherCurrentWindowId !== null && t.windowId === switcherCurrentWindowId);
            if (activeInCurrent >= 0) return activeInCurrent;
            const activeAny = items.findIndex(t => t.active);
            return activeAny >= 0 ? activeAny : -1;
        };
    
        function renderList(filterText = '', opts = {}) {
            // 防止切到网页搜索模式后，旧的本地搜索异步回调继续改写列表
            if (mode.isWebSearchMode) return;
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
                    text.textContent = ysT('listAiSwitchingToAiSearch');
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
                        if (mode.isWebSearchMode || !switcherVisible) return;
                        if (myToken !== aiSearchToken) return;
                        ysSendToBg({ action: 'ai_search_tabs', query: filterText }, {}, (res, err) => {
                            if (mode.isWebSearchMode || !switcherVisible) return;
                            if (myToken !== aiSearchToken) return; // 用户已继续输入，丢弃
                            if (err || !res || !res.keywords || res.keywords.length === 0) {
                                const extra = (res && res.message)
                                    ? `<div style="margin-top:10px;font-size:11px;color:rgba(180,100,60,0.92);line-height:1.55;text-align:left;max-width:280px;margin-left:auto;margin-right:auto;">${escapeHtml(res.message)}</div>`
                                    : '';
                                const base = err
                                    ? ysT('listBgUnreachable')
                                    : ysT('listNoMatchingTabs');
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
                        const kwEsc = escapeHtml(filterText.trim());
                        text.innerHTML = ysT('listNoMatchForKeyword', [kwEsc]).replace(kwEsc, `<b>${kwEsc}</b>`);
                        noResultWrap.appendChild(emoji);
                        noResultWrap.appendChild(text);
                        listContainer.appendChild(noResultWrap);
                    } else {
                        listContainer.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(100,110,130,0.6);font-size:12px;">${ysT('listNoMatchingTabs')}</div>`;
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
                label.textContent = ysT('aiSearchBannerLabel');
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
                    background: 'var(--ys-btn-bg)', borderRadius: '4px',
                    fontSize: '10px', fontWeight: 'bold', color: 'var(--ys-text-secondary)'
                });
                if (group.icon) {
                    const img = document.createElement('img');
                    img.src = group.icon; img.width = 14; img.height = 14;
                    Object.assign(img.style, {
                        width: '14px',
                        height: '14px',
                        objectFit: 'contain',
                        flexShrink: '0',
                        borderRadius: '2px',
                        display: 'block',
                    });
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
                    fontSize: '13px', fontWeight: '500', color: 'var(--ys-text-primary)',
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
    
        const renderWebSuggestions = (suggestions, queryText = '', opts = {}) => {
            const shouldAnimate = !!opts.animate;
            const loading = !!opts.loading;
            const prevH = shouldAnimate ? card.offsetHeight : 0;
            const keyword = String(queryText || '').trim();
    
            const rebuildSuggestionsDOM = () => {
                stopAiEmptyStateEmojiLoop();
                listContainer.innerHTML = '';
                switcherTabs = [];
                switcherSelIdx = -1;
    
                if (!keyword) {
                    const empty = document.createElement('div');
                    Object.assign(empty.style, {
                        padding: '24px 20px',
                        textAlign: 'center',
                        color: 'var(--ys-text-muted)',
                        fontSize: '12px',
                    });
                    empty.textContent = ysT('webSuggestLoading');
                    listContainer.appendChild(empty);
                    return;
                }
    
                if (!Array.isArray(suggestions) || suggestions.length === 0) {
                    const empty = document.createElement('div');
                    Object.assign(empty.style, {
                        padding: '24px 20px',
                        textAlign: 'center',
                        color: 'var(--ys-text-muted)',
                        fontSize: '12px',
                    });
                    empty.textContent = loading
                        ? ysT('webSuggestLoading')
                        : ysT('webSuggestNoSuggestionsFor', [keyword]);
                    listContainer.appendChild(empty);
                    return;
                }
    
                const fragment = document.createDocumentFragment();
                suggestions.forEach((text, idx) => {
                    const row = document.createElement('div');
                    row.id = `ys-web-suggestion-${idx}`;
                    Object.assign(row.style, {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        minHeight: '36px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        margin: '0 6px 2px',
                        cursor: 'pointer',
                        boxSizing: 'border-box',
                        background: idx === webSuggestionSelIdx ? WEB_SUGGESTION_SELECTED_BG : 'transparent',
                        transition: 'background 0.12s ease',
                    });
    
                    const iconWrap = document.createElement('div');
                    Object.assign(iconWrap.style, {
                        width: '20px',
                        height: '20px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(80,110,220,0.08)',
                        flexShrink: '0',
                        fontSize: '11px',
                    });
                    iconWrap.textContent = '🔎';
    
                    const textEl = document.createElement('div');
                    textEl.textContent = text;
                    Object.assign(textEl.style, {
                        flex: '1',
                        minWidth: '0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '13px',
                        color: 'var(--ys-text-primary)',
                    });
    
                    const actionHint = document.createElement('div');
                    actionHint.textContent = ysT('webSuggestEnterHint');
                    Object.assign(actionHint.style, {
                        fontSize: '11px',
                        color: 'var(--ys-text-secondary)',
                        whiteSpace: 'nowrap',
                        flexShrink: '0',
                    });
    
                    row.addEventListener('mouseenter', () => {
                        if (webSuggestionKeyboardNavActive) return;
                        webSuggestionSelIdx = idx;
                        renderWebSuggestions(currentWebSuggestions, keyword, { animate: false });
                    });
                    row.addEventListener('click', () => {
                        if (!text) return;
                        const si = document.getElementById('ys-search-input');
                        if (si) si.value = text;
                        if (slot.submitWebSearch) slot.submitWebSearch();
                    });
    
                    row.appendChild(iconWrap);
                    row.appendChild(textEl);
                    row.appendChild(actionHint);
                    fragment.appendChild(row);
                });
                listContainer.appendChild(fragment);
            };
    
            rebuildSuggestionsDOM();
            if (!shouldAnimate) return;
            const nextH = card.offsetHeight;
            if (Math.abs(prevH - nextH) <= 1.5) return;
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
        };
    
        const requestWebSuggestions = (queryText, immediate = false) => {
            if (!mode.isWebSearchMode) return;
            const query = String(queryText || '').trim();
            invalidateWebSuggestions();
            if (!query) {
                currentWebSuggestions = [];
                webSuggestionSelIdx = -1;
                renderWebSuggestions([], '', { animate: true });
                return;
            }
            renderWebSuggestions([], query, { animate: true, loading: true });
            const myToken = ++webSuggestionToken;
            const run = () => {
                ysSendToBg({ action: 'get_search_suggestions', query }, {}, (res, err) => {
                    if (myToken !== webSuggestionToken || !mode.isWebSearchMode || !switcherVisible) return;
                    if (err || !res || !Array.isArray(res.suggestions)) {
                        currentWebSuggestions = [];
                        webSuggestionSelIdx = -1;
                        renderWebSuggestions([], query, { animate: true });
                        return;
                    }
                    currentWebSuggestions = res.suggestions
                        .map((item) => String(item || '').trim())
                        .filter(Boolean)
                        .slice(0, 8);
                    webSuggestionSelIdx = currentWebSuggestions.length > 0 ? 0 : -1;
                    renderWebSuggestions(currentWebSuggestions, query, { animate: true });
                });
            };
            if (immediate) {
                run();
            } else {
                webSuggestionDebounceTimer = setTimeout(run, 180);
            }
        };
        const moveWebSuggestionSelection = (delta) => {
            const total = currentWebSuggestions.length;
            if (total <= 0) return;
            webSuggestionKeyboardNavActive = true;
            if (delta > 0) {
                webSuggestionSelIdx = (webSuggestionSelIdx + 1 + total) % total;
            } else {
                const base = webSuggestionSelIdx < 0 ? 0 : webSuggestionSelIdx;
                webSuggestionSelIdx = (base - 1 + total) % total;
            }
            const siMove = document.getElementById('ys-search-input');
            renderWebSuggestions(currentWebSuggestions, siMove ? siMove.value : '');
            const selectedEl = document.getElementById(`ys-web-suggestion-${webSuggestionSelIdx}`);
            if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
        };
        const getSelectedWebSuggestion = () => {
            if (webSuggestionSelIdx < 0) return '';
            return String(currentWebSuggestions[webSuggestionSelIdx] || '').trim();
        };
        const isWebSuggestionKeyboardNavActive = () => webSuggestionKeyboardNavActive;
        const clearWebSuggestionKeyboardNavActive = () => {
            webSuggestionKeyboardNavActive = false;
        };
    return {
        renderList,
        renderWebSuggestions,
        requestWebSuggestions,
        moveWebSuggestionSelection,
        getSelectedWebSuggestion,
        isWebSuggestionKeyboardNavActive,
        clearWebSuggestionKeyboardNavActive,
        invalidateAiSearch,
        invalidateWebSuggestions,
    };
}
