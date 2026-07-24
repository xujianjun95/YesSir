const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const stateSource = fs.readFileSync(
  path.join(root, 'content-switcher/01-utils-and-state.js'),
  'utf8',
);
const listSource = fs.readFileSync(
  path.join(root, 'content-switcher/04b-switcher-list-bundle.js'),
  'utf8',
);
const showSource = fs.readFileSync(
  path.join(root, 'content-switcher/04-show-switcher.js'),
  'utf8',
);
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const zh = JSON.parse(fs.readFileSync(path.join(root, '_locales/zh_CN/messages.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));

assert(
  stateSource.includes("const YS_DOMAIN_DISPLAY_NAME_OVERRIDES_KEY = 'ysDomainDisplayNameOverridesV1';"),
  'custom names must use a versioned persistent storage key',
);
assert(
  stateSource.includes('domainDisplayNameOverrides[normalizedDomain]'),
  'custom names must resolve by normalized domain',
);
assert(
  stateSource.indexOf('domainDisplayNameOverrides[normalizedDomain]')
    < stateSource.indexOf('GROUP_DOMAIN_BRANDING[normalizedDomain]?.displayName'),
  'user override must take precedence over built-in and AI names',
);
assert(
  listSource.includes("domainText.addEventListener('dblclick'"),
  'domain label must support inline rename on double-click',
);
assert(
  listSource.includes("inputEvent.key === 'Enter'")
    && listSource.includes("inputEvent.key === 'Escape'")
    && listSource.includes("input.addEventListener('blur'"),
  'inline editor must support save, cancel, and blur behavior',
);
assert(
  listSource.includes('ysSaveDomainDisplayNameOverride(group.domain, nextName'),
  'inline editor must persist the name using the stable domain key',
);
assert(
  showSource.includes('ysLoadDomainDisplayNameOverrides((success) =>'),
  'the panel must restore persisted names when it opens',
);
assert(
  showSource.includes("focusedEl?.classList?.contains('ys-domain-name-input')")
    && contentSource.includes("activeElement.classList.contains('ys-domain-name-input')"),
  'global keyboard handlers must ignore the inline domain-name editor',
);
assert(zh.domainNameEditHint && en.domainNameEditHint, 'rename hint must be localized');
assert(zh.domainNameSaveFailed && en.domainNameSaveFailed, 'save error must be localized');

console.log('Domain name override checks passed');
