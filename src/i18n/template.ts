/**
 * `core.zh.json` 里那些句子的写法，以及把它们填成一句话。
 *
 * **Rust 那边有一份一模一样的实现**（`src-tauri/src/core_text.rs`）：系统通知的
 * 正文在 Rust 里写，也要说中文，而表只有一张。两边跑同一份用例
 * （`core.zh.cases.json`），说法对不上会先在测试里挂。
 *
 * 写法：
 *
 * - `{arg}`：参数原样填进去；
 * - `{arg:表}`：拿参数去 `tables` 里那张表查一个词；
 * - `{arg:表*}`：参数是 `a, b` 这样的一串，逐个查表，用顿号连起来；
 * - `{arg:表|退路}`：表里查不到时用「退路」（本身也是一段写法）；
 * - `{arg!names}`：core 用反引号括的名字（`` `官方`, `中转` ``）换成「官方」、「中转」；
 * - `{?arg:有|没有}`：参数在而且不是空串时用前一段，否则用后一段（`|没有` 可省）；
 * - `{{`、`}}`：字面的花括号（只在最外层；占位符里的 `}` 一律是收尾）。
 *
 * **缺一个参数、查不到一个词，整句就说不出来**（返回 `undefined`），调用处退回
 * core 的英文 —— 一句完整的英文好过一句缺了主语的中文。`{?arg:…}` 只是问一问，
 * 不算缺。
 */
export type Tables = Record<string, Record<string, string>>;
export type Args = Record<string, string>;

type Node =
  | { t: "text"; s: string }
  | { t: "arg"; arg: string; table?: string; list?: boolean; names?: boolean; fallback?: Node[] }
  | { t: "if"; arg: string; then: Node[]; else: Node[] };

class Bad extends Error {}

/** 解析一段写法，直到 `stops` 里的某个字符（顶层的）或结尾 */
function parse(src: string, at: { i: number }, stops: string): Node[] {
  const out: Node[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", s: text });
    text = "";
  };
  while (at.i < src.length) {
    const c = src[at.i]!;
    if (c === "{" && src[at.i + 1] === "{") {
      text += "{";
      at.i += 2;
    } else if (c === "}" && src[at.i + 1] === "}" && !stops.includes("}")) {
      // 字面的右括号只在最外层：占位符里的 `}` 一律是收尾
      text += "}";
      at.i += 2;
    } else if (stops.includes(c)) {
      break;
    } else if (c === "{") {
      flush();
      at.i += 1;
      out.push(placeholder(src, at));
    } else {
      text += c;
      at.i += 1;
    }
  }
  flush();
  return out;
}

function name(src: string, at: { i: number }): string {
  const m = /^[a-z_][a-z0-9_]*/.exec(src.slice(at.i));
  if (!m) throw new Bad(`bad name at ${at.i} in ${src}`);
  at.i += m[0].length;
  return m[0];
}

function expect(src: string, at: { i: number }, c: string) {
  if (src[at.i] !== c) throw new Bad(`expected ${c} at ${at.i} in ${src}`);
  at.i += 1;
}

function placeholder(src: string, at: { i: number }): Node {
  if (src[at.i] === "?") {
    at.i += 1;
    const arg = name(src, at);
    expect(src, at, ":");
    const then = parse(src, at, "|}");
    let els: Node[] = [];
    if (src[at.i] === "|") {
      at.i += 1;
      els = parse(src, at, "}");
    }
    expect(src, at, "}");
    return { t: "if", arg, then, else: els };
  }
  const arg = name(src, at);
  if (src[at.i] === "!") {
    at.i += 1;
    const f = name(src, at);
    if (f !== "names") throw new Bad(`unknown filter ${f}`);
    expect(src, at, "}");
    return { t: "arg", arg, names: true };
  }
  if (src[at.i] === ":") {
    at.i += 1;
    const table = name(src, at);
    let list = false;
    if (src[at.i] === "*") {
      list = true;
      at.i += 1;
    }
    let fallback: Node[] | undefined;
    if (src[at.i] === "|") {
      at.i += 1;
      fallback = parse(src, at, "}");
    }
    expect(src, at, "}");
    return { t: "arg", arg, table, list, fallback };
  }
  expect(src, at, "}");
  return { t: "arg", arg };
}

const cache = new Map<string, Node[]>();

/** 一段写法解析好的样子。**写错了就抛**：表是随代码一起发的，写错是开发时的事 */
export function compile(src: string): Node[] {
  let n = cache.get(src);
  if (!n) {
    const at = { i: 0 };
    n = parse(src, at, "");
    if (at.i !== src.length) throw new Bad(`unbalanced template: ${src}`);
    cache.set(src, n);
  }
  return n;
}

const names = (v: string) => v.replace(/`([^`]*)`/g, "「$1」").replace(/, /g, "、");

function run(nodes: Node[], args: Args, tables: Tables): string | undefined {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") {
      out += n.s;
      continue;
    }
    if (n.t === "if") {
      const v = args[n.arg];
      const r = run(v !== undefined && v !== "" ? n.then : n.else, args, tables);
      if (r === undefined) return undefined;
      out += r;
      continue;
    }
    const v = args[n.arg];
    if (v === undefined) return undefined;
    if (n.names) {
      out += names(v);
      continue;
    }
    if (n.table === undefined) {
      out += v;
      continue;
    }
    const table = tables[n.table];
    if (!table) throw new Bad(`unknown table ${n.table}`);
    if (n.list) {
      const words = v.split(", ").map((k) => table[k]);
      if (words.some((w) => w === undefined)) return undefined;
      out += words.join("、");
      continue;
    }
    const w = table[v];
    if (w !== undefined) {
      out += w;
      continue;
    }
    if (!n.fallback) return undefined;
    const r = run(n.fallback, args, tables);
    if (r === undefined) return undefined;
    out += r;
  }
  return out;
}

/** 按写法填一句话。说不出来是 `undefined` */
export function render(src: string, args: Args, tables: Tables): string | undefined {
  return run(compile(src), args, tables);
}
