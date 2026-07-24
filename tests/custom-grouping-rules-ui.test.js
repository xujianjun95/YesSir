const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const customRules = fs.readFileSync(
  path.join(root, 'content-switcher/04a-custom-grouping-rules.js'),
  'utf8',
);

assert(
  customRules.includes('rules: 5, name: 40'),
  'the custom grouping rule editor must limit the total rule count to five',
);
assert(
  customRules.includes('instructions: 2000, groups: 10, categoryName: 30')
    && customRules.includes('conditions: 20, conditionValue: 300'),
  'each custom rule must allow ten tab groups with twenty conditions per group',
);

assert(
  content.includes("height: options.height || 'auto'"),
  'the shared modal must support an explicit height so its flex scroll area can shrink',
);
assert(
  content.includes("contentBody.style.overscrollBehavior = 'contain'"),
  'scrollable modals must contain wheel and trackpad scrolling',
);
assert(
  content.includes("overlay.addEventListener('wheel', stopOverlayScrollThrough, { passive: false })")
    && content.includes("overlay.addEventListener('touchmove', stopOverlayScrollThrough, { passive: false })"),
  'scroll gestures over the modal backdrop must not reach the underlying page',
);
assert(
  content.includes('const modalHeight = modal.offsetHeight'),
  'long modals must be positioned with dimensions unaffected by their entry transform',
);
assert(
  content.includes('new ResizeObserver(positionModal)')
    && content.includes('modalResizeObserver?.disconnect()'),
  'modals must recenter after dynamic content changes and release their observer on close',
);
assert(
  content.includes("overflow: 'hidden'"),
  'modal content must not paint outside the viewport-bounded shell',
);
assert(
  content.includes("contentBody.style.maxHeight = options.contentMaxHeight || 'calc(100vh - 104px)'"),
  'scrollable modals must stay content-sized until their body reaches the viewport limit',
);
assert(
  customRules.includes("contentMaxHeight: 'calc(100vh - 104px)'"),
  'the custom-rule editor must use a viewport-bounded content area',
);
assert(
  !customRules.includes("height: 'min(780px, calc(100vh - 32px))'"),
  'the custom-rule editor must not force empty vertical space with a fixed height',
);
assert(
  customRules.includes('const collapsedGroupIds = new Set(state.groups.slice(1)'),
  'multi-group rules must open with only the first group expanded',
);
assert(
  customRules.includes("maxHeight: 'min(420px, 42vh)'"),
  'the group editor must grow with its content and scroll only after reaching its viewport limit',
);
assert(
  !customRules.includes('groupsList.style.height = useFixedGroupViewport'),
  'multiple groups must not reserve a fixed-height blank area',
);
assert(
  !customRules.includes("gap: '9px', paddingRight: '6px'")
    && !customRules.includes("scrollbarGutter: 'stable'"),
  'the group cards must use the same full content width as the rule-mode control',
);
assert(
  customRules.includes("cardHeader.addEventListener('click', toggleGroup)"),
  'the full group header must toggle its expanded state',
);
const emojiOptionsSource = customRules.slice(
  customRules.indexOf('const YS_RULE_EMOJIS = ['),
  customRules.indexOf('];', customRules.indexOf('const YS_RULE_EMOJIS = [')),
);
assert.strictEqual(
  (emojiOptionsSource.match(/[\p{Extended_Pictographic}]/gu) || []).length,
  20,
  'the Emoji picker must expose exactly 20 recommended options',
);
assert(
  customRules.includes('function ysRuleCreateEmojiSelect('),
  'Emoji values must use a dedicated picker instead of free-form text inputs',
);
assert(
  customRules.includes("gridTemplateColumns: 'repeat(5, 36px)'"),
  'the Emoji picker must display all options in a compact five-column grid',
);
assert(
  customRules.includes("height: '35px', minHeight: '35px'")
    && customRules.includes("transform: 'translate(-50%, -50%)'"),
  'the Emoji trigger must match the adjacent picker and center its value',
);
assert(
  customRules.includes('const scheduleMode = ysRuleCreateCompactSelect(')
    && customRules.includes("{ width: 220, align: 'right' }"),
  'the schedule selector must use a compact aligned custom menu',
);
assert(
  customRules.includes('function ysRuleCreateAddGroupIcon()')
    && customRules.includes('addGroup.prepend(ysRuleCreateAddGroupIcon())'),
  'the add-group button must use the supplied circular plus icon',
);
assert(
  customRules.includes("display: 'flex', flexDirection: 'column', gap: '13px'")
    && customRules.includes("groupsTitle.style.marginBottom = '0'"),
  'the add-group header must have balanced spacing above and below',
);
assert(
  customRules.includes('function ysRuleOpenDeleteConfirm(')
    && customRules.includes("role: 'alertdialog'")
    && !customRules.includes('window.confirm('),
  'rule deletion must use the accessible YesSir confirmation dialog instead of the browser prompt',
);
assert(
  customRules.includes("container.style.minHeight = ''"),
  'the rule list must clear its loading-state height so the modal keeps balanced vertical padding',
);
assert(
  customRules.includes("menu.addEventListener('wheel', stopScrollThrough, { passive: false })")
    && customRules.includes("menu.addEventListener('touchmove', stopScrollThrough, { passive: false })"),
  'scroll gestures over the Emoji picker must not reach the underlying page',
);
assert(
  customRules.includes('if (!YS_RULE_EMOJIS.includes(group.emoji)) group.emoji = YS_RULE_EMOJIS[0]'),
  'new and legacy groups without a valid Emoji must default to the first recommended option',
);
assert(
  customRules.includes('function ysRuleCreateColorPicker('),
  'Chrome group colors must use a custom picker so every option can show its real swatch',
);
assert(
  customRules.includes("{ value: 'blue', hex: '#1A73E8', darkHex: '#8AB4F8' }"),
  'color swatches must follow Chromium Google color mappings',
);
assert(
  customRules.includes("{ value: 'pink', hex: '#D01884', darkHex: '#FF8BCB' }")
    && customRules.includes("{ value: 'cyan', hex: '#007B83', darkHex: '#78D9EC' }")
    && customRules.includes("{ value: 'orange', hex: '#FA903E', darkHex: '#FCAD70' }"),
  'pink, cyan, and orange swatches must match Chromium tab-group colors in both themes',
);
assert(
  customRules.includes("menu.style.width = `${rect.width}px`"),
  'the color menu must use the exact rendered width of its trigger',
);
assert(
  !customRules.includes("ysT('customRulesCategoriesLabel')"),
  'description mode must not render the removed fixed-category section',
);
assert(
  customRules.includes("position: 'sticky', bottom: '0', zIndex: '3', background: 'transparent'"),
  'the sticky action row must not render a separate white footer panel',
);

console.log('Custom grouping rule UI checks passed');
