const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bgAiNetwork = fs.readFileSync(path.join(root, 'bg-ai-network.js'), 'utf8');
const showSwitcher = fs.readFileSync(path.join(root, 'content-switcher/04-show-switcher.js'), 'utf8');

assert(
  bgAiNetwork.includes('...(isSigMatch ? cached : {})'),
  'computeAiSnapshotForTabs must not carry stale pageLabel/topic/siteName when tab signature changes',
);

assert(
  !/action:\s*['"]prewarm_ai_snapshot['"]/.test(showSwitcher),
  'showSwitcher must not call prewarm_ai_snapshot directly; it should reuse throttled current-window prewarm',
);

console.log('P1 regression checks passed');
