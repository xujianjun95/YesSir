const assert = require('assert');
const {
  ysSanitizeCustomGroupingRules,
  ysIsCustomGroupingRuleActive,
  ysResolveActiveCustomGroupingRules,
  ysBuildCustomGroupingRuleContext,
  ysMatchCustomGroupingCondition,
  ysApplyStructuredGroupingRules,
} = require('../bg-grouping-rules.js');

function makeRule(overrides = {}) {
  return {
    id: 'rule-1',
    name: '工作时间',
    instructions: '工作页面优先按任务分类',
    enabled: true,
    order: 0,
    schedule: { mode: 'always' },
    ...overrides,
  };
}

function makeMatcher(overrides = {}) {
  return {
    id: 'matcher-1',
    name: '新闻网站',
    type: 'matcher',
    enabled: true,
    order: 0,
    schedule: { mode: 'always' },
    groups: [{
      id: 'target-1', emoji: '📰', name: '新闻', color: 'blue',
      conditions: [{ id: 'condition-1', field: 'domain', operator: 'contains', value: 'news.' }],
    }],
    ...overrides,
  };
}

const sanitized = ysSanitizeCustomGroupingRules([
  makeRule(),
  makeRule({ id: '', name: '' }),
  makeRule({ id: 'rule-2', order: 1 }),
]);
assert.strictEqual(sanitized.length, 2, 'invalid rules must be ignored');
assert.strictEqual(sanitized[0].type, 'description', 'legacy rules must migrate to description mode');
const limitedRules = ysSanitizeCustomGroupingRules(
  Array.from({ length: 6 }, (_, index) => makeRule({ id: `rule-${index}`, name: `规则 ${index}` })),
);
assert.strictEqual(limitedRules.length, 5, 'custom grouping rules must be limited to five');

const workHours = makeRule({
  schedule: { mode: 'weekly', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
});
assert.strictEqual(
  ysIsCustomGroupingRuleActive(workHours, new Date(2026, 6, 20, 9, 0)),
  true,
  'weekly rule must include its start minute',
);
assert.strictEqual(
  ysIsCustomGroupingRuleActive(workHours, new Date(2026, 6, 20, 18, 0)),
  false,
  'weekly rule must exclude its end minute',
);

const overnight = makeRule({
  schedule: { mode: 'weekly', days: [5], start: '18:00', end: '09:00' },
});
assert.strictEqual(
  ysIsCustomGroupingRuleActive(overnight, new Date(2026, 6, 24, 22, 0)),
  true,
  'overnight rule must match on the selected start day',
);
assert.strictEqual(
  ysIsCustomGroupingRuleActive(overnight, new Date(2026, 6, 25, 8, 59)),
  true,
  'overnight rule must remain active on the following morning',
);
assert.strictEqual(
  ysIsCustomGroupingRuleActive(overnight, new Date(2026, 6, 25, 9, 0)),
  false,
  'overnight rule must stop at its end minute',
);

const resolved = ysResolveActiveCustomGroupingRules([
  makeRule({ id: 'always-high', name: '基础高', order: 0 }),
  makeRule({ id: 'always-low', name: '基础低', order: 1 }),
  makeRule({ id: 'timed-high', name: '定时高', order: 2, schedule: { mode: 'weekly', days: [1], start: '09:00', end: '18:00' } }),
  makeRule({ id: 'timed-low', name: '定时低', order: 3, schedule: { mode: 'weekly', days: [1], start: '09:00', end: '18:00' } }),
], new Date(2026, 6, 20, 10, 0));
assert.deepStrictEqual(
  resolved.map((rule) => rule.id),
  ['always-low', 'always-high', 'timed-low', 'timed-high'],
  'prompt order must place higher-priority and scheduled rules later',
);

const context = ysBuildCustomGroupingRuleContext([
  makeRule({ id: 'low' }),
  makeRule({ id: 'high' }),
], false);
assert.deepStrictEqual(context.categoryColors, {}, 'description rules must not carry fixed category styles');
assert(context.prompt.includes('根据需要创建有意义的分类'), 'prompt must allow AI-created categories');

const matcherSanitized = ysSanitizeCustomGroupingRules([makeMatcher()]);
assert.strictEqual(matcherSanitized.length, 1, 'valid structured rules must survive sanitization');
assert.strictEqual(matcherSanitized[0].instructions, '', 'structured rules must not require natural-language instructions');
const limitedGroups = ysSanitizeCustomGroupingRules([makeMatcher({
  groups: Array.from({ length: 11 }, (_, index) => ({
    id: `group-${index}`, emoji: '📁', name: `分组 ${index}`, color: 'blue',
    conditions: [{ id: `condition-${index}`, field: 'domain', operator: 'contains', value: `site-${index}.com` }],
  })),
})]);
assert.strictEqual(limitedGroups[0].groups.length, 10, 'a custom rule must contain at most ten tab groups');
assert.strictEqual(
  ysSanitizeCustomGroupingRules([makeMatcher({ groups: [] })]).length,
  0,
  'structured rules without groups must be ignored',
);
const legacyMatcher = makeMatcher({
  groups: undefined,
  targetCategory: { id: 'legacy-target', emoji: '📰', name: '旧版新闻', color: 'blue' },
  conditions: [{ id: 'legacy-condition', field: 'domain', operator: 'contains', value: 'news.' }],
});
const migratedMatcher = ysSanitizeCustomGroupingRules([legacyMatcher]);
assert.strictEqual(migratedMatcher[0].groups.length, 1, 'legacy single-group rules must migrate to groups[0]');
assert.strictEqual(migratedMatcher[0].groups[0].name, '旧版新闻', 'legacy group metadata must be preserved');

const sampleTab = {
  id: 10,
  title: 'Breaking NEWS Today',
  url: 'https://News.QQ.com/world/article?id=1',
};
assert.strictEqual(
  ysMatchCustomGroupingCondition({ field: 'domain', operator: 'contains', value: 'news.qq' }, sampleTab),
  true,
  'domain contains must ignore case',
);
const migratedLegacyOperator = ysSanitizeCustomGroupingRules([makeMatcher({
  groups: [{
    id: 'legacy-operator-group', emoji: '📰', name: '旧条件', color: 'blue',
    conditions: [{ id: 'legacy-operator', field: 'title', operator: 'startsWith', value: 'breaking' }],
  }],
})]);
assert.strictEqual(
  migratedLegacyOperator[0].groups[0].conditions[0].operator,
  'contains',
  'removed legacy operators must migrate to contains',
);
assert.strictEqual(
  ysMatchCustomGroupingCondition({ field: 'domain', operator: 'equals', value: 'news.qq.com' }, sampleTab),
  true,
  'domain equals must work',
);
assert.strictEqual(
  ysMatchCustomGroupingCondition(
    { field: 'domain', operator: 'equals', value: 'https://NEWS.qq.com/world/article?id=1' },
    sampleTab,
  ),
  true,
  'domain matching must accept values pasted with a protocol, path, and query',
);
assert.strictEqual(
  ysMatchCustomGroupingCondition(
    { field: 'domain', operator: 'contains', value: 'http://news.qq.com:8080/' },
    sampleTab,
  ),
  true,
  'domain matching must ignore an HTTP protocol and port',
);

const priorityRules = ysResolveActiveCustomGroupingRules([
  makeMatcher({
    id: 'always-high',
    order: 0,
    groups: [{
      id: 'always-target', emoji: '🌐', name: '门户', color: 'grey',
      conditions: [{ id: 'always-condition', field: 'domain', operator: 'contains', value: 'news.' }],
    }],
  }),
  makeMatcher({
    id: 'timed-low',
    order: 5,
    schedule: { mode: 'weekly', days: [1], start: '09:00', end: '18:00' },
    groups: [{
      id: 'timed-target', emoji: '💼', name: '工作资讯', color: 'green',
      conditions: [{ id: 'timed-condition', field: 'domain', operator: 'contains', value: 'news.' }],
    }],
  }),
], new Date(2026, 6, 20, 10, 0));
const applied = ysApplyStructuredGroupingRules(priorityRules, [
  sampleTab,
  { id: 11, title: 'Unmatched', url: 'https://example.com/' },
]);
assert.deepStrictEqual(
  applied.assignments,
  [{ id: 10, topic: '💼 工作资讯' }],
  'scheduled structured rules must beat always-on rules',
);
assert.deepStrictEqual(applied.unmatchedTabs.map((tab) => tab.id), [11], 'unmatched tabs must remain for AI grouping');

const orRuleResult = ysApplyStructuredGroupingRules([
  makeMatcher({
    id: 'or-rule',
    groups: [{
      id: 'or-target', emoji: '🗞️', name: '资讯', color: 'cyan',
      conditions: [
        { id: 'miss', field: 'domain', operator: 'equals', value: 'does-not-match.example' },
        { id: 'hit', field: 'title', operator: 'contains', value: 'news today' },
      ],
    }],
  }),
], [sampleTab]);
assert.strictEqual(orRuleResult.assignments.length, 1, 'any matching condition must assign the tab');

const sameLayerPriority = ysApplyStructuredGroupingRules(
  ysResolveActiveCustomGroupingRules([
    makeMatcher({
      id: 'top-rule',
      order: 0,
      groups: [{
        id: 'top-target', emoji: '1️⃣', name: '高优先级', color: 'red',
        conditions: [{ id: 'top-condition', field: 'domain', operator: 'contains', value: 'news.' }],
      }],
    }),
    makeMatcher({
      id: 'lower-rule',
      order: 1,
      groups: [{
        id: 'lower-target', emoji: '2️⃣', name: '低优先级', color: 'grey',
        conditions: [{ id: 'lower-condition', field: 'domain', operator: 'contains', value: 'news.' }],
      }],
    }),
  ]),
  [sampleTab],
);
assert.strictEqual(sameLayerPriority.assignments[0].topic, '1️⃣ 高优先级', 'higher list items must win within a layer');

const multiGroupResult = ysApplyStructuredGroupingRules(
  ysResolveActiveCustomGroupingRules([makeMatcher({
    groups: [
      {
        id: 'news-group', emoji: '📰', name: '新闻', color: 'blue',
        conditions: [{ id: 'news-condition', field: 'domain', operator: 'contains', value: 'news.' }],
      },
      {
        id: 'shop-group', emoji: '🛍️', name: '购物', color: 'orange',
        conditions: [{ id: 'shop-condition', field: 'domain', operator: 'contains', value: 'shop.' }],
      },
    ],
  })]),
  [sampleTab, { id: 12, title: 'Shop', url: 'https://shop.example.com/cart' }],
);
assert.deepStrictEqual(multiGroupResult.assignments, [
  { id: 10, topic: '📰 新闻' },
  { id: 12, topic: '🛍️ 购物' },
], 'one structured rule must assign tabs to multiple configured groups');
assert.strictEqual(multiGroupResult.categoryColors['🛍️ 购物'], 'orange', 'each group color must be preserved');

const groupOrderResult = ysApplyStructuredGroupingRules([makeMatcher({
  groups: [
    {
      id: 'first-group', emoji: '1️⃣', name: '第一个', color: 'red',
      conditions: [{ id: 'first-condition', field: 'domain', operator: 'contains', value: 'news.' }],
    },
    {
      id: 'second-group', emoji: '2️⃣', name: '第二个', color: 'grey',
      conditions: [{ id: 'second-condition', field: 'title', operator: 'contains', value: 'news' }],
    },
  ],
})], [sampleTab]);
assert.strictEqual(groupOrderResult.assignments[0].topic, '1️⃣ 第一个', 'the first matching group in a rule must win');

const matcherOnlyContext = ysBuildCustomGroupingRuleContext(matcherSanitized, false);
assert.strictEqual(matcherOnlyContext.prompt, '', 'structured rules must not be injected as fuzzy AI instructions');

console.log('Custom grouping rule checks passed');
