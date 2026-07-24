const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const listSource = fs.readFileSync(
  path.join(root, 'content-switcher/04b-switcher-list-bundle.js'),
  'utf8',
);
const tabItemSource = fs.readFileSync(
  path.join(root, 'content-switcher/03-build-tab-item.js'),
  'utf8',
);

const groupLayoutStart = listSource.indexOf("groupRow.className = 'ys-group-row';");
const groupLayoutEnd = listSource.indexOf('switcherTabs = displayTabs;', groupLayoutStart);
const groupLayoutSource = listSource.slice(groupLayoutStart, groupLayoutEnd);

assert(groupLayoutStart >= 0 && groupLayoutEnd > groupLayoutStart, 'domain group layout must exist');
assert(
  groupLayoutSource.includes("flexDirection: 'column'"),
  'domain groups must render as a vertical header-and-tabs hierarchy',
);
assert(
  !groupLayoutSource.includes("gridTemplateColumns: '130px minmax(0, 1fr)'"),
  'the legacy fixed left domain column must be removed',
);
assert(
  groupLayoutSource.includes("paddingLeft: '26px'"),
  'tab rows must be visually nested below the domain header',
);
assert(
  groupLayoutSource.includes("padding: '12px 12px 8px'")
    && groupLayoutSource.includes("background: 'transparent'"),
  'domain headers must use transparent surfaces and whitespace for hierarchy',
);
assert(
  groupLayoutSource.includes("padding: '0 6px'")
    && groupLayoutSource.includes("marginBottom: '4px'")
    && !groupLayoutSource.includes("borderBottom: '1px solid var(--ys-divider)'"),
  'domain groups must use whitespace instead of a full-width bottom divider',
);
assert(
  !groupLayoutSource.includes("backgroundColor: 'var(--ys-btn-bg)'")
    && !groupLayoutSource.includes("backgroundImage: 'linear-gradient(var(--ys-accent-bg), var(--ys-accent-bg))'")
    && !groupLayoutSource.includes("borderRadius: '8px'"),
  'domain headers must not retain the full-width blue rounded bar',
);
assert(
  groupLayoutSource.includes("titleDivider.className = 'ys-domain-title-divider'")
    && groupLayoutSource.includes("height: '1px'")
    && groupLayoutSource.includes("background: 'var(--ys-divider)'")
    && groupLayoutSource.includes("opacity: '0.60'")
    && groupLayoutSource.indexOf('domainRow.appendChild(titleDivider);')
      < groupLayoutSource.indexOf('domainRow.appendChild(editHint);'),
  'a neutral divider must extend after the title and stop before the edit hint',
);
assert(
  !groupLayoutSource.includes("const iconDiv = document.createElement('div')")
    && !groupLayoutSource.includes('domainRow.appendChild(iconDiv);')
    && groupLayoutSource.includes("domainRow.appendChild(domainText);"),
  'domain headers must start with text and must not reserve a group favicon slot',
);
assert(
  groupLayoutSource.includes("titleDivider.style.display = 'none'")
    && groupLayoutSource.includes("titleDivider.style.display = ''"),
  'the divider must make room for the inline editor and return afterwards',
);
assert(
  groupLayoutSource.includes("editHint.textContent = '✎'")
    && groupLayoutSource.includes("domainRow.addEventListener('mouseenter'")
    && groupLayoutSource.includes("editHint.setAttribute('aria-hidden', 'true')"),
  'domain headers must show a non-interactive pencil hint on hover',
);
assert(
  groupLayoutSource.includes('prefers-reduced-motion: reduce'),
  'domain header motion must respect reduced-motion preferences',
);
assert(
  groupLayoutSource.indexOf('groupRow.appendChild(leftCol);')
    < groupLayoutSource.indexOf('groupRow.appendChild(rightCol);'),
  'the domain header must render before its tab rows',
);
assert(
  tabItemSource.includes("minHeight:      '44px'"),
  'tab rows must use the agreed compact 44px rhythm',
);
assert(
  tabItemSource.includes("iconSlot.className = 'ys-tab-icon-slot'")
    && tabItemSource.includes('const resolvedIconUrl = resolveTabIconUrl(tab, 64);')
    && tabItemSource.includes('leftArea.appendChild(iconSlot);'),
  'individual tab rows must keep their favicon',
);
assert(
  !groupLayoutSource.includes('collapsed') && !groupLayoutSource.includes('toggle'),
  'domain headers must not introduce collapse behavior',
);

console.log('Domain group layout checks passed');
