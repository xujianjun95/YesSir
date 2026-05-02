// bg-i18n.js — Service Worker 文案（跟随浏览器语言，可选 uiLanguage 覆盖）
(function initBgLocale() {
    let _bgFlat = null;
    /** @type {'auto'|'zh_CN'|'en'} */
    let _bgUiLanguage = 'auto';

    function applySubs(str, subs) {
        if (!subs || !subs.length) return str;
        let out = str;
        subs.forEach((val, i) => {
            out = out.replace(new RegExp('\\$' + (i + 1), 'g'), String(val));
        });
        return out;
    }

    function bgIsBrowserChinese() {
        try {
            return /^zh\b/i.test(String(chrome.i18n.getUILanguage() || ''));
        } catch (_) {}
        return true;
    }

    /** 'auto' 展开为 'zh_CN' 或 'en' */
    function bgResolvedLang() {
        if (_bgUiLanguage === 'zh_CN' || _bgUiLanguage === 'en') return _bgUiLanguage;
        return bgIsBrowserChinese() ? 'zh_CN' : 'en';
    }

    async function bgLoadLocale(lang) {
        if (lang === 'zh_CN') {
            // chrome.i18n 默认就是 zh_CN，无需额外 fetch
            _bgFlat = null;
            return;
        }
        try {
            const url = chrome.runtime.getURL('_locales/en/messages.json');
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const obj = await res.json();
            const flat = {};
            Object.keys(obj).forEach((k) => {
                if (obj[k] && typeof obj[k].message === 'string') flat[k] = obj[k].message;
            });
            _bgFlat = flat;
        } catch (_) {
            _bgFlat = null;
        }
    }

    function bgRefreshLocaleCache(mode) {
        if (mode === 'system') mode = 'auto';
        _bgUiLanguage = mode || 'auto';
        void bgLoadLocale(bgResolvedLang());
    }

    chrome.storage.local.get({ uiLanguage: 'auto' }, (r) => {
        bgRefreshLocaleCache(r && r.uiLanguage);
    });
    chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local' || !ch.uiLanguage) return;
        bgRefreshLocaleCache(ch.uiLanguage.newValue);
    });

    const assign = (typeof self !== 'undefined' ? self : globalThis);
    assign.bgT = function bgT(messageName, substitutions) {
        const subs = Array.isArray(substitutions)
            ? substitutions
            : substitutions !== undefined && substitutions !== null
                ? [substitutions]
                : [];
        const key = String(messageName || '');
        const resolved = bgResolvedLang();
        if (resolved !== 'zh_CN' && _bgFlat && _bgFlat[key]) {
            return applySubs(_bgFlat[key], subs);
        }
        const viaChrome = chrome.i18n.getMessage(key, subs);
        if (viaChrome) return viaChrome;
        return key;
    };
})();
