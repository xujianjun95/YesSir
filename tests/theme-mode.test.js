const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const switcher = fs.readFileSync(path.join(root, 'content-switcher/04-show-switcher.js'), 'utf8');
const zh = JSON.parse(fs.readFileSync(path.join(root, '_locales/zh_CN/messages.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));

assert(!content.includes('prefers-color-scheme'), 'theme must not follow the browser or system color scheme');
assert(!content.includes('ysEnsureSystemThemeMediaListener'), 'system theme listener must be removed');
assert(content.includes("return mode === 'dark' ? 'dark' : 'light';"), 'legacy and invalid modes must fall back to light');
assert(switcher.includes('const createSwitch = (checked, label) =>'), 'theme must use an inline switch');
assert(switcher.includes("const nextThemeMode = darkModeEnabled ? 'dark' : 'light';"), 'the switch must toggle light and dark');
assert(!switcher.includes("val: 'system'"), 'system mode must be removed from theme settings');
assert(!switcher.includes('showThemeModeModal'), 'theme must not open a secondary dialog');
assert(!zh.themeSystem && !en.themeSystem, 'system theme copy must be removed from both locales');
assert(!zh.themeModalTitle && !en.themeModalTitle, 'obsolete theme dialog copy must be removed');
assert.strictEqual(zh.menuTheme.message, '深色模式', 'Chinese menu must describe the inline switch');
assert.strictEqual(zh.menuEnglishMode.message, '英文界面', 'Chinese menu must describe the inline language switch');
assert(switcher.includes("const languageSwitch = createSwitch(englishEnabled, ysT('menuEnglishMode'))"), 'language must use an inline switch');
assert(content.includes('// initFloatingWidget();'), 'floating widget bootstrap must remain disabled but recoverable');
assert(switcher.includes('// menu.appendChild(floatToggle);'), 'floating widget menu entry must remain disabled but recoverable');

const menuSource = switcher.slice(switcher.indexOf(
  "chrome.storage.local.get({ showFloatingWidget: true, themeMode: 'light', uiLanguage: 'auto' }",
));
const expectedMenuOrder = [
  "ysT('menuEnglishMode')",
  "ysT('menuTheme')",
  "ysT('menuModifierKeys')",
  "ysT('menuCustomRules')",
  "ysT('menuApiKey')",
  "ysT('menuOnboarding')",
  "ysT('menuRateExtension')",
];
let previousMenuIndex = -1;
expectedMenuOrder.forEach((token) => {
  const currentMenuIndex = menuSource.indexOf(token);
  assert(currentMenuIndex > previousMenuIndex, `menu item order is incorrect around ${token}`);
  previousMenuIndex = currentMenuIndex;
});

console.log('Theme mode checks passed');
