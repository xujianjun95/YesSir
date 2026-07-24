// ─── 自定义 AI 分组规则：存储校验、时间匹配与提示词上下文 ───────────────────────

const YS_CUSTOM_GROUPING_RULES_KEY = 'ysCustomGroupingRulesV1';
const YS_CUSTOM_RULE_COLORS = new Set([
    'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
]);
const YS_CUSTOM_RULE_FIELDS = new Set(['domain', 'title', 'url']);
const YS_CUSTOM_RULE_OPERATORS = new Set(['contains', 'equals']);
const YS_CUSTOM_RULE_LIMITS = Object.freeze({
    rules: 5,
    name: 40,
    instructions: 2000,
    groups: 10,
    categoryName: 30,
    conditions: 20,
    conditionValue: 300,
});

function ysClampRuleText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function ysIsValidRuleTime(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return false;
    const [hours, minutes] = value.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function ysRuleTimeToMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return (hours * 60) + minutes;
}

function ysSanitizeCustomRuleCategory(value, index) {
    if (!value || typeof value !== 'object') return null;
    const name = ysClampRuleText(value.name, YS_CUSTOM_RULE_LIMITS.categoryName);
    const emoji = ysClampRuleText(value.emoji, 12);
    const color = YS_CUSTOM_RULE_COLORS.has(value.color) ? value.color : 'grey';
    if (!name || !emoji) return null;
    return {
        id: ysClampRuleText(value.id, 80) || `category-${index}`,
        name,
        emoji,
        color,
    };
}

function ysSanitizeCustomRuleConditions(value) {
    return (Array.isArray(value) ? value : [])
        .slice(0, YS_CUSTOM_RULE_LIMITS.conditions)
        .map((condition, conditionIndex) => {
            if (!condition || typeof condition !== 'object') return null;
            const field = YS_CUSTOM_RULE_FIELDS.has(condition.field) ? condition.field : '';
            const legacyOperator = condition.operator === 'startsWith' || condition.operator === 'endsWith';
            const operator = legacyOperator
                ? 'contains'
                : (YS_CUSTOM_RULE_OPERATORS.has(condition.operator) ? condition.operator : '');
            const matchValue = ysClampRuleText(condition.value, YS_CUSTOM_RULE_LIMITS.conditionValue);
            if (!field || !operator || !matchValue) return null;
            return {
                id: ysClampRuleText(condition.id, 80) || `condition-${conditionIndex}`,
                field,
                operator,
                value: matchValue,
            };
        })
        .filter(Boolean);
}

function ysSanitizeCustomRuleGroup(value, index) {
    const category = ysSanitizeCustomRuleCategory(value, index);
    if (!category) return null;
    const conditions = ysSanitizeCustomRuleConditions(value.conditions);
    if (conditions.length === 0) return null;
    return { ...category, conditions };
}

function ysSanitizeCustomGroupingRule(value, index) {
    if (!value || typeof value !== 'object') return null;
    const id = ysClampRuleText(value.id, 80);
    const name = ysClampRuleText(value.name, YS_CUSTOM_RULE_LIMITS.name);
    const type = value.type === 'matcher' ? 'matcher' : 'description';
    const instructions = ysClampRuleText(value.instructions, YS_CUSTOM_RULE_LIMITS.instructions);
    if (!id || !name || (type === 'description' && !instructions)) return null;

    const rawSchedule = value.schedule && typeof value.schedule === 'object'
        ? value.schedule
        : { mode: 'always' };
    let schedule;
    if (rawSchedule.mode === 'weekly') {
        const days = Array.from(new Set(
            (Array.isArray(rawSchedule.days) ? rawSchedule.days : [])
                .map(Number)
                .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
        ));
        const start = String(rawSchedule.start || '09:00');
        const end = String(rawSchedule.end || '18:00');
        if (days.length === 0 || !ysIsValidRuleTime(start) || !ysIsValidRuleTime(end)) return null;
        schedule = { mode: 'weekly', days, start, end };
    } else {
        schedule = { mode: 'always' };
    }

    let rawGroups = Array.isArray(value.groups) ? value.groups : [];
    if (type === 'matcher' && rawGroups.length === 0 && value.targetCategory) {
        rawGroups = [{ ...value.targetCategory, conditions: value.conditions }];
    }
    const groups = type === 'matcher'
        ? rawGroups
            .slice(0, YS_CUSTOM_RULE_LIMITS.groups)
            .map(ysSanitizeCustomRuleGroup)
            .filter(Boolean)
        : [];
    if (type === 'matcher' && groups.length === 0) return null;

    return {
        id,
        name,
        type,
        instructions: type === 'description' ? instructions : '',
        enabled: value.enabled !== false,
        order: Number.isFinite(Number(value.order)) ? Number(value.order) : index,
        schedule,
        groups,
        createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : 0,
        updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
    };
}

function ysSanitizeCustomGroupingRules(value) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, YS_CUSTOM_RULE_LIMITS.rules)
        .map(ysSanitizeCustomGroupingRule)
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);
}

function ysIsCustomGroupingRuleActive(rule, now = new Date()) {
    if (!rule || rule.enabled === false) return false;
    const schedule = rule.schedule || { mode: 'always' };
    if (schedule.mode !== 'weekly') return true;

    const currentDay = now.getDay();
    const currentMinutes = (now.getHours() * 60) + now.getMinutes();
    const startMinutes = ysRuleTimeToMinutes(schedule.start);
    const endMinutes = ysRuleTimeToMinutes(schedule.end);
    const selectedDays = new Set(schedule.days);

    if (startMinutes === endMinutes) return selectedDays.has(currentDay);
    if (startMinutes < endMinutes) {
        return selectedDays.has(currentDay)
            && currentMinutes >= startMinutes
            && currentMinutes < endMinutes;
    }

    const previousDay = (currentDay + 6) % 7;
    return (selectedDays.has(currentDay) && currentMinutes >= startMinutes)
        || (selectedDays.has(previousDay) && currentMinutes < endMinutes);
}

/**
 * 返回提示词使用顺序：基础规则先于定时规则；同层低优先级先于高优先级。
 * 列表越靠上 order 越小、优先级越高，因此同层按 order 倒序输出。
 */
function ysResolveActiveCustomGroupingRules(value, now = new Date()) {
    const rules = ysSanitizeCustomGroupingRules(value).filter((rule) => rule.enabled);
    const lowToHigh = (items) => items.sort((a, b) => b.order - a.order);
    const always = lowToHigh(rules.filter((rule) => rule.schedule.mode === 'always'));
    const timed = lowToHigh(rules.filter(
        (rule) => rule.schedule.mode === 'weekly' && ysIsCustomGroupingRuleActive(rule, now),
    ));
    return [...always, ...timed];
}

function ysBuildCustomGroupingRuleContext(rules, isEnglishMode) {
    const descriptionRules = Array.isArray(rules)
        ? rules.filter((rule) => rule.type !== 'matcher')
        : [];
    if (descriptionRules.length === 0) {
        return { prompt: '', categoryColors: {} };
    }

    const blocks = descriptionRules.map((rule, index) => {
        if (isEnglishMode) {
            return [
                `Rule ${index + 1}: ${rule.name}`,
                rule.instructions,
            ].filter(Boolean).join('\n');
        }
        return [
            `规则 ${index + 1}：${rule.name}`,
            rule.instructions,
        ].filter(Boolean).join('\n');
    });

    const prompt = isEnglishMode
        ? `\n\nCustom grouping rules (later rules have higher priority when requirements conflict):\n${blocks.join('\n\n')}\nApply these rules first and create useful categories as needed.`
        : `\n\n【用户自定义分组规则】\n以下规则按优先级排列；发生冲突时，越靠后的规则优先：\n${blocks.join('\n\n')}\n优先按这些规则分类，并根据需要创建有意义的分类。`;
    return { prompt, categoryColors: {} };
}

function ysNormalizeCustomGroupingDomain(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const urlValue = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(urlValue).hostname.toLocaleLowerCase();
    } catch (_) {
        return raw
            .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
            .split(/[/?#]/, 1)[0]
            .replace(/:\d+$/, '')
            .toLocaleLowerCase();
    }
}

function ysMatchCustomGroupingCondition(condition, tab) {
    if (!condition || !tab) return false;
    let candidate = '';
    if (condition.field === 'title') {
        candidate = String(tab.title || '');
    } else if (condition.field === 'url') {
        candidate = String(tab.url || '');
    } else if (condition.field === 'domain') {
        try { candidate = new URL(String(tab.url || '')).hostname; } catch (_) { return false; }
    } else {
        return false;
    }

    const source = candidate.toLocaleLowerCase();
    const expected = condition.field === 'domain'
        ? ysNormalizeCustomGroupingDomain(condition.value)
        : String(condition.value || '').toLocaleLowerCase();
    if (!expected) return false;
    if (condition.operator === 'equals') return source === expected;
    return condition.operator === 'contains' && source.includes(expected);
}

/** activeRules 为低→高优先级；结构化匹配时反向执行，首条命中即停止。 */
function ysApplyStructuredGroupingRules(activeRules, tabs) {
    const matcherRules = (Array.isArray(activeRules) ? activeRules : [])
        .filter((rule) => rule.type === 'matcher')
        .slice()
        .reverse();
    const assignments = [];
    const unmatchedTabs = [];
    const categoryColors = {};

    matcherRules.forEach((rule) => {
        (Array.isArray(rule.groups) ? rule.groups : []).forEach((group) => {
            const title = `${group.emoji} ${group.name}`;
            if (!categoryColors[title]) categoryColors[title] = group.color;
        });
    });

    (Array.isArray(tabs) ? tabs : []).forEach((tab) => {
        let matchedGroup = null;
        for (const rule of matcherRules) {
            matchedGroup = (Array.isArray(rule.groups) ? rule.groups : []).find((group) => (
                group.conditions.some((condition) => ysMatchCustomGroupingCondition(condition, tab))
            ));
            if (matchedGroup) break;
        }
        if (!matchedGroup) {
            unmatchedTabs.push(tab);
            return;
        }
        assignments.push({ id: tab.id, topic: `${matchedGroup.emoji} ${matchedGroup.name}` });
    });

    return { assignments, unmatchedTabs, categoryColors };
}

async function ysGetActiveCustomGroupingRules(now = new Date()) {
    try {
        const stored = await chrome.storage.local.get({ [YS_CUSTOM_GROUPING_RULES_KEY]: [] });
        return ysResolveActiveCustomGroupingRules(
            stored[YS_CUSTOM_GROUPING_RULES_KEY],
            now,
        );
    } catch (error) {
        console.error('读取自定义分组规则失败，回退默认分组:', error);
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        YS_CUSTOM_GROUPING_RULES_KEY,
        YS_CUSTOM_RULE_LIMITS,
        ysSanitizeCustomGroupingRules,
        ysIsCustomGroupingRuleActive,
        ysResolveActiveCustomGroupingRules,
        ysBuildCustomGroupingRuleContext,
        ysMatchCustomGroupingCondition,
        ysApplyStructuredGroupingRules,
    };
}
