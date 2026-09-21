/**
 * 把一段 JSON body 排成缩进两格的多行，供详情抽屉显示。
 *
 * **只动字符串外面的空白，不经过 `JSON.parse` 再 `stringify`。**那样写
 * 回来的已经不是发出去的那一份：`1.0` 变成 `1`，超过 2^53 的整数被改掉，
 * 数字样子的键被挪到最前面。排查时要看的恰恰是原样。
 *
 * **截断的也排。**body 超过上限只存开头，那一份 parse 不了，但开头照样
 * 值得读 —— 排到哪算哪。
 *
 * 不是**一个** JSON 值的返回 `null`，由调用方原样显示：SSE 流本来就是一行
 * 一个事件，NDJSON 也是，展开成几千行反而没法读。
 */
export function prettyJson(text: string, truncated: boolean): string | null {
  let i = skipSpace(text, 0);
  if (text.charAt(i) !== "{" && text.charAt(i) !== "[") return null;
  // 完整的 body 先确认它真是 JSON。一段以 `[` 开头的日志也会走到这里，
  // 按 JSON 排出来只会更乱
  if (!truncated && !parses(text)) return null;

  const out: string[] = [];
  let depth = 0;
  // 顶层的值已经结束。之后再出现内容，说明这不是一个值，是一串
  let done = false;
  const newline = () => "\n" + "  ".repeat(depth);

  while (i < text.length) {
    const c = text.charAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (done) return null;

    if (c === '"') {
      const end = stringEnd(text, i);
      out.push(text.slice(i, end));
      i = end;
    } else if (c === "[") {
      // **只装标量的数组写在一行。**`required: ["path", "content"]` 拆成
      // 四行是噪音；一个 embedding 的 1536 个数一行一个，展开就是一千多行
      const end = scalarArrayEnd(text, i);
      if (end < 0) {
        depth++;
        out.push("[", newline());
        i++;
        continue;
      }
      out.push(inlineArray(text, i, end));
      i = end + 1;
      if (depth === 0) done = true;
    } else if (c === "{") {
      const next = skipSpace(text, i + 1);
      if (text.charAt(next) === "}") {
        out.push("{}");
        i = next + 1;
        if (depth === 0) done = true;
        continue;
      }
      depth++;
      out.push("{", newline());
      i++;
    } else if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
      out.push(newline(), c);
      i++;
      if (depth === 0) done = true;
    } else if (c === ",") {
      out.push(",", newline());
      i++;
    } else if (c === ":") {
      out.push(": ");
      i++;
    } else {
      // 数字、true、false、null：照抄到下一个分隔符
      const end = bareEnd(text, i);
      out.push(text.slice(i, end));
      i = end;
    }
  }
  // 截断在逗号后面时，最后一行只剩缩进
  return out.join("").trimEnd();
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isSpace(c: string): boolean {
  return c === " " || c === "\n" || c === "\r" || c === "\t";
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && isSpace(text.charAt(i))) i++;
  return i;
}

/** 从开引号起，到闭引号之后。截断在字符串中间时到末尾 */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    if (text.charAt(j) === "\\") j += 2;
    else if (text.charAt(j) === '"') return j + 1;
    else j++;
  }
  return text.length;
}

/** 至少前进一个字符：截断的 body 不经过 parse，里面可能有任何东西 */
function bareEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && !isSpace(text.charAt(j)) && !",:{}[]\"".includes(text.charAt(j))) j++;
  return j;
}

/** `[` 对应的 `]` 的位置；里面有对象或数组、或者截断在中间，返回 -1 */
function scalarArrayEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    const c = text.charAt(j);
    if (c === '"') j = stringEnd(text, j);
    else if (c === "]") return j;
    else if (c === "{" || c === "[") return -1;
    else j++;
  }
  return -1;
}

function inlineArray(text: string, start: number, end: number): string {
  const parts: string[] = [];
  let i = start + 1;
  while (i < end) {
    const c = text.charAt(i);
    if (isSpace(c) || c === ",") {
      i++;
      continue;
    }
    const next = c === '"' ? stringEnd(text, i) : bareEnd(text, i);
    parts.push(text.slice(i, next));
    i = next;
  }
  return "[" + parts.join(", ") + "]";
}
