// ─── 界面文案：_locales + 可选 uiLanguage 覆盖（须在 content.js 之后、01 之前加载） ───

/**
 * uiLanguage 值域：'auto' | 'zh_CN' | 'en'
 *  - 'auto'（默认）：根据浏览器语言自动判定 → 中文浏览器用 zh_CN，其他用 en
 *  - 'zh_CN' / 'en'：用户在设置里手动选择
 * 注：旧版 'system' 会自动迁移为 'auto'
 */

/** @type {'auto'|'zh_CN'|'en'} 当前生效的语言偏好 */
let _ysUiLanguage = 'auto';
/** @type {Record<string, string>|null} */
let _ysMessagesFlat = null;

/** 检测浏览器 UI 语言是否为中文 */
function _ysIsBrowserChinese() {
    try {
        const uil = chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage();
        return /^zh\b/i.test(String(uil || ''));
    } catch (_) {}
    return true;
}

/** 返回实际使用的语言（将 'auto' 展开为 'zh_CN' 或 'en'） */
function ysGetResolvedLanguage() {
    if (_ysUiLanguage === 'zh_CN' || _ysUiLanguage === 'en') return _ysUiLanguage;
    return _ysIsBrowserChinese() ? 'zh_CN' : 'en';
}

/** 页面右侧 AI 归纳标签展示语言 */
function ysIsEnglishPageLabelsPreferred() {
    return ysGetResolvedLanguage() === 'en';
}

function ysApplyMessageSubstitutions(str, subs) {
    if (!subs || !subs.length) return str;
    let out = str;
    subs.forEach((val, i) => {
        out = out.replace(new RegExp('\\$' + (i + 1), 'g'), String(val));
    });
    return out;
}

/**
 * @param {string} messageName
 * @param {string|string[]|undefined} [substitutions]
 */
function ysT(messageName, substitutions) {
    const subs = Array.isArray(substitutions)
        ? substitutions
        : substitutions !== undefined && substitutions !== null
            ? [substitutions]
            : [];
    const key = String(messageName || '');
    const resolved = ysGetResolvedLanguage();
    if (resolved !== 'zh_CN' && _ysMessagesFlat && _ysMessagesFlat[key]) {
        return ysApplyMessageSubstitutions(_ysMessagesFlat[key], subs);
    }
    const viaChrome = chrome.i18n.getMessage(key, subs);
    if (viaChrome) return viaChrome;
    return key;
}

function ysFlattenLocaleJson(obj) {
    const flat = {};
    if (!obj || typeof obj !== 'object') return flat;
    Object.keys(obj).forEach((k) => {
        const entry = obj[k];
        if (entry && typeof entry.message === 'string') flat[k] = entry.message;
    });
    return flat;
}

function ysLoadFlatLocale(lang, cb) {
    let url;
    try {
        url = chrome.runtime.getURL('_locales/' + lang + '/messages.json');
    } catch (e) {
        cb && cb();
        return;
    }
    fetch(url)
        .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.json();
        })
        .then((json) => {
            _ysMessagesFlat = ysFlattenLocaleJson(json);
            cb && cb();
        })
        .catch(() => {
            _ysMessagesFlat = null;
            cb && cb();
        });
}

/**
 * 读取 storage 中的 uiLanguage 并加载对应文案。
 * - 'auto' / 旧版 'system'：根据浏览器语言自动判定
 * - 'zh_CN' / 'en'：直接加载对应 locale
 */
function ysRefreshI18nFromStorage(done) {
    chrome.storage.local.get({ uiLanguage: 'auto' }, (res) => {
        let mode = res && res.uiLanguage ? res.uiLanguage : 'auto';
        if (mode === 'system') mode = 'auto';
        _ysUiLanguage = mode;

        const resolved = ysGetResolvedLanguage();

        if (resolved === 'zh_CN') {
            _ysMessagesFlat = null;
            if (typeof document !== 'undefined' && document.documentElement) {
                document.documentElement.setAttribute('lang', 'zh-CN');
            }
            done && done();
            return;
        }

        _ysMessagesFlat = null;
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.setAttribute('lang', 'en');
        }
        ysLoadFlatLocale('en', done);
    });
}

ysRefreshI18nFromStorage();

if (typeof window.__ysI18nStorageHooked === 'undefined') {
    window.__ysI18nStorageHooked = true;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.uiLanguage) return;
        ysRefreshI18nFromStorage();
    });
}
