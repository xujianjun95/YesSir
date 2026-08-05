const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'content-switcher/04-show-switcher.js'),
  'utf8',
);
const context = vm.createContext({});
vm.runInContext(source, context);

function runEnterCase(eventOverrides = {}) {
  let prevented = false;
  let activated = false;
  const event = {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {
      prevented = true;
    },
    ...eventOverrides,
  };

  const handled = context.ysHandleSwitcherSearchEnter(event, () => {
    activated = true;
  });

  return { handled, prevented, activated };
}

assert.deepStrictEqual(
  runEnterCase({ isComposing: true }),
  { handled: true, prevented: false, activated: false },
  'IME candidate-confirmation Enter must not activate the selected tab',
);

assert.deepStrictEqual(
  runEnterCase({ keyCode: 229 }),
  { handled: true, prevented: false, activated: false },
  'IME keyCode 229 must not activate the selected tab',
);

assert.deepStrictEqual(
  runEnterCase(),
  { handled: true, prevented: true, activated: true },
  'regular Enter must keep activating the selected tab',
);

console.log('IME Enter regression checks passed');
