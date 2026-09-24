/**
 * 命令面板的搜索打分。**纯函数**，面板里每按一个键对全部条目跑一遍。
 *
 * 分数在 0–1 之间，0 表示不出现。从高到低：
 *
 * · 整个名字就是它（1）
 * · 名字以它开头（0.9）
 * · 名字里某个词以它开头（0.8）：`code` 命中 `claude-code`，`sonnet` 命中
 *   `claude-sonnet-4-5`
 * · 名字里含有它（0.65）：中文没有词界，`密钥` 命中 `新建密钥` 走的是这一档
 * · 按顺序含有它的每个字母（最高 0.4，越紧凑越高）：`ccd` 命中 `claude-code`。
 *   只对两个字母以上的英文和数字做 —— 单个字母、中文这样比，什么都命中
 *
 * 别名（`keywords`：另一种语言的名字、说明）打六折：**别名整个对上（0.6）也排在名字
 * 里含有它（0.65）的后面**。几个词用空格隔开时，**每个词都要命中**（在名字或别名里
 * 都行），分数取平均。
 */

/** 小写、去首尾空白、全角转半角、连续空白并成一个 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** 词的分隔：空白和常见的标点。名字里常见的是 `claude-code`、`api.deepseek.com`、`a/b` */
const SEP = /[\s\-_./:@#·,()（）【】[\]]/;

function wordStart(field: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const i = field.indexOf(token, from);
    if (i < 0) return false;
    if (i > 0 && SEP.test(field[i - 1]!)) return true;
    // 驼峰之类的不管：名字都是小写的标识符或自然语言
    from = i + 1;
  }
}

/** 按顺序含有 token 的每个字符。返回覆盖的跨度，没有就是 -1 */
function subsequenceSpan(field: string, token: string): number {
  let at = -1;
  let first = -1;
  for (const ch of token) {
    at = field.indexOf(ch, at + 1);
    if (at < 0) return -1;
    if (first < 0) first = at;
  }
  return at - first + 1;
}

const FUZZY_OK = /^[a-z0-9]{2,}$/;

/** 一个词对一段文字的分数 */
export function fieldScore(field: string, token: string): number {
  if (!token || !field) return 0;
  if (field === token) return 1;
  if (field.startsWith(token)) return 0.9;
  if (wordStart(field, token)) return 0.8;
  if (field.includes(token)) return 0.65;
  if (FUZZY_OK.test(token)) {
    const span = subsequenceSpan(field, token);
    if (span > 0) return 0.15 + 0.25 * (token.length / span);
  }
  return 0;
}

/**
 * 别名的折扣。打 `试算` 时名字里有这两个字的「路由试算…」要排在别名里有它的「路由」
 * 页前面；中文没有词界，名字对上多半只是「含有」（0.65），别名却是空格隔开的一串词，
 * 常常是「词首」（0.8）—— 折扣小了，别名反倒压过名字。
 */
const KEYWORD_WEIGHT = 0.6;

/**
 * 一条的分数。`title` 是显示的名字，`keywords` 是只用来搜的别名。
 * 查询为空时一律 1（全都出现，顺序由调用方定）。
 */
export function score(query: string, title: string, keywords: readonly string[] = []): number {
  const q = normalize(query);
  if (!q) return 1;
  const t = normalize(title);
  const ks = keywords.map(normalize).filter(Boolean);

  const one = (token: string) => {
    let best = fieldScore(t, token);
    for (const k of ks) {
      if (best >= 1) break;
      best = Math.max(best, fieldScore(k, token) * KEYWORD_WEIGHT);
    }
    return best;
  };

  // 整句先比一次：`new key` 作为一个整体命中 `New key` 比拆成两个词各自命中更准
  const whole = one(q);
  const tokens = q.split(" ");
  if (tokens.length === 1) return whole;
  let sum = 0;
  for (const token of tokens) {
    const s = one(token);
    if (s === 0) return whole;
    sum += s;
  }
  return Math.max(whole, (sum / tokens.length) * 0.95);
}

/**
 * 请求编号的查询：`#48123`、`48123`，至少两位。返回数字部分，不是就返回 `null`。
 */
export function requestIdQuery(query: string): string | null {
  const m = /^#?(\d{2,})$/.exec(normalize(query));
  return m ? m[1]! : null;
}
