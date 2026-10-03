import { StreamLanguage, type StreamParser } from "@codemirror/language";

/**
 * 只读代码框里的 JavaScript 着色。
 *
 * **自己写一个小的分词器，不引 `@codemirror/lang-javascript`。**这里只为审核时读得清：
 * 注释、字符串、关键字、数字分得出来就够了，不需要语法树、补全和检查。那个包连同
 * 它带进来的几个依赖比这一页别的部分加起来还大。
 *
 * 认得的：`//` 和 `/* *\/` 注释、三种引号的字符串（模板字符串里的 `${…}` 按代码着色，
 * 可以嵌套）、数字、关键字和几个常量。正则字面量当作普通的符号 —— 认错了也只是颜色
 * 不对，不影响读。
 */

const KEYWORDS = new Set(
  (
    "async await break case catch class const continue debugger default delete do else export extends " +
    "finally for function if import in instanceof let new of return static super switch this throw try " +
    "typeof var void while with yield"
  ).split(" "),
);
const ATOMS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

interface State {
  /** 在 `/* … *\/` 里面 */
  comment: boolean;
  /**
   * 模板字符串的嵌套：`"tpl"` 是正在模板的文字部分里，数字是 `${` 打开之后、代码里还开着
   * 几层 `{`
   */
  stack: ("tpl" | number)[];
}

const parser: StreamParser<State> = {
  name: "javascript",
  startState: () => ({ comment: false, stack: [] }),
  copyState: (s) => ({ comment: s.comment, stack: [...s.stack] }),
  token(stream, st) {
    if (st.comment) {
      if (stream.skipTo("*/")) {
        stream.pos += 2;
        st.comment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    const top = st.stack[st.stack.length - 1];
    if (top === "tpl") {
      while (!stream.eol()) {
        if (stream.peek() === "`") {
          if (stream.pos > stream.start) return "string";
          stream.next();
          st.stack.pop();
          return "string";
        }
        if (stream.match("${", false)) {
          if (stream.pos > stream.start) return "string";
          stream.match("${");
          st.stack.push(0);
          return "punctuation";
        }
        if (stream.next() === "\\") stream.next();
      }
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      st.comment = true;
      if (stream.skipTo("*/")) {
        stream.pos += 2;
        st.comment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    const ch = stream.next();
    if (ch === undefined) return null;
    if (ch === '"' || ch === "'") {
      let escaped = false;
      for (let c = stream.next(); c !== undefined; c = stream.next()) {
        if (c === ch && !escaped) break;
        escaped = !escaped && c === "\\";
      }
      return "string";
    }
    if (ch === "`") {
      st.stack.push("tpl");
      return "string";
    }
    if (ch === "{" || ch === "}") {
      if (typeof top === "number") {
        if (ch === "{") st.stack[st.stack.length - 1] = top + 1;
        else if (top === 0) {
          // `${…}` 合上了，回到模板字符串的文字里
          st.stack.pop();
          return "punctuation";
        } else st.stack[st.stack.length - 1] = top - 1;
      }
      return "brace";
    }
    if (/\d/.test(ch)) {
      stream.match(/^(?:[xX][\da-fA-F_]+|[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?)n?/);
      return "number";
    }
    if (/[A-Za-z_$]/.test(ch)) {
      stream.eatWhile(/[\w$]/);
      const word = stream.current();
      // `name:` 是对象里的键（清单里那几项，`default:` 也是），着键的颜色。switch 里的
      // `default:` 也会被当成键 —— 插件里少见，颜色错了也不影响读
      if (stream.match(/^\s*:(?!:)/, false)) return "propertyName";
      if (KEYWORDS.has(word)) return "keyword";
      if (ATOMS.has(word)) return "atom";
      return "variableName";
    }
    if (/[()[\];,.]/.test(ch)) return "punctuation";
    stream.eatWhile(/[=+\-*/%<>!&|^~?:]/);
    return "operator";
  },
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
};

export const javascript = StreamLanguage.define(parser);
