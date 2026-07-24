// ─── 自定义 AI 分组规则：规则列表与单页编辑器 ─────────────────────────────────

const YS_RULES_STORAGE_KEY = 'ysCustomGroupingRulesV1';
const YS_RULE_LIMITS = Object.freeze({
    rules: 5, name: 40, instructions: 2000, groups: 10, categoryName: 30,
    conditions: 20, conditionValue: 300,
});
const YS_RULE_COLORS = [
    // Chromium ThemeHelper::GetTabGroupColors：浅色主题 / 深色主题 Google 色阶。
    { value: 'grey', hex: '#5F6368', darkHex: '#DADCE0' },
    { value: 'blue', hex: '#1A73E8', darkHex: '#8AB4F8' },
    { value: 'red', hex: '#D93025', darkHex: '#F28B82' },
    { value: 'yellow', hex: '#F9AB00', darkHex: '#FDD663' },
    { value: 'green', hex: '#188038', darkHex: '#81C995' },
    { value: 'pink', hex: '#D01884', darkHex: '#FF8BCB' },
    { value: 'purple', hex: '#A142F4', darkHex: '#C58AF9' },
    { value: 'cyan', hex: '#007B83', darkHex: '#78D9EC' },
    { value: 'orange', hex: '#FA903E', darkHex: '#FCAD70' },
];
const YS_RULE_EMOJIS = [
    '📁', '💼', '💻', '🧰', '📰', '📚', '✍️', '📊', '💬', '🎬',
    '🎵', '🛒', '💰', '🎨', '🧪', '✈️', '🍽️', '🎮', '🏠', '⭐',
];
let ysActiveRuleColorPickerClose = null;
let ysActiveRuleTimePickerClose = null;
let ysActiveRuleEmojiPickerClose = null;
let ysActiveRuleConditionSelectClose = null;

function ysRuleCreateId(prefix) {
    try {
        if (crypto && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
    } catch (_) {}
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ysRuleLoadAll(done) {
    chrome.storage.local.get({ [YS_RULES_STORAGE_KEY]: [] }, (res) => {
        const raw = res && Array.isArray(res[YS_RULES_STORAGE_KEY]) ? res[YS_RULES_STORAGE_KEY] : [];
        const rules = raw
            .filter((rule) => rule && typeof rule === 'object')
            .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
        done(rules);
    });
}

function ysRuleSaveAll(rules, done) {
    const normalized = rules.slice(0, YS_RULE_LIMITS.rules).map((rule, index) => ({ ...rule, order: index }));
    chrome.storage.local.set({ [YS_RULES_STORAGE_KEY]: normalized }, () => {
        const error = chrome.runtime.lastError;
        done && done(error ? error.message : null, normalized);
    });
}

function ysRuleButton(text, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    Object.assign(button.style, {
        border: primary ? '1px solid var(--ys-accent)' : '1px solid var(--ys-btn-border)',
        background: primary ? 'var(--ys-accent)' : 'var(--ys-btn-bg)',
        color: primary ? '#fff' : 'var(--ys-text-primary)',
        borderRadius: '9px',
        padding: '8px 12px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'background .15s, opacity .15s, transform .15s',
    });
    button.addEventListener('mouseenter', () => { if (!button.disabled) button.style.transform = 'translateY(-1px)'; });
    button.addEventListener('mouseleave', () => { button.style.transform = 'none'; });
    return button;
}

function ysRuleCreateAddGroupIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, { width: '14px', height: '14px', flex: '0 0 auto', fill: 'currentColor' });
    [
        'M926.3 337.9c-22.6-53.3-54.8-101.2-96-142.3-41.1-41.1-89-73.4-142.3-96-55.2-23.4-113.9-35.2-174.3-35.2S394.6 76.2 339.3 99.6c-53.3 22.6-101.2 54.8-142.3 96-41.1 41.1-73.4 89-96 142.3-23.4 55.2-35.2 113.9-35.2 174.3 0 60.4 11.8 119.1 35.2 174.3 22.6 53.3 54.8 101.2 96 142.3 41.1 41.1 89 73.4 142.3 96 55.2 23.4 113.9 35.2 174.3 35.2s119.1-11.8 174.3-35.2c53.3-22.6 101.2-54.8 142.3-96 41.1-41.1 73.4-89 96-142.3 23.4-55.2 35.2-113.9 35.2-174.3 0.1-60.4-11.8-119.1-35.1-174.3zM513.7 879.1c-202.3 0-366.9-164.6-366.9-366.9s164.6-366.9 366.9-366.9c202.3 0 366.9 164.6 366.9 366.9S716 879.1 513.7 879.1z',
        'M695.7 469.2h-139v-139c0-23.6-19.3-43-43-43-23.6 0-43 19.3-43 43v139h-139c-23.6 0-43 19.3-43 43s19.3 43 43 43h139v139c0 23.7 19.3 43 43 43 23.6 0 43-19.3 43-43v-139h139c23.6 0 43-19.3 43-43s-19.4-43-43-43z',
    ].forEach((pathData) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
    });
    return svg;
}

function ysRuleCreateTypeIcon(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, {
        width: '15px', height: '15px', flex: '0 0 auto', fill: 'currentColor',
    });
    const paths = type === 'matcher'
        ? ['M727.008 487.232l194.016-184.32a99.2 99.2 0 0 0 0-140.288l-48.416-48.416a99.2 99.2 0 0 0-138.464-1.76L544.64 292.384l-184.064-196.64-1.504-1.568a64.832 64.832 0 0 0-91.712-0.384L129.184 231.968a64.8 64.8 0 0 0-1.12 90.144l181.344 193.728-171.456 162.88a99.264 99.264 0 0 0-28.256 49.28l-28.992 123.744a65.632 65.632 0 0 0 82.4 77.92l119.296-35.136a99.744 99.744 0 0 0 40.32-23.232l169.056-160.608 203.616 217.536 1.504 1.568a64.832 64.832 0 0 0 91.712 0.384l138.176-138.176a64.8 64.8 0 0 0 1.12-90.144l-200.896-214.624zM319.424 786.176l-90.112-90.112a31.488 31.488 0 0 0-9.792-6.496L667.104 264.352l94.272 94.272c1.408 1.408 3.168 2.08 4.768 3.168L319.424 786.176zM778.208 158.784a35.2 35.2 0 0 1 49.12 0.64l48.416 48.416c13.76 13.76 13.76 36.032-0.64 50.4l-64.448 61.216c-1.28-2.08-2.24-4.288-4.064-6.112l-93.12-93.12 64.736-61.44zM288.512 399.904c8-0.128 16-3.168 22.112-9.28l48-48a31.968 31.968 0 1 0-45.248-45.248l-48 48a31.68 31.68 0 0 0-8.928 20.256L174.816 278.4c-0.512-0.512-0.512-1.024-0.352-1.152L312.64 139.04c0.128-0.128 0.672-0.128 1.248 0.416l184.384 196.992-142.432 135.328-67.328-71.872zM145.024 868.288a1.6 1.6 0 0 1-2.016-1.92l28.992-123.744c0.992-4.16 2.944-7.968 5.312-11.488a31.808 31.808 0 0 0 6.752 10.144l88.288 88.288a35.072 35.072 0 0 1-8 3.552l-119.328 35.168z m598.336 16.672c-0.128 0.128-0.672 0.128-1.248-0.416l-125.6-134.176a31.232 31.232 0 0 0 14.08-7.712l48-48a31.968 31.968 0 1 0-45.248-45.248l-48 48a31.68 31.68 0 0 0-7.296 11.904l-39.904-42.656 142.432-135.328 200.576 214.304c0.48 0.512 0.48 1.024 0.352 1.152l-138.144 138.176z']
        : [
            'M843.875 135.125h-90V90.125c0-11.25-16.875-28.125-33.75-28.125s-28.125 11.25-28.125 28.125v39.375H360.125V90.125c0-11.25-11.25-28.125-28.125-28.125s-28.125 16.875-28.125 28.125v39.375H180.125C129.5 135.125 90.125 174.5 90.125 219.5v652.5c0 50.625 39.375 90 90 90h663.75c50.625 0 90-39.375 90-90V219.5c0-45-39.375-84.375-90-84.375z m28.125 736.875c0 16.875-11.25 28.125-28.125 28.125H180.125c-16.875 0-28.125-11.25-28.125-28.125V219.5c0-16.875 11.25-28.125 28.125-28.125h118.125v5.625c5.625 16.875 16.875 33.75 33.75 33.75s28.125-11.25 28.125-28.125v-11.25h331.875v5.625c0 16.875 11.25 28.125 28.125 28.125s28.125-11.25 28.125-28.125v-5.625h90c16.875 0 28.125 11.25 28.125 28.125v652.5z',
            'M753.875 337.625H270.125c-16.875 0-28.125 11.25-28.125 28.125s11.25 33.75 28.125 33.75h483.75c16.875 0 28.125-11.25 28.125-28.125s-11.25-33.75-28.125-33.75zM753.875 517.625H270.125c-16.875 0-28.125 11.25-28.125 28.125s11.25 28.125 28.125 28.125h483.75c16.875 0 28.125-11.25 28.125-28.125s-11.25-28.125-28.125-28.125zM512 697.625H270.125c-16.875 0-28.125 11.25-28.125 28.125s11.25 28.125 28.125 28.125H512c16.875 0 28.125-11.25 28.125-28.125s-11.25-28.125-28.125-28.125z',
        ];
    paths.forEach((pathData) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
    });
    return svg;
}

function ysRuleFieldLabel(text) {
    const label = document.createElement('div');
    label.textContent = text;
    Object.assign(label.style, {
        marginBottom: '6px',
        color: 'var(--ys-text-secondary)',
        fontSize: '11px',
        fontWeight: '700',
    });
    return label;
}

function ysRuleInputStyle(element) {
    Object.assign(element.style, {
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid var(--ys-search-border)',
        background: 'var(--ys-search-bg)',
        color: 'var(--ys-text-primary)',
        borderRadius: '9px',
        padding: '9px 10px',
        fontSize: '12px',
        outline: 'none',
    });
    element.addEventListener('focus', () => { element.style.borderColor = 'var(--ys-search-focus-border)'; });
    element.addEventListener('blur', () => { element.style.borderColor = 'var(--ys-search-border)'; });
    return element;
}

function ysRuleCreateCompactSelect(options, currentValue, onChange, ariaLabel, menuOptions = {}) {
    let value = options.some(([optionValue]) => optionValue === currentValue)
        ? currentValue
        : options[0][0];
    const trigger = ysRuleInputStyle(document.createElement('button'));
    trigger.type = 'button';
    trigger.dataset.pickerId = ysRuleCreateId('condition-select');
    trigger.setAttribute('aria-label', ariaLabel);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    Object.assign(trigger.style, {
        height: '35px', minHeight: '35px', padding: '0 27px 0 10px', position: 'relative',
        display: 'flex', alignItems: 'center', cursor: 'pointer', textAlign: 'left', lineHeight: '1',
    });

    const renderTrigger = () => {
        const label = document.createElement('span');
        label.textContent = options.find(([optionValue]) => optionValue === value)?.[1] || '';
        Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        const arrow = document.createElement('span');
        arrow.textContent = '⌄';
        Object.assign(arrow.style, {
            position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-55%)',
            color: 'var(--ys-text-muted)', fontSize: '11px', pointerEvents: 'none',
        });
        trigger.replaceChildren(label, arrow);
        trigger.value = value;
    };
    renderTrigger();

    const getMenu = () => document.getElementById(`ys-rule-condition-menu-${trigger.dataset.pickerId}`);
    const closeMenu = (restoreFocus = false) => {
        getMenu()?.remove();
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', handleOutside, true);
        document.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', closeMenu);
        if (ysActiveRuleConditionSelectClose === closeMenu) ysActiveRuleConditionSelectClose = null;
        if (restoreFocus) trigger.focus({ preventScroll: true });
    };
    const handleOutside = (event) => {
        const menu = getMenu();
        if (event.target !== trigger && !trigger.contains(event.target) && (!menu || !menu.contains(event.target))) {
            closeMenu();
        }
    };
    const handleScroll = (event) => {
        const menu = getMenu();
        if (menu?.contains(event.target)) {
            event.stopPropagation();
            return;
        }
        closeMenu();
    };

    const openMenu = () => {
        if (getMenu()) {
            closeMenu();
            return;
        }
        if (ysActiveRuleConditionSelectClose) ysActiveRuleConditionSelectClose();
        if (ysActiveRuleColorPickerClose) ysActiveRuleColorPickerClose();
        if (ysActiveRuleTimePickerClose) ysActiveRuleTimePickerClose();
        if (ysActiveRuleEmojiPickerClose) ysActiveRuleEmojiPickerClose();

        const menu = document.createElement('div');
        menu.id = `ys-rule-condition-menu-${trigger.dataset.pickerId}`;
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', ariaLabel);
        Object.assign(menu.style, {
            position: 'fixed', zIndex: '2147483650', padding: '4px', boxSizing: 'border-box',
            overscrollBehavior: 'contain', border: '1px solid var(--ys-card-border)', borderRadius: '10px',
            background: 'var(--ys-card-bg)', backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 12px 28px rgba(25, 35, 58, .2)',
        });
        const optionButtons = [];
        options.forEach(([optionValue, optionLabel], optionIndex) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(optionValue === value));
            Object.assign(option.style, {
                width: '100%', minHeight: '31px', display: 'grid', gridTemplateColumns: '15px minmax(0, 1fr)',
                alignItems: 'center', gap: '6px', padding: '5px 8px', border: 'none', borderRadius: '7px',
                background: optionValue === value ? 'var(--ys-accent-bg)' : 'transparent',
                color: optionValue === value ? 'var(--ys-accent-text)' : 'var(--ys-text-primary)',
                fontSize: '12px', textAlign: 'left', cursor: 'pointer',
            });
            const check = document.createElement('span');
            check.textContent = optionValue === value ? '✓' : '';
            check.style.color = 'var(--ys-accent)';
            const label = document.createElement('span');
            label.textContent = optionLabel;
            option.append(check, label);
            option.addEventListener('mouseenter', () => { option.style.background = 'var(--ys-btn-hover)'; });
            option.addEventListener('mouseleave', () => {
                option.style.background = optionValue === value ? 'var(--ys-accent-bg)' : 'transparent';
            });
            option.addEventListener('click', () => {
                value = optionValue;
                renderTrigger();
                onChange(value);
                closeMenu(true);
            });
            option.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMenu(true);
                    return;
                }
                const direction = event.key === 'ArrowDown' ? 1 : (event.key === 'ArrowUp' ? -1 : 0);
                if (direction) {
                    event.preventDefault();
                    optionButtons[(optionIndex + direction + optionButtons.length) % optionButtons.length]?.focus();
                }
            });
            optionButtons.push(option);
            menu.appendChild(option);
        });
        menu.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });
        menu.addEventListener('touchmove', (event) => {
            event.preventDefault();
            event.stopPropagation();
        }, { passive: false });
        document.body.appendChild(menu);

        const rect = trigger.getBoundingClientRect();
        const menuWidth = Math.min(Number(menuOptions.width) || rect.width, rect.width);
        menu.style.width = `${menuWidth}px`;
        const menuRect = menu.getBoundingClientRect();
        const top = rect.bottom + 5 + menuRect.height <= window.innerHeight - 12
            ? rect.bottom + 5
            : Math.max(12, rect.top - menuRect.height - 5);
        const preferredLeft = menuOptions.align === 'right' ? rect.right - menuRect.width : rect.left;
        const left = Math.max(12, Math.min(window.innerWidth - menuRect.width - 12, preferredLeft));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        trigger.setAttribute('aria-expanded', 'true');
        ysActiveRuleConditionSelectClose = closeMenu;
        setTimeout(() => {
            optionButtons.find((option) => option.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });
            document.addEventListener('mousedown', handleOutside, true);
        }, 0);
        document.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', closeMenu);
    };

    trigger.addEventListener('click', openMenu);
    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
        }
    });
    return trigger;
}

function ysRuleCreateEmojiSelect(currentValue, onChange) {
    let value = YS_RULE_EMOJIS.includes(currentValue) ? currentValue : YS_RULE_EMOJIS[0];
    const trigger = ysRuleInputStyle(document.createElement('button'));
    trigger.type = 'button';
    trigger.dataset.pickerId = ysRuleCreateId('emoji-picker');
    trigger.setAttribute('aria-label', 'Emoji');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    Object.assign(trigger.style, {
        width: '64px', minWidth: '64px', padding: '0',
        height: '35px', minHeight: '35px',
        position: 'relative', cursor: 'pointer', fontSize: '16px', textAlign: 'center',
    });
    const renderTrigger = () => {
        const emoji = document.createElement('span');
        emoji.textContent = value;
        Object.assign(emoji.style, {
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            lineHeight: '1', pointerEvents: 'none',
        });
        const arrow = document.createElement('span');
        arrow.textContent = '⌄';
        Object.assign(arrow.style, {
            position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
            color: 'var(--ys-text-muted)', fontSize: '11px', pointerEvents: 'none',
        });
        trigger.replaceChildren(emoji, arrow);
    };
    renderTrigger();

    const getMenu = () => document.getElementById(`ys-rule-emoji-menu-${trigger.dataset.pickerId}`);
    const closeMenu = (restoreFocus = false) => {
        const menu = getMenu();
        if (menu) menu.remove();
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', handleOutside, true);
        document.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleResize);
        if (ysActiveRuleEmojiPickerClose === closeMenu) ysActiveRuleEmojiPickerClose = null;
        if (restoreFocus) trigger.focus();
    };
    const handleOutside = (event) => {
        const menu = getMenu();
        if (event.target !== trigger && (!menu || !menu.contains(event.target))) closeMenu();
    };
    const handleScroll = (event) => {
        const menu = getMenu();
        if (!menu || menu.contains(event.target)) return;
        closeMenu();
    };
    const handleResize = () => closeMenu();

    trigger.addEventListener('click', () => {
        if (getMenu()) {
            closeMenu();
            return;
        }
        if (ysActiveRuleEmojiPickerClose) ysActiveRuleEmojiPickerClose();
        if (ysActiveRuleColorPickerClose) ysActiveRuleColorPickerClose();
        if (ysActiveRuleTimePickerClose) ysActiveRuleTimePickerClose();

        const menu = document.createElement('div');
        menu.id = `ys-rule-emoji-menu-${trigger.dataset.pickerId}`;
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', 'Emoji');
        Object.assign(menu.style, {
            position: 'fixed', zIndex: '2147483650', width: '220px', padding: '8px', boxSizing: 'border-box',
            display: 'grid', gridTemplateColumns: 'repeat(5, 36px)', justifyContent: 'center', gap: '5px',
            overscrollBehavior: 'contain', touchAction: 'none',
            border: '1px solid var(--ys-card-border)', borderRadius: '12px',
            background: 'var(--ys-card-bg)', backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 14px 34px rgba(25, 35, 58, .22)',
        });
        const stopScrollThrough = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        menu.addEventListener('wheel', stopScrollThrough, { passive: false });
        menu.addEventListener('touchmove', stopScrollThrough, { passive: false });
        const options = [];
        YS_RULE_EMOJIS.forEach((emoji, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.textContent = emoji;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-label', emoji);
            const sync = () => {
                const selected = emoji === value;
                option.setAttribute('aria-selected', String(selected));
                option.style.background = selected ? 'var(--ys-accent-bg)' : 'transparent';
                option.style.borderColor = selected ? 'var(--ys-accent-hover)' : 'transparent';
            };
            Object.assign(option.style, {
                width: '36px', height: '36px', padding: '0', border: '1px solid transparent', borderRadius: '8px',
                color: 'var(--ys-text-primary)', cursor: 'pointer', fontSize: '18px', lineHeight: '1',
            });
            sync();
            option.addEventListener('mouseenter', () => {
                if (emoji !== value) option.style.background = 'var(--ys-btn-hover)';
            });
            option.addEventListener('mouseleave', sync);
            option.addEventListener('click', () => {
                value = emoji;
                renderTrigger();
                onChange(value);
                closeMenu(true);
            });
            option.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMenu(true);
                    return;
                }
                const columnCount = 5;
                const targetIndex = event.key === 'ArrowRight'
                    ? Math.min(YS_RULE_EMOJIS.length - 1, index + 1)
                    : event.key === 'ArrowLeft'
                        ? Math.max(0, index - 1)
                        : event.key === 'ArrowDown'
                            ? Math.min(YS_RULE_EMOJIS.length - 1, index + columnCount)
                            : event.key === 'ArrowUp'
                                ? Math.max(0, index - columnCount)
                                : event.key === 'Home'
                                    ? 0
                                    : event.key === 'End'
                                        ? YS_RULE_EMOJIS.length - 1
                                        : -1;
                if (targetIndex >= 0) {
                    event.preventDefault();
                    options[targetIndex].focus();
                }
            });
            options.push(option);
            menu.appendChild(option);
        });
        document.body.appendChild(menu);
        const rect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const top = rect.bottom + 6 + menuRect.height <= window.innerHeight - 12
            ? rect.bottom + 6
            : Math.max(12, rect.top - menuRect.height - 6);
        const preferredLeft = rect.left - ((menuRect.width - rect.width) / 2);
        const left = Math.max(12, Math.min(window.innerWidth - menuRect.width - 12, preferredLeft));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        trigger.setAttribute('aria-expanded', 'true');
        ysActiveRuleEmojiPickerClose = closeMenu;
        setTimeout(() => {
            options.find((option) => option.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });
            document.addEventListener('mousedown', handleOutside, true);
        }, 0);
        document.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleResize);
    });
    return trigger;
}

function ysRuleGetColorHex(color) {
    const item = YS_RULE_COLORS.find((candidate) => candidate.value === color) || YS_RULE_COLORS[0];
    return document.documentElement.getAttribute('data-ys-theme') === 'dark' ? item.darkHex : item.hex;
}

function ysRuleCreateColorPicker(currentValue, onChange) {
    let value = YS_RULE_COLORS.some((color) => color.value === currentValue) ? currentValue : 'grey';
    const root = document.createElement('div');
    root.style.position = 'relative';
    const trigger = ysRuleInputStyle(document.createElement('button'));
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    Object.assign(trigger.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        minHeight: '35px', cursor: 'pointer', textAlign: 'left',
    });

    const renderTrigger = () => {
        const label = document.createElement('span');
        Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' });
        const swatch = document.createElement('span');
        Object.assign(swatch.style, {
            width: '11px', height: '11px', flex: '0 0 auto', borderRadius: '50%',
            background: ysRuleGetColorHex(value), boxShadow: '0 0 0 1px rgba(127,127,127,.22)',
        });
        const text = document.createElement('span');
        text.textContent = ysT(`customRulesColor_${value}`);
        const arrow = document.createElement('span');
        arrow.textContent = '⌄';
        arrow.style.color = 'var(--ys-text-muted)';
        label.append(swatch, text);
        trigger.replaceChildren(label, arrow);
    };
    renderTrigger();

    const closeMenu = () => {
        const menu = document.getElementById(`ys-rule-color-menu-${trigger.dataset.pickerId}`);
        if (menu) menu.remove();
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', handleOutside, true);
        document.removeEventListener('scroll', closeMenu, true);
        window.removeEventListener('resize', closeMenu);
        if (ysActiveRuleColorPickerClose === closeMenu) ysActiveRuleColorPickerClose = null;
    };
    const handleOutside = (event) => {
        const menu = document.getElementById(`ys-rule-color-menu-${trigger.dataset.pickerId}`);
        if (!root.contains(event.target) && (!menu || !menu.contains(event.target))) closeMenu();
    };
    trigger.dataset.pickerId = ysRuleCreateId('picker');
    trigger.addEventListener('click', () => {
        if (ysActiveRuleColorPickerClose) ysActiveRuleColorPickerClose();
        if (ysActiveRuleTimePickerClose) ysActiveRuleTimePickerClose();
        if (ysActiveRuleEmojiPickerClose) ysActiveRuleEmojiPickerClose();
        const menu = document.createElement('div');
        menu.id = `ys-rule-color-menu-${trigger.dataset.pickerId}`;
        menu.setAttribute('role', 'listbox');
        Object.assign(menu.style, {
            position: 'fixed', zIndex: '2147483650', width: '150px', padding: '5px', boxSizing: 'border-box',
            border: '1px solid var(--ys-card-border)', borderRadius: '11px',
            background: 'var(--ys-card-bg)', backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 16px 36px rgba(0,0,0,.24)',
        });
        YS_RULE_COLORS.forEach((color) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(color.value === value));
            Object.assign(option.style, {
                width: '100%', display: 'grid', gridTemplateColumns: '16px 14px 1fr', gap: '7px',
                alignItems: 'center', border: 'none', borderRadius: '7px', padding: '7px 8px',
                background: color.value === value ? 'var(--ys-accent-bg)' : 'transparent',
                color: 'var(--ys-text-primary)', fontSize: '12px', textAlign: 'left', cursor: 'pointer',
            });
            const check = document.createElement('span');
            check.textContent = color.value === value ? '✓' : '';
            check.style.color = 'var(--ys-accent)';
            const swatch = document.createElement('span');
            Object.assign(swatch.style, {
                width: '12px', height: '12px', borderRadius: '50%', background: ysRuleGetColorHex(color.value),
                boxShadow: '0 0 0 1px rgba(127,127,127,.22)',
            });
            const label = document.createElement('span');
            label.textContent = ysT(`customRulesColor_${color.value}`);
            option.append(check, swatch, label);
            option.addEventListener('mouseenter', () => { option.style.background = 'var(--ys-btn-hover)'; });
            option.addEventListener('mouseleave', () => {
                option.style.background = color.value === value ? 'var(--ys-accent-bg)' : 'transparent';
            });
            option.addEventListener('click', () => {
                value = color.value;
                renderTrigger();
                onChange(value);
                closeMenu();
            });
            menu.appendChild(option);
        });
        document.body.appendChild(menu);
        const rect = trigger.getBoundingClientRect();
        menu.style.width = `${rect.width}px`;
        const menuRect = menu.getBoundingClientRect();
        const top = rect.bottom + 6 + menuRect.height <= window.innerHeight - 12
            ? rect.bottom + 6
            : Math.max(12, rect.top - menuRect.height - 6);
        const left = Math.max(12, Math.min(window.innerWidth - menuRect.width - 12, rect.right - menuRect.width));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        trigger.setAttribute('aria-expanded', 'true');
        ysActiveRuleColorPickerClose = closeMenu;
        setTimeout(() => document.addEventListener('mousedown', handleOutside, true), 0);
        document.addEventListener('scroll', closeMenu, true);
        window.addEventListener('resize', closeMenu);
    });
    root.appendChild(trigger);
    return root;
}

function ysRuleCreateTimePicker(currentValue, ariaLabel) {
    const normalizedValue = /^([01]\d|2[0-3]):[0-5]\d$/.test(currentValue) ? currentValue : '09:00';
    let [hour, minute] = normalizedValue.split(':');
    const trigger = ysRuleInputStyle(document.createElement('button'));
    trigger.type = 'button';
    trigger.value = normalizedValue;
    trigger.dataset.pickerId = ysRuleCreateId('time-picker');
    trigger.setAttribute('aria-label', ariaLabel);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    Object.assign(trigger.style, {
        minHeight: '39px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', textAlign: 'left', fontVariantNumeric: 'tabular-nums',
    });

    const renderTrigger = () => {
        const valueText = document.createElement('span');
        valueText.textContent = `${hour}:${minute}`;
        valueText.style.fontWeight = '650';
        const arrow = document.createElement('span');
        arrow.textContent = '⌄';
        Object.assign(arrow.style, { color: 'var(--ys-text-muted)', fontSize: '13px' });
        trigger.value = `${hour}:${minute}`;
        trigger.replaceChildren(valueText, arrow);
    };
    renderTrigger();

    const getMenu = () => document.getElementById(`ys-rule-time-menu-${trigger.dataset.pickerId}`);
    const closeMenu = (restoreFocus = false) => {
        const menu = getMenu();
        if (menu) menu.remove();
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', handleOutside, true);
        document.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleResize);
        if (ysActiveRuleTimePickerClose === closeMenu) ysActiveRuleTimePickerClose = null;
        if (restoreFocus) trigger.focus();
    };
    const handleOutside = (event) => {
        const menu = getMenu();
        if (event.target !== trigger && (!menu || !menu.contains(event.target))) closeMenu();
    };
    const handleScroll = (event) => {
        const menu = getMenu();
        if (!menu || menu.contains(event.target)) return;
        closeMenu();
    };
    const handleResize = () => closeMenu();

    trigger.addEventListener('click', () => {
        if (getMenu()) {
            closeMenu();
            return;
        }
        if (ysActiveRuleColorPickerClose) ysActiveRuleColorPickerClose();
        if (ysActiveRuleTimePickerClose) ysActiveRuleTimePickerClose();
        if (ysActiveRuleEmojiPickerClose) ysActiveRuleEmojiPickerClose();

        const menu = document.createElement('div');
        menu.id = `ys-rule-time-menu-${trigger.dataset.pickerId}`;
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', ariaLabel);
        Object.assign(menu.style, {
            position: 'fixed', zIndex: '2147483650', width: '236px', padding: '7px',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px',
            border: '1px solid var(--ys-card-border)', borderRadius: '12px',
            background: 'var(--ys-card-bg)', backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 14px 34px rgba(25, 35, 58, .22)',
        });

        const createColumn = (label, values, selectedValue, onSelect) => {
            const column = document.createElement('div');
            Object.assign(column.style, {
                minWidth: '0', padding: '4px', borderRadius: '9px', background: 'var(--ys-btn-bg)',
            });
            const heading = document.createElement('div');
            heading.textContent = label;
            Object.assign(heading.style, {
                padding: '3px 7px 7px', color: 'var(--ys-text-muted)', fontSize: '10px',
                fontWeight: '700', textAlign: 'center',
            });
            const list = document.createElement('div');
            list.setAttribute('role', 'listbox');
            list.setAttribute('aria-label', label);
            Object.assign(list.style, {
                height: '204px', overflowY: 'auto', overscrollBehavior: 'contain',
                scrollbarWidth: 'thin', scrollbarColor: 'var(--ys-divider) transparent',
            });
            const options = [];
            const syncOptions = (nextValue) => {
                options.forEach((option) => {
                    const selected = option.dataset.value === nextValue;
                    option.setAttribute('aria-selected', String(selected));
                    option.style.background = selected ? 'var(--ys-accent)' : 'transparent';
                    option.style.color = selected ? '#fff' : 'var(--ys-text-primary)';
                    option.style.fontWeight = selected ? '700' : '550';
                });
            };
            values.forEach((value, index) => {
                const option = document.createElement('button');
                option.type = 'button';
                option.dataset.value = value;
                option.setAttribute('role', 'option');
                option.textContent = value;
                Object.assign(option.style, {
                    width: '100%', minHeight: '32px', display: 'block', border: 'none', borderRadius: '7px',
                    background: 'transparent', color: 'var(--ys-text-primary)', cursor: 'pointer',
                    fontSize: '12px', fontVariantNumeric: 'tabular-nums', textAlign: 'center',
                });
                option.addEventListener('mouseenter', () => {
                    if (option.getAttribute('aria-selected') !== 'true') option.style.background = 'var(--ys-btn-hover)';
                });
                option.addEventListener('mouseleave', () => syncOptions(
                    options.find((candidate) => candidate.getAttribute('aria-selected') === 'true')?.dataset.value,
                ));
                option.addEventListener('click', () => {
                    syncOptions(value);
                    onSelect(value);
                });
                option.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        closeMenu(true);
                        return;
                    }
                    const targetIndex = event.key === 'ArrowDown'
                        ? Math.min(values.length - 1, index + 1)
                        : event.key === 'ArrowUp'
                            ? Math.max(0, index - 1)
                            : event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                    ? values.length - 1
                                    : -1;
                    if (targetIndex >= 0) {
                        event.preventDefault();
                        options[targetIndex].focus();
                    }
                });
                options.push(option);
                list.appendChild(option);
            });
            syncOptions(selectedValue);
            column.append(heading, list);
            return { column, selectedOption: options.find((option) => option.dataset.value === selectedValue) };
        };

        const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
        const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
        const hourColumn = createColumn(ysT('customRulesHourLabel'), hours, hour, (value) => {
            hour = value;
            renderTrigger();
        });
        const minuteColumn = createColumn(ysT('customRulesMinuteLabel'), minutes, minute, (value) => {
            minute = value;
            renderTrigger();
            closeMenu(true);
        });
        menu.append(hourColumn.column, minuteColumn.column);
        document.body.appendChild(menu);

        const rect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const top = rect.bottom + 6 + menuRect.height <= window.innerHeight - 12
            ? rect.bottom + 6
            : Math.max(12, rect.top - menuRect.height - 6);
        const left = Math.max(12, Math.min(window.innerWidth - menuRect.width - 12, rect.left));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        trigger.setAttribute('aria-expanded', 'true');
        ysActiveRuleTimePickerClose = closeMenu;
        setTimeout(() => {
            hourColumn.selectedOption?.scrollIntoView({ block: 'center' });
            minuteColumn.selectedOption?.scrollIntoView({ block: 'center' });
            hourColumn.selectedOption?.focus({ preventScroll: true });
            document.addEventListener('mousedown', handleOutside, true);
        }, 0);
        document.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleResize);
    });

    return trigger;
}

function ysRuleScheduleSummary(rule) {
    const schedule = rule && rule.schedule ? rule.schedule : { mode: 'always' };
    if (schedule.mode !== 'weekly') return ysT('customRulesAlways');
    const dayLabels = ysGetResolvedLanguage() === 'en'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        : ['日', '一', '二', '三', '四', '五', '六'];
    const days = (Array.isArray(schedule.days) ? schedule.days : []).map((day) => dayLabels[day]).filter(Boolean);
    return `${days.join('、')} · ${schedule.start || '09:00'}–${schedule.end || '18:00'}`;
}

function ysRuleOpenDeleteConfirm(ruleName, onConfirm) {
    openYsModal(ysT('customRulesDeleteDialogTitle'), (container, close) => {
        Object.assign(container.style, {
            display: 'flex', flexDirection: 'column', gap: '14px', color: 'var(--ys-text-primary)',
        });

        const message = document.createElement('div');
        message.textContent = ysT('customRulesDeleteConfirm', [ruleName]);
        Object.assign(message.style, { fontSize: '13px', lineHeight: '1.6', fontWeight: '600' });
        const warning = document.createElement('div');
        warning.textContent = ysT('customRulesDeleteWarning');
        Object.assign(warning.style, {
            marginTop: '-8px', fontSize: '11px', lineHeight: '1.5', color: 'var(--ys-text-muted)',
        });

        const actions = document.createElement('div');
        Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' });
        const cancel = ysRuleButton(ysT('btnCancel'));
        cancel.addEventListener('click', close);
        const remove = ysRuleButton(ysT('customRulesDeleteAction'));
        Object.assign(remove.style, {
            borderColor: 'rgba(210, 55, 65, .45)', background: '#d7444e', color: '#fff', padding: '8px 13px',
        });
        remove.addEventListener('mouseenter', () => { if (!remove.disabled) remove.style.background = '#c83a44'; });
        remove.addEventListener('mouseleave', () => { remove.style.background = '#d7444e'; });
        remove.addEventListener('click', () => {
            if (remove.disabled) return;
            remove.disabled = true;
            remove.style.opacity = '0.6';
            close();
            onConfirm();
        });
        actions.append(cancel, remove);
        container.append(message, warning, actions);
        setTimeout(() => cancel.focus(), 0);
    }, { width: '360px', centerInViewport: true, role: 'alertdialog' });
}

function showYsCustomGroupingRulesModal() {
    if (typeof openYsModal !== 'function') {
        showCustomToast(ysT('customRulesUnavailable'), 2400);
        return;
    }

    openYsModal(ysT('customRulesTitle'), (container, close) => {
        container.textContent = ysT('customRulesLoading');
        Object.assign(container.style, { color: 'var(--ys-text-muted)', fontSize: '12px', minHeight: '160px' });

        ysRuleLoadAll((rules) => {
            const renderList = () => {
                container.replaceChildren();
                container.style.color = '';
                container.style.fontSize = '';
                container.style.minHeight = '';

                const intro = document.createElement('div');
                intro.textContent = ysT('customRulesIntro');
                Object.assign(intro.style, {
                    fontSize: '11px', color: 'var(--ys-text-secondary)', lineHeight: '1.6', marginBottom: '12px',
                });
                container.appendChild(intro);

                const list = document.createElement('div');
                Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '8px' });

                if (rules.length === 0) {
                    const empty = document.createElement('div');
                    empty.textContent = ysT('customRulesEmpty');
                    Object.assign(empty.style, {
                        padding: '34px 18px', textAlign: 'center', border: '1px dashed var(--ys-divider)',
                        borderRadius: '12px', color: 'var(--ys-text-muted)', fontSize: '12px', lineHeight: '1.7',
                    });
                    list.appendChild(empty);
                }

                const openEditor = (rule) => {
                    close();
                    setTimeout(() => ysShowCustomRuleEditor(rule, rules), 220);
                };

                rules.forEach((rule, index) => {
                    const card = document.createElement('div');
                    Object.assign(card.style, {
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px',
                        borderRadius: '12px', border: '1px solid var(--ys-divider)', background: 'var(--ys-btn-bg)',
                        opacity: rule.enabled === false ? '0.58' : '1',
                    });

                    const toggle = document.createElement('input');
                    toggle.type = 'checkbox';
                    toggle.checked = rule.enabled !== false;
                    toggle.title = ysT('customRulesToggle');
                    toggle.addEventListener('change', () => {
                        rule.enabled = toggle.checked;
                        rule.updatedAt = Date.now();
                        ysRuleSaveAll(rules, () => renderList());
                    });

                    const main = document.createElement('button');
                    main.type = 'button';
                    Object.assign(main.style, {
                        flex: '1', minWidth: '0', border: 'none', background: 'transparent', cursor: 'pointer',
                        padding: '0', textAlign: 'left', color: 'inherit',
                    });
                    const title = document.createElement('div');
                    title.textContent = rule.name || ysT('customRulesUntitled');
                    Object.assign(title.style, {
                        color: 'var(--ys-text-title)', fontSize: '12px', fontWeight: '700',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    });
                    const meta = document.createElement('div');
                    const groupCount = Array.isArray(rule.groups)
                        ? rule.groups.length
                        : (rule.targetCategory ? 1 : 0);
                    const typeSummary = rule.type === 'matcher'
                        ? ysT('customRulesGroupCount', [String(groupCount)])
                        : ysT('customRulesDescriptionMode');
                    meta.textContent = `${ysRuleScheduleSummary(rule)} · ${typeSummary}`;
                    Object.assign(meta.style, {
                        marginTop: '4px', color: 'var(--ys-text-muted)', fontSize: '10px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    });
                    main.append(title, meta);
                    main.addEventListener('click', () => openEditor(rule));

                    const actions = document.createElement('div');
                    Object.assign(actions.style, { display: 'flex', gap: '3px', flexShrink: '0' });
                    const actionButton = (label, titleText, handler, disabled = false) => {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.textContent = label;
                        button.title = titleText;
                        button.disabled = disabled;
                        Object.assign(button.style, {
                            width: '26px', height: '26px', border: 'none', borderRadius: '7px',
                            background: 'transparent', color: 'var(--ys-text-secondary)', cursor: disabled ? 'default' : 'pointer',
                            opacity: disabled ? '0.25' : '0.8',
                        });
                        button.addEventListener('click', handler);
                        return button;
                    };
                    actions.appendChild(actionButton('↑', ysT('customRulesMoveUp'), () => {
                        if (index <= 0) return;
                        [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
                        ysRuleSaveAll(rules, (error, saved) => { if (!error) { rules = saved; renderList(); } });
                    }, index === 0));
                    actions.appendChild(actionButton('↓', ysT('customRulesMoveDown'), () => {
                        if (index >= rules.length - 1) return;
                        [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
                        ysRuleSaveAll(rules, (error, saved) => { if (!error) { rules = saved; renderList(); } });
                    }, index === rules.length - 1));
                    actions.appendChild(actionButton('×', ysT('customRulesDelete'), () => {
                        ysRuleOpenDeleteConfirm(rule.name || ysT('customRulesUntitled'), () => {
                            const deleteIndex = rules.findIndex((candidate) => candidate.id === rule.id);
                            if (deleteIndex < 0) return;
                            rules.splice(deleteIndex, 1);
                            ysRuleSaveAll(rules, (error, saved) => { if (!error) { rules = saved; renderList(); } });
                        });
                    }));

                    card.append(toggle, main, actions);
                    list.appendChild(card);
                });

                container.appendChild(list);

                const footer = document.createElement('div');
                Object.assign(footer.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' });
                const count = document.createElement('span');
                count.textContent = `${rules.length}/${YS_RULE_LIMITS.rules}`;
                Object.assign(count.style, { fontSize: '10px', color: 'var(--ys-text-muted)' });
                const addButton = ysRuleButton(ysT('customRulesNew'), true);
                addButton.disabled = rules.length >= YS_RULE_LIMITS.rules;
                addButton.style.opacity = addButton.disabled ? '0.45' : '1';
                addButton.addEventListener('click', () => {
                    if (!addButton.disabled) openEditor(null);
                });
                footer.append(count, addButton);
                container.appendChild(footer);
            };
            renderList();
        });
    }, { width: '500px', scrollable: true, centerInViewport: true });
}

function ysShowCustomRuleEditor(existingRule, sourceRules) {
    const now = Date.now();
    const state = existingRule
        ? JSON.parse(JSON.stringify(existingRule))
        : {
            id: ysRuleCreateId('rule'), name: '', type: 'description', instructions: '', enabled: true,
            order: sourceRules.length, schedule: { mode: 'always' }, groups: [],
            createdAt: now, updatedAt: now,
        };
    state.type = state.type === 'matcher' ? 'matcher' : 'description';
    const createCondition = () => ({
        id: ysRuleCreateId('condition'), field: 'domain', operator: 'contains', value: '',
    });
    const createMatcherGroup = () => ({
        id: ysRuleCreateId('category'), emoji: YS_RULE_EMOJIS[0], name: '', color: 'blue', conditions: [createCondition()],
    });
    if (!Array.isArray(state.groups)) state.groups = [];
    if (state.groups.length === 0 && state.targetCategory && typeof state.targetCategory === 'object') {
        state.groups = [{
            ...state.targetCategory,
            conditions: Array.isArray(state.conditions) && state.conditions.length > 0
                ? state.conditions
                : [createCondition()],
        }];
    }
    if (state.groups.length === 0) state.groups.push(createMatcherGroup());
    state.groups.forEach((group) => {
        if (!YS_RULE_EMOJIS.includes(group.emoji)) group.emoji = YS_RULE_EMOJIS[0];
        if (!Array.isArray(group.conditions) || group.conditions.length === 0) group.conditions = [createCondition()];
        group.conditions.forEach((condition) => {
            if (!['contains', 'equals'].includes(condition.operator)) condition.operator = 'contains';
        });
    });
    const collapsedGroupIds = new Set(state.groups.slice(1).map((group) => group.id));

    openYsModal(existingRule ? ysT('customRulesEditTitle') : ysT('customRulesNewTitle'), (container, close) => {
        Object.assign(container.style, { display: 'flex', flexDirection: 'column', gap: '13px' });

        const errorBox = document.createElement('div');
        Object.assign(errorBox.style, {
            display: 'none', padding: '8px 10px', borderRadius: '8px', fontSize: '11px', lineHeight: '1.45',
            color: '#b83939', background: 'rgba(220,70,70,.1)', border: '1px solid rgba(220,70,70,.2)',
        });
        const showError = (message) => {
            errorBox.textContent = message;
            errorBox.style.display = 'block';
        };
        container.appendChild(errorBox);

        const nameField = document.createElement('div');
        nameField.appendChild(ysRuleFieldLabel(ysT('customRulesNameLabel')));
        const nameInput = ysRuleInputStyle(document.createElement('input'));
        nameInput.type = 'text';
        nameInput.maxLength = YS_RULE_LIMITS.name;
        nameInput.placeholder = ysT('customRulesNamePlaceholder');
        nameInput.value = state.name || '';
        nameField.appendChild(nameInput);
        container.appendChild(nameField);

        const typeField = document.createElement('div');
        typeField.appendChild(ysRuleFieldLabel(ysT('customRulesTypeLabel')));
        const typeRow = document.createElement('div');
        Object.assign(typeRow.style, {
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', padding: '4px',
            borderRadius: '11px', background: 'var(--ys-btn-bg)',
        });
        const typeButtons = new Map();
        [
            ['description', ysT('customRulesDescriptionMode')],
            ['matcher', ysT('customRulesMatcherMode')],
        ].forEach(([value, label]) => {
            const option = document.createElement('label');
            Object.assign(option.style, {
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                minHeight: '34px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '650',
                transition: 'background .15s, border-color .15s',
            });
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `ys-rule-type-${state.id}`;
            radio.value = value;
            radio.checked = state.type === value;
            const icon = ysRuleCreateTypeIcon(value);
            const text = document.createElement('span');
            text.textContent = label;
            option.append(radio, icon, text);
            typeButtons.set(value, option);
            typeRow.appendChild(option);
        });
        typeField.appendChild(typeRow);
        container.appendChild(typeField);

        const instructionsField = document.createElement('div');
        instructionsField.appendChild(ysRuleFieldLabel(ysT('customRulesInstructionsLabel')));
        const instructionsInput = ysRuleInputStyle(document.createElement('textarea'));
        instructionsInput.maxLength = YS_RULE_LIMITS.instructions;
        instructionsInput.rows = 5;
        instructionsInput.placeholder = ysT('customRulesInstructionsPlaceholder');
        instructionsInput.value = state.instructions || '';
        instructionsInput.style.resize = 'vertical';
        instructionsInput.style.lineHeight = '1.55';
        instructionsField.appendChild(instructionsInput);
        const hint = document.createElement('div');
        hint.textContent = ysT('customRulesInstructionsHint');
        Object.assign(hint.style, { marginTop: '5px', fontSize: '10px', lineHeight: '1.5', color: 'var(--ys-text-muted)' });
        instructionsField.appendChild(hint);
        container.appendChild(instructionsField);

        const scheduleField = document.createElement('div');
        scheduleField.appendChild(ysRuleFieldLabel(ysT('customRulesScheduleLabel')));
        const scheduleOptions = [
            ['always', ysT('customRulesAlways')],
            ['weekly', ysT('customRulesScheduled')],
        ];
        let syncScheduleVisibility = () => {};
        const scheduleMode = ysRuleCreateCompactSelect(
            scheduleOptions,
            state.schedule && state.schedule.mode === 'weekly' ? 'weekly' : 'always',
            () => syncScheduleVisibility(),
            ysT('customRulesScheduleLabel'),
            { width: 220, align: 'right' },
        );
        scheduleField.appendChild(scheduleMode);

        const weeklyArea = document.createElement('div');
        Object.assign(weeklyArea.style, { marginTop: '9px', display: 'flex', flexDirection: 'column', gap: '8px' });
        const selectedDays = new Set(
            state.schedule && Array.isArray(state.schedule.days) ? state.schedule.days : [1, 2, 3, 4, 5],
        );
        const dayLabels = ysGetResolvedLanguage() === 'en'
            ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
            : ['日', '一', '二', '三', '四', '五', '六'];
        const dayRow = document.createElement('div');
        Object.assign(dayRow.style, { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px' });
        dayLabels.forEach((label, day) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            const sync = () => Object.assign(button.style, {
                height: '30px', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: '650',
                border: `1px solid ${selectedDays.has(day) ? 'var(--ys-accent-hover)' : 'var(--ys-divider)'}`,
                color: selectedDays.has(day) ? 'var(--ys-accent-text)' : 'var(--ys-text-secondary)',
                background: selectedDays.has(day) ? 'var(--ys-accent-bg)' : 'var(--ys-btn-bg)',
            });
            sync();
            button.addEventListener('click', () => {
                if (selectedDays.has(day)) selectedDays.delete(day); else selectedDays.add(day);
                sync();
            });
            dayRow.appendChild(button);
        });
        weeklyArea.appendChild(dayRow);

        const timeRow = document.createElement('div');
        Object.assign(timeRow.style, { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'center' });
        const startInput = ysRuleCreateTimePicker(
            (state.schedule && state.schedule.start) || '09:00',
            ysT('customRulesStartTimeLabel'),
        );
        const dash = document.createElement('span');
        dash.textContent = '—';
        dash.style.color = 'var(--ys-text-muted)';
        const endInput = ysRuleCreateTimePicker(
            (state.schedule && state.schedule.end) || '18:00',
            ysT('customRulesEndTimeLabel'),
        );
        timeRow.append(startInput, dash, endInput);
        weeklyArea.appendChild(timeRow);
        const overnightHint = document.createElement('div');
        overnightHint.textContent = ysT('customRulesOvernightHint');
        Object.assign(overnightHint.style, { fontSize: '10px', color: 'var(--ys-text-muted)' });
        weeklyArea.appendChild(overnightHint);
        scheduleField.appendChild(weeklyArea);
        syncScheduleVisibility = () => { weeklyArea.style.display = scheduleMode.value === 'weekly' ? 'flex' : 'none'; };
        syncScheduleVisibility();

        const matcherField = document.createElement('div');
        Object.assign(matcherField.style, {
            display: 'flex', flexDirection: 'column', gap: '13px',
        });
        const groupsHeader = document.createElement('div');
        Object.assign(groupsHeader.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        });
        const groupsTitle = ysRuleFieldLabel(ysT('customRulesGroupsLabel'));
        groupsTitle.style.marginBottom = '0';
        groupsHeader.appendChild(groupsTitle);
        const addGroup = ysRuleButton(ysT('customRulesAddGroup'));
        addGroup.prepend(ysRuleCreateAddGroupIcon());
        Object.assign(addGroup.style, {
            display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 8px',
        });
        groupsHeader.appendChild(addGroup);
        matcherField.appendChild(groupsHeader);
        const groupsList = document.createElement('div');
        Object.assign(groupsList.style, {
            display: 'flex', flexDirection: 'column', gap: '9px',
            overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin',
            scrollbarColor: 'var(--ys-divider) transparent',
            maxHeight: 'min(420px, 42vh)',
        });
        matcherField.appendChild(groupsList);

        const conditionOptions = {
            fields: [
                ['domain', ysT('customRulesFieldDomain')],
                ['title', ysT('customRulesFieldTitle')],
                ['url', ysT('customRulesFieldUrl')],
            ],
            operators: [
                ['contains', ysT('customRulesOperatorContains')],
                ['equals', ysT('customRulesOperatorEquals')],
            ],
        };

        const renderGroups = () => {
            groupsList.replaceChildren();
            state.groups.forEach((group, groupIndex) => {
                const card = document.createElement('div');
                Object.assign(card.style, {
                    display: 'flex', flexDirection: 'column', gap: '9px', padding: '12px',
                    border: '1px solid var(--ys-divider)', borderRadius: '12px', background: 'var(--ys-btn-bg)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.035)',
                });
                const cardHeader = document.createElement('div');
                Object.assign(cardHeader.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', userSelect: 'none',
                });
                const cardTitle = ysRuleFieldLabel(ysT('customRulesGroupIndex', [String(groupIndex + 1)]));
                cardTitle.style.marginBottom = '0';
                const syncCardTitle = () => {
                    const indexLabel = ysT('customRulesGroupIndex', [String(groupIndex + 1)]);
                    const groupName = String(group.name || '').trim();
                    const groupEmoji = String(group.emoji || '').trim();
                    cardTitle.textContent = groupName
                        ? `${indexLabel} · ${groupEmoji ? `${groupEmoji} ` : ''}${groupName}`
                        : indexLabel;
                };
                syncCardTitle();
                const cardActions = document.createElement('div');
                Object.assign(cardActions.style, { display: 'flex', gap: '4px' });
                const isCollapsed = collapsedGroupIds.has(group.id);
                const collapseGroup = ysRuleButton(
                    `${isCollapsed ? '▸' : '▾'} ${isCollapsed ? ysT('customRulesExpandGroup') : ysT('customRulesCollapseGroup')}`,
                );
                collapseGroup.title = collapsedGroupIds.has(group.id)
                    ? ysT('customRulesExpandGroup')
                    : ysT('customRulesCollapseGroup');
                Object.assign(collapseGroup.style, { padding: '4px 7px', color: 'var(--ys-text-secondary)' });
                const toggleGroup = () => {
                    if (collapsedGroupIds.has(group.id)) {
                        state.groups.forEach((item) => {
                            if (item.id !== group.id) collapsedGroupIds.add(item.id);
                        });
                        collapsedGroupIds.delete(group.id);
                    } else {
                        collapsedGroupIds.add(group.id);
                    }
                    renderGroups();
                };
                collapseGroup.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggleGroup();
                });
                cardActions.appendChild(collapseGroup);
                const moveGroup = (label, title, direction, disabled) => {
                    const button = ysRuleButton(label);
                    button.title = title;
                    button.disabled = disabled;
                    Object.assign(button.style, { padding: '4px 7px', opacity: disabled ? '0.35' : '1' });
                    button.addEventListener('click', (event) => {
                        event.stopPropagation();
                        if (disabled) return;
                        const nextIndex = groupIndex + direction;
                        [state.groups[groupIndex], state.groups[nextIndex]] = [state.groups[nextIndex], state.groups[groupIndex]];
                        renderGroups();
                    });
                    return button;
                };
                cardActions.append(
                    moveGroup('↑', ysT('customRulesMoveGroupUp'), -1, groupIndex === 0),
                    moveGroup('↓', ysT('customRulesMoveGroupDown'), 1, groupIndex === state.groups.length - 1),
                );
                const removeGroup = ysRuleButton('×');
                removeGroup.title = ysT('customRulesRemoveGroup');
                removeGroup.disabled = state.groups.length === 1;
                Object.assign(removeGroup.style, {
                    padding: '4px 7px', color: '#d84d58', borderColor: 'rgba(220,70,70,.3)',
                    opacity: removeGroup.disabled ? '0.35' : '1',
                });
                removeGroup.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (removeGroup.disabled) return;
                    state.groups.splice(groupIndex, 1);
                    renderGroups();
                });
                cardActions.appendChild(removeGroup);
                cardHeader.append(cardTitle, cardActions);
                cardHeader.addEventListener('click', toggleGroup);
                card.appendChild(cardHeader);

                const groupBody = document.createElement('div');
                Object.assign(groupBody.style, {
                    display: collapsedGroupIds.has(group.id) ? 'none' : 'flex',
                    flexDirection: 'column', gap: '9px',
                });
                card.appendChild(groupBody);

                const targetRow = document.createElement('div');
                Object.assign(targetRow.style, {
                    display: 'grid', gridTemplateColumns: '64px minmax(140px, 1fr) 150px', gap: '7px', alignItems: 'center',
                });
                const targetEmoji = ysRuleCreateEmojiSelect(group.emoji || '', (value) => {
                    group.emoji = value;
                    syncCardTitle();
                });
                const targetName = ysRuleInputStyle(document.createElement('input'));
                targetName.value = group.name || '';
                targetName.placeholder = ysT('customRulesGroupNamePlaceholder');
                targetName.maxLength = YS_RULE_LIMITS.categoryName;
                targetName.addEventListener('input', () => {
                    group.name = targetName.value;
                    syncCardTitle();
                });
                const targetColor = ysRuleCreateColorPicker(group.color || 'blue', (value) => {
                    group.color = value;
                });
                targetRow.append(targetEmoji, targetName, targetColor);
                groupBody.appendChild(targetRow);

                const conditionsHeader = document.createElement('div');
                Object.assign(conditionsHeader.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px',
                });
                conditionsHeader.appendChild(ysRuleFieldLabel(ysT('customRulesConditionsLabel')));
                const addConditionTop = ysRuleButton(ysT('customRulesAddCondition'));
                addConditionTop.style.padding = '5px 8px';
                conditionsHeader.appendChild(addConditionTop);
                groupBody.appendChild(conditionsHeader);
                const conditionsList = document.createElement('div');
                Object.assign(conditionsList.style, { display: 'flex', flexDirection: 'column', gap: '7px' });
                groupBody.appendChild(conditionsList);

                const addConditionAt = (index) => {
                    if (group.conditions.length >= YS_RULE_LIMITS.conditions) {
                        showError(ysT('customRulesTooManyConditions'));
                        return;
                    }
                    group.conditions.splice(index, 0, createCondition());
                    renderGroups();
                };
                group.conditions.forEach((condition, conditionIndex) => {
                const row = document.createElement('div');
                Object.assign(row.style, {
                    display: 'grid', gridTemplateColumns: '118px 105px minmax(130px, 1fr) 28px 28px',
                    gap: '6px', alignItems: 'center',
                });
                const fieldSelect = ysRuleCreateCompactSelect(
                    conditionOptions.fields,
                    condition.field || 'domain',
                    (value) => {
                        condition.field = value;
                        valueInput.placeholder = value === 'domain' ? 'news.qq.com' : ysT('customRulesMatchValuePlaceholder');
                    },
                    ysT('customRulesConditionsLabel'),
                );

                const operatorSelect = ysRuleCreateCompactSelect(
                    conditionOptions.operators,
                    condition.operator || 'contains',
                    (value) => { condition.operator = value; },
                    ysT('customRulesOperatorContains'),
                );

                const valueInput = ysRuleInputStyle(document.createElement('input'));
                valueInput.value = condition.value || '';
                valueInput.maxLength = YS_RULE_LIMITS.conditionValue;
                valueInput.placeholder = condition.field === 'domain' ? 'news.qq.com' : ysT('customRulesMatchValuePlaceholder');
                valueInput.addEventListener('input', () => { condition.value = valueInput.value; });

                const plus = ysRuleButton('+');
                plus.title = ysT('customRulesAddCondition');
                plus.style.padding = '5px';
                plus.style.borderColor = 'rgba(55,115,235,.35)';
                plus.style.color = '#3478e5';
                plus.addEventListener('click', () => addConditionAt(conditionIndex + 1));
                const remove = ysRuleButton('−');
                remove.title = ysT('customRulesRemoveCondition');
                remove.style.padding = '5px';
                remove.style.borderColor = 'rgba(220,70,70,.3)';
                remove.style.color = '#d84d58';
                remove.disabled = group.conditions.length === 1;
                remove.style.opacity = remove.disabled ? '0.35' : '1';
                remove.addEventListener('click', () => {
                    if (remove.disabled) return;
                    group.conditions.splice(conditionIndex, 1);
                    renderGroups();
                });
                row.append(fieldSelect, operatorSelect, valueInput, plus, remove);
                conditionsList.appendChild(row);
                });
                addConditionTop.addEventListener('click', () => addConditionAt(group.conditions.length));
                const conditionHint = document.createElement('div');
                conditionHint.textContent = ysT('customRulesConditionsHint');
                Object.assign(conditionHint.style, { fontSize: '10px', lineHeight: '1.5', color: 'var(--ys-text-muted)' });
                groupBody.appendChild(conditionHint);
                groupsList.appendChild(card);
            });
            addGroup.disabled = state.groups.length >= YS_RULE_LIMITS.groups;
            addGroup.style.opacity = addGroup.disabled ? '0.45' : '1';
        };
        addGroup.addEventListener('click', () => {
            if (state.groups.length >= YS_RULE_LIMITS.groups) {
                showError(ysT('customRulesTooManyGroups'));
                return;
            }
            state.groups.forEach((group) => collapsedGroupIds.add(group.id));
            state.groups.push(createMatcherGroup());
            renderGroups();
        });
        renderGroups();
        container.appendChild(matcherField);
        container.appendChild(scheduleField);

        const syncRuleTypeVisibility = () => {
            typeButtons.forEach((option, value) => {
                const active = state.type === value;
                option.style.background = active ? 'var(--ys-accent-bg)' : 'transparent';
                option.style.border = `1px solid ${active ? 'var(--ys-accent-hover)' : 'transparent'}`;
                option.style.color = active ? 'var(--ys-accent-text)' : 'var(--ys-text-secondary)';
                option.querySelector('input').checked = active;
            });
            instructionsField.style.display = state.type === 'description' ? 'block' : 'none';
            matcherField.style.display = state.type === 'matcher' ? 'flex' : 'none';
        };
        typeButtons.forEach((option, value) => {
            option.querySelector('input').addEventListener('change', () => {
                state.type = value;
                syncRuleTypeVisibility();
            });
        });
        syncRuleTypeVisibility();

        const footer = document.createElement('div');
        Object.assign(footer.style, {
            display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 0 2px',
            position: 'sticky', bottom: '0', zIndex: '3', background: 'transparent',
        });
        const cancel = ysRuleButton(ysT('btnCancel'));
        cancel.addEventListener('click', () => {
            close();
            setTimeout(showYsCustomGroupingRulesModal, 220);
        });
        const save = ysRuleButton(ysT('customRulesSave'), true);
        save.addEventListener('click', () => {
            errorBox.style.display = 'none';
            const name = nameInput.value.trim();
            const instructions = instructionsInput.value.trim();
            if (!name) { showError(ysT('customRulesErrorName')); nameInput.focus(); return; }
            if (state.type === 'description' && !instructions) {
                showError(ysT('customRulesErrorInstructions'));
                instructionsInput.focus();
                return;
            }
            if (scheduleMode.value === 'weekly' && selectedDays.size === 0) {
                showError(ysT('customRulesErrorDays'));
                return;
            }
            if (scheduleMode.value === 'weekly' && (!startInput.value || !endInput.value)) {
                showError(ysT('customRulesErrorTime'));
                return;
            }
            const normalizedGroups = state.groups.map((group) => ({
                ...group,
                emoji: String(group.emoji || '').trim(),
                name: String(group.name || '').trim(),
                color: YS_RULE_COLORS.some((item) => item.value === group.color) ? group.color : 'grey',
                conditions: group.conditions.map((condition) => ({
                    ...condition,
                    field: ['domain', 'title', 'url'].includes(condition.field) ? condition.field : 'domain',
                    operator: ['contains', 'equals'].includes(condition.operator)
                        ? condition.operator
                        : 'contains',
                    value: String(condition.value || '').trim(),
                })),
            }));
            if (state.type === 'matcher' && normalizedGroups.some((group) => !group.emoji || !group.name)) {
                showError(ysT('customRulesErrorTargetGroup'));
                return;
            }
            const groupNames = normalizedGroups.map((group) => group.name.toLocaleLowerCase());
            if (state.type === 'matcher' && new Set(groupNames).size !== groupNames.length) {
                showError(ysT('customRulesErrorDuplicateGroup'));
                return;
            }
            if (state.type === 'matcher' && normalizedGroups.some(
                (group) => group.conditions.some((condition) => !condition.value),
            )) {
                showError(ysT('customRulesErrorCondition'));
                return;
            }

            state.name = name;
            state.instructions = state.type === 'description' ? instructions : '';
            state.schedule = scheduleMode.value === 'weekly'
                ? { mode: 'weekly', days: Array.from(selectedDays).sort((a, b) => a - b), start: startInput.value, end: endInput.value }
                : { mode: 'always' };
            state.groups = state.type === 'matcher' ? normalizedGroups : [];
            delete state.categories;
            delete state.targetCategory;
            delete state.conditions;
            state.updatedAt = Date.now();

            const nextRules = sourceRules.map((rule) => ({ ...rule }));
            const existingIndex = nextRules.findIndex((rule) => rule.id === state.id);
            if (existingIndex >= 0) nextRules[existingIndex] = state;
            else nextRules.push(state);

            save.disabled = true;
            save.style.opacity = '0.55';
            ysRuleSaveAll(nextRules, (error) => {
                if (error) {
                    save.disabled = false;
                    save.style.opacity = '1';
                    showError(ysT('customRulesErrorSave', [error]));
                    return;
                }
                close();
                setTimeout(showYsCustomGroupingRulesModal, 220);
            });
        });
        footer.append(cancel, save);
        container.appendChild(footer);
    }, {
        width: '640px',
        maxHeight: 'calc(100vh - 32px)',
        contentMaxHeight: 'calc(100vh - 104px)',
        scrollable: true,
        centerInViewport: true,
    });
}
