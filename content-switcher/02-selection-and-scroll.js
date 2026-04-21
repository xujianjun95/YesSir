// ─── 02 键盘/鼠标选中态、标题色、列表滚动与视口对齐（showSwitcher 内 renderList 依赖）────────

function isSourceWindowActiveTabItem(item) {
    return !!(item && item.dataset.activeInSourceWindow === 'true');
}

function getUnselectedItemBackground(item) {
    if (isSourceWindowActiveTabItem(item)) return TAB_ROW_ACTIVE_BG;
    if (item && item.dataset.isActiveInItsWindow === 'true') return TAB_ROW_OTHER_ACTIVE_BG;
    return 'transparent';
}

function getTabTitleColor(item, titleEl) {
    if (!titleEl || titleEl.dataset.isActive !== 'true') return 'var(--ys-text-primary)';
    return isSourceWindowActiveTabItem(item)
        ? 'var(--ys-accent-text)'
        : TAB_ROW_OTHER_ACTIVE_TITLE_COLOR;
}

function updateSwitcherSelection(newIdx) {
    const oldItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (oldItem) {
        oldItem.dataset.selected = 'false';
        oldItem.style.background = getUnselectedItemBackground(oldItem);
        const title = oldItem.querySelector('.ys-tab-title');
        if (title) {
            title.style.color = getTabTitleColor(oldItem, title);
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
        const isAnyActive = isSourceWindowActiveTabItem(newItem) || newItem.dataset.isActiveInItsWindow === 'true';
        newItem.style.background = isAnyActive
            ? TAB_ROW_ACTIVE_BG
            : TAB_ROW_SELECTED_BG;
        const title = newItem.querySelector('.ys-tab-title');
        if (title) {
            title.style.color = getTabTitleColor(newItem, title);
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
