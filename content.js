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
    toast.innerText = `已关闭标签页，累计触发: ${count} 次`;

    Object.assign(toast.style, {
        position:           'fixed',
        bottom:             '15%',
        left:               '50%',
        transform:          'translateX(-50%)',
        padding:            '9px 18px',
        background:         'rgba(22, 24, 35, 0.82)',
        backdropFilter:     'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border:             '1px solid rgba(255, 255, 255, 0.10)',
        borderTop:          '1px solid rgba(255, 255, 255, 0.18)',
        borderRadius:       '10px',
        color:              'rgba(230, 232, 245, 0.95)',
        fontSize:           '13px',
        letterSpacing:      '0.01em',
        boxShadow:          '0 8px 24px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.06) inset',
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


// ─── Tab Switcher Overlay ─────────────────────────────────────────────────────

let switcherVisible  = false;
let switcherTabs     = [];
let switcherSelIdx   = 0;

function showSwitcher(tabs) {
    hideSwitcher();
    switcherTabs   = tabs;
    switcherSelIdx = tabs.findIndex(t => t.active);
    if (switcherSelIdx < 0) switcherSelIdx = 0;
    switcherVisible = true;

    const overlay = document.createElement('div');
    overlay.id = 'ys-switcher-overlay';
    Object.assign(overlay.style, {
        position:       'fixed',
        inset:          '0',
        zIndex:         '2147483646',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'rgba(10, 12, 20, 0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        opacity:        '0',
        transition:     'opacity 0.15s ease',
        pointerEvents:  'auto', // 允许点击遮罩层
        fontFamily:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    // 点击遮罩层关闭
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hideSwitcher();
    });

    // 【新增】彻底解决滚动穿透：拦截非列表区域的滚轮事件
    overlay.addEventListener('wheel', (e) => {
        const listContainer = document.getElementById('ys-switcher-list');
        // 如果鼠标不是在列表内部滚动，强制阻止默认事件（即阻止网页背景滚动）
        if (!listContainer || !listContainer.contains(e.target)) {
            e.preventDefault();
        }
    }, { passive: false });

    // 卡片
    const card = document.createElement('div');
    card.id = 'ys-switcher-card';
    Object.assign(card.style, {
        background:     'rgba(18, 20, 32, 0.90)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border:         '1px solid rgba(255,255,255,0.10)',
        borderTop:      '1px solid rgba(255,255,255,0.18)',
        borderRadius:   '16px',
        boxShadow:      '0 24px 64px rgba(0,0,0,0.50)',
        width:          '320px',
        maxHeight:      '60vh',
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        transform:      'scale(0.93) translateY(6px)',
        transition:     'transform 0.18s cubic-bezier(0.34,1.3,0.64,1)',
    });

    // 顶部提示栏
    const header = document.createElement('div');
    Object.assign(header.style, {
        padding:        '11px 16px 8px',
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        borderBottom:   '1px solid rgba(255,255,255,0.07)',
        flexShrink:     '0',
    });
    header.innerHTML = `
      <span style="font-size:12px;font-weight:600;color:rgba(200,210,240,0.8);letter-spacing:0.02em;">标签页切换</span>
      <span style="font-size:11px;color:rgba(140,150,180,0.55);">点击确认，松开按键关闭</span>`;

    // 列表容器
    const list = document.createElement('div');
    list.id = 'ys-switcher-list';
    Object.assign(list.style, {
        overflowY:  'auto',
        padding:    '6px 8px',
        flexGrow:   '1',
        scrollbarWidth: 'none',
        overscrollBehavior: 'contain', // 【新增】防止内部滚动触顶或触底时联动外部网页
    });

    tabs.forEach((tab, i) => buildTabItem(tab, i, list));

    card.appendChild(header);
    card.appendChild(list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        card.style.transform = 'scale(1) translateY(0)';
    });

    // 滚动让当前项居中
    scrollToSelected();
}

function buildTabItem(tab, i, container) {
    const item = document.createElement('div');
    item.id    = `ys-tab-item-${i}`;
    item.dataset.idx = i;

    Object.assign(item.style, {
        display:        'flex',
        alignItems:     'center',
        gap:            '10px',
        padding:        '8px 10px',
        borderRadius:   '9px',
        cursor:         'pointer', // 鼠标指针
        transition:     'background 0.12s ease',
        background:     'transparent',
        userSelect:     'none',
        pointerEvents:  'auto',    // 允许交互
    });

    // favicon / letter avatar
    const icon = document.createElement('div');
    Object.assign(icon.style, {
        width:          '22px',
        height:         '22px',
        borderRadius:   '5px',
        flexShrink:     '0',
        overflow:       'hidden',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       '11px',
        fontWeight:     '600',
        background:     'rgba(80,110,200,0.25)',
        color:          'rgba(160,185,255,0.9)',
    });

    if (tab.favIconUrl) {
        const img = document.createElement('img');
        img.src    = tab.favIconUrl;
        img.width  = 16;
        img.height = 16;
        img.style.cssText = 'display:block;border-radius:2px';
        img.onerror = () => {
            img.remove();
            icon.textContent = (tab.title || '?')[0].toUpperCase();
        };
        icon.appendChild(img);
    } else {
        icon.textContent = (tab.title || '?')[0].toUpperCase();
    }

    // 标题 + 域名
    const text = document.createElement('div');
    Object.assign(text.style, {
        flex:       '1',
        minWidth:   '0',
        display:    'flex',
        flexDirection: 'column',
        gap:        '1px',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
        fontSize:       '13px',
        fontWeight:     '500',
        color:          'rgba(215,220,240,0.92)',
        overflow:       'hidden',
        textOverflow:   'ellipsis',
        whiteSpace:     'nowrap',
    });
    title.textContent = tab.title || '(无标题)';

    const domain = document.createElement('div');
    Object.assign(domain.style, {
        fontSize:       '11px',
        color:          'rgba(130,140,170,0.55)',
        overflow:       'hidden',
        textOverflow:   'ellipsis',
        whiteSpace:     'nowrap',
    });
    try { domain.textContent = new URL(tab.url).hostname; } catch { domain.textContent = ''; }

    text.appendChild(title);
    text.appendChild(domain);

    // 当前激活标记
    if (tab.active) {
        const dot = document.createElement('div');
        Object.assign(dot.style, {
            width:        '5px',
            height:       '5px',
            borderRadius: '50%',
            background:   'rgba(100,160,255,0.7)',
            flexShrink:   '0',
        });
        item.appendChild(icon);
        item.appendChild(text);
        item.appendChild(dot);
    } else {
        item.appendChild(icon);
        item.appendChild(text);
    }

    container.appendChild(item);

    // 悬停高亮
    item.addEventListener('mouseenter', () => {
        updateSwitcherSelection(i);
    });

    // 点击切换标签
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'switch_tab', tabId: tab.id });
        hideSwitcher();
    });
}

function updateSwitcherSelection(newIdx) {
    const oldItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (oldItem) {
        Object.assign(oldItem.style, {
            background: 'transparent',
        });
        const title = oldItem.querySelector('div > div:first-child');
        if (title) title.style.color = 'rgba(215,220,240,0.92)';
    }

    switcherSelIdx = Math.max(0, Math.min(switcherTabs.length - 1, newIdx));

    const newItem = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (newItem) {
        Object.assign(newItem.style, {
            background: 'rgba(70,110,220,0.22)',
        });
        const title = newItem.querySelector('div > div:first-child');
        if (title) title.style.color = 'rgba(255,255,255,0.98)';
    }
}

function scrollToSelected() {
    const list = document.getElementById('ys-switcher-list');
    const item = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
    if (list && item) {
        const listRect = list.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

function hideSwitcher() {
    switcherVisible = false;
    switcherTabs    = [];

    const overlay = document.getElementById('ys-switcher-overlay');
    if (!overlay) return;
    const card = document.getElementById('ys-switcher-card');

    overlay.style.opacity = '0';
    if (card) card.style.transform = 'scale(0.93) translateY(6px)';
    setTimeout(() => overlay.remove(), 160);
}

// 初始化选中高亮
function initSwitcherHighlight() {
    requestAnimationFrame(() => {
        const item = document.getElementById(`ys-tab-item-${switcherSelIdx}`);
        if (item) {
            Object.assign(item.style, { background: 'rgba(70,110,220,0.22)' });
            const title = item.querySelector('div > div:first-child');
            if (title) title.style.color = 'rgba(255,255,255,0.98)';
        }
    });
}


// ─── Floating Widget ──────────────────────────────────────────────────────────

function initFloatingWidget() {
    if (document.getElementById('geek-float-btn')) return;

    let snapEdge  = 'right';
    let posY      = Math.min(window.innerHeight * 0.45, window.innerHeight - 60);
    let panelOpen = false;
    let panelView = 'chart'; // 'chart' | 'settings'

    const glass = (extra = {}) => Object.assign({
        background:     'rgba(245, 245, 248, 0.18)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border:         '1px solid rgba(255, 255, 255, 0.38)',
        boxShadow:      '0 6px 24px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)',
    }, extra);

    // ── 悬浮按钮 ──
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

    // ── 面板 ──
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

    // ── 定位 ──
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

    // ── 拖拽 ──
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
    });

    // ── 点击切换面板 ──
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

    // ── 图表视图 ──
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
            <span style="font-size:12px;font-weight:600;color:rgba(60,70,110,0.85);letter-spacing:0.01em;">近五天关闭统计</span>
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

    // ── 设置视图 ──
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
                renderSettingsView(); // 重绘选中态
            });
        });
    }

    // ── SVG 折线图 ──
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
const DOUBLE_PRESS_DELAY = 300; // 毫秒，双击时间阈值

document.addEventListener('keydown', function(event) {
    // 忽略长按修饰键时系统发出的连续触发
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
                    showSwitcher(res.tabs);
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

// 【新增】松开修饰键自动关闭面板
document.addEventListener('keyup', function(event) {
    if (event.key === MOD_EVENT_KEY[modifierKey] && switcherVisible) {
        hideSwitcher();
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