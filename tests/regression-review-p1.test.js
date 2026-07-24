const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bgAiNetwork = fs.readFileSync(path.join(root, 'bg-ai-network.js'), 'utf8');
const showSwitcher = fs.readFileSync(path.join(root, 'content-switcher/04-show-switcher.js'), 'utf8');
const groupingStart = bgAiNetwork.indexOf('async function performBatchAutoGrouping(');
const groupingEnd = bgAiNetwork.indexOf('async function performBatchAutoGroupingApplyGroups(', groupingStart);
const groupingSource = bgAiNetwork.slice(groupingStart, groupingEnd);

assert(
  bgAiNetwork.includes('...(isSigMatch ? cached : {})'),
  'computeAiSnapshotForTabs must not carry stale pageLabel/topic/siteName when tab signature changes',
);

assert(
  !/action:\s*['"]prewarm_ai_snapshot['"]/.test(showSwitcher),
  'showSwitcher must not call prewarm_ai_snapshot directly; it should reuse throttled current-window prewarm',
);

assert(
  groupingSource.includes('const toQuery = structuredRuleResult.unmatchedTabs;'),
  'manual AI grouping must send every structurally unmatched tab to the LLM',
);

assert(
  !groupingSource.includes('results.push({ id: t.id, topic: cached[topicField] })'),
  'manual AI grouping must not lock cached topics before global regrouping',
);

assert(
  groupingSource.includes('仅作参考，不是硬约束'),
  'user category preferences must remain soft guidance during global regrouping',
);

assert(
  groupingSource.includes('ysGetActiveCustomGroupingRules()'),
  'manual AI grouping must load currently active custom rules',
);

assert(
  groupingSource.includes('if (toQuery.length > 0)'),
  'manual AI grouping must skip the AI request when structured rules match every tab',
);

assert(
  bgAiNetwork.includes('tabIds.length === 1 && !categoryColors[title]'),
  'a configured category must keep its title and color even when it contains one tab',
);

console.log('P1 regression checks passed');
