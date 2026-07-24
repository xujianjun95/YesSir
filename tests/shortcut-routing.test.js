const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

assert(
  content.includes("const isSwitcherSearchInput = event.target?.id === 'ys-search-input';"),
  'Mod+E must remain available while the YesSir search input is focused',
);

assert(
  content.includes('if (isEditableTarget && !isSwitcherSearchInput) return;'),
  'Mod+E must still be left to editable controls outside the YesSir search input',
);

assert(
  /document\.addEventListener\('keydown',[\s\S]*?\n\}, true\);/.test(content),
  'the global shortcut listener must run in capture phase before host pages can stop propagation',
);

console.log('Shortcut routing regression checks passed');
