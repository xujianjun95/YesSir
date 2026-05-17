function getDomainFromUrl(url) {
    try {
        if (!url || !String(url).startsWith('http')) return '';
        return new URL(url).hostname.toLowerCase();
    } catch (_) {
        return '';
    }
}

/** 与 content-switcher 的 getTabDomainKey 一致：取 hostname 末两段作为「站点」分组键，子域合并（如 gemini.google.com 与 www.google.com 同属 google.com）。 */
function getTabGroupDomainKey(url) {
    let domain = '本地网页/其他';
    try {
        if (url && String(url).startsWith('http')) {
            const u = new URL(url);
            const parts = u.hostname.split('.');
            domain = parts.length >= 2 ? parts.slice(-2).join('.') : u.hostname;
        }
    } catch (e) {}
    return domain;
}

function normalizeSiteName(rawName, url = '') {
    let name = String(rawName || '').trim();
    if (!name) return null;

    // 清理模型偶发返回的引号、解释前缀和多行内容
    name = name
        .replace(/^["'「『“”]+|["'」』“”]+$/g, '')
        .replace(/^网站名称[:：]\s*/i, '')
        .split('\n')[0]
        .trim();

    if (!name) return null;
    if (name.length > 20) name = name.slice(0, 20).trim();

    const domain = getDomainFromUrl(url);
    if (name.includes('.') && domain) return null;
    return name;
}

const SITE_NAME_RULES_BY_DOMAIN = [
    [/(\.|^)baidu\.com$/, '百度'],
    [/(\.|^)google\.com$|(\.|^)google\.[a-z.]+$/, 'Google'],
    [/(\.|^)bing\.com$/, 'Bing'],
    [/(\.|^)so\.com$|(\.|^)360\.cn$/, '360搜索'],
    [/(\.|^)sogou\.com$/, '搜狗'],
    [/(\.|^)qq\.com$/, 'QQ'],
    [/(\.|^)wechat\.com$|(\.|^)weixin\.qq\.com$/, '微信'],
    [/(\.|^)mp\.weixin\.qq\.com$/, '微信公众号'],
    [/(\.|^)work\.weixin\.qq\.com$/, '企业微信'],
    [/(\.|^)docs\.qq\.com$/, '腾讯文档'],
    [/(\.|^)mail\.qq\.com$/, 'QQ邮箱'],
    [/(\.|^)mail\.163\.com$/, '网易邮箱'],
    [/(\.|^)music\.163\.com$/, '网易云音乐'],
    [/(\.|^)youdao\.com$|(\.|^)ydstatic\.com$/, '有道'],
    [/(\.|^)aliyun\.com$/, '阿里云'],
    [/(\.|^)alibaba\.com$|(\.|^)1688\.com$/, '阿里巴巴'],
    [/(\.|^)alipay\.com$/, '支付宝'],
    [/(\.|^)tmall\.com$/, '天猫'],
    [/(\.|^)github\.com$/, 'GitHub'],
    [/(\.|^)gitlab\.com$/, 'GitLab'],
    [/(\.|^)gitee\.com$/, 'Gitee'],
    [/(\.|^)vercel\.com$/, 'Vercel'],
    [/(\.|^)netlify\.com$/, 'Netlify'],
    [/(\.|^)supabase\.com$/, 'Supabase'],
    [/(\.|^)cloudflare\.com$/, 'Cloudflare'],
    [/(\.|^)figma\.com$/, 'Figma'],
    [/(\.|^)canva\.com$/, 'Canva'],
    [/(\.|^)notion\.site$|(\.|^)notion\.so$/, 'Notion'],
    [/(\.|^)yuque\.com$/, '语雀'],
    [/(\.|^)feishu\.cn$|(\.|^)larksuite\.com$/, '飞书'],
    [/(\.|^)slack\.com$/, 'Slack'],
    [/(\.|^)trello\.com$/, 'Trello'],
    [/(\.|^)atlassian\.net$|(\.|^)jira\.com$/, 'Jira'],
    [/(\.|^)confluence\.com$/, 'Confluence'],
    [/(\.|^)zoom\.us$/, 'Zoom'],
    [/(\.|^)teams\.microsoft\.com$|(\.|^)office\.com$|(\.|^)microsoft\.com$/, 'Microsoft'],
    [/(\.|^)outlook\.live\.com$|(\.|^)outlook\.com$/, 'Outlook'],
    [/(\.|^)onedrive\.live\.com$|(\.|^)onedrive\.com$/, 'OneDrive'],
    [/(\.|^)openai\.com$/, 'OpenAI'],
    [/(\.|^)claude\.ai$/, 'Claude'],
    [/(\.|^)deepseek\.com$/, 'DeepSeek'],
    [/(\.|^)cursor\.com$|(\.|^)cursor\.sh$/, 'Cursor'],
    [/(\.|^)perplexity\.ai$/, 'Perplexity'],
    [/(\.|^)gemini\.google\.com$/, 'Gemini'],
    [/(\.|^)huggingface\.co$/, 'Hugging Face'],
    [/(\.|^)replicate\.com$/, 'Replicate'],
    [/(\.|^)bilibili\.com$/, '哔哩哔哩'],
    [/(\.|^)douban\.com$/, '豆瓣'],
    [/(\.|^)zhihu\.com$/, '知乎'],
    [/(\.|^)weibo\.com$/, '微博'],
    [/(\.|^)juejin\.cn$/, '稀土掘金'],
    [/(\.|^)csdn\.net$/, 'CSDN'],
    [/(\.|^)oschina\.net$/, '开源中国'],
    [/(\.|^)taobao\.com$/, '淘宝'],
    [/(\.|^)jd\.com$/, '京东'],
    [/(\.|^)douyin\.com$|(\.|^)tiktok\.com$/, '抖音'],
    [/(\.|^)xiaohongshu\.com$|(\.|^)xhs\.link$|(\.|^)rednote\.com$/, '小红书'],
    [/(\.|^)kuaishou\.com$/, '快手'],
    [/(\.|^)meituan\.com$/, '美团'],
    [/(\.|^)ele\.me$/, '饿了么'],
    [/(\.|^)ctrip\.com$|(\.|^)trip\.com$/, '携程'],
    [/(\.|^)youtube\.com$/, 'YouTube'],
    [/(\.|^)netflix\.com$/, 'Netflix'],
    [/(\.|^)x\.com$|(\.|^)twitter\.com$/, 'X'],
    [/(\.|^)linkedin\.com$/, 'LinkedIn'],
    [/(\.|^)reddit\.com$/, 'Reddit'],
    [/(\.|^)discord\.com$/, 'Discord'],
    [/(\.|^)stackoverflow\.com$/, 'Stack Overflow'],
    [/(\.|^)npmjs\.com$/, 'npm'],
    [/(\.|^)developer\.mozilla\.org$|(\.|^)mdn\.mozilla\.org$/, 'MDN'],
    [/(\.|^)leetcode\.com$|(\.|^)leetcode\.cn$/, 'LeetCode'],
    [/(\.|^)v2ex\.com$/, 'V2EX'],
];

const SITE_NAME_RULES_BY_KEYWORD = [
    [/google|谷歌/, 'Google'],
    [/bing/, 'Bing'],
    [/360搜索|so\.com/, '360搜索'],
    [/搜狗|sogou/, '搜狗'],
    [/qq邮箱|mail\.qq/, 'QQ邮箱'],
    [/网易邮箱|mail\.163/, '网易邮箱'],
    [/网易云音乐|music\.163/, '网易云音乐'],
    [/有道|youdao/, '有道'],
    [/aliyun/, '阿里云'],
    [/支付宝|alipay/, '支付宝'],
    [/天猫|tmall/, '天猫'],
    [/淘宝|taobao/, '淘宝'],
    [/1688|阿里巴巴/, '阿里巴巴'],
    [/github/, 'GitHub'],
    [/gitlab/, 'GitLab'],
    [/gitee/, 'Gitee'],
    [/aithub/, 'Aithub'],
    [/vercel/, 'Vercel'],
    [/netlify/, 'Netlify'],
    [/supabase/, 'Supabase'],
    [/cloudflare/, 'Cloudflare'],
    [/figma/, 'Figma'],
    [/canva/, 'Canva'],
    [/notion/, 'Notion'],
    [/语雀|yuque/, '语雀'],
    [/feishu|lark/, '飞书'],
    [/企业微信|work weixin|work\.weixin/, '企业微信'],
    [/微信|weixin|wechat/, '微信'],
    [/腾讯文档|docs\.qq/, '腾讯文档'],
    [/jira/, 'Jira'],
    [/confluence/, 'Confluence'],
    [/slack/, 'Slack'],
    [/trello/, 'Trello'],
    [/zoom/, 'Zoom'],
    [/outlook/, 'Outlook'],
    [/onedrive/, 'OneDrive'],
    [/microsoft|office|teams/, 'Microsoft'],
    [/chatgpt|openai/, 'OpenAI'],
    [/claude\.ai/, 'Claude'],
    [/gemini/, 'Gemini'],
    [/deepseek/, 'DeepSeek'],
    [/perplexity/, 'Perplexity'],
    [/cursor\.com|cursor\.sh/, 'Cursor'],
    [/hugging\s?face|huggingface/, 'Hugging Face'],
    [/replicate/, 'Replicate'],
    [/bilibili/, '哔哩哔哩'],
    [/豆瓣|douban/, '豆瓣'],
    [/zhihu/, '知乎'],
    [/weibo/, '微博'],
    [/jd\.com/, '京东'],
    [/douyin|tiktok/, '抖音'],
    [/xiaohongshu|xhs\.link|rednote/, '小红书'],
    [/快手|kuaishou/, '快手'],
    [/美团|meituan/, '美团'],
    [/饿了么|ele\.me/, '饿了么'],
    [/携程|ctrip|trip\.com/, '携程'],
    [/youtube/, 'YouTube'],
    [/netflix/, 'Netflix'],
    [/twitter|x\.com/, 'X'],
    [/linkedin/, 'LinkedIn'],
    [/reddit/, 'Reddit'],
    [/discord/, 'Discord'],
    [/stackoverflow/, 'Stack Overflow'],
    [/npmjs/, 'npm'],
    [/developer\.mozilla|mdn/, 'MDN'],
    [/掘金|juejin/, '稀土掘金'],
    [/csdn/, 'CSDN'],
    [/开源中国|oschina/, '开源中国'],
    [/leetcode/, 'LeetCode'],
    [/v2ex/, 'V2EX'],
];

function inferSiteNameByKeyword(title, url = '') {
    const t = String(title || '').toLowerCase();
    const d = getDomainFromUrl(url);
    const all = `${t} ${d}`;

    for (const [pattern, label] of SITE_NAME_RULES_BY_DOMAIN) {
        if (pattern.test(d)) return label;
    }

    for (const [pattern, label] of SITE_NAME_RULES_BY_KEYWORD) {
        if (pattern.test(all)) return label;
    }

    return null;
}

